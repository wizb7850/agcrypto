import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { deliverDueWebhooks } from '../src/modules/webhooks/service.js';
import { adminSession, createApiKey, createTestApp, sendIpn, signup, type TestApp, verify } from './helpers.js';

describe('paiements et retraits', () => {
  let t: TestApp;
  beforeEach(async () => { t = await createTestApp(); });

  it('facture → page de paiement → IPN → solde → retraits → webhooks', async () => {
    const { session } = await signup(t, { name: 'Boutique <Test>' });
    await t.inject({ method: 'PUT', url: '/v1/settings', headers: session, payload: { webhook_url: 'https://shop.test/hook' } });
    const { webhook_secret } = (await t.inject({ method: 'GET', url: '/v1/settings', headers: session })).json();
    await verify(t, session, 'personal');
    const api = await createApiKey(t, session);
    const finance = await adminSession(t, 'finance');

    // 1. Facture créée par le site du marchand (clé API), idempotente
    const create = () => t.inject({ method: 'POST', url: '/v1/invoices', headers: api,
      payload: { amount: '49.99', currency: 'EUR', order_id: 'cmd-1', success_url: 'https://shop.test/merci' } });
    const res = await create();
    expect(res.statusCode).toBe(201);
    const inv = res.json();
    expect(inv).toMatchObject({ checkout_url: `https://api.agcrypto.test/pay/${inv.id}`, amount_usd: '53.9892', status: 'pending' });
    expect((await create()).json().id).toBe(inv.id);
    expect((await t.inject({ method: 'POST', url: '/v1/invoices', headers: api,
      payload: { amount: '10', currency: 'EUR', order_id: 'cmd-1' } })).statusCode).toBe(409);

    // 2. Page de paiement
    expect((await t.inject({ method: 'GET', url: `/pay/${inv.id}` })).headers['content-security-policy']).toContain('nonce-');
    const data = (await t.inject({ method: 'GET', url: `/pay/${inv.id}/data` })).json();
    expect(data).toMatchObject({ merchant: 'Boutique <Test>', amount: '49.99', currency: 'EUR', status: 'pending', payment: null });

    // 3. Le client choisit sa crypto : appel serveur à serveur à NOWPayments
    expect((await t.inject({ method: 'POST', url: `/pay/${inv.id}/payment`, payload: { pay_currency: 'doge' } })).statusCode).toBe(400);
    const pay = await t.inject({ method: 'POST', url: `/pay/${inv.id}/payment`, payload: { pay_currency: 'usdttrc20' } });
    expect(pay.json()).toMatchObject({ pay_amount: '50.12', network: 'Tron (TRC-20)' });
    expect(pay.json().qr_svg).toContain('<svg');
    expect(t.calls[0]).toMatchObject({ orderId: inv.id, priceCurrency: 'eur', ipnCallbackUrl: 'https://api.agcrypto.test/ipn/nowpayments' });
    await t.inject({ method: 'POST', url: `/pay/${inv.id}/payment`, payload: { pay_currency: 'usdttrc20' } });
    expect(t.calls).toHaveLength(1); // même adresse au rechargement

    // 4. IPN signées : doublons et IPN en retard sans effet
    for (const status of ['waiting', 'confirming', 'finished', 'finished', 'confirming']) {
      const r = await sendIpn(t, { payment_id: 777, order_id: inv.id, payment_status: status, pay_currency: 'usdttrc20',
        pay_amount: 50.12, actually_paid: 50.12, outcome_amount: 50, outcome_currency: 'usdttrc20' });
      expect(r.statusCode).toBe(200);
    }
    expect((await t.inject({ method: 'GET', url: `/v1/invoices/${inv.id}`, headers: api })).json().status).toBe('paid');
    expect((await t.inject({ method: 'GET', url: '/v1/invoices?status=paid', headers: api })).json().total).toBe(1);
    expect((await t.inject({ method: 'GET', url: '/v1/invoices?status=pending', headers: api })).json().total).toBe(0);

    // 5. Solde : 50 USDT reçus − 1 % = 49.5 ; tableau de bord
    expect((await t.inject({ method: 'GET', url: '/v1/balance', headers: api })).json().balances).toEqual([{ currency: 'usdttrc20', available: '49.5' }]);
    const dash = (await t.inject({ method: 'GET', url: '/v1/dashboard', headers: session })).json();
    expect(dash).toMatchObject({ stats_30d: { volume_usd: '53.9892', paid_invoices: 1, created_invoices: 1, conversion_rate: 100 } });
    expect(dash.recent_invoices[0].id).toBe(inv.id);

    // 6. Retraits : frais 10 % + 1 fixe ; refus = recrédit ; double traitement impossible
    expect((await t.inject({ method: 'GET', url: '/v1/withdrawals/quote?currency=usdttrc20&amount=40', headers: api })).json())
      .toEqual({ currency: 'usdttrc20', amount: '40', fee: '5', net_amount: '35' });
    const wd = (amount: string) => t.inject({ method: 'POST', url: '/v1/withdrawals', headers: api,
      payload: { currency: 'usdttrc20', amount, address: 'TMerchantPayout1234567890' } });
    expect((await wd('60')).json().error).toBe('insufficient_balance');
    expect((await wd('1')).json().error).toBe('amount_too_small');
    const w1 = (await wd('40')).json();
    await t.inject({ method: 'POST', url: `/admin/withdrawals/${w1.id}/reject`, headers: finance, payload: { reason: 'Adresse invalide' } });
    const w2 = (await wd('49.5')).json();
    expect(w2).toMatchObject({ fee: '5.95', net_amount: '43.55' });
    const pendingList = (await t.inject({ method: 'GET', url: '/admin/withdrawals', headers: finance })).json();
    expect(pendingList.withdrawals).toEqual([expect.objectContaining({ id: w2.id, merchant_name: 'Boutique <Test>' })]);
    expect((await t.inject({ method: 'POST', url: `/admin/withdrawals/${w2.id}/complete`, headers: finance, payload: { tx_hash: 'abcdef1234567890' } })).json().status).toBe('completed');
    expect((await t.inject({ method: 'POST', url: `/admin/withdrawals/${w2.id}/reject`, headers: finance, payload: { reason: 'trop tard' } })).statusCode).toBe(409);
    expect((await t.inject({ method: 'GET', url: '/v1/balance', headers: api })).json().balances[0].available).toBe('0');

    // 7. Revenus : 0.5 (paiement) + 5.95 (retrait)
    expect((await t.inject({ method: 'GET', url: '/admin/revenue', headers: finance })).json().revenue)
      .toEqual([{ currency: 'usdttrc20', payment_fees: '0.5', withdrawal_fees: '5.95', total: '6.45' }]);

    // 8. Webhooks signés envoyés au site du marchand
    const sent: { body: string; sig: string }[] = [];
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      sent.push({ body: String(init.body), sig: (init.headers as Record<string, string>)['x-agcrypto-signature']! });
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    await deliverDueWebhooks(t.db, t.app.log, fakeFetch);
    expect(sent.map((s) => JSON.parse(s.body).type)).toEqual(expect.arrayContaining(
      ['invoice.confirming', 'invoice.paid', 'withdrawal.rejected', 'withdrawal.completed']));
    const [, ts, v1] = sent[0]!.sig.match(/^t=(\d+),v1=([0-9a-f]+)$/)!;
    expect(createHmac('sha256', webhook_secret).update(`${ts}.${sent[0]!.body}`).digest('hex')).toBe(v1);
    expect(await deliverDueWebhooks(t.db, t.app.log, fakeFetch)).toBe(0);
  });

  it('un identifiant de paiement déjà utilisé par une autre facture est refusé', async () => {
    const { session } = await signup(t);
    const api = await createApiKey(t, session);
    const create = async (order: string) => (await t.inject({ method: 'POST', url: '/v1/invoices', headers: api,
      payload: { amount: '10', currency: 'USD', order_id: order } })).json();
    const a = await create('a');
    const b = await create('b');
    await t.inject({ method: 'POST', url: `/pay/${a.id}/payment`, payload: { pay_currency: 'usdttrc20' } });
    // Le fournisseur renvoie (à tort) le même identifiant pour la facture b
    const original = t.ctx.nowpayments.createPayment;
    t.ctx.nowpayments.createPayment = async (input) => ({ ...(await original(input)), id: '777' });
    const res = await t.inject({ method: 'POST', url: `/pay/${b.id}/payment`, payload: { pay_currency: 'usdttrc20' } });
    expect(res.statusCode).toBe(502);
    expect((await t.inject({ method: 'GET', url: `/v1/invoices/${a.id}`, headers: api })).json().payments).toHaveLength(1);
    expect((await t.inject({ method: 'GET', url: `/v1/invoices/${b.id}`, headers: api })).json().payments).toHaveLength(0);
  });

  it('rejette les IPN falsifiées', async () => {
    const { session } = await signup(t);
    const api = await createApiKey(t, session);
    const inv = (await t.inject({ method: 'POST', url: '/v1/invoices', headers: api, payload: { amount: '10', currency: 'USD', order_id: 'x' } })).json();
    const forged = await t.inject({ method: 'POST', url: '/ipn/nowpayments', headers: { 'x-nowpayments-sig': 'deadbeef' },
      payload: { payment_id: 1, order_id: inv.id, payment_status: 'finished', outcome_amount: 1e6, outcome_currency: 'usdttrc20' } });
    expect(forged.statusCode).toBe(401);
    expect((await t.inject({ method: 'GET', url: '/v1/balance', headers: api })).json().balances).toEqual([]);
  });

  it('informations publiques : tarifs et limites', async () => {
    const info = (await t.inject({ method: 'GET', url: '/public/info' })).json();
    expect(info).toMatchObject({
      demo: false,
      limits: { unverified_receive_usd: 1000, personal_receive_usd_30d: 10000, personal_withdraw_usd_24h: 2000 },
      fees: { payment_percent: 1, withdrawal_percent: 10 },
    });
    expect(info.price_currencies).toContain('EUR');
  });

  it('la documentation de l\'API est générée', async () => {
    const spec = (await t.inject({ method: 'GET', url: '/docs/json' })).json();
    expect(spec.info.title).toBe('agcrypto API');
    expect(Object.keys(spec.paths)).toEqual(expect.arrayContaining(['/v1/invoices', '/auth/merchant/signup', '/admin/kyc/{id}/approve']));
    expect(spec.paths['/v1/invoices'].post.requestBody.content['application/json'].schema.required).toContain('order_id');
  });
});
