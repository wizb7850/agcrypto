import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().default(3000),
  HOST: z.string().default('0.0.0.0'),
  PUBLIC_BASE_URL: z.url(),
  NOWPAYMENTS_API_KEY: z.string().min(1),
  NOWPAYMENTS_IPN_SECRET: z.string().min(1),
  NOWPAYMENTS_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
  PLATFORM_FEE_PERCENT: z.coerce.number().min(0).max(100).default(1),
  ADMIN_TOKEN: z.string().min(32, 'ADMIN_TOKEN doit faire au moins 32 caractères'),
  LOG_LEVEL: z.string().default('info'),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Configuration invalide :\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
