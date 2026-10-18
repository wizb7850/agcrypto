import { and, eq, isNull } from 'drizzle-orm';
import Fastify, { type FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Config } from './config.js';
import type { Db } from './db/client.js';
import { apiKeys } from './db/schema.js';
import { safeEqual, sha256 } from './lib/security.js';
import { type NowPaymentsApi, verifyIpnSignature } from './providers/nowpayments.js';
import { HttpError } from './services/errors.js';
import { createInvoice, getInvoice, presentInvoice } from './services/invoices.js';
import { handleIpn } from './services/ipn.js';
import { getBalances, getRevenue } from './services/ledger.js';
import {
  completeWithdrawal, listWithdrawals, quoteWithdrawal, rejectWithdrawal, requestWithdrawal,
} from './services/withdrawals.js';
import { registerCheckoutRoutes } from './routes/checkout.js';

export interface AppDeps {
  db: Db;
  config: Pick<Config,
    | 'PUBLIC_BASE_URL' | 'NOWPAYMENTS_IPN_SECRET' | 'ADMIN_TOKEN' | 'LOG_LEVEL' | 'PAYMENT_FEE_PERCENT'
    | 'WITHDRAWAL_FEE_PERCENT' | 'WITHDRAWAL_FIXED_FEES' | 'CHECKOUT_CURRENCIES' | 'INVOICE_TTL_MINUTES'>;
  nowpayments: NowPaymentsApi;
}

const decimal = z.string().regex(/^\d+(\.\d{1,18})?$/, 'Montant décimal attendu, ex. "49.99"');
const currency = z.string().regex(/^[a-zA-Z0-9]{2,20}$/);

const createInvoiceBody = z.object({
  amount: decimal,
  currency,
  order_id: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  success_url: z.url().optional(),
  cancel_url: z.url().optional(),
});

const withdrawalBody = z.object({
  currency,
  amount: decimal,
  address: z.string().min(10).max(200),
  extra_id: z.string().max(100).optional(),
});

function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) throw new HttpError(400, 'invalid_request', z.prettifyError(r.error));
  return r.data;
}

const bearer = (req: FastifyRequest) => req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];

export function buildApp({ db, config, nowpayments }: AppDeps) {
  const app = Fastify({ logger: { level: config.LOG_LEVEL } });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      return reply.status(err.statusCode).send({ error: err.code, message: err.message });
    }
    if (err instanceof z.ZodError) {
      return reply.status(400).send({ error: 'invalid_request', message: z.prettifyError(err) });
    }
    const { statusCode, message } = err as { statusCode?: number; message?: string };
    if (statusCode && statusCode < 500) return reply.status(statusCode).send({ error: 'bad_request', message });
    req.log.error(err);
    return reply.status(500).send({ error: 'internal_error', message: 'Erreur interne' });
  });

  async function merchantAuth(req: FastifyRequest): Promise<string> {
    const key = bearer(req);
    if (!key) throw new HttpError(401, 'unauthorized', 'Clé API manquante');
    const [row] = await db.select({ merchantId: apiKeys.merchantId }).from(apiKeys)
      .where(and(eq(apiKeys.keyHash, sha256(key)), isNull(apiKeys.revokedAt)));
    if (!row) throw new HttpError(401, 'unauthorized', 'Clé API invalide');
    return row.merchantId;
  }

  function adminAuth(req: FastifyRequest) {
    const token = bearer(req);
    if (!token || !safeEqual(token, config.ADMIN_TOKEN)) throw new HttpError(401, 'unauthorized', 'Accès refusé');
  }

  app.get('/health', async () => ({ status: 'ok' }));

  // ---- API marchands ----
  app.post('/v1/invoices', async (req, reply) => {
    const merchantId = await merchantAuth(req);
    const b = parse(createInvoiceBody, req.body);
    const { invoice, created } = await createInvoice(db, config.INVOICE_TTL_MINUTES, merchantId, {
      amount: b.amount, currency: b.currency, orderId: b.order_id, description: b.description,
      successUrl: b.success_url, cancelUrl: b.cancel_url,
    });
    return reply.status(created ? 201 : 200).send(presentInvoice(invoice, config.PUBLIC_BASE_URL, false));
  });

  app.get<{ Params: { id: string } }>('/v1/invoices/:id', async (req) => {
    return getInvoice(db, config.PUBLIC_BASE_URL, await merchantAuth(req), req.params.id);
  });

  app.get('/v1/balance', async (req) => ({ balances: await getBalances(db, await merchantAuth(req)) }));

  app.post('/v1/withdrawals', async (req, reply) => {
    const merchantId = await merchantAuth(req);
    const b = parse(withdrawalBody, req.body);
    const w = await requestWithdrawal(db, config, merchantId, {
      currency: b.currency, amount: b.amount, address: b.address, extraId: b.extra_id,
    });
    return reply.status(201).send(w);
  });

  // Aperçu des frais avant de demander un retrait
  app.get('/v1/withdrawals/quote', async (req) => {
    await merchantAuth(req);
    const q = parse(z.object({ currency, amount: decimal }), req.query);
    return quoteWithdrawal(config, q.currency, q.amount);
  });

  app.get('/v1/withdrawals', async (req) => ({
    withdrawals: await listWithdrawals(db, { merchantId: await merchantAuth(req) }),
  }));

  // ---- Notifications NOWPayments ----
  app.post('/ipn/nowpayments', async (req, reply) => {
    const sig = req.headers['x-nowpayments-sig'];
    if (!verifyIpnSignature(req.body, typeof sig === 'string' ? sig : undefined, config.NOWPAYMENTS_IPN_SECRET)) {
      req.log.warn('IPN rejetée : signature invalide');
      throw new HttpError(401, 'invalid_signature', 'Signature invalide');
    }
    await handleIpn(db, { feePercent: config.PAYMENT_FEE_PERCENT, publicBaseUrl: config.PUBLIC_BASE_URL },
      req.body as Record<string, unknown>);
    return reply.send({ ok: true });
  });

  // ---- Page de paiement publique ----
  registerCheckoutRoutes(app, {
    db, nowpayments, publicBaseUrl: config.PUBLIC_BASE_URL, currencies: config.CHECKOUT_CURRENCIES,
  });

  // ---- Back-office (toi) ----
  app.get('/admin/revenue', async (req) => {
    adminAuth(req);
    return { revenue: await getRevenue(db) };
  });

  app.get<{ Querystring: { status?: string } }>('/admin/withdrawals', async (req) => {
    adminAuth(req);
    return { withdrawals: await listWithdrawals(db, { status: req.query.status ?? 'requested' }) };
  });

  app.post<{ Params: { id: string } }>('/admin/withdrawals/:id/complete', async (req) => {
    adminAuth(req);
    const { tx_hash } = parse(z.object({ tx_hash: z.string().min(10).max(200) }), req.body);
    return completeWithdrawal(db, req.params.id, tx_hash);
  });

  app.post<{ Params: { id: string } }>('/admin/withdrawals/:id/reject', async (req) => {
    adminAuth(req);
    const { reason } = parse(z.object({ reason: z.string().min(1).max(500) }), req.body);
    return rejectWithdrawal(db, req.params.id, reason);
  });

  return app;
}
