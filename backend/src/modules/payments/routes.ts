import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { HttpError } from '../../lib/errors.js';
import { pagination, route } from '../../lib/http.js';
import type { Guards } from '../../plugins/guards.js';
import { verifyIpnSignature } from '../../providers/nowpayments.js';
import { createInvoice, getInvoice, INVOICE_STATUSES, listInvoices, presentInvoice } from './invoices.js';
import { handleIpn } from './ipn.js';

const decimal = z.string().regex(/^\d+(\.\d{1,8})?$/, 'Montant décimal attendu, ex. "49.99"');

export function registerPaymentRoutes(app: FastifyInstance, ctx: AppContext, guards: Guards) {
  const { db, config } = ctx;
  const tags = ['Factures'];
  const auth = ['api_key', 'merchant_session'] as const;

  route(app, {
    method: 'POST', url: '/v1/invoices', tags, auth: [...auth],
    summary: 'Créer une facture (lien de paiement)',
    description: 'Idempotent : un même order_id renvoie la facture existante. Soumis aux limites du compte.',
    body: z.object({
      amount: decimal.refine((v) => Number(v) > 0, 'Le montant doit être positif'),
      currency: z.string().regex(/^[a-zA-Z]{3}$/, 'Code devise sur 3 lettres, ex. EUR'),
      order_id: z.string().trim().min(1).max(100),
      description: z.string().max(500).optional(),
      success_url: z.url().optional(),
      cancel_url: z.url().optional(),
    }),
    handler: async ({ req, reply, body }) => {
      const p = await guards.merchant(req, { requireActive: true });
      const { invoice, created } = await createInvoice(db, config, p.merchant, {
        amount: body.amount, currency: body.currency, orderId: body.order_id, description: body.description,
        successUrl: body.success_url, cancelUrl: body.cancel_url,
      });
      return reply.status(created ? 201 : 200).send(presentInvoice(invoice, config.PUBLIC_BASE_URL, false));
    },
  });

  route(app, {
    method: 'GET', url: '/v1/invoices', tags, auth: [...auth],
    summary: 'Lister les factures',
    query: pagination.extend({ status: z.enum(INVOICE_STATUSES).optional() }),
    handler: async ({ req, query }) => {
      const p = await guards.merchant(req);
      return listInvoices(db, config.PUBLIC_BASE_URL, { merchantId: p.merchant.id, ...query });
    },
  });

  route(app, {
    method: 'GET', url: '/v1/invoices/:id', tags, auth: [...auth],
    summary: 'Détail d\'une facture et de ses paiements',
    params: z.object({ id: z.string() }),
    handler: async ({ req, params }) => {
      const p = await guards.merchant(req);
      return getInvoice(db, config.PUBLIC_BASE_URL, p.merchant.id, params.id);
    },
  });

  // Notifications envoyées par NOWPayments (signées avec le secret IPN)
  app.post('/ipn/nowpayments', { schema: { hide: true } }, async (req, reply) => {
    // En démo il n'y a pas de secret IPN : la route est fermée pour qu'on ne puisse rien forger.
    if (config.NOWPAYMENTS_ENV === 'demo') throw new HttpError(404, 'not_found', 'IPN désactivées en mode démo');
    const sig = req.headers['x-nowpayments-sig'];
    if (!verifyIpnSignature(req.body, typeof sig === 'string' ? sig : undefined, config.NOWPAYMENTS_IPN_SECRET)) {
      req.log.warn('IPN rejetée : signature invalide');
      throw new HttpError(401, 'invalid_signature', 'Signature invalide');
    }
    await handleIpn(db, { feePercent: config.PAYMENT_FEE_PERCENT, publicBaseUrl: config.PUBLIC_BASE_URL },
      req.body as Record<string, unknown>);
    return reply.send({ ok: true });
  });
}
