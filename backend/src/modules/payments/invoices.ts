import { and, asc, desc, eq, sql, type SQL } from 'drizzle-orm';
import type { Config } from '../../config.js';
import type { Db } from '../../db/client.js';
import { invoices, merchants, payments } from '../../db/schema.js';
import { HttpError } from '../../lib/errors.js';
import { fromUnits, toUnits } from '../../lib/money.js';
import { newId } from '../../lib/security.js';
import type { MerchantRow } from '../../plugins/guards.js';
import { type NowPaymentsApi, NowPaymentsError } from '../../providers/nowpayments.js';
import { assertCanReceive, invoiceUsd, type LimitsConfig } from '../limits/service.js';

type Invoice = typeof invoices.$inferSelect;
type Payment = typeof payments.$inferSelect;

const MAX_PAYMENTS_PER_INVOICE = 5;
const dec = (v: string | null) => (v == null ? null : fromUnits(toUnits(v)));

export const checkoutUrl = (baseUrl: string, id: string) => new URL(`/pay/${id}`, baseUrl).toString();

/** Une facture sans aucun paiement lancé expire à expires_at. */
export function effectiveStatus(inv: Invoice, hasPayments: boolean) {
  return inv.status === 'pending' && !hasPayments && inv.expiresAt < new Date() ? 'expired' : inv.status;
}

export function presentInvoice(inv: Invoice, baseUrl: string, hasPayments = true) {
  return {
    id: inv.id,
    order_id: inv.orderId,
    status: effectiveStatus(inv, hasPayments),
    amount: fromUnits(toUnits(inv.priceAmount)),
    currency: inv.priceCurrency.toUpperCase(),
    amount_usd: inv.amountUsd && fromUnits(toUnits(inv.amountUsd)),
    description: inv.description,
    checkout_url: checkoutUrl(baseUrl, inv.id),
    expires_at: inv.expiresAt.toISOString(),
    created_at: inv.createdAt.toISOString(),
    updated_at: inv.updatedAt.toISOString(),
  };
}

export function presentPayment(p: Payment) {
  return {
    id: p.id,
    status: p.status,
    pay_currency: p.payCurrency,
    pay_amount: dec(p.payAmount),
    pay_address: p.payAddress,
    pay_extra_id: p.payExtraId,
    actually_paid: dec(p.actuallyPaid),
    expires_at: p.expiresAt?.toISOString() ?? null,
  };
}

export interface CreateInvoiceParams {
  amount: string;
  currency: string;
  orderId: string;
  description?: string;
  successUrl?: string;
  cancelUrl?: string;
}

export async function createInvoice(
  db: Db,
  cfg: LimitsConfig & Pick<Config, 'INVOICE_TTL_MINUTES'>,
  merchant: MerchantRow,
  p: CreateInvoiceParams,
) {
  const currency = p.currency.toLowerCase();
  const amountUsd = invoiceUsd(cfg, p.amount, currency); // refuse les devises sans taux connu

  return db.transaction(async (tx) => {
    // Idempotence : un même order_id renvoie la facture existante (le marchand peut réessayer sans risque).
    const [existing] = await tx.select().from(invoices)
      .where(and(eq(invoices.merchantId, merchant.id), eq(invoices.orderId, p.orderId)));
    if (existing) return checkReplay(existing, p);

    // Verrou sur le marchand : deux factures simultanées ne peuvent pas dépasser la limite ensemble.
    const [locked] = await tx.select().from(merchants).where(eq(merchants.id, merchant.id)).for('update');
    await assertCanReceive(tx, cfg, locked!, amountUsd);

    const [row] = await tx.insert(invoices).values({
      id: newId('inv'),
      merchantId: merchant.id,
      orderId: p.orderId,
      priceAmount: p.amount,
      priceCurrency: currency,
      amountUsd,
      description: p.description,
      successUrl: p.successUrl,
      cancelUrl: p.cancelUrl,
      status: 'pending',
      expiresAt: new Date(Date.now() + cfg.INVOICE_TTL_MINUTES * 60_000),
    }).returning();
    return { invoice: row!, created: true };
  });
}

function checkReplay(existing: Invoice, p: CreateInvoiceParams) {
  const same = toUnits(existing.priceAmount) === toUnits(p.amount) && existing.priceCurrency === p.currency.toLowerCase();
  if (!same) throw new HttpError(409, 'order_id_conflict', `order_id déjà utilisé avec d'autres paramètres (${existing.id})`);
  return { invoice: existing, created: false };
}

// Statut "effectif" en SQL (une facture en attente, expirée et sans paiement est considérée expirée)
const hasPayments = sql`exists (select 1 from ${payments} where ${payments.invoiceId} = ${invoices.id})`;
const STATUS_FILTER: Record<string, SQL> = {
  pending: sql`${invoices.status} = 'pending' and (${invoices.expiresAt} >= now() or ${hasPayments})`,
  expired: sql`${invoices.status} = 'expired' or (${invoices.status} = 'pending' and ${invoices.expiresAt} < now() and not ${hasPayments})`,
};

export const INVOICE_STATUSES = ['pending', 'confirming', 'partially_paid', 'paid', 'failed', 'expired', 'refunded'] as const;

export async function listInvoices(
  db: Db,
  baseUrl: string,
  filter: { merchantId?: string; status?: string; limit: number; offset: number },
) {
  const where = and(
    filter.merchantId ? eq(invoices.merchantId, filter.merchantId) : undefined,
    filter.status ? (STATUS_FILTER[filter.status] ?? eq(invoices.status, filter.status)) : undefined,
  );
  const [rows, [count]] = await Promise.all([
    db.select({ inv: invoices, hasPayments: sql<boolean>`${hasPayments}` }).from(invoices).where(where)
      .orderBy(desc(invoices.createdAt)).limit(filter.limit).offset(filter.offset),
    db.select({ total: sql<number>`count(*)::int` }).from(invoices).where(where),
  ]);
  return {
    invoices: rows.map((r) => presentInvoice(r.inv, baseUrl, r.hasPayments)),
    total: count?.total ?? 0,
  };
}

export async function getInvoice(db: Db, baseUrl: string, merchantId: string, id: string) {
  const [inv] = await db.select().from(invoices).where(and(eq(invoices.id, id), eq(invoices.merchantId, merchantId)));
  if (!inv) throw new HttpError(404, 'not_found', 'Facture introuvable');
  const pays = await listPayments(db, id);
  return { ...presentInvoice(inv, baseUrl, pays.length > 0), payments: pays.map(presentPayment) };
}

/** Données publiques affichées sur la page de paiement (aucun secret). */
export async function getCheckout(db: Db, id: string) {
  const [row] = await db.select({ inv: invoices, merchantName: merchants.name, merchantStatus: merchants.status }).from(invoices)
    .innerJoin(merchants, eq(merchants.id, invoices.merchantId)).where(eq(invoices.id, id));
  if (!row) throw new HttpError(404, 'not_found', 'Paiement introuvable');
  const pays = await listPayments(db, id);
  // Le paiement affiché : celui qui a le plus avancé, sinon le plus récent.
  const current = pays.find((p) => p.status !== 'pending' && p.status !== 'expired') ?? pays.at(-1) ?? null;
  return {
    invoice: row.inv, merchantName: row.merchantName, merchantActive: row.merchantStatus === 'active',
    payment: current, hasPayments: pays.length > 0,
  };
}

/** Le client a choisi sa crypto : on demande à NOWPayments une adresse et un montant. */
export async function startPayment(
  deps: { db: Db; nowpayments: NowPaymentsApi; publicBaseUrl: string; currencies: string[] },
  invoiceId: string,
  payCurrency: string,
) {
  const { db } = deps;
  if (!deps.currencies.includes(payCurrency)) throw new HttpError(400, 'unsupported_currency', 'Crypto non proposée');
  const { invoice, payment: current, hasPayments, merchantActive } = await getCheckout(db, invoiceId);
  if (!merchantActive) throw new HttpError(409, 'not_payable', 'Ce marchand ne peut pas recevoir de paiement pour le moment');
  const status = effectiveStatus(invoice, hasPayments);
  if (status !== 'pending') throw new HttpError(409, 'not_payable', `Ce paiement est ${status}`);
  if (invoice.expiresAt < new Date()) throw new HttpError(409, 'not_payable', 'Ce paiement a expiré');

  const all = await listPayments(db, invoiceId);
  // Réutilise l'adresse déjà donnée pour cette crypto (évite d'en générer une à chaque rechargement).
  const reusable = all.find((p) => p.payCurrency === payCurrency && p.status === 'pending'
    && (!p.expiresAt || p.expiresAt > new Date()));
  if (reusable) return reusable;
  if (current && current.status !== 'pending' && current.status !== 'expired') {
    throw new HttpError(409, 'payment_in_progress', 'Un paiement est déjà en cours de confirmation');
  }
  if (all.length >= MAX_PAYMENTS_PER_INVOICE) throw new HttpError(429, 'too_many_attempts', 'Trop de tentatives');

  let remote;
  try {
    remote = await deps.nowpayments.createPayment({
      priceAmount: invoice.priceAmount,
      priceCurrency: invoice.priceCurrency,
      payCurrency,
      orderId: invoice.id,
      description: invoice.description ?? undefined,
      ipnCallbackUrl: new URL('/ipn/nowpayments', deps.publicBaseUrl).toString(),
    });
  } catch (e) {
    if (e instanceof NowPaymentsError && e.status < 500) throw new HttpError(422, 'provider_rejected', e.message);
    throw e;
  }

  const [row] = await db.insert(payments).values({
    id: newId('pay'),
    invoiceId,
    providerPaymentId: remote.id,
    status: 'pending',
    payCurrency: remote.payCurrency.toLowerCase(),
    payAmount: fromUnits(toUnits(remote.payAmount)),
    payAddress: remote.payAddress,
    payExtraId: remote.payExtraId,
    expiresAt: remote.expiresAt,
    raw: remote,
  }).onConflictDoNothing().returning();
  if (row) return row;
  // L'IPN "waiting" est arrivée avant notre insert : la ligne existe déjà, on la complète.
  // Uniquement si elle appartient bien à CETTE facture (jamais réutiliser le paiement d'une autre facture).
  const [updated] = await db.update(payments).set({
    payAddress: remote.payAddress, payExtraId: remote.payExtraId, expiresAt: remote.expiresAt,
    payAmount: fromUnits(toUnits(remote.payAmount)),
  }).where(and(eq(payments.providerPaymentId, remote.id), eq(payments.invoiceId, invoiceId))).returning();
  if (!updated) {
    throw new HttpError(502, 'provider_conflict', 'Le fournisseur a renvoyé un identifiant de paiement déjà utilisé. Réessaie.');
  }
  return updated;
}

const listPayments = (db: Db, invoiceId: string) =>
  db.select().from(payments).where(eq(payments.invoiceId, invoiceId)).orderBy(asc(payments.createdAt));
