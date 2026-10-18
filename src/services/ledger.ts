import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { ledgerEntries } from '../db/schema.js';
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
