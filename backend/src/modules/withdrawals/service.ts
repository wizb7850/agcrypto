import { and, desc, eq, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { AppContext, Tx } from '../../context.js';
import type { Db } from '../../db/client.js';
import { ledgerEntries, merchants, merchantUsers, withdrawals } from '../../db/schema.js';
import { HttpError } from '../../lib/errors.js';
import { fromUnits, toUnits } from '../../lib/money.js';
import { newId } from '../../lib/security.js';
import type { AdminRow, MerchantRow } from '../../plugins/guards.js';
import { audit } from '../admin/audit.js';
import { getBalance } from '../ledger/service.js';
import { assertCanWithdraw } from '../limits/service.js';
import { sendInBackground } from '../notifications/mailer.js';
import * as mails from '../notifications/templates.js';
import { enqueueEvent } from '../webhooks/service.js';
import { type FeeConfig, withdrawalFee } from './fees.js';

type Withdrawal = typeof withdrawals.$inferSelect;

export function presentWithdrawal(w: Withdrawal, merchantName?: string) {
  return {
    id: w.id,
    merchant_id: w.merchantId,
    ...(merchantName !== undefined && { merchant_name: merchantName }),
    status: w.status,
    currency: w.currency,
    amount: fromUnits(toUnits(w.amount)),
    fee: fromUnits(toUnits(w.fee)),
    net_amount: fromUnits(toUnits(w.netAmount)),
    amount_usd: w.amountUsd && fromUnits(toUnits(w.amountUsd)),
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
  ctx: AppContext,
  merchant: MerchantRow,
  p: { currency: string; amount: string; address: string; extraId?: string },
) {
  const { db, config } = ctx;
  const currency = p.currency.toLowerCase();
  const amount = toUnits(p.amount);
  if (amount <= 0n) throw new HttpError(400, 'invalid_amount', 'Le montant doit être positif');
  // Frais figés au moment de la demande : un changement de tarif n'affecte pas les retraits en attente.
  const { fee, net } = withdrawalFee(config, currency, amount);
  // Valeur en USD pour les limites (appel externe fait AVANT la transaction pour ne pas garder de verrou)
  const amountUsd = merchant.verificationLevel === 'business' ? null : await ctx.prices.usdValue(fromUnits(amount), currency);

  return db.transaction(async (tx) => {
    // Verrou sur le marchand : deux demandes simultanées ne peuvent pas dépenser le même solde.
    const [locked] = await tx.select().from(merchants).where(eq(merchants.id, merchant.id)).for('update');
    if (locked!.status !== 'active') throw new HttpError(403, 'account_suspended', 'Ton compte est suspendu.');
    await assertCanWithdraw(tx, config, locked!, amountUsd);
    const balance = await getBalance(tx, merchant.id, currency);
    if (balance < amount) {
      throw new HttpError(422, 'insufficient_balance', `Solde insuffisant (${fromUnits(balance)} ${currency})`);
    }
    const id = newId('wd');
    const [w] = await tx.insert(withdrawals).values({
      id, merchantId: merchant.id, currency, amount: fromUnits(amount), fee: fromUnits(fee), netAmount: fromUnits(net),
      amountUsd, address: p.address, extraId: p.extraId, status: 'requested',
    }).returning();
    // Le montant est retiré du solde dès la demande (bloqué), recrédité si l'équipe refuse.
    await tx.insert(ledgerEntries).values({
      merchantId: merchant.id, currency, amount: fromUnits(-amount), type: 'withdrawal', reference: id,
    });
    return presentWithdrawal(w!);
  });
}

export async function listWithdrawals(
  db: Db,
  filter: { merchantId?: string; status?: string; limit: number; offset: number },
) {
  const where = and(
    filter.merchantId ? eq(withdrawals.merchantId, filter.merchantId) : undefined,
    filter.status ? eq(withdrawals.status, filter.status) : undefined,
  );
  const [rows, [count]] = await Promise.all([
    db.select({ w: withdrawals, merchantName: merchants.name }).from(withdrawals)
      .innerJoin(merchants, eq(merchants.id, withdrawals.merchantId))
      .where(where).orderBy(desc(withdrawals.createdAt)).limit(filter.limit).offset(filter.offset),
    db.select({ total: sql<number>`count(*)::int` }).from(withdrawals).where(where),
  ]);
  return {
    withdrawals: rows.map((r) => presentWithdrawal(r.w, filter.merchantId ? undefined : r.merchantName)),
    total: count?.total ?? 0,
  };
}

export interface ProcessContext { ctx: AppContext; admin: AdminRow; ip: string; log: FastifyBaseLogger }

export async function completeWithdrawal(p: ProcessContext, id: string, txHash: string) {
  return processWithdrawal(p, id, 'withdrawal.complete', async (tx, w) => {
    const [updated] = await tx.update(withdrawals)
      .set({ status: 'completed', txHash, processedAt: new Date(), processedBy: p.admin.id })
      .where(eq(withdrawals.id, w.id)).returning();
    return updated!;
  });
}

export async function rejectWithdrawal(p: ProcessContext, id: string, reason: string) {
  return processWithdrawal(p, id, 'withdrawal.reject', async (tx, w) => {
    const [updated] = await tx.update(withdrawals)
      .set({ status: 'rejected', rejectReason: reason, processedAt: new Date(), processedBy: p.admin.id })
      .where(eq(withdrawals.id, w.id)).returning();
    await tx.insert(ledgerEntries).values({
      merchantId: w.merchantId, currency: w.currency, amount: w.amount, type: 'withdrawal_reversal', reference: w.id,
    });
    return updated!;
  });
}

async function processWithdrawal(
  p: ProcessContext,
  id: string,
  action: string,
  apply: (tx: Tx, w: Withdrawal) => Promise<Withdrawal>,
) {
  const { db, mailer, config } = p.ctx;
  const updated = await db.transaction(async (tx) => {
    const [w] = await tx.select().from(withdrawals).where(eq(withdrawals.id, id)).for('update');
    if (!w) throw new HttpError(404, 'not_found', 'Retrait introuvable');
    if (w.status !== 'requested') throw new HttpError(409, 'already_processed', `Retrait déjà traité (${w.status})`);
    const result = await apply(tx, w);
    await enqueueEvent(tx, w.merchantId, `withdrawal.${result.status}`, presentWithdrawal(result));
    await audit(tx, {
      adminId: p.admin.id, action, targetType: 'withdrawal', targetId: w.id, ip: p.ip,
      details: { merchant_id: w.merchantId, net_amount: result.netAmount, currency: w.currency, tx_hash: result.txHash, reason: result.rejectReason },
    });
    return result;
  });

  // E-mail au marchand (après validation de la transaction)
  const users = await db.select({ email: merchantUsers.email }).from(merchantUsers).where(eq(merchantUsers.merchantId, updated.merchantId));
  for (const u of users) {
    sendInBackground(mailer, p.log, mails.withdrawalProcessed(u.email, updated, `${config.APP_URL}/app/retraits`));
  }
  return presentWithdrawal(updated);
}
