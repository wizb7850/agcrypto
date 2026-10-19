import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { HttpError } from '../../lib/errors.js';
import { route } from '../../lib/http.js';
import { RateLimiter } from '../../lib/rate-limit.js';
import {
  clearSessionCookie, type Guards, requireCsrf, sessionToken, setSessionCookie,
} from '../../plugins/guards.js';
import { permissionsOf } from '../admin/permissions.js';
import { sendInBackground } from '../notifications/mailer.js';
import * as mails from '../notifications/templates.js';
import {
  changePassword, checkCredentials, createSession, deleteSession, issueEmailCode, issuePasswordReset,
  resetPassword, type SessionKind, signupMerchant, verifyEmailCode,
} from './service.js';

const email = z.email('E-mail invalide').max(200);
const newPassword = z.string().min(10, 'Le mot de passe doit faire au moins 10 caractères').max(200);
const credentials = z.object({ email, password: z.string().min(1).max(200) });

export function registerAuthRoutes(app: FastifyInstance, ctx: AppContext, guards: Guards) {
  const { db, config, mailer } = ctx;
  const secure = config.PUBLIC_BASE_URL.startsWith('https://');
  const tags = ['Authentification'];

  // Limites anti-abus (par adresse IP et/ou par compte)
  const loginLimiter = new RateLimiter(10, 15 * 60_000, 'Trop de tentatives de connexion. Réessaie dans 15 minutes.');
  const signupLimiter = new RateLimiter(10, 60 * 60_000, 'Trop d\'inscriptions depuis cette adresse. Réessaie plus tard.');
  const resendLimiter = new RateLimiter(1, 60_000, 'Attends une minute avant de redemander un code.');
  const forgotLimiter = new RateLimiter(5, 15 * 60_000, 'Trop de demandes. Réessaie dans 15 minutes.');

  async function login(kind: SessionKind, req: FastifyRequest, body: z.output<typeof credentials>) {
    requireCsrf(req);
    const key = `${kind}|${req.ip}|${body.email.toLowerCase()}`;
    loginLimiter.check(key);
    try {
      const userId = await checkCredentials(db, kind, body.email, body.password);
      loginLimiter.reset(key);
      return await createSession(db, kind, userId);
    } catch (e) {
      loginLimiter.hit(key);
      throw e;
    }
  }

  // ------------------------------------------------------------------ Marchands

  route(app, {
    method: 'POST', url: '/auth/merchant/signup', tags, auth: 'public',
    summary: 'Créer un compte marchand',
    description: 'Crée le compte, envoie un code de vérification par e-mail et ouvre une session.',
    body: z.object({
      account_type: z.enum(['personal', 'business']),
      name: z.string().trim().min(2, 'Nom trop court').max(100),
      email,
      password: newPassword,
    }),
    handler: async ({ req, reply, body }) => {
      requireCsrf(req);
      signupLimiter.consume(req.ip);
      const user = await signupMerchant(db, {
        accountType: body.account_type, name: body.name, email: body.email, password: body.password,
      });
      const code = await issueEmailCode(db, user.userId);
      sendInBackground(mailer, req.log, mails.emailVerification(user.email, code));
      setSessionCookie(reply, 'merchant', await createSession(db, 'merchant', user.userId), secure);
      return reply.status(201).send({ email_verification_required: true });
    },
  });

  route(app, {
    method: 'POST', url: '/auth/merchant/verify-email', tags, auth: 'merchant_session',
    summary: 'Valider l\'adresse e-mail avec le code reçu',
    body: z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Le code contient 6 chiffres') }),
    handler: async ({ req, body }) => {
      const p = await guards.merchant(req, { via: 'session', allowUnverifiedEmail: true });
      if (p.user!.emailVerified) return { ok: true };
      await verifyEmailCode(db, p.user!.id, body.code);
      return { ok: true };
    },
  });

  route(app, {
    method: 'POST', url: '/auth/merchant/resend-verification', tags, auth: 'merchant_session',
    summary: 'Renvoyer un code de vérification',
    handler: async ({ req }) => {
      const p = await guards.merchant(req, { via: 'session', allowUnverifiedEmail: true });
      if (p.user!.emailVerified) throw new HttpError(400, 'already_verified', 'Ton e-mail est déjà vérifié');
      resendLimiter.consume(p.user!.id);
      sendInBackground(mailer, req.log, mails.emailVerification(p.user!.email, await issueEmailCode(db, p.user!.id)));
      return { ok: true };
    },
  });

  route(app, {
    method: 'POST', url: '/auth/merchant/login', tags, auth: 'public',
    summary: 'Se connecter au tableau de bord marchand',
    body: credentials,
    handler: async ({ req, reply, body }) => {
      setSessionCookie(reply, 'merchant', await login('merchant', req, body), secure);
      return { ok: true };
    },
  });

  route(app, {
    method: 'POST', url: '/auth/merchant/logout', tags, auth: 'merchant_session',
    summary: 'Se déconnecter',
    handler: async ({ req, reply }) => {
      requireCsrf(req);
      const token = sessionToken(req, 'merchant');
      if (token) await deleteSession(db, token);
      clearSessionCookie(reply, 'merchant', secure);
      return { ok: true };
    },
  });

  route(app, {
    method: 'GET', url: '/auth/merchant/me', tags, auth: 'merchant_session',
    summary: 'Compte connecté',
    handler: async ({ req }) => {
      const p = await guards.merchant(req, { via: 'session', allowUnverifiedEmail: true });
      const m = p.merchant;
      return {
        user: { id: p.user!.id, email: p.user!.email, email_verified: p.user!.emailVerified },
        merchant: {
          id: m.id, name: m.name, account_type: m.accountType, verification_level: m.verificationLevel,
          status: m.status, suspended_reason: m.suspendedReason, created_at: m.createdAt.toISOString(),
        },
      };
    },
  });

  route(app, {
    method: 'POST', url: '/auth/merchant/password/forgot', tags, auth: 'public',
    summary: 'Mot de passe oublié',
    description: 'Envoie un lien de réinitialisation si le compte existe. La réponse est identique dans tous les cas.',
    body: z.object({ email }),
    handler: async ({ req, body }) => {
      requireCsrf(req);
      forgotLimiter.consume(`${req.ip}|${body.email.toLowerCase()}`);
      const reset = await issuePasswordReset(db, body.email);
      if (reset) {
        const url = `${config.APP_URL}/reinitialiser-mot-de-passe?token=${encodeURIComponent(reset.token)}`;
        sendInBackground(mailer, req.log, mails.passwordReset(reset.email, url));
      }
      return { ok: true };
    },
  });

  route(app, {
    method: 'POST', url: '/auth/merchant/password/reset', tags, auth: 'public',
    summary: 'Choisir un nouveau mot de passe (lien reçu par e-mail)',
    body: z.object({ token: z.string().min(20).max(200), password: newPassword }),
    handler: async ({ req, body }) => {
      requireCsrf(req);
      const userEmail = await resetPassword(db, body.token, body.password);
      sendInBackground(mailer, req.log, mails.passwordChanged(userEmail));
      return { ok: true };
    },
  });

  route(app, {
    method: 'POST', url: '/auth/merchant/password/change', tags, auth: 'merchant_session',
    summary: 'Changer de mot de passe',
    description: 'Ferme toutes les autres sessions.',
    body: z.object({ current_password: z.string().min(1).max(200), new_password: newPassword }),
    handler: async ({ req, reply, body }) => {
      const p = await guards.merchant(req, { via: 'session' });
      const userEmail = await changePassword(db, p.user!.id, body.current_password, body.new_password);
      setSessionCookie(reply, 'merchant', await createSession(db, 'merchant', p.user!.id), secure);
      sendInBackground(mailer, req.log, mails.passwordChanged(userEmail));
      return { ok: true };
    },
  });

  // ------------------------------------------------------------------ Équipe back-office

  const adminTags = ['Authentification équipe'];

  route(app, {
    method: 'POST', url: '/auth/admin/login', tags: adminTags, auth: 'public',
    summary: 'Se connecter au back-office',
    body: credentials,
    handler: async ({ req, reply, body }) => {
      setSessionCookie(reply, 'admin', await login('admin', req, body), secure);
      return { ok: true };
    },
  });

  route(app, {
    method: 'POST', url: '/auth/admin/logout', tags: adminTags, auth: 'admin_session',
    summary: 'Se déconnecter du back-office',
    handler: async ({ req, reply }) => {
      requireCsrf(req);
      const token = sessionToken(req, 'admin');
      if (token) await deleteSession(db, token);
      clearSessionCookie(reply, 'admin', secure);
      return { ok: true };
    },
  });

  route(app, {
    method: 'GET', url: '/auth/admin/me', tags: adminTags, auth: 'admin_session',
    summary: 'Membre de l\'équipe connecté et ses permissions',
    handler: async ({ req }) => {
      const a = await guards.admin(req);
      return { id: a.id, email: a.email, role: a.role, permissions: permissionsOf(a.role) };
    },
  });
}
