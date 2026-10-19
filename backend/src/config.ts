import { existsSync } from 'node:fs';
import { z } from 'zod';

/** Charge le fichier .env s'il existe (les variables déjà définies dans le système restent prioritaires). */
export function loadDotEnv(path = '.env') {
  if (existsSync(path)) process.loadEnvFile(path);
}

/** Variable d'environnement contenant du JSON, validée par un schéma. */
const json = <T extends z.ZodType>(schema: T, example: string) =>
  z.string().transform((value, ctx): z.output<T> => {
    try {
      return schema.parse(JSON.parse(value));
    } catch {
      ctx.addIssue({ code: 'custom', message: `JSON attendu, ex. ${example}` });
      return z.NEVER;
    }
  });

const decimalMap = z.record(z.string(), z.string().regex(/^\d+(\.\d+)?$/));
const usd = z.coerce.number().min(0);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().min(1).default('postgres://agcrypto:agcrypto@localhost:55432/agcrypto'),
  PORT: z.coerce.number().int().default(3000),
  // 127.0.0.1 = joignable uniquement depuis cette machine. 0.0.0.0 seulement en production derrière un proxy.
  HOST: z.string().default('127.0.0.1'),
  // Adresse publique de l'API : liens de paiement (/pay/...) et notifications NOWPayments
  PUBLIC_BASE_URL: z.url().default('http://localhost:3000'),
  // Adresse du frontend : liens envoyés par e-mail (réinitialisation du mot de passe…)
  APP_URL: z.url().default('http://localhost:3001'),
  LOG_LEVEL: z.string().default('info'),

  // ---- NOWPayments ----
  // demo : aucun appel à NOWPayments, adresses fictives et bouton « simuler le paiement » (local uniquement)
  NOWPAYMENTS_ENV: z.enum(['demo', 'sandbox', 'production']).default('demo'),
  NOWPAYMENTS_API_KEY: z.string().default(''),
  NOWPAYMENTS_IPN_SECRET: z.string().default(''),

  // ---- Frais (revenus de la plateforme) ----
  PAYMENT_FEE_PERCENT: z.coerce.number().min(0).max(50).default(1),
  WITHDRAWAL_FEE_PERCENT: z.coerce.number().min(0).max(50).default(10),
  WITHDRAWAL_FIXED_FEES: json(decimalMap, '{"usdttrc20":"1","btc":"0.0001"}')
    .default({ usdttrc20: '1', usdterc20: '5', usdtbsc: '1', btc: '0.0001' }),

  // ---- Limites par niveau de vérification (en équivalent USD) ----
  LIMIT_UNVERIFIED_RECEIVE_USD: usd.default(1000), // cumul total avant vérification
  LIMIT_PERSONAL_RECEIVE_USD_30D: usd.default(10_000), // sur 30 jours glissants
  LIMIT_PERSONAL_WITHDRAW_USD_24H: usd.default(2000), // sur 24 heures glissantes
  // Valeur en USD d'une unité de chaque monnaie de facturation (à mettre à jour régulièrement)
  FX_RATES_USD: json(decimalMap, '{"usd":"1","eur":"1.08"}').default({
    usd: '1', eur: '1.08', gbp: '1.27', chf: '1.13', cad: '0.73', xof: '0.00165', xaf: '0.00165', mad: '0.1',
  }),

  // ---- Paiement ----
  CHECKOUT_CURRENCIES: z.string().default('usdttrc20,usdterc20,usdtbsc,btc,eth,ltc,trx,bnbbsc')
    .transform((v) => v.split(',').map((c) => c.trim().toLowerCase()).filter(Boolean)),
  INVOICE_TTL_MINUTES: z.coerce.number().int().min(5).max(7 * 24 * 60).default(60),

  // ---- E-mails ----
  // Vide = les e-mails sont seulement écrits dans les logs. En local : smtp://127.0.0.1:1025 (Mailpit).
  SMTP_URL: z.string().default(''),
  MAIL_FROM: z.string().default('agcrypto <no-reply@agcrypto.local>'),

  // ---- Documents de vérification (stockés hors du dossier public) ----
  UPLOAD_DIR: z.string().default('./storage'),
}).superRefine((c, ctx) => {
  if (c.NOWPAYMENTS_ENV === 'demo') return;
  for (const key of ['NOWPAYMENTS_API_KEY', 'NOWPAYMENTS_IPN_SECRET'] as const) {
    if (!c[key]) ctx.addIssue({ code: 'custom', path: [key], message: `obligatoire en mode ${c.NOWPAYMENTS_ENV}` });
  }
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const hint = existsSync('.env') ? 'Corrige ces variables dans le fichier .env.'
      : 'Fichier .env introuvable : lance « npm run setup » pour le générer.';
    throw new Error(`Configuration invalide :\n${z.prettifyError(parsed.error)}\n\n${hint}`);
  }
  return parsed.data;
}

/** Pour les scripts (migrations, création de compte admin) qui n'ont besoin que de la base. */
export function requireDatabaseUrl(): string {
  loadDotEnv();
  return loadConfig().DATABASE_URL;
}
