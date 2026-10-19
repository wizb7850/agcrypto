import { mulDecimal } from '../lib/money.js';
import type { NowPaymentsApi } from './nowpayments.js';

/** Évalue un montant crypto en USD (pour les limites de retrait des comptes non professionnels). */
export interface PriceService {
  /** Renvoie la valeur en USD, ou null si le cours est indisponible. */
  usdValue(amount: string, currency: string): Promise<string | null>;
}

// Stablecoins indexés sur le dollar : 1 unité = 1 USD, quel que soit le réseau (usdttrc20, usdcerc20…)
const STABLECOIN = /^(usdt|usdc|dai|busd|tusd|fdusd|usdp)/;
const REFERENCE_USD = '1000';

export function createPriceService(provider: Pick<NowPaymentsApi, 'estimate'>, cacheMs = 5 * 60_000): PriceService {
  const cache = new Map<string, { price: string; at: number }>();

  async function priceOf(currency: string): Promise<string | null> {
    if (STABLECOIN.test(currency)) return '1';
    const hit = cache.get(currency);
    if (hit && Date.now() - hit.at < cacheMs) return hit.price;
    try {
      // Combien de crypto pour 1000 USD ? → prix d'une unité = 1000 / quantité
      const qty = Number(await provider.estimate(REFERENCE_USD, 'usd', currency));
      if (!(qty > 0)) return null;
      const price = (Number(REFERENCE_USD) / qty).toFixed(8);
      cache.set(currency, { price, at: Date.now() });
      return price;
    } catch {
      return null;
    }
  }

  return {
    async usdValue(amount, currency) {
      const price = await priceOf(currency.toLowerCase());
      return price === null ? null : mulDecimal(amount, price);
    },
  };
}
