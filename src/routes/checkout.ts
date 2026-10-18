import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import QRCode from 'qrcode';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import type { payments } from '../db/schema.js';
import type { NowPaymentsApi } from '../providers/nowpayments.js';
import { currencyInfo } from '../checkout/currencies.js';
import { renderCheckoutPage } from '../checkout/page.js';
import { HttpError } from '../services/errors.js';
import { effectiveStatus, getCheckout, presentPayment, startPayment } from '../services/invoices.js';
import { fromUnits, toUnits } from '../lib/money.js';

interface Deps { db: Db; nowpayments: NowPaymentsApi; publicBaseUrl: string; currencies: string[] }

const idParam = z.object({ id: z.string().regex(/^inv_[0-9a-f]{24}$/) });

async function publicPayment(p: typeof payments.$inferSelect) {
  const info = currencyInfo(p.payCurrency ?? '');
  return {
    ...presentPayment(p),
    label: info.name,
    network: info.network,
    qr_svg: p.payAddress ? await QRCode.toString(p.payAddress, { type: 'svg', margin: 1 }) : null,
  };
}

export function registerCheckoutRoutes(app: FastifyInstance, deps: Deps) {
  const parseId = (params: unknown) => {
    const r = idParam.safeParse(params);
    if (!r.success) throw new HttpError(404, 'not_found', 'Paiement introuvable');
    return r.data.id;
  };

  app.get('/pay/:id', async (req, reply) => {
    const id = parseId(req.params);
    const nonce = randomBytes(16).toString('base64');
    return reply
      .header('content-type', 'text/html; charset=utf-8')
      .header('content-security-policy',
        `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data:; connect-src 'self'; frame-ancestors 'none'`)
      .header('referrer-policy', 'no-referrer')
      .send(renderCheckoutPage(id, nonce));
  });

  app.get('/pay/:id/data', async (req, reply) => {
    const { invoice, merchantName, payment, hasPayments } = await getCheckout(deps.db, parseId(req.params));
    reply.header('cache-control', 'no-store');
    return {
      merchant: merchantName,
      amount: fromUnits(toUnits(invoice.priceAmount)),
      currency: invoice.priceCurrency.toUpperCase(),
      description: invoice.description,
      status: effectiveStatus(invoice, hasPayments),
      expires_at: invoice.expiresAt.toISOString(),
      success_url: invoice.successUrl,
      currencies: deps.currencies.map(currencyInfo),
      payment: payment ? await publicPayment(payment) : null,
    };
  });

  app.post('/pay/:id/payment', async (req) => {
    const { pay_currency } = z.object({ pay_currency: z.string().max(20) }).parse(req.body);
    const p = await startPayment(deps, parseId(req.params), pay_currency.toLowerCase());
    return publicPayment(p);
  });
}
