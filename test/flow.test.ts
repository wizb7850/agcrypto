import { createHmac } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { Db } from '../src/db/client.js';
import * as schema from '../src/db/schema.js';
import { generateApiKey } from '../src/lib/security.js';
import type { CreatePaymentInput, NowPaymentsApi } from '../src/providers/nowpayments.js';
import { deliverDueWebhooks } from '../src/services/webhooks.js';

const IPN_SECRET = 'test-ipn-secret';
const ADMIN = 'a'.repeat(32);
const ADDRESS = 'TXYZpayAddress1234567890abcdef';

function sign(body: object) {
  const sort = (v: any): any => (v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])])) : v);
  return createHmac('sha512', IPN_SECRET).update(JSON.stringify(sort(body))).digest('hex');
}

async function setup() {
  const db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: './drizzle' });
  const calls: CreatePaymentInput[] = [];
  const nowpayments: NowPaymentsApi = {
    async createPayment(input) {
      calls.push(input);
      return {
        id: String(776 + calls.length), status: 'waiting', payAddress: ADDRESS, payAmount: '50.12',
        payCurrency: input.payCurrency, payExtraId: null, expiresAt: new Date(Date.now() + 3600_000),
      };
    },
  };
  const app = buildApp({
    db: db as unknown as Db,
    nowpayments,
    config: {
      PUBLIC_BASE_URL: 'https://api.agcrypto.test',
      NOWPAYMENTS_IPN_SECRET: IPN_SECRET,
      ADMIN_TOKEN: ADMIN,
      LOG_LEVEL: 'silent',
      PAYMENT_FEE_PERCENT: 1,
      WITHDRAWAL_FEE_PERCENT: 10,
      WITHDRAWAL_FIXED_FEES: { usdttrc20: '1' },
      CHECKOUT_CURRENCIES: ['usdttrc20', 'btc'],
      INVOICE_TTL_MINUTES: 60,
    },
  });
  const key = generateApiKey();
  await db.insert(schema.merchants).values({
    id: 'mch_1', name: 'Boutique <Test>', webhookUrl: 'https://shop.test/hook', webhookSecret: 'whsec_test',
  });
  await db.insert(schema.apiKeys).values({ id: 'key_1', merchantId: 'mch_1', keyHash: key.hash, prefix: key.prefix });
  return { db: db as unknown as Db, app, auth: { authorization: `Bearer ${key.key}` }, calls };
}

describe('parcours complet', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => { ctx = await setup(); });

  const ipn = (order_id: string, payment_status: string, extra: object = {}) => {
    const body = {
      payment_id: 777, order_id, payment_status, pay_currency: 'usdttrc20', pay_amount: 50.12,
      actually_paid: 50.12, outcome_amount: 50, outcome_currency: 'usdttrc20', ...extra,
    };
    return ctx.app.inject({ method: 'POST', url: '/ipn/nowpayments', headers: { 'x-nowpayments-sig': sign(body) }, payload: body });
  };
  const balance = async () =>
    (await ctx.app.inject({ method: 'GET', url: '/v1/balance', headers: ctx.auth })).json().balances;
  const createInvoice = (order_id: string) => ctx.app.inject({ method: 'POST', url: '/v1/invoices', headers: ctx.auth,
    payload: { amount: '49.99', currency: 'EUR', order_id, success_url: 'https://shop.test/merci' } });

  it('facture → checkout → paiement → solde → retraits avec frais', async () => {
    const { app, auth, calls } = ctx;
    const adm = { authorization: `Bearer ${ADMIN}` };

    // 1. Le marchand crée une facture : le lien pointe vers NOTRE page de paiement
    const res = await createInvoice('cmd-1');
    expect(res.statusCode).toBe(201);
    const inv = res.json();
    expect(inv.checkout_url).toBe(`https://api.agcrypto.test/pay/${inv.id}`);
    expect((await createInvoice('cmd-1')).json().id).toBe(inv.id); // idempotent

    // 2. Page de paiement
    const page = await app.inject({ method: 'GET', url: `/pay/${inv.id}` });
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-security-policy']).toContain('nonce-');
    const data = (await app.inject({ method: 'GET', url: `/pay/${inv.id}/data` })).json();
    expect(data).toMatchObject({ merchant: 'Boutique <Test>', amount: '49.99', currency: 'EUR', status: 'pending', payment: null });
    expect(data.currencies.map((c: { code: string }) => c.code)).toEqual(['usdttrc20', 'btc']);

    // 3. Le client choisit USDT TRC-20 → appel serveur à serveur à NOWPayments
    expect((await app.inject({ method: 'POST', url: `/pay/${inv.id}/payment`, payload: { pay_currency: 'doge' } })).statusCode).toBe(400);
    const pay = await app.inject({ method: 'POST', url: `/pay/${inv.id}/payment`, payload: { pay_currency: 'usdttrc20' } });
    expect(pay.statusCode).toBe(200);
    expect(pay.json()).toMatchObject({ pay_address: ADDRESS, pay_amount: '50.12', network: 'Tron (TRC-20)' });
    expect(pay.json().qr_svg).toContain('<svg');
    expect(calls[0]).toMatchObject({ orderId: inv.id, priceCurrency: 'eur', payCurrency: 'usdttrc20',
      ipnCallbackUrl: 'https://api.agcrypto.test/ipn/nowpayments' });
    // Rechargement de la page : même adresse, pas de nouvel appel
    await app.inject({ method: 'POST', url: `/pay/${inv.id}/payment`, payload: { pay_currency: 'usdttrc20' } });
    expect(calls).toHaveLength(1);

    // 4. NOWPayments notifie (doublon + IPN en retard ignorés)
    for (const s of ['waiting', 'confirming', 'finished', 'finished', 'confirming']) {
      expect((await ipn(inv.id, s)).statusCode).toBe(200);
    }
    const after = (await app.inject({ method: 'GET', url: `/pay/${inv.id}/data` })).json();
    expect(after.status).toBe('paid');
    expect(after.success_url).toBe('https://shop.test/merci');
    expect((await app.inject({ method: 'POST', url: `/pay/${inv.id}/payment`, payload: { pay_currency: 'btc' } })).statusCode).toBe(409);

    // 5. Solde : 50 USDT reçus de NOWPayments − 1 % de commission = 49.5
    expect(await balance()).toEqual([{ currency: 'usdttrc20', available: '49.5' }]);

    // 6. Frais de retrait : 10 % + 1 USDT fixe
    const quote = await app.inject({ method: 'GET', url: '/v1/withdrawals/quote?currency=usdttrc20&amount=40', headers: auth });
    expect(quote.json()).toEqual({ currency: 'usdttrc20', amount: '40', fee: '5', net_amount: '35' });

    const wdBody = (amount: string) => ({ currency: 'usdttrc20', amount, address: 'TMerchantPayout1234567890' });
    expect((await app.inject({ method: 'POST', url: '/v1/withdrawals', headers: auth, payload: wdBody('60') })).statusCode).toBe(422);
    expect((await app.inject({ method: 'POST', url: '/v1/withdrawals', headers: auth, payload: wdBody('1') })).statusCode).toBe(422); // < frais

    // Retrait refusé → solde restitué
    const wd1 = (await app.inject({ method: 'POST', url: '/v1/withdrawals', headers: auth, payload: wdBody('40') })).json();
    expect(await balance()).toEqual([{ currency: 'usdttrc20', available: '9.5' }]);
    await app.inject({ method: 'POST', url: `/admin/withdrawals/${wd1.id}/reject`, headers: adm, payload: { reason: 'test' } });
    expect(await balance()).toEqual([{ currency: 'usdttrc20', available: '49.5' }]);

    // Retrait de tout le solde → l'admin envoie le net et confirme
    const wd2 = (await app.inject({ method: 'POST', url: '/v1/withdrawals', headers: auth, payload: wdBody('49.5') })).json();
    expect(wd2).toMatchObject({ amount: '49.5', fee: '5.95', net_amount: '43.55', status: 'requested' });
    const pending = (await app.inject({ method: 'GET', url: '/admin/withdrawals', headers: adm })).json();
    expect(pending.withdrawals.map((w: { id: string }) => w.id)).toEqual([wd2.id]);
    const done = await app.inject({ method: 'POST', url: `/admin/withdrawals/${wd2.id}/complete`, headers: adm,
      payload: { tx_hash: 'abcdef1234567890' } });
    expect(done.json().status).toBe('completed');
    expect((await app.inject({ method: 'POST', url: `/admin/withdrawals/${wd2.id}/reject`, headers: adm,
      payload: { reason: 'x' } })).statusCode).toBe(409);
    expect(await balance()).toEqual([{ currency: 'usdttrc20', available: '0' }]);

    // 7. Tes revenus : 0.5 (paiement) + 5.95 (retrait)
    const rev = (await app.inject({ method: 'GET', url: '/admin/revenue', headers: adm })).json();
    expect(rev.revenue).toEqual([{ currency: 'usdttrc20', payment_fees: '0.5', withdrawal_fees: '5.95', total: '6.45' }]);

    // 8. Webhooks signés envoyés au marchand
    const sent: { body: string; sig: string }[] = [];
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      sent.push({ body: String(init.body), sig: (init.headers as Record<string, string>)['x-agcrypto-signature']! });
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    await deliverDueWebhooks(ctx.db, app.log, fakeFetch);
    expect(sent.map((s) => JSON.parse(s.body).type)).toEqual(expect.arrayContaining(
      ['invoice.confirming', 'invoice.paid', 'withdrawal.rejected', 'withdrawal.completed']));
    const [, t, v1] = sent[0]!.sig.match(/^t=(\d+),v1=([0-9a-f]+)$/)!;
    expect(createHmac('sha256', 'whsec_test').update(`${t}.${sent[0]!.body}`).digest('hex')).toBe(v1);
    expect(await deliverDueWebhooks(ctx.db, app.log, fakeFetch)).toBe(0);
  });

  it('rejette les IPN falsifiées', async () => {
    const inv = (await createInvoice('cmd-2')).json();
    const body = { payment_id: 1, order_id: inv.id, payment_status: 'finished', outcome_amount: 1e6, outcome_currency: 'usdttrc20' };
    const forged = await ctx.app.inject({ method: 'POST', url: '/ipn/nowpayments',
      headers: { 'x-nowpayments-sig': 'deadbeef' }, payload: body });
    expect(forged.statusCode).toBe(401);
    expect(await balance()).toEqual([]);
  });

  it('refuse les accès sans clé valide', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/v1/balance' })).statusCode).toBe(401);
    expect((await ctx.app.inject({ method: 'GET', url: '/admin/revenue', headers: ctx.auth })).statusCode).toBe(401);
    expect((await ctx.app.inject({ method: 'GET', url: '/pay/inv_inexistant/data' })).statusCode).toBe(404);
  });
});
