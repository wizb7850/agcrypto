export const formatDate = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

// Codes NOWPayments → libellés lisibles (le réseau compte : USDT TRC-20 ≠ USDT ERC-20)
const CURRENCIES: Record<string, string> = {
  usdttrc20: 'USDT · Tron', usdterc20: 'USDT · Ethereum', usdtbsc: 'USDT · BNB Chain',
  usdtmatic: 'USDT · Polygon', usdcerc20: 'USDC · Ethereum', btc: 'BTC', eth: 'ETH',
  ltc: 'LTC', trx: 'TRX', bnbbsc: 'BNB', sol: 'SOL', ton: 'TON',
};
export const currencyLabel = (code: string) => CURRENCIES[code.toLowerCase()] ?? code.toUpperCase();

export const STATUS: Record<string, { label: string; tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger' }> = {
  pending: { label: 'En attente', tone: 'neutral' },
  confirming: { label: 'Confirmation', tone: 'info' },
  partially_paid: { label: 'Partiel', tone: 'warning' },
  paid: { label: 'Payée', tone: 'success' },
  failed: { label: 'Échouée', tone: 'danger' },
  expired: { label: 'Expirée', tone: 'neutral' },
  refunded: { label: 'Remboursée', tone: 'warning' },
  requested: { label: 'À traiter', tone: 'warning' },
  completed: { label: 'Envoyé', tone: 'success' },
  rejected: { label: 'Refusé', tone: 'danger' },
};
