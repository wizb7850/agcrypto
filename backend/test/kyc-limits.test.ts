import { beforeEach, describe, expect, it } from 'vitest';
import {
  adminSession, businessData, createApiKey, createTestApp, paidInvoice, personalData, PNG, signup, type TestApp, upload, verify,
} from './helpers.js';

describe('vérification d\'identité (KYC / KYB)', () => {
  let t: TestApp;
  beforeEach(async () => { t = await createTestApp(); });

  it('dossier personnel : envoi, refus motivé, correction, validation', async () => {
    const { email, session, merchantId } = await signup(t, { email: 'awa@test.com' });
    const compliance = await adminSession(t, 'compliance');

    // Le vrai type du fichier est contrôlé (pas l'extension)
    expect((await upload(t, session, 'id_front', Buffer.from('ceci n\'est pas une image'))).statusCode).toBe(415);
    expect((await upload(t, session, 'type_inconnu')).statusCode).toBe(400);

    const front = (await upload(t, session, 'id_front')).json();
    expect(front).toMatchObject({ kind: 'id_front', mime_type: 'image/png', size: PNG.length });

    // Documents manquants : refus explicite
    const incomplete = await t.inject({ method: 'POST', url: '/v1/verification/submissions', headers: session,
      payload: { level: 'personal', data: personalData, document_ids: [front.id] } });
    expect(incomplete.statusCode).toBe(400);
    expect(incomplete.json().message).toContain('Selfie');

    // Mineur : refusé
    const minor = await t.inject({ method: 'POST', url: '/v1/verification/submissions', headers: session,
      payload: { level: 'personal', data: { ...personalData, birth_date: '2015-01-01' }, document_ids: [front.id] } });
    expect(minor.statusCode).toBe(400);

    const ids = [front.id];
    for (const kind of ['id_back', 'selfie', 'proof_of_address']) ids.push((await upload(t, session, kind)).json().id);
    const submit = () => t.inject({ method: 'POST', url: '/v1/verification/submissions', headers: session,
      payload: { level: 'personal', data: personalData, document_ids: ids } });
    const sub = await submit();
    expect(sub.statusCode).toBe(201);
    expect(sub.json().status).toBe('pending');
    expect((await submit()).statusCode).toBe(409); // un seul dossier en cours

    // L'équipe conformité voit le dossier, consulte les documents (accès tracé), refuse avec un motif
    const queue = (await t.inject({ method: 'GET', url: '/admin/kyc', headers: compliance })).json();
    expect(queue.submissions).toEqual([expect.objectContaining({ id: sub.json().id, merchant_id: merchantId, level: 'personal' })]);
    const detail = (await t.inject({ method: 'GET', url: `/admin/kyc/${sub.json().id}`, headers: compliance })).json();
    expect(detail.data.last_name).toBe('Diallo');
    expect(detail.documents).toHaveLength(4);
    const file = await t.inject({ method: 'GET', url: `/admin/kyc/documents/${front.id}`, headers: compliance });
    expect(file.headers['content-type']).toBe('image/png');
    expect(file.rawPayload.equals(PNG)).toBe(true);

    const reject = await t.inject({ method: 'POST', url: `/admin/kyc/${sub.json().id}/reject`, headers: compliance,
      payload: { reason: 'Photo floue, merci de renvoyer un selfie net' } });
    expect(reject.json().status).toBe('rejected');
    expect(t.mailer.lastTo(email)!.text).toContain('Photo floue');
    const status = (await t.inject({ method: 'GET', url: '/v1/verification', headers: session })).json();
    expect(status).toMatchObject({ level: 'none', latest_submission: { status: 'rejected', reject_reason: 'Photo floue, merci de renvoyer un selfie net' } });

    // Les documents déjà utilisés ne peuvent pas être réutilisés : nouveau dossier complet
    expect((await submit()).json().error).toBe('invalid_documents');
    await verify(t, session, 'personal', compliance);
    expect((await t.inject({ method: 'GET', url: '/v1/verification', headers: session })).json().level).toBe('personal');
    expect(t.mailer.lastTo(email)!.subject).toBe('Ton compte est vérifié');

    // Déjà vérifié à ce niveau : refus ; passage au niveau entreprise possible
    const again = await t.inject({ method: 'POST', url: '/v1/verification/submissions', headers: session,
      payload: { level: 'personal', data: personalData, document_ids: ['x'] } });
    expect(again.json().error).toBe('already_verified');
  });

  it('dossier entreprise : le compte devient professionnel', async () => {
    const { session } = await signup(t, { accountType: 'personal' });
    await verify(t, session, 'business');
    const me = (await t.inject({ method: 'GET', url: '/auth/merchant/me', headers: session })).json();
    expect(me.merchant).toMatchObject({ account_type: 'business', verification_level: 'business' });
  });

  it('passeport : le verso n\'est pas demandé', async () => {
    const { session } = await signup(t);
    const ids: string[] = [];
    for (const kind of ['id_front', 'selfie', 'proof_of_address']) ids.push((await upload(t, session, kind)).json().id);
    const res = await t.inject({ method: 'POST', url: '/v1/verification/submissions', headers: session,
      payload: { level: 'personal', data: { ...personalData, id_type: 'passport' }, document_ids: ids } });
    expect(res.statusCode).toBe(201);
    const bizIds: string[] = [];
    const { session: s2 } = await signup(t);
    for (const kind of ['company_registration', 'company_proof_of_address', 'representative_id_front']) bizIds.push((await upload(t, s2, kind)).json().id);
    const biz = await t.inject({ method: 'POST', url: '/v1/verification/submissions', headers: s2,
      payload: { level: 'business', data: { ...businessData, representative: { ...businessData.representative, id_type: 'passport' } }, document_ids: bizIds } });
    expect(biz.statusCode).toBe(201);
  });

  it('seuls les rôles autorisés accèdent aux dossiers', async () => {
    const { session } = await signup(t);
    const ids: string[] = [];
    for (const kind of ['id_front', 'id_back', 'selfie', 'proof_of_address']) ids.push((await upload(t, session, kind)).json().id);
    const sub = (await t.inject({ method: 'POST', url: '/v1/verification/submissions', headers: session,
      payload: { level: 'personal', data: personalData, document_ids: ids } })).json();
    for (const role of ['support', 'finance'] as const) {
      const h = await adminSession(t, role);
      expect((await t.inject({ method: 'GET', url: '/admin/kyc', headers: h })).statusCode).toBe(403);
      expect((await t.inject({ method: 'POST', url: `/admin/kyc/${sub.id}/approve`, headers: h })).statusCode).toBe(403);
    }
  });
});

describe('limites par niveau de compte', () => {
  let t: TestApp;
  beforeEach(async () => { t = await createTestApp(); });

  const invoice = (auth: Record<string, string>, amount: string, currency = 'USD', order = `o-${Math.random()}`) =>
    t.inject({ method: 'POST', url: '/v1/invoices', headers: auth, payload: { amount, currency, order_id: order } });
  const withdraw = (auth: Record<string, string>, amount: string, currency = 'usdttrc20') =>
    t.inject({ method: 'POST', url: '/v1/withdrawals', headers: auth, payload: { currency, amount, address: 'TMerchantPayout1234567890' } });

  it('compte non vérifié : 1000 USD encaissables au total, aucun retrait', async () => {
    const { session } = await signup(t);
    const api = await createApiKey(t, session);

    expect((await invoice(api, '1001')).json().error).toBe('receive_limit_exceeded');
    expect((await invoice(api, '600')).statusCode).toBe(201);
    // Les factures en attente comptent dans la limite
    expect((await invoice(api, '500')).json().error).toBe('receive_limit_exceeded');
    // Conversion des devises : 300 EUR = 324 USD (taux 1.08) → 924 USD au total
    const eur = await invoice(api, '300', 'EUR');
    expect(eur.statusCode).toBe(201);
    expect(eur.json().amount_usd).toBe('324');
    expect((await invoice(api, '100', 'USD')).json().error).toBe('receive_limit_exceeded');
    expect((await invoice(api, '10', 'JPY')).json().error).toBe('unsupported_currency');

    const limits = (await t.inject({ method: 'GET', url: '/v1/limits', headers: api })).json();
    expect(limits).toMatchObject({
      level: 'none',
      receive: { limit_usd: '1000', used_usd: '924', remaining_usd: '76', period: 'total' },
      withdraw: { allowed: false },
    });

    await paidInvoice(t, api, { amount: '50', outcome: '50' }).catch(() => undefined); // au-delà de la limite
    expect((await withdraw(api, '10')).json().error).toBe('verification_required');
  });

  it('compte personnel vérifié : retraits limités à 2000 USD sur 24 h, cours crypto pris en compte', async () => {
    const { session } = await signup(t);
    await verify(t, session, 'personal');
    const api = await createApiKey(t, session);
    await paidInvoice(t, api, { amount: '5000', outcome: '5000' }); // crédite 4950 USDT (− 1 %)
    await paidInvoice(t, api, { amount: '3000', outcome: '0.06', outcomeCurrency: 'btc' }); // 0.0594 BTC

    expect((await withdraw(api, '1500')).statusCode).toBe(201);
    const over = await withdraw(api, '600');
    expect(over.json().error).toBe('withdraw_limit_exceeded');
    expect(over.json().message).toContain('reste 500 USD');
    // BTC évalué au cours (50 000 USD) : 0.011 BTC = 550 USD > 500 restants
    expect((await withdraw(api, '0.011', 'btc')).json().error).toBe('withdraw_limit_exceeded');
    expect((await withdraw(api, '0.009', 'btc')).statusCode).toBe(201);

    const limits = (await t.inject({ method: 'GET', url: '/v1/limits', headers: api })).json();
    expect(limits.withdraw).toMatchObject({ allowed: true, limit_usd: '2000', used_usd: '1950', remaining_usd: '50', period: '24h' });
    expect(limits.receive).toMatchObject({ limit_usd: '10000', used_usd: '8000', period: '30d' });
    // Encaissement mensuel : 8000 déjà facturés, 2001 de plus dépasse 10 000
    expect((await invoice(api, '2001')).json().error).toBe('receive_limit_exceeded');
  });

  it('compte professionnel vérifié : aucune limite', async () => {
    const { session } = await signup(t, { accountType: 'business' });
    await verify(t, session, 'business');
    const api = await createApiKey(t, session);
    await paidInvoice(t, api, { amount: '250000', outcome: '250000' });
    expect((await withdraw(api, '100000')).statusCode).toBe(201);
    const limits = (await t.inject({ method: 'GET', url: '/v1/limits', headers: api })).json();
    expect(limits).toMatchObject({ level: 'business', receive: { limit_usd: null }, withdraw: { allowed: true, limit_usd: null } });
  });
});
