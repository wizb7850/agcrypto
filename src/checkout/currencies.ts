// Libellés affichés sur la page de paiement. Le réseau est essentiel : envoyer de l'USDT
// sur le mauvais réseau = fonds perdus.
const LABELS: Record<string, { name: string; network: string }> = {
  usdttrc20: { name: 'USDT', network: 'Tron (TRC-20)' },
  usdterc20: { name: 'USDT', network: 'Ethereum (ERC-20)' },
  usdtbsc: { name: 'USDT', network: 'BNB Chain (BEP-20)' },
  usdtmatic: { name: 'USDT', network: 'Polygon' },
  usdtsol: { name: 'USDT', network: 'Solana' },
  usdcerc20: { name: 'USDC', network: 'Ethereum (ERC-20)' },
  btc: { name: 'Bitcoin', network: 'Bitcoin' },
  eth: { name: 'Ethereum', network: 'Ethereum' },
  ltc: { name: 'Litecoin', network: 'Litecoin' },
  trx: { name: 'TRON', network: 'Tron' },
  bnbbsc: { name: 'BNB', network: 'BNB Chain' },
  sol: { name: 'Solana', network: 'Solana' },
  ton: { name: 'Toncoin', network: 'TON' },
};

export const currencyInfo = (code: string) => ({
  code,
  ...(LABELS[code] ?? { name: code.toUpperCase(), network: code.toUpperCase() }),
});
