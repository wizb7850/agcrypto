import { randomBytes } from 'node:crypto';
import type { NowPaymentsApi } from './nowpayments.js';

// Faux fournisseur pour tester en local sans compte NOWPayments : aucune vraie adresse, aucun vrai argent.
const PREFIX: Record<string, string> = { btc: 'bc1qdemo', eth: '0xdemo', usdterc20: '0xdemo', usdtbsc: '0xdemo', bnbbsc: '0xdemo' };

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
  };
}
