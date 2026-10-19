import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { apiKeys, invoices, merchants, withdrawals } from '../../db/schema.js';
import { HttpError } from '../../lib/errors.js';
import { fromUnits, toUnits } from '../../lib/money.js';
import { route } from '../../lib/http.js';
import { generateApiKey, generateWebhookSecret, newId } from '../../lib/security.js';
import type { Guards } from '../../plugins/guards.js';
import { getBalances } from '../ledger/service.js';
import { getLimits, supportedPriceCurrencies } from '../limits/service.js';
import { listInvoices } from '../payments/invoices.js';

// Tableau de bord marchand : vue d'ensemble, limites, réglages d'intégration (clés API, webhook).

export function registerMerchantRoutes(app: FastifyInstance, ctx: AppContext, guards: Guards) {
  const { db, config } = ctx;
  const auth = ['api_key', 'merchant_session'] as const;

  route(app, {
    method: 'GET', url: '/v1/balance', tags: ['Soldes'], auth: [...auth],
    summary: 'Soldes disponibles par crypto',
    handler: async ({ req }) => ({ balances: await getBalances(db, (await guards.merchant(req)).merchant.id) }),
  });

  route(app, {
    method: 'GET', url: '/v1/limits', tags: ['Compte'], auth: [...auth],
    summary: 'Niveau de vérification et limites (encaissement, retrait)',
    handler: async ({ req }) => getLimits(db, config, (await guards.merchant(req)).merchant),
  });

  route(app, {
    method: 'GET', url: '/v1/dashboard', tags: ['Compte'], auth: 'merchant_session',
    summary: 'Vue d\'ensemble du tableau de bord',
    handler: async ({ req }) => {
      const { merchant } = await guards.merchant(req, { via: 'session' });
      const since = new Date(Date.now() - 30 * 24 * 3600_000);
      const [balances, limits, recent, [stats], [pendingW]] = await Promise.all([
        getBalances(db, merchant.id),
        getLimits(db, config, merchant),
        listInvoices(db, config.PUBLIC_BASE_URL, { merchantId: merchant.id, limit: 5, offset: 0 }),
        db.select({
          volume: sql<string>`coalesce(sum(${invoices.amountUsd}) filter (where ${invoices.status} = 'paid'), 0)::text`,
          paid: sql<number>`(count(*) filter (where ${invoices.status} = 'paid'))::int`,
          total: sql<number>`count(*)::int`,
        }).from(invoices).where(and(eq(invoices.merchantId, merchant.id), gte(invoices.createdAt, since))),
        db.select({ count: sql<number>`count(*)::int` }).from(withdrawals)
          .where(and(eq(withdrawals.merchantId, merchant.id), eq(withdrawals.status, 'requested'))),
      ]);
      return {
        balances,
        limits,
        stats_30d: {
          volume_usd: fromUnits(toUnits(stats?.volume ?? '0')),
          paid_invoices: stats?.paid ?? 0,
          created_invoices: stats?.total ?? 0,
          conversion_rate: stats?.total ? Math.round(((stats.paid ?? 0) / stats.total) * 100) : 0,
        },
        pending_withdrawals: pendingW?.count ?? 0,
        recent_invoices: recent.invoices,
      };
    },
  });

  // ---------------------------------------------------------------- Réglages

  route(app, {
    method: 'GET', url: '/v1/settings', tags: ['Intégration'], auth: 'merchant_session',
    summary: 'Réglages d\'intégration (webhook) et paramètres du compte',
    handler: async ({ req }) => {
      const { merchant } = await guards.merchant(req, { via: 'session' });
      return {
        name: merchant.name,
        webhook_url: merchant.webhookUrl,
        webhook_secret: merchant.webhookSecret,
        price_currencies: supportedPriceCurrencies(config).map((c) => c.toUpperCase()),
        checkout_currencies: config.CHECKOUT_CURRENCIES,
        fees: {
          payment_percent: config.PAYMENT_FEE_PERCENT,
          withdrawal_percent: config.WITHDRAWAL_FEE_PERCENT,
          withdrawal_fixed: config.WITHDRAWAL_FIXED_FEES,
        },
      };
    },
  });

  route(app, {
    method: 'PUT', url: '/v1/settings', tags: ['Intégration'], auth: 'merchant_session',
    summary: 'Modifier l\'URL de webhook',
    body: z.object({
      webhook_url: z.url().refine(
        (u) => config.NOWPAYMENTS_ENV === 'demo' || u.startsWith('https://'),
        'L\'URL doit commencer par https://',
      ).nullable(),
    }),
    handler: async ({ req, body }) => {
      const { merchant } = await guards.merchant(req, { via: 'session' });
      await db.update(merchants).set({ webhookUrl: body.webhook_url }).where(eq(merchants.id, merchant.id));
      return { ok: true };
    },
  });

  route(app, {
    method: 'POST', url: '/v1/settings/webhook-secret', tags: ['Intégration'], auth: 'merchant_session',
    summary: 'Générer un nouveau secret de webhook',
    description: 'L\'ancien secret cesse immédiatement de fonctionner.',
    handler: async ({ req }) => {
      const { merchant } = await guards.merchant(req, { via: 'session', requireActive: true });
      const secret = generateWebhookSecret();
      await db.update(merchants).set({ webhookSecret: secret }).where(eq(merchants.id, merchant.id));
      return { webhook_secret: secret };
    },
  });

  // ---------------------------------------------------------------- Clés API

  route(app, {
    method: 'GET', url: '/v1/api-keys', tags: ['Intégration'], auth: 'merchant_session',
    summary: 'Lister les clés API',
    handler: async ({ req }) => {
      const { merchant } = await guards.merchant(req, { via: 'session' });
      const rows = await db.select().from(apiKeys).where(eq(apiKeys.merchantId, merchant.id)).orderBy(desc(apiKeys.createdAt));
      return {
        api_keys: rows.map((k) => ({
          id: k.id, name: k.name, prefix: k.prefix, created_at: k.createdAt.toISOString(),
          revoked_at: k.revokedAt?.toISOString() ?? null,
        })),
      };
    },
  });

  route(app, {
    method: 'POST', url: '/v1/api-keys', tags: ['Intégration'], auth: 'merchant_session',
    summary: 'Créer une clé API',
    description: 'La clé complète n\'est affichée qu\'une seule fois : seule son empreinte est conservée.',
    body: z.object({ name: z.string().trim().max(60).optional() }),
    handler: async ({ req, reply, body }) => {
      const { merchant } = await guards.merchant(req, { via: 'session', requireActive: true });
      const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(apiKeys)
        .where(and(eq(apiKeys.merchantId, merchant.id), isNull(apiKeys.revokedAt))) as [{ count: number }];
      if (count >= 10) throw new HttpError(409, 'too_many_keys', 'Maximum 10 clés actives : révoque une clé inutilisée');
      const k = generateApiKey();
      const id = newId('key');
      await db.insert(apiKeys).values({ id, merchantId: merchant.id, keyHash: k.hash, prefix: k.prefix, name: body.name || null });
      return reply.status(201).send({ id, key: k.key, prefix: k.prefix, name: body.name || null });
    },
  });

  route(app, {
    method: 'DELETE', url: '/v1/api-keys/:id', tags: ['Intégration'], auth: 'merchant_session',
    summary: 'Révoquer une clé API',
    params: z.object({ id: z.string() }),
    handler: async ({ req, params }) => {
      const { merchant } = await guards.merchant(req, { via: 'session' });
      const [k] = await db.update(apiKeys).set({ revokedAt: new Date() })
        .where(and(eq(apiKeys.id, params.id), eq(apiKeys.merchantId, merchant.id), isNull(apiKeys.revokedAt)))
        .returning();
      if (!k) throw new HttpError(404, 'not_found', 'Clé introuvable ou déjà révoquée');
      return { ok: true };
    },
  });
}
