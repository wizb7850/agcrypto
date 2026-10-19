import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import QRCode from 'qrcode';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import type { payments } from '../../db/schema.js';
import { HttpError } from '../../lib/errors.js';
import { route } from '../../lib/http.js';
import { fromUnits, toUnits } from '../../lib/money.js';
import { renderCheckoutPage } from './checkout-page.js';
import { currencyInfo } from './currencies.js';
import { effectiveStatus, getCheckout, presentPayment, startPayment } from './invoices.js';
import { handleIpn } from './ipn.js';

// Page de paiement publique vue par les clients des marchands (servie par l'API, sans framework).

const params = z.object({ id: z.string().regex(/^inv_[0-9a-f]{24}$/, 'Paiement introuvable') });

async function publicPayment(p: typeof payments.$inferSelect) {
  const info = currencyInfo(p.payCurrency ?? '');
  return {
    ...presentPayment(p),
    label: info.name,
    network: info.network,
    qr_svg: p.payAddress ? await QRCode.toString(p.payAddress, { type: 'svg', margin: 1 }) : null,
  };
}

export function registerCheckoutRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, config } = ctx;
  const demo = config.NOWPAYMENTS_ENV === 'demo';
  const tags = ['Page de paiement'];

  // Page HTML (pas dans la documentation API)
  app.get('/pay/:id', { schema: { hide: true } }, async (req, reply) => {
    const r = params.safeParse(req.params);
    if (!r.success) throw new HttpError(404, 'not_found', 'Paiement introuvable');
    const nonce = randomBytes(16).toString('base64');
    return reply
      .header('content-type', 'text/html; charset=utf-8')
      .header('content-security-policy',
        `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data:; connect-src 'self'; frame-ancestors 'none'`)
      .header('referrer-policy', 'no-referrer')
      .send(renderCheckoutPage(r.data.id, nonce));
  });

  route(app, {
    method: 'GET', url: '/pay/:id/data', tags, auth: 'public',
    summary: 'Données publiques d\'une page de paiement',
    params,
    handler: async ({ reply, params: { id } }) => {
      const { invoice, merchantName, payment, hasPayments } = await getCheckout(db, id);
      reply.header('cache-control', 'no-store');
      return {
        merchant: merchantName,
        amount: fromUnits(toUnits(invoice.priceAmount)),
        currency: invoice.priceCurrency.toUpperCase(),
        description: invoice.description,
        status: effectiveStatus(invoice, hasPayments),
        expires_at: invoice.expiresAt.toISOString(),
        success_url: invoice.successUrl,
        currencies: config.CHECKOUT_CURRENCIES.map(currencyInfo),
        demo,
        payment: payment ? await publicPayment(payment) : null,
      };
    },
  });

  route(app, {
    method: 'POST', url: '/pay/:id/payment', tags, auth: 'public',
    summary: 'Le client choisit sa crypto : obtenir l\'adresse et le montant à payer',
    params,
    body: z.object({ pay_currency: z.string().max(20) }),
    handler: async ({ params: { id }, body }) => publicPayment(await startPayment({
      db, nowpayments: ctx.nowpayments, publicBaseUrl: config.PUBLIC_BASE_URL, currencies: config.CHECKOUT_CURRENCIES,
    }, id, body.pay_currency.toLowerCase())),
  });

  if (demo) {
    // Mode démo uniquement : simule ce que NOWPayments enverrait quand le client paie.
    route(app, {
      method: 'POST', url: '/pay/:id/demo-simulate', tags, auth: 'public',
      summary: '[Démo] Simuler le paiement du client',
      params,
      handler: async ({ params: { id } }) => {
        const { payment } = await getCheckout(db, id);
        if (!payment) throw new HttpError(409, 'no_payment', 'Choisis d\'abord une crypto');
        const base = {
          payment_id: payment.providerPaymentId, order_id: payment.invoiceId, pay_currency: payment.payCurrency,
          pay_amount: payment.payAmount, actually_paid: payment.payAmount,
          outcome_amount: payment.payAmount, outcome_currency: payment.payCurrency,
        };
        const opts = { feePercent: config.PAYMENT_FEE_PERCENT, publicBaseUrl: config.PUBLIC_BASE_URL };
        await handleIpn(db, opts, { ...base, payment_status: 'confirming' });
        setTimeout(() => {
          handleIpn(db, opts, { ...base, payment_status: 'finished' }).catch((e) => app.log.error(e));
        }, 4000);
        return { ok: true };
      },
    });
  }
}
