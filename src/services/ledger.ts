import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { ledgerEntries, withdrawals } from '../db/schema.js';
import { fromUnits, toUnits } from '../lib/money.js';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export async function getBalance(db: Db | Tx, merchantId: string, currency: string): Promise<bigint> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${ledgerEntries.amount}), 0)::text` })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.merchantId, merchantId), eq(ledgerEntries.currency, currency)));
  return toUnits(row?.total ?? '0');
}

export async function getBalances(db: Db, merchantId: string) {
  const rows = await db
    .select({
      currency: ledgerEntries.currency,
      total: sql<string>`sum(${ledgerEntries.amount})::text`,
    })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.merchantId, merchantId))
    .groupBy(ledgerEntries.currency)
    .orderBy(ledgerEntries.currency);
  return rows.map((r) => ({ currency: r.currency, available: fromUnits(toUnits(r.total)) }));
}

/** Tes revenus par devise : frais sur paiements + frais sur retraits effectués. */
export async function getRevenue(db: Db) {
  const paymentFees = await db
    .select({ currency: ledgerEntries.currency, total: sql<string>`(-sum(${ledgerEntries.amount}))::text` })
    .from(ledgerEntries).where(eq(ledgerEntries.type, 'fee')).groupBy(ledgerEntries.currency);
  const withdrawalFees = await db
    .select({ currency: withdrawals.currency, total: sql<string>`sum(${withdrawals.fee})::text` })
    .from(withdrawals).where(eq(withdrawals.status, 'completed')).groupBy(withdrawals.currency);

  const byCurrency = new Map<string, { payment_fees: bigint; withdrawal_fees: bigint }>();
  const get = (c: string) => byCurrency.get(c) ?? byCurrency.set(c, { payment_fees: 0n, withdrawal_fees: 0n }).get(c)!;
  for (const r of paymentFees) get(r.currency).payment_fees += toUnits(r.total);
  for (const r of withdrawalFees) get(r.currency).withdrawal_fees += toUnits(r.total);
  return [...byCurrency].sort(([a], [b]) => a.localeCompare(b)).map(([currency, v]) => ({
    currency,
    payment_fees: fromUnits(v.payment_fees),
    withdrawal_fees: fromUnits(v.withdrawal_fees),
    total: fromUnits(v.payment_fees + v.withdrawal_fees),
  }));
}
