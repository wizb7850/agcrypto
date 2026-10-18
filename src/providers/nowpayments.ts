import { createHmac } from 'node:crypto';
import { safeEqual } from '../lib/security.js';

const BASE_URLS = {
  production: 'https://api.nowpayments.io/v1',
  sandbox: 'https://api-sandbox.nowpayments.io/v1',
} as const;

export interface CreateInvoiceInput {
  priceAmount: string;
  priceCurrency: string;
  orderId: string;
  description?: string;
  ipnCallbackUrl: string;
  successUrl?: string;
  cancelUrl?: string;
  payCurrency?: string;
}

export interface NowPaymentsApi {
  createInvoice(input: CreateInvoiceInput): Promise<{ id: string; invoiceUrl: string }>;
}

export function createNowPaymentsClient(opts: {
  apiKey: string;
  env: keyof typeof BASE_URLS;
  fetchImpl?: typeof fetch;
}): NowPaymentsApi {
  const doFetch = opts.fetchImpl ?? fetch;
  const base = BASE_URLS[opts.env];

  return {
    async createInvoice(input) {
      const res = await doFetch(`${base}/invoice`, {
        method: 'POST',
        headers: { 'x-api-key': opts.apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({
          price_amount: Number(input.priceAmount),
          price_currency: input.priceCurrency.toLowerCase(),
          order_id: input.orderId,
          order_description: input.description,
          ipn_callback_url: input.ipnCallbackUrl,
          success_url: input.successUrl,
          cancel_url: input.cancelUrl,
          pay_currency: input.payCurrency,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok || !body.id || !body.invoice_url) {
        throw new Error(`NOWPayments createInvoice a échoué (${res.status}) : ${JSON.stringify(body)}`);
      }
      return { id: String(body.id), invoiceUrl: String(body.invoice_url) };
    },
  };
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
