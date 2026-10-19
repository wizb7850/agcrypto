import {
  bigserial, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex,
} from 'drizzle-orm/pg-core';

// Montants : numeric(38,18), manipulés en string côté TypeScript (jamais en float).
const amount = (name: string) => numeric(name, { precision: 38, scale: 18 });
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const ts = (name: string) => timestamp(name, { withTimezone: true });

// =====================================================================
// Marchands et comptes
// =====================================================================

export const merchants = pgTable('merchants', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  // Profil choisi à l'inscription : personal (particulier) | business (entreprise)
  accountType: text('account_type').notNull().default('personal'),
  // Niveau obtenu après vérification : none | personal | business. Détermine les limites.
  verificationLevel: text('verification_level').notNull().default('none'),
  status: text('status').notNull().default('active'), // active | suspended
  suspendedReason: text('suspended_reason'),
  webhookUrl: text('webhook_url'),
  webhookSecret: text('webhook_secret').notNull(),
  createdAt: createdAt(),
});

// Personnes qui se connectent au tableau de bord d'un marchand.
export const merchantUsers = pgTable('merchant_users', {
  id: text('id').primaryKey(),
  merchantId: text('merchant_id').notNull().references(() => merchants.id),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  emailVerifiedAt: ts('email_verified_at'),
  createdAt: createdAt(),
}, (t) => [index('merchant_users_merchant_idx').on(t.merchantId)]);

// Équipe back-office (un compte par personne, avec un rôle).
export const adminUsers = pgTable('admin_users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull(), // owner | compliance | finance | support
  disabledAt: ts('disabled_at'),
  createdAt: createdAt(),
});

// Sessions de connexion : on ne stocke que l'empreinte (SHA-256) du jeton placé dans le cookie.
export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(), // merchant | admin
  userId: text('user_id').notNull(),
  expiresAt: ts('expires_at').notNull(),
  createdAt: createdAt(),
}, (t) => [index('sessions_user_idx').on(t.userId), index('sessions_expires_idx').on(t.expiresAt)]);

// Codes de vérification d'e-mail et liens de réinitialisation de mot de passe (empreintes uniquement).
export const authTokens = pgTable('auth_tokens', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  purpose: text('purpose').notNull(), // email_verification | password_reset
  tokenHash: text('token_hash').notNull(),
  attempts: integer('attempts').notNull().default(0),
  expiresAt: ts('expires_at').notNull(),
  usedAt: ts('used_at'),
  createdAt: createdAt(),
}, (t) => [index('auth_tokens_user_idx').on(t.userId, t.purpose), index('auth_tokens_hash_idx').on(t.tokenHash)]);

// Clés API : utilisées par le site du marchand pour appeler l'API (jamais pour se connecter au tableau de bord).
export const apiKeys = pgTable('api_keys', {
  id: text('id').primaryKey(),
  merchantId: text('merchant_id').notNull().references(() => merchants.id),
  name: text('name'),
  keyHash: text('key_hash').notNull().unique(),
  prefix: text('prefix').notNull(),
  createdAt: createdAt(),
  revokedAt: ts('revoked_at'),
});

// =====================================================================
// Vérification d'identité (KYC particulier / KYB entreprise)
// =====================================================================

export const kycSubmissions = pgTable('kyc_submissions', {
  id: text('id').primaryKey(),
  merchantId: text('merchant_id').notNull().references(() => merchants.id),
  level: text('level').notNull(), // personal | business
  status: text('status').notNull(), // pending | approved | rejected
  data: jsonb('data').notNull(),
  rejectReason: text('reject_reason'),
  reviewedBy: text('reviewed_by'),
  submittedAt: ts('submitted_at').notNull().defaultNow(),
  reviewedAt: ts('reviewed_at'),
}, (t) => [index('kyc_status_idx').on(t.status), index('kyc_merchant_idx').on(t.merchantId)]);

export const kycDocuments = pgTable('kyc_documents', {
  id: text('id').primaryKey(),
  merchantId: text('merchant_id').notNull().references(() => merchants.id),
  submissionId: text('submission_id').references(() => kycSubmissions.id),
  kind: text('kind').notNull(), // id_front | id_back | selfie | proof_of_address | company_registration | ...
  fileName: text('file_name').notNull(),
  mimeType: text('mime_type').notNull(),
  size: integer('size').notNull(),
  sha256: text('sha256').notNull(),
  storageKey: text('storage_key').notNull(),
  createdAt: createdAt(),
}, (t) => [index('kyc_documents_submission_idx').on(t.submissionId)]);

// =====================================================================
// Paiements
// =====================================================================

export const invoices = pgTable('invoices', {
  id: text('id').primaryKey(),
  merchantId: text('merchant_id').notNull().references(() => merchants.id),
  orderId: text('order_id').notNull(),
  priceAmount: amount('price_amount').notNull(),
  priceCurrency: text('price_currency').notNull(),
  // Équivalent USD figé à la création : sert au calcul des limites et des statistiques
  amountUsd: amount('amount_usd'),
  description: text('description'),
  status: text('status').notNull(),
  successUrl: text('success_url'),
  cancelUrl: text('cancel_url'),
  expiresAt: ts('expires_at').notNull(),
  createdAt: createdAt(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('invoices_merchant_order_uq').on(t.merchantId, t.orderId),
  index('invoices_merchant_created_idx').on(t.merchantId, t.createdAt),
]);

export const payments = pgTable('payments', {
  id: text('id').primaryKey(),
  invoiceId: text('invoice_id').notNull().references(() => invoices.id),
  providerPaymentId: text('provider_payment_id').notNull().unique(),
  status: text('status').notNull(),
  payCurrency: text('pay_currency'),
  payAmount: amount('pay_amount'),
  payAddress: text('pay_address'),
  payExtraId: text('pay_extra_id'),
  expiresAt: ts('expires_at'),
  actuallyPaid: amount('actually_paid'),
  outcomeAmount: amount('outcome_amount'),
  outcomeCurrency: text('outcome_currency'),
  raw: jsonb('raw').notNull(),
  createdAt: createdAt(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => [index('payments_invoice_idx').on(t.invoiceId)]);

// =====================================================================
// Comptabilité et retraits
// =====================================================================

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
  amount: amount('amount').notNull(), // débité du solde
  fee: amount('fee').notNull(), // commission de la plateforme
  netAmount: amount('net_amount').notNull(), // ce que l'équipe envoie réellement
  amountUsd: amount('amount_usd'), // équivalent USD à la demande (limites)
  address: text('address').notNull(),
  extraId: text('extra_id'),
  status: text('status').notNull(), // requested | completed | rejected
  txHash: text('tx_hash'),
  rejectReason: text('reject_reason'),
  processedBy: text('processed_by'),
  createdAt: createdAt(),
  processedAt: ts('processed_at'),
}, (t) => [index('withdrawals_status_idx').on(t.status), index('withdrawals_merchant_idx').on(t.merchantId)]);

// =====================================================================
// Notifications et traçabilité
// =====================================================================

// Outbox : les notifications aux marchands sont écrites dans la même transaction
// que le changement d'état, puis envoyées par un worker avec relances.
export const webhookDeliveries = pgTable('webhook_deliveries', {
  id: text('id').primaryKey(),
  merchantId: text('merchant_id').notNull().references(() => merchants.id),
  eventType: text('event_type').notNull(),
  payload: jsonb('payload').notNull(),
  status: text('status').notNull(), // pending | delivered | failed
  attempts: integer('attempts').notNull().default(0),
  nextAttemptAt: ts('next_attempt_at').notNull().defaultNow(),
  lastError: text('last_error'),
  createdAt: createdAt(),
}, (t) => [index('webhook_due_idx').on(t.status, t.nextAttemptAt)]);

// Journal de toutes les actions de l'équipe back-office (qui a fait quoi, quand).
export const adminAuditLog = pgTable('admin_audit_log', {
  id: bigserial('id', { mode: 'bigint' }).primaryKey(),
  adminId: text('admin_id').notNull(),
  action: text('action').notNull(), // ex. kyc.approve, withdrawal.complete, merchant.suspend
  targetType: text('target_type').notNull(),
  targetId: text('target_id').notNull(),
  details: jsonb('details'),
  ip: text('ip'),
  createdAt: createdAt(),
}, (t) => [index('audit_created_idx').on(t.createdAt)]);
