import multipart from '@fastify/multipart';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify from 'fastify';
import { z } from 'zod';
import type { AppContext } from './context.js';
import { HttpError } from './lib/errors.js';
import { registerAdminRoutes } from './modules/admin/routes.js';
import { registerAuthRoutes } from './modules/auth/routes.js';
import { registerKycRoutes } from './modules/kyc/routes.js';
import { registerMerchantRoutes } from './modules/merchant/routes.js';
import { registerCheckoutRoutes } from './modules/payments/checkout.js';
import { registerPaymentRoutes } from './modules/payments/routes.js';
import { registerWithdrawalRoutes } from './modules/withdrawals/routes.js';
import { createGuards } from './plugins/guards.js';

export async function buildApp(ctx: AppContext) {
  const app = Fastify({
    logger: { level: ctx.config.LOG_LEVEL },
    // Derrière un proxy local (Vite en dev, Nginx/Caddy en production) : vraie adresse IP du client
    trustProxy: 'loopback',
    bodyLimit: 1024 * 1024,
  });

  // La validation est faite par zod (lib/http.ts). Les schémas JSON servent uniquement à la documentation.
  app.setValidatorCompiler(() => () => true);

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      return reply.status(err.statusCode).send({ error: err.code, message: err.message });
    }
    if (err instanceof z.ZodError) {
      return reply.status(400).send({ error: 'invalid_request', message: z.prettifyError(err) });
    }
    const { statusCode, message, code } = err as { statusCode?: number; message?: string; code?: string };
    if (statusCode && statusCode < 500) {
      return reply.status(statusCode).send({ error: code?.toLowerCase() ?? 'bad_request', message });
    }
    req.log.error(err);
    return reply.status(500).send({ error: 'internal_error', message: 'Erreur interne' });
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'agcrypto API',
        version: '1.0.0',
        description: [
          'API de la passerelle de paiement crypto agcrypto.',
          '',
          '- **Site du marchand** : en-tête `Authorization: Bearer agc_...` (clé créée dans le tableau de bord).',
          '- **Tableau de bord / back-office** : cookie de session + en-tête `x-agcrypto-csrf: 1` sur les actions.',
        ].join('\n'),
      },
      components: {
        securitySchemes: {
          apiKey: { type: 'http', scheme: 'bearer', description: 'Clé API du marchand (agc_...)' },
          merchantSession: { type: 'apiKey', in: 'cookie', name: 'agc_merchant' },
          adminSession: { type: 'apiKey', in: 'cookie', name: 'agc_admin' },
          csrf: { type: 'apiKey', in: 'header', name: 'x-agcrypto-csrf', description: 'Mettre la valeur 1' },
        },
      },
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 5 } });

  const guards = createGuards(ctx.db);
  app.get('/health', { schema: { tags: ['Système'], summary: 'État du service' } }, async () => ({ status: 'ok' }));
  registerAuthRoutes(app, ctx, guards);
  registerMerchantRoutes(app, ctx, guards);
  registerPaymentRoutes(app, ctx, guards);
  registerWithdrawalRoutes(app, ctx, guards);
  registerKycRoutes(app, ctx, guards);
  registerCheckoutRoutes(app, ctx);
  registerAdminRoutes(app, ctx, guards);

  return app;
}
