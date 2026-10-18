import {
  bigserial, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex,
} from 'drizzle-orm/pg-core';

// Montants : numeric(38,18), manipulés en string côté TypeScript (jamais en float).
const amount = (name: string) => numeric(name, { precision: 38, scale: 18 });
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const merchants = pgTable('merchants', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  webhookUrl: text('webhook_url'),
  webhookSecret: text('webhook_secret').notNull(),
  createdAt: createdAt(),
});

export const apiKeys = pgTable('api_keys', {
  id: text('id').primaryKey(),
  merchantId: text('merchant_id').notNull().references(() => merchants.id),
  keyHash: text('key_hash').notNull().unique(),
  prefix: text('prefix').notNull(),
  createdAt: createdAt(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});

export const invoices = pgTable('invoices', {
  id: text('id').primaryKey(),
  merchantId: text('merchant_id').notNull().references(() => merchants.id),
  orderId: text('order_id').notNull(),
  priceAmount: amount('price_amount').notNull(),
  priceCurrency: text('price_currency').notNull(),
  description: text('description'),
  status: text('status').notNull(),
  successUrl: text('success_url'),
  cancelUrl: text('cancel_url'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('invoices_merchant_order_uq').on(t.merchantId, t.orderId)]);

export const payments = pgTable('payments', {
  id: text('id').primaryKey(),
  invoiceId: text('invoice_id').notNull().references(() => invoices.id),
  providerPaymentId: text('provider_payment_id').notNull().unique(),
  status: text('status').notNull(),
  payCurrency: text('pay_currency'),
  payAmount: amount('pay_amount'),
  payAddress: text('pay_address'),
  payExtraId: text('pay_extra_id'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  actuallyPaid: amount('actually_paid'),
  outcomeAmount: amount('outcome_amount'),
  outcomeCurrency: text('outcome_currency'),
  raw: jsonb('raw').notNull(),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('payments_invoice_idx').on(t.invoiceId)]);

// Registre comptable : le solde d'un marchand = SUM(amount) par devise.
// On n'écrit jamais de "solde" directement, on ajoute des lignes.
export const ledgerEntries = pgTable('ledger_entries', {
  id: bigserial('id', { mode: 'bigint' }).primaryKey(),
  merchantId: text('merchant_id').notNull().references(() => merchants.id),
  currency: text('currency').notNull(),
  amount: amount('amount').notNull(),
  type: text('type').notNull(), // payment | fee | withdrawal | withdrawal_reversal
  reference: text('reference').notNull(),
  createdAt: createdAt(),
}, (t) => [
  // Empêche de créditer deux fois le même paiement (IPN reçue en double, etc.)
  uniqueIndex('ledger_type_reference_uq').on(t.type, t.reference),
  index('ledger_merchant_currency_idx').on(t.merchantId, t.currency),
]);

export const withdrawals = pgTable('withdrawals', {
  id: text('id').primaryKey(),
  merchantId: text('merchant_id').notNull().references(() => merchants.id),
  currency: text('currency').notNull(),
  amount: amount('amount').notNull(),       // débité du solde
  fee: amount('fee').notNull(),             // ta commission
  netAmount: amount('net_amount').notNull(), // ce que tu envoies réellement
  address: text('address').notNull(),
  extraId: text('extra_id'),
  status: text('status').notNull(), // requested | completed | rejected
  txHash: text('tx_hash'),
  rejectReason: text('reject_reason'),
  createdAt: createdAt(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
}, (t) => [index('withdrawals_status_idx').on(t.status)]);

// Outbox : les notifications aux marchands sont écrites dans la même transaction
// que le changement d'état, puis envoyées par un worker avec relances.
export const webhookDeliveries = pgTable('webhook_deliveries', {
  id: text('id').primaryKey(),
  merchantId: text('merchant_id').notNull().references(() => merchants.id),
  eventType: text('event_type').notNull(),
  payload: jsonb('payload').notNull(),
  status: text('status').notNull(), // pending | delivered | failed
  attempts: integer('attempts').notNull().default(0),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
  lastError: text('last_error'),
  createdAt: createdAt(),
}, (t) => [index('webhook_due_idx').on(t.status, t.nextAttemptAt)]);
