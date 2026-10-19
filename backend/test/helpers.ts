import { createHmac, randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { AppContext } from '../src/context.js';
import type { Db } from '../src/db/client.js';
import * as schema from '../src/db/schema.js';
import type { Role } from '../src/modules/admin/permissions.js';
import { createAdmin } from '../src/modules/auth/service.js';
import { MemoryStorage } from '../src/modules/kyc/storage.js';
import { MemoryMailer } from '../src/modules/notifications/mailer.js';
import type { CreatePaymentInput, NowPaymentsApi } from '../src/providers/nowpayments.js';
import { createPriceService } from '../src/providers/prices.js';

export const IPN_SECRET = 'test-ipn-secret';
export const CSRF = { 'x-agcrypto-csrf': '1' };
export const PASSWORD = 'motdepasse-solide';

type Headers = Record<string, string>;
type Inject = Awaited<ReturnType<typeof buildApp>>['inject'];
export type TestApp = Awaited<ReturnType<typeof createTestApp>>;

/** Application complète sur un vrai PostgreSQL en mémoire, avec NOWPayments, e-mails et stockage simulés. */
export async function createTestApp(env: Record<string, string> = {}) {
  const pg = drizzle(new PGlite(), { schema });
  await migrate(pg, { migrationsFolder: './drizzle' });
  const db = pg as unknown as Db;
  const config = loadConfig({
    NOWPAYMENTS_ENV: 'sandbox', NOWPAYMENTS_API_KEY: 'test', NOWPAYMENTS_IPN_SECRET: IPN_SECRET,
    PUBLIC_BASE_URL: 'https://api.agcrypto.test', APP_URL: 'https://app.agcrypto.test', LOG_LEVEL: 'silent',
    WITHDRAWAL_FIXED_FEES: '{"usdttrc20":"1"}', CHECKOUT_CURRENCIES: 'usdttrc20,btc', ...env,
  });
  const calls: CreatePaymentInput[] = [];
  let nextPaymentId = 777;
  const nowpayments: NowPaymentsApi = {
    async createPayment(input) {
      calls.push(input);
      return {
        id: String(nextPaymentId++), status: 'waiting', payAddress: 'TXYZpayAddress1234567890abcdef', payAmount: '50.12',
        payCurrency: input.payCurrency, payExtraId: null, expiresAt: new Date(Date.now() + 3600_000),
      };
    },
    async estimate(amount, _from, to) {
      const prices: Record<string, number> = { btc: 50_000 };
      if (!prices[to]) throw new Error('cours inconnu');
      return String(Number(amount) / prices[to]);
    },
  };
  const mailer = new MemoryMailer();
  const storage = new MemoryStorage();
  const ctx: AppContext = { db, config, nowpayments, prices: createPriceService(nowpayments), mailer, storage };
  const app = await buildApp(ctx);
  return { app, db, config, mailer, storage, calls, ctx, inject: app.inject.bind(app) as Inject };
}

export function cookieOf(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers['set-cookie'];
  return String(Array.isArray(raw) ? raw[0] : raw).split(';')[0]!;
}

export const codeFromMail = (t: TestApp, email: string) => t.mailer.lastTo(email)?.text.match(/\b(\d{6})\b/)?.[1];

/** Inscription + vérification de l'e-mail. Renvoie les en-têtes d'une session marchand. */
export async function signup(t: TestApp, opts: { email?: string; accountType?: 'personal' | 'business'; name?: string } = {}) {
  const email = opts.email ?? `marchand-${randomBytes(4).toString('hex')}@test.com`;
  const res = await t.inject({
    method: 'POST', url: '/auth/merchant/signup', headers: CSRF,
    payload: { account_type: opts.accountType ?? 'personal', name: opts.name ?? 'Boutique Test', email, password: PASSWORD },
  });
  if (res.statusCode !== 201) throw new Error(`signup: ${res.body}`);
  const session: Headers = { cookie: cookieOf(res), ...CSRF };
  const verify = await t.inject({ method: 'POST', url: '/auth/merchant/verify-email', headers: session, payload: { code: codeFromMail(t, email) } });
  if (verify.statusCode !== 200) throw new Error(`verify: ${verify.body}`);
  const me = (await t.inject({ method: 'GET', url: '/auth/merchant/me', headers: session })).json();
  return { email, session, merchantId: me.merchant.id as string };
}

export async function createApiKey(t: TestApp, session: Headers): Promise<Headers> {
  const res = await t.inject({ method: 'POST', url: '/v1/api-keys', headers: session, payload: { name: 'Site' } });
  if (res.statusCode !== 201) throw new Error(`api key: ${res.body}`);
  return { authorization: `Bearer ${res.json().key}` };
}

/** Crée un membre de l'équipe et renvoie les en-têtes de sa session. */
export async function adminSession(t: TestApp, role: Role = 'owner', email = `${role}-${randomBytes(3).toString('hex')}@agcrypto.test`) {
  await createAdmin(t.db, email, 'admin-motdepasse', role);
  const res = await t.inject({ method: 'POST', url: '/auth/admin/login', headers: CSRF, payload: { email, password: 'admin-motdepasse' } });
  if (res.statusCode !== 200) throw new Error(`admin login: ${res.body}`);
  return { cookie: cookieOf(res), ...CSRF } as Headers;
}

// ---- Documents ----

export const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(64)]);

export function multipart(content: Buffer, filename = 'piece.png', mime = 'image/png') {
  const boundary = `----agc${randomBytes(8).toString('hex')}`;
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { payload, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

export async function upload(t: TestApp, session: Headers, kind: string, content = PNG) {
  const mp = multipart(content);
  return t.inject({ method: 'POST', url: `/v1/verification/documents?kind=${kind}`, headers: { ...session, ...mp.headers }, payload: mp.payload });
}

export const personalData = {
  first_name: 'Awa', last_name: 'Diallo', birth_date: '1990-04-12', nationality: 'Sénégalaise',
  id_type: 'id_card', id_number: 'SN123456', country: 'Sénégal', city: 'Dakar', address: '12 rue des Almadies',
};

export const businessData = {
  company_name: 'Diallo Commerce SARL', registration_number: 'SN-DKR-2024-B-1234', country: 'Sénégal', city: 'Dakar',
  address: '5 avenue Bourguiba', activity: 'Vente en ligne de vêtements',
  representative: { ...personalData, role: 'Gérante' },
};

/** Envoie un dossier complet et le fait valider par l'équipe. */
export async function verify(t: TestApp, session: Headers, level: 'personal' | 'business', admin?: Headers) {
  const kinds = level === 'personal'
    ? ['id_front', 'id_back', 'selfie', 'proof_of_address']
    : ['company_registration', 'company_proof_of_address', 'representative_id_front', 'representative_id_back'];
  const ids: string[] = [];
  for (const kind of kinds) ids.push((await upload(t, session, kind)).json().id);
  const sub = await t.inject({
    method: 'POST', url: '/v1/verification/submissions', headers: session,
    payload: { level, data: level === 'personal' ? personalData : businessData, document_ids: ids },
  });
  if (sub.statusCode !== 201) throw new Error(`submission: ${sub.body}`);
  const reviewer = admin ?? await adminSession(t, 'compliance');
  const ok = await t.inject({ method: 'POST', url: `/admin/kyc/${sub.json().id}/approve`, headers: reviewer });
  if (ok.statusCode !== 200) throw new Error(`approve: ${ok.body}`);
  return sub.json().id as string;
}

// ---- Paiements ----

export function signIpn(body: object) {
  const sort = (v: unknown): unknown => (v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort((v as Record<string, unknown>)[k])])) : v);
  return createHmac('sha512', IPN_SECRET).update(JSON.stringify(sort(body))).digest('hex');
}

export const sendIpn = (t: TestApp, body: Record<string, unknown>) =>
  t.inject({ method: 'POST', url: '/ipn/nowpayments', headers: { 'x-nowpayments-sig': signIpn(body) }, payload: body });

/** Crée une facture et simule un paiement complet. Crédite `outcome` `currency` (moins la commission). */
export async function paidInvoice(t: TestApp, auth: Headers, opts: { amount?: string; currency?: string; outcome: string; outcomeCurrency?: string }) {
  const inv = await t.inject({
    method: 'POST', url: '/v1/invoices', headers: auth,
    payload: { amount: opts.amount ?? '50', currency: opts.currency ?? 'USD', order_id: `cmd-${randomBytes(4).toString('hex')}` },
  });
  if (inv.statusCode !== 201) throw new Error(`invoice: ${inv.body}`);
  const pay = await t.inject({ method: 'POST', url: `/pay/${inv.json().id}/payment`, payload: { pay_currency: 'usdttrc20' } });
  const ipn = await sendIpn(t, {
    payment_id: Number(t.calls.length + 776), order_id: inv.json().id, payment_status: 'finished',
    pay_currency: 'usdttrc20', pay_amount: 50.12, actually_paid: 50.12,
    outcome_amount: Number(opts.outcome), outcome_currency: opts.outcomeCurrency ?? 'usdttrc20',
  });
  if (pay.statusCode !== 200 || ipn.statusCode !== 200) throw new Error(`paiement: ${pay.body} ${ipn.body}`);
  return inv.json().id as string;
}
