import { randomBytes } from 'node:crypto';
import { and, desc, eq, ilike, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import {
  adminUsers, apiKeys, invoices, kycSubmissions, merchants, merchantUsers, sessions, withdrawals,
} from '../../db/schema.js';
import { HttpError } from '../../lib/errors.js';
import { pagination, route } from '../../lib/http.js';
import { fromUnits, toUnits } from '../../lib/money.js';
import type { Guards } from '../../plugins/guards.js';
import { createAdmin } from '../auth/service.js';
import { getSubmission, listSubmissions, readDocument, reviewSubmission } from '../kyc/service.js';
import { getBalances, getRevenue } from '../ledger/service.js';
import { getLimits } from '../limits/service.js';
import { sendInBackground } from '../notifications/mailer.js';
import * as mails from '../notifications/templates.js';
import { listInvoices } from '../payments/invoices.js';
import { completeWithdrawal, listWithdrawals, rejectWithdrawal } from '../withdrawals/service.js';
import { audit, listAudit } from './audit.js';
import { ROLE_LABELS, ROLES } from './permissions.js';

const idParams = z.object({ id: z.string().min(1).max(64) });
const reason = z.object({ reason: z.string().trim().min(3, 'Indique un motif').max(500) });

export function registerAdminRoutes(app: FastifyInstance, ctx: AppContext, guards: Guards) {
  const { db, config } = ctx;
  const auth = 'admin_session' as const;
  const reviewer = async (req: FastifyRequest, permission: Parameters<Guards['admin']>[1]) =>
    ({ ctx, admin: await guards.admin(req, permission), ip: req.ip, log: req.log });

  // ------------------------------------------------------------------ Vue d'ensemble

  route(app, {
    method: 'GET', url: '/admin/overview', tags: ['Back-office'], auth,
    summary: 'Chiffres clés : files d\'attente, marchands, volume',
    handler: async ({ req }) => {
      await guards.admin(req, 'overview:read');
      const since = new Date(Date.now() - 30 * 24 * 3600_000);
      const [[m], [k], [w], [v]] = await Promise.all([
        db.select({
          total: sql<number>`count(*)::int`,
          verified: sql<number>`(count(*) filter (where ${merchants.verificationLevel} <> 'none'))::int`,
          business: sql<number>`(count(*) filter (where ${merchants.verificationLevel} = 'business'))::int`,
          suspended: sql<number>`(count(*) filter (where ${merchants.status} = 'suspended'))::int`,
        }).from(merchants),
        db.select({ pending: sql<number>`count(*)::int` }).from(kycSubmissions).where(eq(kycSubmissions.status, 'pending')),
        db.select({ pending: sql<number>`count(*)::int` }).from(withdrawals).where(eq(withdrawals.status, 'requested')),
        db.select({
          volume: sql<string>`coalesce(sum(${invoices.amountUsd}), 0)::text`,
          count: sql<number>`count(*)::int`,
        }).from(invoices).where(and(eq(invoices.status, 'paid'), sql`${invoices.updatedAt} >= ${since}`)),
      ]);
      return {
        merchants: m,
        pending_kyc: k?.pending ?? 0,
        pending_withdrawals: w?.pending ?? 0,
        paid_30d: { volume_usd: fromUnits(toUnits(v?.volume ?? '0')), count: v?.count ?? 0 },
      };
    },
  });

  // ------------------------------------------------------------------ Marchands

  route(app, {
    method: 'GET', url: '/admin/merchants', tags: ['Back-office · Marchands'], auth,
    summary: 'Rechercher des marchands',
    query: pagination.extend({
      q: z.string().trim().max(100).optional(),
      status: z.enum(['active', 'suspended']).optional(),
      level: z.enum(['none', 'personal', 'business']).optional(),
    }),
    handler: async ({ req, query }) => {
      await guards.admin(req, 'merchants:read');
      const emailOf = sql<string>`(select ${merchantUsers.email} from ${merchantUsers} where ${merchantUsers.merchantId} = ${merchants.id} limit 1)`;
      const search: SQL | undefined = query.q ? or(
        ilike(merchants.name, `%${query.q}%`),
        eq(merchants.id, query.q),
        sql`exists (select 1 from ${merchantUsers} where ${merchantUsers.merchantId} = ${merchants.id} and ${merchantUsers.email} ilike ${`%${query.q}%`})`,
      ) : undefined;
      const where = and(
        search,
        query.status ? eq(merchants.status, query.status) : undefined,
        query.level ? eq(merchants.verificationLevel, query.level) : undefined,
      );
      const [rows, [count]] = await Promise.all([
        db.select({ m: merchants, email: emailOf }).from(merchants).where(where)
          .orderBy(desc(merchants.createdAt)).limit(query.limit).offset(query.offset),
        db.select({ total: sql<number>`count(*)::int` }).from(merchants).where(where),
      ]);
      return {
        merchants: rows.map(({ m, email }) => ({
          id: m.id, name: m.name, email, account_type: m.accountType, verification_level: m.verificationLevel,
          status: m.status, created_at: m.createdAt.toISOString(),
        })),
        total: count?.total ?? 0,
      };
    },
  });

  route(app, {
    method: 'GET', url: '/admin/merchants/:id', tags: ['Back-office · Marchands'], auth,
    summary: 'Fiche marchand : soldes, limites, factures, retraits, vérifications',
    params: idParams,
    handler: async ({ req, params }) => {
      await guards.admin(req, 'merchants:read');
      const [m] = await db.select().from(merchants).where(eq(merchants.id, params.id));
      if (!m) throw new HttpError(404, 'not_found', 'Marchand introuvable');
      const [users, balances, limits, recentInvoices, recentWithdrawals, kyc, [keys]] = await Promise.all([
        db.select({ email: merchantUsers.email, verified: merchantUsers.emailVerifiedAt, created: merchantUsers.createdAt })
          .from(merchantUsers).where(eq(merchantUsers.merchantId, m.id)),
        getBalances(db, m.id),
        getLimits(db, config, m),
        listInvoices(db, config.PUBLIC_BASE_URL, { merchantId: m.id, limit: 10, offset: 0 }),
        listWithdrawals(db, { merchantId: m.id, limit: 10, offset: 0 }),
        db.select().from(kycSubmissions).where(eq(kycSubmissions.merchantId, m.id)).orderBy(desc(kycSubmissions.submittedAt)),
        db.select({ active: sql<number>`count(*)::int` }).from(apiKeys).where(and(eq(apiKeys.merchantId, m.id), isNull(apiKeys.revokedAt))),
      ]);
      return {
        id: m.id, name: m.name, account_type: m.accountType, verification_level: m.verificationLevel,
        status: m.status, suspended_reason: m.suspendedReason, webhook_url: m.webhookUrl,
        created_at: m.createdAt.toISOString(),
        users: users.map((u) => ({ email: u.email, email_verified: u.verified !== null, created_at: u.created.toISOString() })),
        balances, limits, active_api_keys: keys?.active ?? 0,
        invoices: recentInvoices, withdrawals: recentWithdrawals,
        kyc_submissions: kyc.map((s) => ({
          id: s.id, level: s.level, status: s.status, reject_reason: s.rejectReason,
          submitted_at: s.submittedAt.toISOString(), reviewed_at: s.reviewedAt?.toISOString() ?? null,
        })),
      };
    },
  });

  route(app, {
    method: 'POST', url: '/admin/merchants/:id/suspend', tags: ['Back-office · Marchands'], auth,
    summary: 'Suspendre un marchand (plus de paiements ni de retraits)',
    params: idParams, body: reason,
    handler: async ({ req, params, body }) => {
      const admin = await guards.admin(req, 'merchants:suspend');
      const [m] = await db.transaction(async (tx) => {
        const rows = await tx.update(merchants).set({ status: 'suspended', suspendedReason: body.reason })
          .where(and(eq(merchants.id, params.id), eq(merchants.status, 'active'))).returning();
        if (!rows.length) throw new HttpError(409, 'not_active', 'Marchand introuvable ou déjà suspendu');
        await audit(tx, { adminId: admin.id, action: 'merchant.suspend', targetType: 'merchant', targetId: params.id, ip: req.ip, details: { reason: body.reason } });
        return rows;
      });
      const users = await db.select({ email: merchantUsers.email }).from(merchantUsers).where(eq(merchantUsers.merchantId, m!.id));
      for (const u of users) sendInBackground(ctx.mailer, req.log, mails.merchantSuspended(u.email, body.reason));
      return { ok: true };
    },
  });

  route(app, {
    method: 'POST', url: '/admin/merchants/:id/reactivate', tags: ['Back-office · Marchands'], auth,
    summary: 'Réactiver un marchand suspendu',
    params: idParams,
    handler: async ({ req, params }) => {
      const admin = await guards.admin(req, 'merchants:suspend');
      await db.transaction(async (tx) => {
        const rows = await tx.update(merchants).set({ status: 'active', suspendedReason: null })
          .where(and(eq(merchants.id, params.id), eq(merchants.status, 'suspended'))).returning();
        if (!rows.length) throw new HttpError(409, 'not_suspended', 'Marchand introuvable ou non suspendu');
        await audit(tx, { adminId: admin.id, action: 'merchant.reactivate', targetType: 'merchant', targetId: params.id, ip: req.ip });
      });
      return { ok: true };
    },
  });

  // ------------------------------------------------------------------ Vérifications (KYC / KYB)

  route(app, {
    method: 'GET', url: '/admin/kyc', tags: ['Back-office · Vérifications'], auth,
    summary: 'Dossiers de vérification (en attente par défaut, plus anciens d\'abord)',
    query: pagination.extend({ status: z.enum(['pending', 'approved', 'rejected']).default('pending') }),
    handler: async ({ req, query }) => {
      await guards.admin(req, 'kyc:read');
      return listSubmissions(db, query);
    },
  });

  route(app, {
    method: 'GET', url: '/admin/kyc/:id', tags: ['Back-office · Vérifications'], auth,
    summary: 'Détail d\'un dossier (données, documents, historique)',
    params: idParams,
    handler: async ({ req, params }) => {
      await guards.admin(req, 'kyc:read');
      return getSubmission(db, params.id);
    },
  });

  route(app, {
    method: 'GET', url: '/admin/kyc/documents/:id', tags: ['Back-office · Vérifications'], auth,
    summary: 'Télécharger un document (accès tracé)',
    params: idParams,
    handler: async ({ req, reply, params }) => {
      const admin = await guards.admin(req, 'kyc:read');
      const { doc, data } = await readDocument(ctx, params.id);
      // Consulter une pièce d'identité est une donnée sensible : chaque accès est tracé
      await audit(db, { adminId: admin.id, action: 'kyc.document_view', targetType: 'kyc_document', targetId: doc.id, ip: req.ip });
      return reply
        .header('content-type', doc.mimeType)
        .header('content-disposition', `inline; filename="${doc.fileName.replace(/[^\w.\-]/g, '_')}"`)
        .header('cache-control', 'private, no-store')
        .header('x-content-type-options', 'nosniff')
        .send(data);
    },
  });

  route(app, {
    method: 'POST', url: '/admin/kyc/:id/approve', tags: ['Back-office · Vérifications'], auth,
    summary: 'Valider un dossier',
    params: idParams,
    handler: async ({ req, params }) => reviewSubmission(await reviewer(req, 'kyc:review'), params.id, { approve: true }),
  });

  route(app, {
    method: 'POST', url: '/admin/kyc/:id/reject', tags: ['Back-office · Vérifications'], auth,
    summary: 'Refuser un dossier (le motif est envoyé au marchand)',
    params: idParams, body: reason,
    handler: async ({ req, params, body }) =>
      reviewSubmission(await reviewer(req, 'kyc:review'), params.id, { approve: false, reason: body.reason }),
  });

  // ------------------------------------------------------------------ Retraits

  route(app, {
    method: 'GET', url: '/admin/withdrawals', tags: ['Back-office · Retraits'], auth,
    summary: 'Retraits (à traiter par défaut)',
    query: pagination.extend({ status: z.enum(['requested', 'completed', 'rejected']).default('requested') }),
    handler: async ({ req, query }) => {
      await guards.admin(req, 'withdrawals:read');
      return listWithdrawals(db, query);
    },
  });

  route(app, {
    method: 'POST', url: '/admin/withdrawals/:id/complete', tags: ['Back-office · Retraits'], auth,
    summary: 'Confirmer l\'envoi des fonds (hash de la transaction)',
    params: idParams,
    body: z.object({ tx_hash: z.string().trim().min(10).max(200) }),
    handler: async ({ req, params, body }) => completeWithdrawal(await reviewer(req, 'withdrawals:process'), params.id, body.tx_hash),
  });

  route(app, {
    method: 'POST', url: '/admin/withdrawals/:id/reject', tags: ['Back-office · Retraits'], auth,
    summary: 'Refuser un retrait (le montant est recrédité)',
    params: idParams, body: reason,
    handler: async ({ req, params, body }) => rejectWithdrawal(await reviewer(req, 'withdrawals:process'), params.id, body.reason),
  });

  route(app, {
    method: 'GET', url: '/admin/revenue', tags: ['Back-office · Retraits'], auth,
    summary: 'Revenus de la plateforme par crypto',
    handler: async ({ req }) => {
      await guards.admin(req, 'revenue:read');
      return { revenue: await getRevenue(db) };
    },
  });

  // ------------------------------------------------------------------ Journal

  route(app, {
    method: 'GET', url: '/admin/audit-log', tags: ['Back-office · Équipe'], auth,
    summary: 'Journal des actions de l\'équipe',
    query: pagination,
    handler: async ({ req, query }) => {
      await guards.admin(req, 'audit:read');
      return listAudit(db, query);
    },
  });

  // ------------------------------------------------------------------ Équipe

  const presentAdmin = (a: typeof adminUsers.$inferSelect) => ({
    id: a.id, email: a.email, role: a.role, disabled: a.disabledAt !== null, created_at: a.createdAt.toISOString(),
  });

  route(app, {
    method: 'GET', url: '/admin/team', tags: ['Back-office · Équipe'], auth,
    summary: 'Membres de l\'équipe et rôles disponibles',
    handler: async ({ req }) => {
      await guards.admin(req, 'team:manage');
      const rows = await db.select().from(adminUsers).orderBy(adminUsers.createdAt);
      return { members: rows.map(presentAdmin), roles: ROLES.map((r) => ({ id: r, label: ROLE_LABELS[r] })) };
    },
  });

  route(app, {
    method: 'POST', url: '/admin/team', tags: ['Back-office · Équipe'], auth,
    summary: 'Ajouter un membre (mot de passe généré, affiché une seule fois)',
    body: z.object({ email: z.email().max(200), role: z.enum(ROLES) }),
    handler: async ({ req, reply, body }) => {
      const admin = await guards.admin(req, 'team:manage');
      const password = randomBytes(12).toString('base64url');
      const id = await createAdmin(db, body.email, password, body.role);
      await audit(db, { adminId: admin.id, action: 'team.create', targetType: 'admin', targetId: id, ip: req.ip, details: { email: body.email, role: body.role } });
      return reply.status(201).send({ id, email: body.email.toLowerCase(), role: body.role, password });
    },
  });

  route(app, {
    method: 'PUT', url: '/admin/team/:id', tags: ['Back-office · Équipe'], auth,
    summary: 'Changer le rôle ou désactiver / réactiver un membre',
    params: idParams,
    body: z.object({ role: z.enum(ROLES).optional(), disabled: z.boolean().optional() }),
    handler: async ({ req, params, body }) => {
      const admin = await guards.admin(req, 'team:manage');
      if (params.id === admin.id) throw new HttpError(400, 'self_change', 'Tu ne peux pas modifier ton propre compte');
      return db.transaction(async (tx) => {
        const [target] = await tx.select().from(adminUsers).where(eq(adminUsers.id, params.id)).for('update');
        if (!target) throw new HttpError(404, 'not_found', 'Membre introuvable');
        const losesOwner = target.role === 'owner' && !target.disabledAt && (body.disabled === true || (body.role && body.role !== 'owner'));
        if (losesOwner) {
          const [{ owners }] = await tx.select({ owners: sql<number>`count(*)::int` }).from(adminUsers)
            .where(and(eq(adminUsers.role, 'owner'), isNull(adminUsers.disabledAt), ne(adminUsers.id, target.id))) as [{ owners: number }];
          if (owners === 0) throw new HttpError(409, 'last_owner', 'Il doit rester au moins un propriétaire actif');
        }
        const [updated] = await tx.update(adminUsers).set({
          ...(body.role && { role: body.role }),
          ...(body.disabled !== undefined && { disabledAt: body.disabled ? new Date() : null }),
        }).where(eq(adminUsers.id, target.id)).returning();
        // Un membre désactivé est déconnecté immédiatement
        if (body.disabled) await tx.delete(sessions).where(eq(sessions.userId, target.id));
        await audit(tx, { adminId: admin.id, action: 'team.update', targetType: 'admin', targetId: target.id, ip: req.ip, details: body });
        return presentAdmin(updated!);
      });
    },
  });
}
