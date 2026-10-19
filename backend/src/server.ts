import { buildApp } from './app.js';
import { loadConfig, loadDotEnv } from './config.js';
import type { AppContext } from './context.js';
import { createDb } from './db/client.js';
import { LocalDiskStorage } from './modules/kyc/storage.js';
import { createMailer } from './modules/notifications/mailer.js';
import { deliverDueWebhooks } from './modules/webhooks/service.js';
import { createDemoProvider } from './providers/demo.js';
import { createNowPaymentsClient } from './providers/nowpayments.js';
import { createPriceService } from './providers/prices.js';

loadDotEnv();
const config = loadConfig();
const { db, close } = createDb(config.DATABASE_URL);
const nowpayments = config.NOWPAYMENTS_ENV === 'demo'
  ? createDemoProvider()
  : createNowPaymentsClient({ apiKey: config.NOWPAYMENTS_API_KEY, env: config.NOWPAYMENTS_ENV });

// Le mailer a besoin du logger de l'application : on le branche juste après sa création.
const ctx: AppContext = {
  db, config, nowpayments,
  prices: createPriceService(nowpayments),
  storage: new LocalDiskStorage(config.UPLOAD_DIR),
  mailer: { send: async (m) => mailer.send(m) },
};
const app = await buildApp(ctx);
const mailer = createMailer(config, app.log);

if (config.NOWPAYMENTS_ENV === 'demo') {
  app.log.warn('MODE DÉMO : paiements fictifs, ne jamais utiliser en production (NOWPAYMENTS_ENV=demo)');
}
if (!config.SMTP_URL) app.log.warn('SMTP_URL vide : les e-mails sont seulement écrits dans les logs');

// Worker d'envoi des webhooks (dans le même processus pour la v1).
let stopping = false;
const worker = (async () => {
  while (!stopping) {
    try {
      const sent = await deliverDueWebhooks(db, app.log);
      if (sent === 0) await new Promise((r) => setTimeout(r, 2000));
    } catch (err) {
      app.log.error(err, 'worker webhooks');
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
})();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    stopping = true;
    await app.close();
    await worker;
    await close();
    process.exit(0);
  });
}

await app.listen({ port: config.PORT, host: config.HOST });
app.log.info(`API prête : ${config.PUBLIC_BASE_URL}/health — documentation : ${config.PUBLIC_BASE_URL}/docs`);
