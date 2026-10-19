import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../../db/client.js';
import { invoices, ledgerEntries, payments } from '../../db/schema.js';
import { fromUnits, percentOf, toUnits } from '../../lib/money.js';
import { newId } from '../../lib/security.js';
import { mapPaymentStatus, type PaymentStatus } from '../../providers/nowpayments.js';
import { HttpError } from '../../lib/errors.js';
import { presentInvoice } from './invoices.js';
import { invoiceStatusFrom, isForward } from './status.js';
import { enqueueEvent } from '../webhooks/service.js';

const amountField = z.union([z.number(), z.string()]).nullish();

export const ipnSchema = z.object({
  payment_id: z.union([z.number(), z.string()]).transform(String),
  payment_status: z.string(),
  order_id: z.string(),
  pay_currency: z.string().nullish(),
  pay_amount: amountField,
  actually_paid: amountField,
  outcome_amount: amountField,
  outcome_currency: z.string().nullish(),
});

const dec = (v: number | string | null | undefined) => (v == null ? null : fromUnits(toUnits(v)));

export async function handleIpn(
  db: Db,
  opts: { feePercent: number; publicBaseUrl: string },
  raw: Record<string, unknown>,
) {
  const ipn = ipnSchema.parse(raw);
  const status = mapPaymentStatus(ipn.payment_status);

  await db.transaction(async (tx) => {
    // Verrou sur la facture : les IPN concurrentes d'une même facture sont traitées une par une.
    const [invoice] = await tx.select().from(invoices).where(eq(invoices.id, ipn.order_id)).for('update');
    if (!invoice) throw new HttpError(404, 'unknown_order', `Facture inconnue : ${ipn.order_id}`);

    const fields = {
      payCurrency: ipn.pay_currency?.toLowerCase() ?? null,
      payAmount: dec(ipn.pay_amount),
      actuallyPaid: dec(ipn.actually_paid),
      outcomeAmount: dec(ipn.outcome_amount),
      outcomeCurrency: ipn.outcome_currency?.toLowerCase() ?? null,
      raw,
      updatedAt: new Date(),
    };
    const [existing] = await tx.select().from(payments)
      .where(eq(payments.providerPaymentId, ipn.payment_id));

    if (existing && existing.invoiceId !== invoice.id) {
      throw new HttpError(400, 'invoice_mismatch', 'Ce paiement appartient à une autre facture');
    }

    let paymentId: string;
    if (!existing) {
      paymentId = newId('pay');
      await tx.insert(payments).values({
        id: paymentId, invoiceId: invoice.id, providerPaymentId: ipn.payment_id, status, ...fields,
      });
    } else {
      paymentId = existing.id;
      if (!isForward(existing.status as PaymentStatus, status)) return; // doublon ou IPN en retard
      await tx.update(payments).set({ status, ...fields }).where(eq(payments.id, paymentId));
    }

    if (status === 'paid') {
      // On crédite ce que NOWPayments nous verse réellement (après conversion éventuelle).
      const currency = fields.outcomeCurrency ?? fields.payCurrency;
      const amount = fields.outcomeAmount ?? fields.actuallyPaid;
      if (!currency || !amount) throw new Error(`IPN "finished" sans montant : ${ipn.payment_id}`);
      const gross = toUnits(amount);
      const fee = percentOf(gross, opts.feePercent);
      const base = { merchantId: invoice.merchantId, currency, reference: paymentId };
      await tx.insert(ledgerEntries).values([
        { ...base, type: 'payment', amount: fromUnits(gross) },
        { ...base, type: 'fee', amount: fromUnits(-fee) },
      ]).onConflictDoNothing();
    }

    const all = await tx.select({ status: payments.status }).from(payments)
      .where(eq(payments.invoiceId, invoice.id));
    const next = invoiceStatusFrom(all.map((p) => p.status as PaymentStatus));
    if (next === invoice.status) return;

    const [updated] = await tx.update(invoices).set({ status: next, updatedAt: new Date() })
      .where(eq(invoices.id, invoice.id)).returning();
    await enqueueEvent(tx, invoice.merchantId, `invoice.${next}`, presentInvoice(updated!, opts.publicBaseUrl));
  });
}
