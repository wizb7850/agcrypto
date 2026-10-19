import { beforeEach, describe, expect, it } from 'vitest';
import { adminSession, cookieOf, createApiKey, createTestApp, CSRF, paidInvoice, signup, type TestApp, verify } from './helpers.js';

describe('back-office', () => {
  let t: TestApp;
  beforeEach(async () => { t = await createTestApp(); });

  it('chaque rôle n\'accède qu\'à ce qui le concerne', async () => {
    const roles = {
      owner: await adminSession(t, 'owner'),
      compliance: await adminSession(t, 'compliance'),
      finance: await adminSession(t, 'finance'),
      support: await adminSession(t, 'support'),
    };
    const status = async (role: keyof typeof roles, method: 'GET' | 'POST', url: string, payload?: object) =>
      (await t.inject({ method, url, headers: roles[role], payload })).statusCode;

    for (const role of Object.keys(roles) as (keyof typeof roles)[]) {
      expect(await status(role, 'GET', '/admin/overview')).toBe(200);
      expect(await status(role, 'GET', '/admin/merchants')).toBe(200);
    }
    expect(await status('support', 'GET', '/admin/revenue')).toBe(403);
    expect(await status('compliance', 'GET', '/admin/revenue')).toBe(403);
    expect(await status('finance', 'GET', '/admin/revenue')).toBe(200);
    expect(await status('support', 'GET', '/admin/withdrawals')).toBe(200);
    expect(await status('support', 'POST', '/admin/withdrawals/wd_x/complete', { tx_hash: '0x1234567890' })).toBe(403);
    expect(await status('finance', 'GET', '/admin/audit-log')).toBe(403);
    expect(await status('owner', 'GET', '/admin/audit-log')).toBe(200);
    expect(await status('compliance', 'GET', '/admin/team')).toBe(403);

    const me = (await t.inject({ method: 'GET', url: '/auth/admin/me', headers: roles.finance })).json();
    expect(me.permissions).toEqual(expect.arrayContaining(['withdrawals:process', 'revenue:read']));
    expect(me.permissions).not.toContain('kyc:review');

    // Une session marchand n'ouvre pas le back-office
    const { session } = await signup(t);
    expect((await t.inject({ method: 'GET', url: '/admin/overview', headers: session })).statusCode).toBe(401);
  });

  it('suspension d\'un marchand : plus de factures, plus de paiements, plus de retraits', async () => {
    const { session, merchantId, email } = await signup(t);
    await verify(t, session, 'personal');
    const api = await createApiKey(t, session);
    await paidInvoice(t, api, { outcome: '100' });
    const pending = await t.inject({ method: 'POST', url: '/v1/invoices', headers: api, payload: { amount: '20', currency: 'USD', order_id: 'avant' } });
    const compliance = await adminSession(t, 'compliance');

    const suspend = await t.inject({ method: 'POST', url: `/admin/merchants/${merchantId}/suspend`, headers: compliance, payload: { reason: 'Activité suspecte' } });
    expect(suspend.statusCode).toBe(200);
    expect(t.mailer.lastTo(email)!.subject).toBe('Ton compte a été suspendu');

    expect((await t.inject({ method: 'POST', url: '/v1/invoices', headers: api, payload: { amount: '10', currency: 'USD', order_id: 'x' } })).json().error).toBe('account_suspended');
    expect((await t.inject({ method: 'POST', url: `/pay/${pending.json().id}/payment`, payload: { pay_currency: 'usdttrc20' } })).statusCode).toBe(409);
    expect((await t.inject({ method: 'POST', url: '/v1/withdrawals', headers: api, payload: { currency: 'usdttrc20', amount: '10', address: 'TAddress1234567890' } })).json().error).toBe('account_suspended');
    // Le marchand peut toujours consulter son compte
    expect((await t.inject({ method: 'GET', url: '/v1/balance', headers: api })).statusCode).toBe(200);
    const me = (await t.inject({ method: 'GET', url: '/auth/merchant/me', headers: session })).json();
    expect(me.merchant).toMatchObject({ status: 'suspended', suspended_reason: 'Activité suspecte' });

    // Recherche et fiche marchand
    const search = (await t.inject({ method: 'GET', url: `/admin/merchants?q=${encodeURIComponent(email)}`, headers: compliance })).json();
    expect(search.merchants).toEqual([expect.objectContaining({ id: merchantId, status: 'suspended', verification_level: 'personal' })]);
    const card = (await t.inject({ method: 'GET', url: `/admin/merchants/${merchantId}`, headers: compliance })).json();
    expect(card).toMatchObject({ status: 'suspended', active_api_keys: 1, balances: [{ currency: 'usdttrc20', available: '99' }] });
    expect(card.kyc_submissions[0].status).toBe('approved');

    await t.inject({ method: 'POST', url: `/admin/merchants/${merchantId}/reactivate`, headers: compliance });
    expect((await t.inject({ method: 'POST', url: '/v1/invoices', headers: api, payload: { amount: '10', currency: 'USD', order_id: 'apres' } })).statusCode).toBe(201);
  });

  it('gestion de l\'équipe et journal d\'audit', async () => {
    const owner = await adminSession(t, 'owner', 'patron@agcrypto.test');
    const created = await t.inject({ method: 'POST', url: '/admin/team', headers: owner, payload: { email: 'Finance@agcrypto.test', role: 'finance' } });
    expect(created.statusCode).toBe(201);
    const { id, password } = created.json();

    const login = await t.inject({ method: 'POST', url: '/auth/admin/login', headers: CSRF, payload: { email: 'finance@agcrypto.test', password } });
    expect(login.statusCode).toBe(200);
    const financeSession = { cookie: cookieOf(login), ...CSRF };
    expect((await t.inject({ method: 'GET', url: '/admin/revenue', headers: financeSession })).statusCode).toBe(200);

    // Désactivation : déconnecté immédiatement, ne peut plus se connecter
    await t.inject({ method: 'PUT', url: `/admin/team/${id}`, headers: owner, payload: { disabled: true } });
    expect((await t.inject({ method: 'GET', url: '/admin/revenue', headers: financeSession })).statusCode).toBe(401);
    expect((await t.inject({ method: 'POST', url: '/auth/admin/login', headers: CSRF, payload: { email: 'finance@agcrypto.test', password } })).statusCode).toBe(401);

    // Protections : pas de modification de soi-même, toujours un propriétaire actif
    const self = (await t.inject({ method: 'GET', url: '/auth/admin/me', headers: owner })).json().id;
    expect((await t.inject({ method: 'PUT', url: `/admin/team/${self}`, headers: owner, payload: { role: 'support' } })).statusCode).toBe(400);
    const second = (await t.inject({ method: 'POST', url: '/admin/team', headers: owner, payload: { email: 'associe@agcrypto.test', role: 'owner' } })).json();
    expect((await t.inject({ method: 'PUT', url: `/admin/team/${second.id}`, headers: owner, payload: { role: 'support' } })).statusCode).toBe(200);
    expect((await t.inject({ method: 'POST', url: '/admin/team', headers: owner, payload: { email: 'associe@agcrypto.test', role: 'owner' } })).statusCode).toBe(409);

    const log = (await t.inject({ method: 'GET', url: '/admin/audit-log', headers: owner })).json();
    expect(log.entries.map((e: { action: string }) => e.action)).toEqual(['team.update', 'team.create', 'team.update', 'team.create']);
    expect(log.entries[0]).toMatchObject({ admin_email: 'patron@agcrypto.test', target_id: second.id, details: { role: 'support' } });
  });

  it('vue d\'ensemble', async () => {
    const owner = await adminSession(t, 'owner');
    const { session } = await signup(t);
    await verify(t, session, 'personal', owner);
    const api = await createApiKey(t, session);
    await paidInvoice(t, api, { amount: '120', outcome: '120' });
    await t.inject({ method: 'POST', url: '/v1/withdrawals', headers: api, payload: { currency: 'usdttrc20', amount: '50', address: 'TAddress1234567890' } });
    const overview = (await t.inject({ method: 'GET', url: '/admin/overview', headers: owner })).json();
    expect(overview).toMatchObject({
      merchants: { total: 1, verified: 1, business: 0, suspended: 0 },
      pending_kyc: 0, pending_withdrawals: 1, paid_30d: { volume_usd: '120', count: 1 },
    });
  });
});
