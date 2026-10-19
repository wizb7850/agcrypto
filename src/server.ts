import { buildApp } from './app.js';
import { loadConfig, loadDotEnv } from './config.js';
import { createDb } from './db/client.js';
import { createNowPaymentsClient } from './providers/nowpayments.js';
import { deliverDueWebhooks } from './services/webhooks.js';

loadDotEnv();
const config = loadConfig();
const { db, close } = createDb(config.DATABASE_URL);
const nowpayments = createNowPaymentsClient({ apiKey: config.NOWPAYMENTS_API_KEY, env: config.NOWPAYMENTS_ENV });
const app = buildApp({ db, config, nowpayments });

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
