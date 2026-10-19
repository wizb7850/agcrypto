import { existsSync } from 'node:fs';
import { z } from 'zod';

/** Charge le fichier .env s'il existe (les variables déjà définies dans le système restent prioritaires). */
export function loadDotEnv(path = '.env') {
  if (existsSync(path)) process.loadEnvFile(path);
}

const schema = z.object({
  DATABASE_URL: z.string().min(1).default('postgres://agcrypto:agcrypto@localhost:55432/agcrypto'),
  PORT: z.coerce.number().int().default(3000),
  // 127.0.0.1 = joignable uniquement depuis cette machine. Mettre 0.0.0.0 seulement en production derrière un proxy.
  HOST: z.string().default('127.0.0.1'),
  PUBLIC_BASE_URL: z.url().default('http://localhost:3000'),
  // demo : aucun appel à NOWPayments, adresses fictives et bouton « simuler le paiement » (local uniquement)
  NOWPAYMENTS_ENV: z.enum(['demo', 'sandbox', 'production']).default('demo'),
  NOWPAYMENTS_API_KEY: z.string().default(''),
  NOWPAYMENTS_IPN_SECRET: z.string().default(''),
  // Frais prélevés sur chaque paiement reçu (en plus des frais NOWPayments, déjà déduits par eux)
  PAYMENT_FEE_PERCENT: z.coerce.number().min(0).max(50).default(1),
  // Frais prélevés sur chaque retrait : pourcentage + frais fixe par devise (couvre les frais réseau)
  WITHDRAWAL_FEE_PERCENT: z.coerce.number().min(0).max(50).default(10),
  WITHDRAWAL_FIXED_FEES: z.string().default('{}').transform((v, ctx) => {
    try {
      return z.record(z.string(), z.string().regex(/^\d+(\.\d+)?$/)).parse(JSON.parse(v));
    } catch {
      ctx.addIssue({ code: 'custom', message: 'JSON attendu, ex. {"usdttrc20":"1","btc":"0.0001"}' });
      return z.NEVER;
    }
  }),
  // Cryptos proposées sur la page de paiement (codes NOWPayments)
  CHECKOUT_CURRENCIES: z.string().default('usdttrc20,usdterc20,usdtbsc,btc,eth,ltc,trx,bnbbsc')
    .transform((v) => v.split(',').map((c) => c.trim().toLowerCase()).filter(Boolean)),
  INVOICE_TTL_MINUTES: z.coerce.number().int().min(5).max(7 * 24 * 60).default(60),
  ADMIN_TOKEN: z.string().min(32, 'ADMIN_TOKEN doit faire au moins 32 caractères'),
  LOG_LEVEL: z.string().default('info'),
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
    const hint = existsSync('.env') ? 'Complète ces variables dans le fichier .env.'
      : 'Fichier .env introuvable : lance « npm run setup » pour le générer.';
    throw new Error(`Configuration invalide :\n${z.prettifyError(parsed.error)}\n\n${hint}`);
  }
  return parsed.data;
}

/** Pour les scripts (migrations, création de marchand) qui n'ont besoin que de la base. */
export function requireDatabaseUrl(): string {
  loadDotEnv();
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(existsSync('.env')
      ? 'DATABASE_URL manquant dans le fichier .env.'
      : 'Fichier .env introuvable : lance « npm run setup » pour le générer.');
  }
  return url;
}
