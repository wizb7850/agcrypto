import { existsSync } from 'node:fs';
import { z } from 'zod';

/** Charge le fichier .env s'il existe (les variables déjà définies dans le système restent prioritaires). */
export function loadDotEnv(path = '.env') {
  if (existsSync(path)) process.loadEnvFile(path);
}

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().default(3000),
  HOST: z.string().default('0.0.0.0'),
  PUBLIC_BASE_URL: z.url(),
  NOWPAYMENTS_API_KEY: z.string().min(1),
  NOWPAYMENTS_IPN_SECRET: z.string().min(1),
  NOWPAYMENTS_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
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
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const hint = existsSync('.env') ? 'Complète ces variables dans le fichier .env.'
      : 'Fichier .env introuvable : crée-le avec « cp .env.example .env » puis remplis-le.';
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
      : 'Fichier .env introuvable : crée-le avec « cp .env.example .env » puis remplis-le.');
  }
  return url;
}
