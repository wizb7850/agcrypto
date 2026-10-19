import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

export const newId = (prefix: string) => `${prefix}_${randomBytes(12).toString('hex')}`;

export const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

export const randomToken = () => randomBytes(32).toString('base64url');

/** Code à 6 chiffres (vérification d'e-mail). */
export const randomCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0');

export function generateApiKey() {
  const key = `agc_${randomBytes(32).toString('base64url')}`;
  return { key, hash: sha256(key), prefix: key.slice(0, 10) };
}

export const generateWebhookSecret = () => `whsec_${randomBytes(24).toString('base64url')}`;

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Signature des webhooks envoyés aux marchands : HMAC-SHA256 de `${timestamp}.${body}`. */
export function signWebhook(secret: string, timestamp: number, body: string): string {
  const v1 = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${v1}`;
}
