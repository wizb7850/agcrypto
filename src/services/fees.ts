import { percentOf, toUnits } from '../lib/money.js';
import { HttpError } from './errors.js';

export interface FeeConfig {
  WITHDRAWAL_FEE_PERCENT: number;
  WITHDRAWAL_FIXED_FEES: Record<string, string>;
}

/** Frais de retrait = pourcentage + frais fixe de la devise. Le marchand reçoit le net. */
export function withdrawalFee(cfg: FeeConfig, currency: string, amount: bigint) {
  const fixed = toUnits(cfg.WITHDRAWAL_FIXED_FEES[currency] ?? '0');
  const fee = percentOf(amount, cfg.WITHDRAWAL_FEE_PERCENT) + fixed;
  const net = amount - fee;
  if (net <= 0n) throw new HttpError(422, 'amount_too_small', 'Montant trop faible pour couvrir les frais de retrait');
  return { fee, net };
}
