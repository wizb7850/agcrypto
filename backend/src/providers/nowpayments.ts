import { createHmac } from 'node:crypto';
import { safeEqual } from '../lib/security.js';

const BASE_URLS = {
  production: 'https://api.nowpayments.io/v1',
  sandbox: 'https://api-sandbox.nowpayments.io/v1',
} as const;

export interface CreatePaymentInput {
  priceAmount: string;
  priceCurrency: string;
  payCurrency: string;
  orderId: string;
  description?: string;
  ipnCallbackUrl: string;
}

export interface ProviderPayment {
  id: string;
  status: string;
  payAddress: string;
  payAmount: string;
  payCurrency: string;
  payExtraId: string | null;
  expiresAt: Date | null;
}

export interface NowPaymentsApi {
  /** Crée un paiement et renvoie l'adresse + le montant crypto à afficher sur NOTRE page. */
  createPayment(input: CreatePaymentInput): Promise<ProviderPayment>;
  /** Estimation de conversion (ex. 1000 USD → combien de BTC). Sert à évaluer les retraits en USD. */
  estimate(amount: string, from: string, to: string): Promise<string>;
}

export function createNowPaymentsClient(opts: {
  apiKey: string;
  env: keyof typeof BASE_URLS;
  fetchImpl?: typeof fetch;
}): NowPaymentsApi {
  const doFetch = opts.fetchImpl ?? fetch;
  const base = BASE_URLS[opts.env];

  return {
    async createPayment(input) {
      const res = await doFetch(`${base}/payment`, {
        method: 'POST',
        headers: { 'x-api-key': opts.apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({
          price_amount: Number(input.priceAmount),
          price_currency: input.priceCurrency.toLowerCase(),
          pay_currency: input.payCurrency,
          order_id: input.orderId,
          order_description: input.description,
          ipn_callback_url: input.ipnCallbackUrl,
        }),
        signal: AbortSignal.timeout(20_000),
      });
      const b = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok || !b.payment_id || !b.pay_address || b.pay_amount == null) {
        // Message NOWPayments utile (ex. montant inférieur au minimum de la crypto choisie)
        throw new NowPaymentsError(res.status, typeof b.message === 'string' ? b.message : JSON.stringify(b));
      }
      return {
        id: String(b.payment_id),
        status: String(b.payment_status ?? 'waiting'),
        payAddress: String(b.pay_address),
        payAmount: String(b.pay_amount),
        payCurrency: String(b.pay_currency ?? input.payCurrency),
        payExtraId: b.payin_extra_id ? String(b.payin_extra_id) : null,
        expiresAt: typeof b.expiration_estimate_date === 'string' ? new Date(b.expiration_estimate_date) : null,
      };
    },

    async estimate(amount, from, to) {
      const qs = new URLSearchParams({ amount, currency_from: from, currency_to: to });
      const res = await doFetch(`${base}/estimate?${qs}`, {
        headers: { 'x-api-key': opts.apiKey },
        signal: AbortSignal.timeout(10_000),
      });
      const b = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok || b.estimated_amount == null) {
        throw new NowPaymentsError(res.status, typeof b.message === 'string' ? b.message : 'estimation impossible');
      }
      return String(b.estimated_amount);
    },
  };
}

export class NowPaymentsError extends Error {
  constructor(public status: number, message: string) {
    super(`NOWPayments (${status}) : ${message}`);
  }
}

/**
 * Vérifie l'en-tête `x-nowpayments-sig` : HMAC-SHA512 du corps JSON
 * avec les clés triées alphabétiquement (récursivement), clé = secret IPN.
 */
export function verifyIpnSignature(body: unknown, signature: string | undefined, ipnSecret: string): boolean {
  if (!signature || typeof body !== 'object' || body === null) return false;
  const expected = createHmac('sha512', ipnSecret).update(JSON.stringify(sortKeys(body))).digest('hex');
  return safeEqual(expected, signature.toLowerCase());
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

// Statuts NOWPayments : waiting, confirming, confirmed, sending, partially_paid,
// finished, failed, refunded, expired.
export type PaymentStatus =
  | 'pending' | 'confirming' | 'partially_paid' | 'paid' | 'failed' | 'expired' | 'refunded';

export function mapPaymentStatus(nowStatus: string): PaymentStatus {
  switch (nowStatus) {
    case 'waiting': return 'pending';
    case 'confirming':
    case 'confirmed':
    case 'sending': return 'confirming';
    case 'partially_paid': return 'partially_paid';
    case 'finished': return 'paid';
    case 'failed': return 'failed';
    case 'expired': return 'expired';
    case 'refunded': return 'refunded';
    default: throw new Error(`Statut NOWPayments inconnu : ${nowStatus}`);
  }
}
