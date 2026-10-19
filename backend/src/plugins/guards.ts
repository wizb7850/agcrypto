import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '../db/client.js';
import { adminUsers, apiKeys, merchants, merchantUsers } from '../db/schema.js';
import { readCookie, serializeCookie } from '../lib/cookies.js';
import { HttpError } from '../lib/errors.js';
import { sha256 } from '../lib/security.js';
import { can, type Permission } from '../modules/admin/permissions.js';
import { resolveSession, SESSION_TTL_HOURS, type SessionKind } from '../modules/auth/service.js';

export type MerchantRow = typeof merchants.$inferSelect;
export type AdminRow = typeof adminUsers.$inferSelect;

export interface MerchantPrincipal {
  merchant: MerchantRow;
  /** null quand l'appel vient d'une clé API (serveur du marchand) */
  user: { id: string; email: string; emailVerified: boolean } | null;
  via: 'api_key' | 'session';
}

export const SESSION_COOKIE: Record<SessionKind, string> = { merchant: 'agc_merchant', admin: 'agc_admin' };

export function setSessionCookie(reply: FastifyReply, kind: SessionKind, token: string, secure: boolean) {
  reply.header('set-cookie', serializeCookie(SESSION_COOKIE[kind], token, { maxAgeSeconds: SESSION_TTL_HOURS * 3600, secure }));
}

export function clearSessionCookie(reply: FastifyReply, kind: SessionKind, secure: boolean) {
  reply.header('set-cookie', serializeCookie(SESSION_COOKIE[kind], '', { maxAgeSeconds: 0, secure }));
}

export const sessionToken = (req: FastifyRequest, kind: SessionKind) => readCookie(req.headers.cookie, SESSION_COOKIE[kind]);

/**
 * Protection CSRF pour les actions faites avec un cookie de session : le frontend ajoute
 * l'en-tête x-agcrypto-csrf, qu'un autre site ne peut pas ajouter à une requête vers notre API.
 */
export function requireCsrf(req: FastifyRequest) {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-agcrypto-csrf'] !== '1') {
    throw new HttpError(403, 'csrf', 'Requête refusée (en-tête x-agcrypto-csrf manquant)');
  }
}

const bearer = (req: FastifyRequest) => req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];

export function createGuards(db: Db) {
  return {
    /**
     * Authentifie un marchand :
     *  - par clé API (Authorization: Bearer agc_...) : le site du marchand, de serveur à serveur ;
     *  - par session (cookie) : le marchand connecté à son tableau de bord.
     */
    async merchant(req: FastifyRequest, opts: {
      via?: 'any' | 'session';
      allowUnverifiedEmail?: boolean;
      requireActive?: boolean;
    } = {}): Promise<MerchantPrincipal> {
      const key = bearer(req);
      let principal: MerchantPrincipal;

      if (key && opts.via !== 'session') {
        const [row] = await db.select({ merchant: merchants }).from(apiKeys)
          .innerJoin(merchants, eq(merchants.id, apiKeys.merchantId))
          .where(and(eq(apiKeys.keyHash, sha256(key)), isNull(apiKeys.revokedAt)));
        if (!row) throw new HttpError(401, 'unauthorized', 'Clé API invalide ou révoquée');
        principal = { merchant: row.merchant, user: null, via: 'api_key' };
      } else {
        const session = await resolveSession(db, 'merchant', sessionToken(req, 'merchant'));
        if (!session) throw new HttpError(401, 'unauthorized', 'Connexion requise');
        const [row] = await db.select({ user: merchantUsers, merchant: merchants }).from(merchantUsers)
          .innerJoin(merchants, eq(merchants.id, merchantUsers.merchantId))
          .where(eq(merchantUsers.id, session.userId));
        if (!row) throw new HttpError(401, 'unauthorized', 'Connexion requise');
        requireCsrf(req);
        const emailVerified = row.user.emailVerifiedAt !== null;
        if (!emailVerified && !opts.allowUnverifiedEmail) {
          throw new HttpError(403, 'email_not_verified', 'Vérifie d\'abord ton adresse e-mail');
        }
        principal = { merchant: row.merchant, user: { id: row.user.id, email: row.user.email, emailVerified }, via: 'session' };
      }

      if (opts.requireActive && principal.merchant.status !== 'active') {
        throw new HttpError(403, 'account_suspended', 'Ton compte est suspendu. Contacte le support.');
      }
      return principal;
    },

    /** Authentifie un membre de l'équipe et vérifie qu'il a la permission demandée. */
    async admin(req: FastifyRequest, permission?: Permission): Promise<AdminRow> {
      const session = await resolveSession(db, 'admin', sessionToken(req, 'admin'));
      const [admin] = session ? await db.select().from(adminUsers).where(eq(adminUsers.id, session.userId)) : [];
      if (!admin || admin.disabledAt) throw new HttpError(401, 'unauthorized', 'Connexion requise');
      requireCsrf(req);
      if (permission && !can(admin.role, permission)) {
        throw new HttpError(403, 'forbidden', 'Ton rôle ne permet pas cette action');
      }
      return admin;
    },
  };
}

export type Guards = ReturnType<typeof createGuards>;
