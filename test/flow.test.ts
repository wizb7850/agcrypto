import { createHmac } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { Db } from '../src/db/client.js';
import * as schema from '../src/db/schema.js';
import { generateApiKey } from '../src/lib/security.js';
import type { CreateInvoiceInput } from '../src/providers/nowpayments.js';
import { deliverDueWebhooks } from '../src/services/webhooks.js';

const IPN_SECRET = 'test-ipn-secret';
const ADMIN = 'a'.repeat(32);

function sign(body: object) {
  const sort = (v: any): any => (v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])])) : v);
  return createHmac('sha512', IPN_SECRET).update(JSON.stringify(sort(body))).digest('hex');
}

async function setup() {
  const db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: './drizzle' });
  const created: CreateInvoiceInput[] = [];
  const nowpayments = {
    async createInvoice(input: CreateInvoiceInput) {
      created.push(input);
      return { id: String(4000 + created.length), invoiceUrl: `https://nowpayments.io/payment/?iid=${4000 + created.length}` };
    },
  };
  const app = buildApp({
    db: db as unknown as Db,
    nowpayments,
    config: {
      PUBLIC_BASE_URL: 'https://api.agcrypto.test',
      NOWPAYMENTS_IPN_SECRET: IPN_SECRET,
      PLATFORM_FEE_PERCENT: 1,
      ADMIN_TOKEN: ADMIN,
      LOG_LEVEL: 'silent',
    },
  });
  const key = generateApiKey();
  await db.insert(schema.merchants).values({
    id: 'mch_1', name: 'Boutique', webhookUrl: 'https://shop.test/hook', webhookSecret: 'whsec_test',
  });
  await db.insert(schema.apiKeys).values({ id: 'key_1', merchantId: 'mch_1', keyHash: key.hash, prefix: key.prefix });
  const auth = { authorization: `Bearer ${key.key}` };
  return { db: db as unknown as Db, app, auth, created };
}

describe('parcours complet', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => { ctx = await setup(); });

  const ipn = (order_id: string, payment_status: string, extra: object = {}) => {
    const body = {
      payment_id: 777, invoice_id: 4001, order_id, payment_status, pay_currency: 'usdttrc20',
      pay_amount: 50.12, actually_paid: 50.12, outcome_amount: 50, outcome_currency: 'usdttrc20', ...extra,
    };
    return ctx.app.inject({ method: 'POST', url: '/ipn/nowpayments', headers: { 'x-nowpayments-sig': sign(body) }, payload: body });
  };

  it('facture → paiement → solde → retrait', async () => {
    const { app, auth, created } = ctx;

    // 1. Le marchand crée une facture
    const res = await app.inject({ method: 'POST', url: '/v1/invoices', headers: auth,
      payload: { amount: '49.99', currency: 'EUR', order_id: 'cmd-1' } });
    expect(res.statusCode).toBe(201);
    const inv = res.json();
    expect(inv.checkout_url).toContain('nowpayments.io');
    expect(created[0]!.ipnCallbackUrl).toBe('https://api.agcrypto.test/ipn/nowpayments');

    // Même order_id → même facture, pas de doublon chez NOWPayments
    const again = await app.inject({ method: 'POST', url: '/v1/invoices', headers: auth,
      payload: { amount: '49.99', currency: 'EUR', order_id: 'cmd-1' } });
    expect(again.statusCode).toBe(200);
    expect(again.json().id).toBe(inv.id);
    expect(created).toHaveLength(1);

    // 2. NOWPayments notifie : confirmation puis paiement terminé (envoyé 2 fois)
    expect((await ipn(inv.id, 'confirming')).statusCode).toBe(200);
    expect((await ipn(inv.id, 'finished')).statusCode).toBe(200);
    expect((await ipn(inv.id, 'finished')).statusCode).toBe(200);
    expect((await ipn(inv.id, 'confirming')).statusCode).toBe(200); // en retard : ignoré

    const got = await app.inject({ method: 'GET', url: `/v1/invoices/${inv.id}`, headers: auth });
    expect(got.json().status).toBe('paid');

    // 3. Solde crédité une seule fois, commission 1 % déduite
    const bal = await app.inject({ method: 'GET', url: '/v1/balance', headers: auth });
    expect(bal.json().balances).toEqual([{ currency: 'usdttrc20', available: '49.5' }]);

    // 4. Retrait : refusé si solde insuffisant, accepté sinon et bloqué immédiatement
    const tooMuch = await app.inject({ method: 'POST', url: '/v1/withdrawals', headers: auth,
      payload: { currency: 'usdttrc20', amount: '60', address: 'TXYZabc1234567890' } });
    expect(tooMuch.statusCode).toBe(422);

    const wd = await app.inject({ method: 'POST', url: '/v1/withdrawals', headers: auth,
      payload: { currency: 'usdttrc20', amount: '40', address: 'TXYZabc1234567890' } });
    expect(wd.statusCode).toBe(201);
    const bal2 = await app.inject({ method: 'GET', url: '/v1/balance', headers: auth });
    expect(bal2.json().balances[0].available).toBe('9.5');

    // 5. L'admin refuse → le solde revient ; une 2e action sur le même retrait est refusée
    const adm = { authorization: `Bearer ${ADMIN}` };
    const rej = await app.inject({ method: 'POST', url: `/admin/withdrawals/${wd.json().id}/reject`, headers: adm,
      payload: { reason: 'adresse douteuse' } });
    expect(rej.json().status).toBe('rejected');
    const twice = await app.inject({ method: 'POST', url: `/admin/withdrawals/${wd.json().id}/complete`, headers: adm,
      payload: { tx_hash: '0xabcdef1234567890' } });
    expect(twice.statusCode).toBe(409);
    const bal3 = await app.inject({ method: 'GET', url: '/v1/balance', headers: auth });
    expect(bal3.json().balances[0].available).toBe('49.5');

    // 6. Webhooks signés envoyés au marchand
    const sent: { body: string; sig: string }[] = [];
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      sent.push({ body: String(init.body), sig: (init.headers as Record<string, string>)['x-agcrypto-signature']! });
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    await deliverDueWebhooks(ctx.db, app.log, fakeFetch);
    const types = sent.map((s) => JSON.parse(s.body).type);
    expect(types).toEqual(expect.arrayContaining(['invoice.confirming', 'invoice.paid', 'withdrawal.rejected']));
    const [, t, v1] = sent[0]!.sig.match(/^t=(\d+),v1=([0-9a-f]+)$/)!;
    expect(createHmac('sha256', 'whsec_test').update(`${t}.${sent[0]!.body}`).digest('hex')).toBe(v1);
    expect(await deliverDueWebhooks(ctx.db, app.log, fakeFetch)).toBe(0); // rien de renvoyé
  });

  it('rejette les IPN falsifiées', async () => {
    const res = await ctx.app.inject({ method: 'POST', url: '/v1/invoices', headers: ctx.auth,
      payload: { amount: '10', currency: 'USD', order_id: 'cmd-2' } });
    const body = { payment_id: 1, order_id: res.json().id, payment_status: 'finished', outcome_amount: 1e6, outcome_currency: 'usdttrc20' };
    const forged = await ctx.app.inject({ method: 'POST', url: '/ipn/nowpayments',
      headers: { 'x-nowpayments-sig': 'deadbeef' }, payload: body });
    expect(forged.statusCode).toBe(401);
    const bal = await ctx.app.inject({ method: 'GET', url: '/v1/balance', headers: ctx.auth });
    expect(bal.json().balances).toEqual([]);
  });

  it('refuse les accès sans clé valide', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/v1/balance' })).statusCode).toBe(401);
    expect((await ctx.app.inject({ method: 'GET', url: '/admin/withdrawals', headers: ctx.auth })).statusCode).toBe(401);
  });
});
