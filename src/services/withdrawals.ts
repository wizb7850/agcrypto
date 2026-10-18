import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { ledgerEntries, merchants, withdrawals } from '../db/schema.js';
import { fromUnits, toUnits } from '../lib/money.js';
import { newId } from '../lib/security.js';
import { HttpError } from './errors.js';
import { type FeeConfig, withdrawalFee } from './fees.js';
import { getBalance } from './ledger.js';
import { enqueueEvent } from './webhooks.js';

type Withdrawal = typeof withdrawals.$inferSelect;

export function presentWithdrawal(w: Withdrawal) {
  return {
    id: w.id,
    status: w.status,
    currency: w.currency,
    amount: fromUnits(toUnits(w.amount)),
    fee: fromUnits(toUnits(w.fee)),
    net_amount: fromUnits(toUnits(w.netAmount)),
    address: w.address,
    extra_id: w.extraId,
    tx_hash: w.txHash,
    reject_reason: w.rejectReason,
    created_at: w.createdAt.toISOString(),
    processed_at: w.processedAt?.toISOString() ?? null,
  };
}

export function quoteWithdrawal(fees: FeeConfig, currency: string, amount: string) {
  const c = currency.toLowerCase();
  const { fee, net } = withdrawalFee(fees, c, toUnits(amount));
  return { currency: c, amount: fromUnits(toUnits(amount)), fee: fromUnits(fee), net_amount: fromUnits(net) };
}

export async function requestWithdrawal(
  db: Db,
  fees: FeeConfig,
  merchantId: string,
  p: { currency: string; amount: string; address: string; extraId?: string },
) {
  const currency = p.currency.toLowerCase();
  const amount = toUnits(p.amount);
  if (amount <= 0n) throw new HttpError(400, 'invalid_amount', 'Le montant doit être positif');
  // Frais figés au moment de la demande : un changement de config n'affecte pas les retraits en attente.
  const { fee, net } = withdrawalFee(fees, currency, amount);

  return db.transaction(async (tx) => {
    // Verrou sur le marchand : deux demandes simultanées ne peuvent pas dépenser le même solde.
    await tx.select({ id: merchants.id }).from(merchants).where(eq(merchants.id, merchantId)).for('update');
    const balance = await getBalance(tx, merchantId, currency);
    if (balance < amount) {
      throw new HttpError(422, 'insufficient_balance', `Solde insuffisant (${fromUnits(balance)} ${currency})`);
    }
    const id = newId('wd');
    const [w] = await tx.insert(withdrawals).values({
      id, merchantId, currency, amount: fromUnits(amount), fee: fromUnits(fee), netAmount: fromUnits(net), address: p.address, extraId: p.extraId, status: 'requested',
    }).returning();
    // Le montant est retiré du solde dès la demande (bloqué), recrédité si l'admin refuse.
    await tx.insert(ledgerEntries).values({
      merchantId, currency, amount: fromUnits(-amount), type: 'withdrawal', reference: id,
    });
    return presentWithdrawal(w!);
  });
}

export async function listWithdrawals(db: Db, filter: { merchantId?: string; status?: string }) {
  const conds = [
    filter.merchantId ? eq(withdrawals.merchantId, filter.merchantId) : undefined,
    filter.status ? eq(withdrawals.status, filter.status) : undefined,
  ];
  const rows = await db.select().from(withdrawals).where(and(...conds))
    .orderBy(desc(withdrawals.createdAt)).limit(100);
  return rows.map(presentWithdrawal);
}

export async function completeWithdrawal(db: Db, id: string, txHash: string) {
  return processWithdrawal(db, id, async (tx, w) => {
    const [updated] = await tx.update(withdrawals)
      .set({ status: 'completed', txHash, processedAt: new Date() })
      .where(eq(withdrawals.id, w.id)).returning();
    return updated!;
  });
}

export async function rejectWithdrawal(db: Db, id: string, reason: string) {
  return processWithdrawal(db, id, async (tx, w) => {
    const [updated] = await tx.update(withdrawals)
      .set({ status: 'rejected', rejectReason: reason, processedAt: new Date() })
      .where(eq(withdrawals.id, w.id)).returning();
    await tx.insert(ledgerEntries).values({
      merchantId: w.merchantId, currency: w.currency, amount: w.amount, type: 'withdrawal_reversal', reference: w.id,
    });
    return updated!;
  });
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

async function processWithdrawal(db: Db, id: string, apply: (tx: Tx, w: Withdrawal) => Promise<Withdrawal>) {
  return db.transaction(async (tx) => {
    const [w] = await tx.select().from(withdrawals).where(eq(withdrawals.id, id)).for('update');
    if (!w) throw new HttpError(404, 'not_found', 'Retrait introuvable');
    if (w.status !== 'requested') throw new HttpError(409, 'already_processed', `Retrait déjà ${w.status}`);
    const updated = await apply(tx, w);
    await enqueueEvent(tx, w.merchantId, `withdrawal.${updated.status}`, presentWithdrawal(updated));
    return presentWithdrawal(updated);
  });
}
