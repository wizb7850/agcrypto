import { randomBytes } from 'node:crypto';
import type { NowPaymentsApi } from './nowpayments.js';

// Faux fournisseur pour tester en local sans compte NOWPayments : aucune vraie adresse, aucun vrai argent.
const PREFIX: Record<string, string> = { btc: 'bc1qdemo', eth: '0xdemo', usdterc20: '0xdemo', usdtbsc: '0xdemo', bnbbsc: '0xdemo' };

/** Cours fictifs utilisés en mode démo (USD pour 1 unité). */
export const DEMO_PRICES_USD: Record<string, string> = {
  btc: '60000', eth: '3000', ltc: '80', trx: '0.12', bnbbsc: '550', sol: '150', ton: '5',
};

export function createDemoProvider(): NowPaymentsApi {
  let next = 1_000_000;
  return {
    async createPayment(input) {
      const address = (PREFIX[input.payCurrency] ?? 'TDemo') + randomBytes(14).toString('hex');
      return {
        id: String(next++),
        status: 'waiting',
        payAddress: address,
        payAmount: input.priceAmount, // démo : 1 unité de prix = 1 unité de crypto
        payCurrency: input.payCurrency,
        payExtraId: null,
        expiresAt: new Date(Date.now() + 60 * 60_000),
      };
    },
    async estimate(amount, from, to) {
      const price = DEMO_PRICES_USD[to];
      if (from !== 'usd' || !price) throw new Error(`Cours démo inconnu : ${to}`);
      // amount USD / prix = quantité de crypto
      return (Number(amount) / Number(price)).toFixed(12);
    },
  };
}

