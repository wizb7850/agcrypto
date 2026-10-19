import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { pagination, route } from '../../lib/http.js';
import type { Guards } from '../../plugins/guards.js';
import { listWithdrawals, quoteWithdrawal, requestWithdrawal } from './service.js';

const decimal = z.string().regex(/^\d+(\.\d{1,18})?$/, 'Montant décimal attendu, ex. "49.5"');
const currency = z.string().regex(/^[a-zA-Z0-9]{2,20}$/, 'Code crypto NOWPayments, ex. usdttrc20');

export function registerWithdrawalRoutes(app: FastifyInstance, ctx: AppContext, guards: Guards) {
  const { db, config } = ctx;
  const tags = ['Retraits'];
  const auth = ['api_key', 'merchant_session'] as const;

  route(app, {
    method: 'GET', url: '/v1/withdrawals/quote', tags, auth: [...auth],
    summary: 'Aperçu des frais d\'un retrait',
    query: z.object({ currency, amount: decimal }),
    handler: async ({ req, query }) => {
      await guards.merchant(req);
      return quoteWithdrawal(config, query.currency, query.amount);
    },
  });

  route(app, {
    method: 'POST', url: '/v1/withdrawals', tags, auth: [...auth],
    summary: 'Demander un retrait',
    description: 'Compte vérifié requis. Le montant est bloqué immédiatement, puis envoyé par l\'équipe après contrôle.',
    body: z.object({
      currency,
      amount: decimal,
      address: z.string().trim().min(10).max(200),
      extra_id: z.string().trim().max(100).optional(),
    }),
    handler: async ({ req, reply, body }) => {
      const p = await guards.merchant(req, { requireActive: true });
      const w = await requestWithdrawal(ctx, p.merchant, {
        currency: body.currency, amount: body.amount, address: body.address, extraId: body.extra_id || undefined,
      });
      return reply.status(201).send(w);
    },
  });

  route(app, {
    method: 'GET', url: '/v1/withdrawals', tags, auth: [...auth],
    summary: 'Historique des retraits',
    query: pagination.extend({ status: z.enum(['requested', 'completed', 'rejected']).optional() }),
    handler: async ({ req, query }) => {
      const p = await guards.merchant(req);
      return listWithdrawals(db, { merchantId: p.merchant.id, ...query });
    },
  });
}
