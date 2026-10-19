import { and, eq, gt, gte, inArray, or, sql, type SQL } from 'drizzle-orm';
import type { Config } from '../../config.js';
import type { Tx } from '../../context.js';
import type { Db } from '../../db/client.js';
import { invoices, withdrawals } from '../../db/schema.js';
import { HttpError } from '../../lib/errors.js';
import { fromUnits, mulDecimal, toUnits } from '../../lib/money.js';
import type { MerchantRow } from '../../plugins/guards.js';

/**
 * Limites par niveau de vérification (montants en équivalent USD) :
 *
 *   Niveau       | Encaisser                         | Retirer
 *   -------------|-----------------------------------|--------------------------------
 *   none         | LIMIT_UNVERIFIED_RECEIVE_USD cumulé| interdit (vérification requise)
 *   personal     | LIMIT_PERSONAL_RECEIVE_USD_30D     | LIMIT_PERSONAL_WITHDRAW_USD_24H
 *   business     | illimité                           | illimité
 */
export type LimitsConfig = Pick<Config,
  'LIMIT_UNVERIFIED_RECEIVE_USD' | 'LIMIT_PERSONAL_RECEIVE_USD_30D' | 'LIMIT_PERSONAL_WITHDRAW_USD_24H' | 'FX_RATES_USD'>;

type Level = 'none' | 'personal' | 'business';
const DAY = 24 * 3600_000;

interface Window { limitUsd: bigint | null; since: Date | null; period: 'total' | '30d' | '24h' | null }

function receiveWindow(cfg: LimitsConfig, level: Level): Window {
  if (level === 'business') return { limitUsd: null, since: null, period: null };
  if (level === 'personal') {
    return { limitUsd: toUnits(cfg.LIMIT_PERSONAL_RECEIVE_USD_30D), since: new Date(Date.now() - 30 * DAY), period: '30d' };
  }
  return { limitUsd: toUnits(cfg.LIMIT_UNVERIFIED_RECEIVE_USD), since: null, period: 'total' };
}

function withdrawWindow(cfg: LimitsConfig, level: Level): Window & { allowed: boolean } {
  if (level === 'business') return { allowed: true, limitUsd: null, since: null, period: null };
  if (level === 'personal') {
    return { allowed: true, limitUsd: toUnits(cfg.LIMIT_PERSONAL_WITHDRAW_USD_24H), since: new Date(Date.now() - DAY), period: '24h' };
  }
  return { allowed: false, limitUsd: 0n, since: null, period: null };
}

/** Monnaies acceptées pour facturer (celles dont on connaît le taux en USD). */
export const supportedPriceCurrencies = (cfg: LimitsConfig) => Object.keys(cfg.FX_RATES_USD);

/** Convertit le montant d'une facture en USD avec la table de taux configurée. */
export function invoiceUsd(cfg: LimitsConfig, amount: string, currency: string): string {
  const rate = cfg.FX_RATES_USD[currency.toLowerCase()];
  if (!rate) {
    throw new HttpError(400, 'unsupported_currency',
      `Devise non prise en charge : ${currency.toUpperCase()} (acceptées : ${supportedPriceCurrencies(cfg).join(', ').toUpperCase()})`);
  }
  return mulDecimal(amount, rate);
}

// Une facture "consomme" la limite dès qu'elle peut encore être payée ou qu'elle l'a été.
async function receivedUsd(db: Db | Tx, merchantId: string, since: Date | null): Promise<bigint> {
  const conds: (SQL | undefined)[] = [
    eq(invoices.merchantId, merchantId),
    or(
      inArray(invoices.status, ['paid', 'confirming', 'partially_paid']),
      and(eq(invoices.status, 'pending'), gt(invoices.expiresAt, new Date())),
    ),
    since ? gte(invoices.createdAt, since) : undefined,
  ];
  const [row] = await db.select({ total: sql<string>`coalesce(sum(${invoices.amountUsd}), 0)::text` })
    .from(invoices).where(and(...conds));
  return toUnits(row?.total ?? '0');
}

async function withdrawnUsd(db: Db | Tx, merchantId: string, since: Date | null): Promise<bigint> {
  const conds: (SQL | undefined)[] = [
    eq(withdrawals.merchantId, merchantId),
    inArray(withdrawals.status, ['requested', 'completed']),
    since ? gte(withdrawals.createdAt, since) : undefined,
  ];
  const [row] = await db.select({ total: sql<string>`coalesce(sum(${withdrawals.amountUsd}), 0)::text` })
    .from(withdrawals).where(and(...conds));
  return toUnits(row?.total ?? '0');
}

const usd = (units: bigint | null) => (units === null ? null : fromUnits(units));
const remaining = (limit: bigint | null, used: bigint) => (limit === null ? null : fromUnits(limit > used ? limit - used : 0n));

/** Vue complète affichée au marchand (tableau de bord, page vérification). */
export async function getLimits(db: Db, cfg: LimitsConfig, merchant: MerchantRow) {
  const level = merchant.verificationLevel as Level;
  const r = receiveWindow(cfg, level);
  const w = withdrawWindow(cfg, level);
  const [received, withdrawn] = await Promise.all([
    receivedUsd(db, merchant.id, r.since),
    withdrawnUsd(db, merchant.id, w.since),
  ]);
  return {
    level,
    receive: { limit_usd: usd(r.limitUsd), used_usd: fromUnits(received), remaining_usd: remaining(r.limitUsd, received), period: r.period },
    withdraw: {
      allowed: w.allowed,
      limit_usd: w.allowed ? usd(w.limitUsd) : '0',
      used_usd: fromUnits(withdrawn),
      remaining_usd: w.allowed ? remaining(w.limitUsd, withdrawn) : '0',
      period: w.period,
    },
  };
}

/** À appeler dans la transaction de création de facture (marchand verrouillé). */
export async function assertCanReceive(tx: Tx, cfg: LimitsConfig, merchant: MerchantRow, amountUsd: string) {
  const level = merchant.verificationLevel as Level;
  const r = receiveWindow(cfg, level);
  if (r.limitUsd === null) return;
  const used = await receivedUsd(tx, merchant.id, r.since);
  if (used + toUnits(amountUsd) > r.limitUsd) {
    const left = fromUnits(r.limitUsd > used ? r.limitUsd - used : 0n);
    throw new HttpError(403, 'receive_limit_exceeded', level === 'none'
      ? `Limite des comptes non vérifiés atteinte (reste ${left} USD). Vérifie ton compte pour continuer.`
      : `Limite mensuelle du compte personnel atteinte (reste ${left} USD). Passe en compte professionnel pour lever la limite.`);
  }
}

/** À appeler dans la transaction de demande de retrait (marchand verrouillé). */
export async function assertCanWithdraw(tx: Tx, cfg: LimitsConfig, merchant: MerchantRow, amountUsd: string | null) {
  const level = merchant.verificationLevel as Level;
  const w = withdrawWindow(cfg, level);
  if (!w.allowed) {
    throw new HttpError(403, 'verification_required', 'Vérifie ton identité pour pouvoir retirer tes fonds.');
  }
  if (w.limitUsd === null) return;
  if (amountUsd === null) {
    throw new HttpError(503, 'price_unavailable', 'Cours indisponible pour évaluer ce retrait. Réessaie dans quelques minutes.');
  }
  const used = await withdrawnUsd(tx, merchant.id, w.since);
  if (used + toUnits(amountUsd) > w.limitUsd) {
    const left = fromUnits(w.limitUsd > used ? w.limitUsd - used : 0n);
    throw new HttpError(403, 'withdraw_limit_exceeded',
      `Limite de retrait sur 24 h atteinte (reste ${left} USD). Passe en compte professionnel pour lever la limite.`);
  }
}
