import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { invoices, payments } from '../db/schema.js';
import { fromUnits, toUnits } from '../lib/money.js';
import { newId } from '../lib/security.js';
import type { NowPaymentsApi } from '../providers/nowpayments.js';
import { HttpError } from './errors.js';

type Invoice = typeof invoices.$inferSelect;

export function presentInvoice(inv: Invoice) {
  return {
    id: inv.id,
    order_id: inv.orderId,
    status: inv.status,
    amount: fromUnits(toUnits(inv.priceAmount)),
    currency: inv.priceCurrency.toUpperCase(),
    description: inv.description,
    checkout_url: inv.checkoutUrl,
    created_at: inv.createdAt.toISOString(),
    updated_at: inv.updatedAt.toISOString(),
  };
}

export interface CreateInvoiceParams {
  amount: string;
  currency: string;
  orderId: string;
  description?: string;
  successUrl?: string;
  cancelUrl?: string;
  payCurrency?: string;
}

export async function createInvoice(
  deps: { db: Db; nowpayments: NowPaymentsApi; publicBaseUrl: string },
  merchantId: string,
  p: CreateInvoiceParams,
): Promise<{ invoice: Invoice; created: boolean }> {
  const { db } = deps;
  // Idempotence : un même order_id renvoie la facture existante (le marchand peut réessayer sans risque).
  const existing = await findByOrderId(db, merchantId, p.orderId);
  if (existing) return checkReplay(existing, p);

  const id = newId('inv');
  // L'appel externe se fait AVANT l'insert : si NOWPayments échoue, rien n'est créé chez nous.
  // Si l'insert échoue ensuite, la facture NOWPayments orpheline n'a jamais été communiquée : sans risque.
  const remote = await deps.nowpayments.createInvoice({
    priceAmount: p.amount,
    priceCurrency: p.currency,
    orderId: id,
    description: p.description,
    ipnCallbackUrl: new URL('/ipn/nowpayments', deps.publicBaseUrl).toString(),
    successUrl: p.successUrl,
    cancelUrl: p.cancelUrl,
    payCurrency: p.payCurrency,
  });

  const [row] = await db.insert(invoices).values({
    id,
    merchantId,
    orderId: p.orderId,
    priceAmount: p.amount,
    priceCurrency: p.currency.toLowerCase(),
    description: p.description,
    status: 'pending',
    providerInvoiceId: remote.id,
    checkoutUrl: remote.invoiceUrl,
  }).onConflictDoNothing().returning();

  if (row) return { invoice: row, created: true };
  // Requête concurrente avec le même order_id : elle a gagné, on renvoie sa facture.
  const winner = await findByOrderId(db, merchantId, p.orderId);
  if (!winner) throw new Error('Facture introuvable après conflit');
  return checkReplay(winner, p);
}

export async function getInvoice(db: Db, merchantId: string, id: string) {
  const [inv] = await db.select().from(invoices)
    .where(and(eq(invoices.id, id), eq(invoices.merchantId, merchantId)));
  if (!inv) throw new HttpError(404, 'not_found', 'Facture introuvable');
  const pays = await db.select().from(payments).where(eq(payments.invoiceId, id));
  return {
    ...presentInvoice(inv),
    payments: pays.map((p) => ({
      id: p.id,
      status: p.status,
      pay_currency: p.payCurrency,
      pay_amount: p.payAmount && fromUnits(toUnits(p.payAmount)),
      actually_paid: p.actuallyPaid && fromUnits(toUnits(p.actuallyPaid)),
    })),
  };
}

async function findByOrderId(db: Db, merchantId: string, orderId: string) {
  const [inv] = await db.select().from(invoices)
    .where(and(eq(invoices.merchantId, merchantId), eq(invoices.orderId, orderId)));
  return inv;
}

function checkReplay(inv: Invoice, p: CreateInvoiceParams) {
  const same = toUnits(inv.priceAmount) === toUnits(p.amount)
    && inv.priceCurrency === p.currency.toLowerCase();
  if (!same) {
    throw new HttpError(409, 'order_id_conflict', `order_id déjà utilisé avec d'autres paramètres (${inv.id})`);
  }
  return { invoice: inv, created: false };
}
