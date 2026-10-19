import { beforeEach, describe, expect, it } from 'vitest';
import { codeFromMail, cookieOf, createTestApp, CSRF, PASSWORD, signup, type TestApp } from './helpers.js';

describe('comptes marchands', () => {
  let t: TestApp;
  beforeEach(async () => { t = await createTestApp(); });

  it('inscription → vérification de l\'e-mail par code', async () => {
    const res = await t.inject({
      method: 'POST', url: '/auth/merchant/signup', headers: CSRF,
      payload: { account_type: 'business', name: 'Ma Société', email: 'Contact@MaSociete.com', password: PASSWORD },
    });
    expect(res.statusCode).toBe(201);
    expect(String(res.headers['set-cookie'])).toMatch(/HttpOnly.*SameSite=Lax/);
    const session = { cookie: cookieOf(res), ...CSRF };

    // Tant que l'e-mail n'est pas vérifié : profil visible, mais rien d'autre
    const me = (await t.inject({ method: 'GET', url: '/auth/merchant/me', headers: session })).json();
    expect(me).toMatchObject({
      user: { email: 'contact@masociete.com', email_verified: false },
      merchant: { name: 'Ma Société', account_type: 'business', verification_level: 'none', status: 'active' },
    });
    expect((await t.inject({ method: 'GET', url: '/v1/dashboard', headers: session })).json().error).toBe('email_not_verified');

    // Code envoyé par e-mail ; un mauvais code est refusé
    const code = codeFromMail(t, 'contact@masociete.com')!;
    expect(code).toMatch(/^\d{6}$/);
    const wrong = code === '000000' ? '111111' : '000000';
    expect((await t.inject({ method: 'POST', url: '/auth/merchant/verify-email', headers: session, payload: { code: wrong } })).statusCode).toBe(400);
    expect((await t.inject({ method: 'POST', url: '/auth/merchant/verify-email', headers: session, payload: { code } })).statusCode).toBe(200);
    expect((await t.inject({ method: 'GET', url: '/auth/merchant/me', headers: session })).json().user.email_verified).toBe(true);
    expect((await t.inject({ method: 'GET', url: '/v1/dashboard', headers: session })).statusCode).toBe(200);
  });

  it('le code est bloqué après 5 erreurs, un nouveau code le remplace', async () => {
    const res = await t.inject({ method: 'POST', url: '/auth/merchant/signup', headers: CSRF,
      payload: { account_type: 'personal', name: 'Awa', email: 'awa@test.com', password: PASSWORD } });
    const session = { cookie: cookieOf(res), ...CSRF };
    const first = codeFromMail(t, 'awa@test.com')!;
    const bad = first === '123456' ? '654321' : '123456';
    for (let i = 0; i < 5; i++) await t.inject({ method: 'POST', url: '/auth/merchant/verify-email', headers: session, payload: { code: bad } });
    expect((await t.inject({ method: 'POST', url: '/auth/merchant/verify-email', headers: session, payload: { code: first } })).statusCode).toBe(429);

    expect((await t.inject({ method: 'POST', url: '/auth/merchant/resend-verification', headers: session })).statusCode).toBe(200);
    // Renvoi limité à 1 par minute
    expect((await t.inject({ method: 'POST', url: '/auth/merchant/resend-verification', headers: session })).statusCode).toBe(429);
    const second = codeFromMail(t, 'awa@test.com')!;
    if (second !== first) {
      expect((await t.inject({ method: 'POST', url: '/auth/merchant/verify-email', headers: session, payload: { code: first } })).statusCode).toBe(400);
    }
    expect((await t.inject({ method: 'POST', url: '/auth/merchant/verify-email', headers: session, payload: { code: second } })).statusCode).toBe(200);
  });

  it('refuse les inscriptions invalides', async () => {
    await signup(t, { email: 'deja@test.com' });
    const base = { account_type: 'personal', name: 'X Y', password: PASSWORD };
    const post = (payload: object, headers: Record<string, string> = CSRF) =>
      t.inject({ method: 'POST', url: '/auth/merchant/signup', headers, payload });
    expect((await post({ ...base, email: 'DEJA@test.com' })).statusCode).toBe(409);
    expect((await post({ ...base, email: 'nouveau@test.com', password: 'court' })).statusCode).toBe(400);
    expect((await post({ ...base, email: 'pas-un-email' })).statusCode).toBe(400);
    expect((await post({ ...base, email: 'n@test.com', account_type: 'autre' })).statusCode).toBe(400);
    // Sans en-tête CSRF : refusé (protection contre les formulaires d'autres sites)
    expect((await post({ ...base, email: 'csrf@test.com' }, {})).statusCode).toBe(403);
  });

  it('connexion, déconnexion et limitation des tentatives', async () => {
    const { email } = await signup(t, { email: 'login@test.com' });
    const login = (password: string) => t.inject({ method: 'POST', url: '/auth/merchant/login', headers: CSRF, payload: { email, password } });

    expect((await login('mauvais-mot-de-passe')).statusCode).toBe(401);
    const ok = await login(PASSWORD);
    expect(ok.statusCode).toBe(200);
    const session = { cookie: cookieOf(ok), ...CSRF };
    expect((await t.inject({ method: 'GET', url: '/auth/merchant/me', headers: session })).statusCode).toBe(200);
    await t.inject({ method: 'POST', url: '/auth/merchant/logout', headers: session });
    expect((await t.inject({ method: 'GET', url: '/auth/merchant/me', headers: session })).statusCode).toBe(401);

    // Compte inconnu : même réponse qu'un mauvais mot de passe
    const unknown = await t.inject({ method: 'POST', url: '/auth/merchant/login', headers: CSRF, payload: { email: 'inconnu@test.com', password: 'x' } });
    expect(unknown.json()).toEqual((await login('encore-faux')).json());

    for (let i = 0; i < 10; i++) await login('faux');
    expect((await login(PASSWORD)).statusCode).toBe(429);
  });

  it('mot de passe oublié puis réinitialisation par lien', async () => {
    const { email, session } = await signup(t, { email: 'oubli@test.com' });
    const forgot = (e: string) => t.inject({ method: 'POST', url: '/auth/merchant/password/forgot', headers: CSRF, payload: { email: e } });

    const before = t.mailer.messages.length;
    expect((await forgot('inconnu@test.com')).statusCode).toBe(200); // ne révèle pas si le compte existe
    expect(t.mailer.messages.length).toBe(before);

    expect((await forgot(email)).statusCode).toBe(200);
    const link = t.mailer.lastTo(email)!.text.match(/https:\/\/app\.agcrypto\.test\/reinitialiser-mot-de-passe\?token=(\S+)/);
    const token = decodeURIComponent(link![1]!);

    const reset = (password: string) => t.inject({ method: 'POST', url: '/auth/merchant/password/reset', headers: CSRF, payload: { token, password } });
    expect((await reset('nouveau-mot-de-passe')).statusCode).toBe(200);
    expect((await reset('encore-un-autre-mdp')).statusCode).toBe(400); // lien à usage unique

    // L'ancienne session est fermée, l'ancien mot de passe ne marche plus
    expect((await t.inject({ method: 'GET', url: '/auth/merchant/me', headers: session })).statusCode).toBe(401);
    const login = (password: string) => t.inject({ method: 'POST', url: '/auth/merchant/login', headers: CSRF, payload: { email, password } });
    expect((await login(PASSWORD)).statusCode).toBe(401);
    expect((await login('nouveau-mot-de-passe')).statusCode).toBe(200);
  });

  it('changement de mot de passe depuis le tableau de bord', async () => {
    const { email, session } = await signup(t, { email: 'change@test.com' });
    const change = (current: string) => t.inject({ method: 'POST', url: '/auth/merchant/password/change', headers: session,
      payload: { current_password: current, new_password: 'mot-de-passe-2' } });
    expect((await change('faux')).statusCode).toBe(400);
    const ok = await change(PASSWORD);
    expect(ok.statusCode).toBe(200);
    // L'ancienne session est fermée, une nouvelle est ouverte
    expect((await t.inject({ method: 'GET', url: '/auth/merchant/me', headers: session })).statusCode).toBe(401);
    expect((await t.inject({ method: 'GET', url: '/auth/merchant/me', headers: { cookie: cookieOf(ok) } })).statusCode).toBe(200);
    expect(t.mailer.lastTo(email)!.subject).toContain('mot de passe a été modifié');
  });
});

describe('clés API', () => {
  it('créées depuis le tableau de bord, affichées une fois, révocables', async () => {
    const t = await createTestApp();
    const { session } = await signup(t);
    const created = await t.inject({ method: 'POST', url: '/v1/api-keys', headers: session, payload: { name: 'Boutique' } });
    expect(created.statusCode).toBe(201);
    const key = created.json().key as string;
    expect(key).toMatch(/^agc_/);
    const bearer = { authorization: `Bearer ${key}` };

    // La liste ne contient jamais la clé complète
    const list = await t.inject({ method: 'GET', url: '/v1/api-keys', headers: session });
    expect(list.body).not.toContain(key);
    expect(list.json().api_keys[0]).toMatchObject({ name: 'Boutique', prefix: key.slice(0, 10), revoked_at: null });

    expect((await t.inject({ method: 'GET', url: '/v1/balance', headers: bearer })).statusCode).toBe(200);
    // Une clé API ne donne pas accès à la gestion du compte
    expect((await t.inject({ method: 'GET', url: '/v1/api-keys', headers: bearer })).statusCode).toBe(401);
    expect((await t.inject({ method: 'GET', url: '/admin/overview', headers: bearer })).statusCode).toBe(401);

    await t.inject({ method: 'DELETE', url: `/v1/api-keys/${created.json().id}`, headers: session });
    expect((await t.inject({ method: 'GET', url: '/v1/balance', headers: bearer })).statusCode).toBe(401);
  });
});
