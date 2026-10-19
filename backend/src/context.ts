import type { Config } from './config.js';
import type { Db } from './db/client.js';
import type { DocumentStorage } from './modules/kyc/storage.js';
import type { Mailer } from './modules/notifications/mailer.js';
import type { NowPaymentsApi } from './providers/nowpayments.js';
import type { PriceService } from './providers/prices.js';

/** Dépendances partagées par tous les modules (injectées : on peut tout remplacer dans les tests). */
export interface AppContext {
  db: Db;
  config: Config;
  nowpayments: NowPaymentsApi;
  prices: PriceService;
  mailer: Mailer;
  storage: DocumentStorage;
}

export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
