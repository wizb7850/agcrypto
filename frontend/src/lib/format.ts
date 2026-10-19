import type { AccountType, Level } from '../api/types';

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export const formatDay = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

/** Montant décimal (chaîne exacte de l'API) avec séparateurs de milliers, sans passer par un float. */
export function formatAmount(value: string | number | null | undefined, maxDecimals = 8) {
  if (value === null || value === undefined || value === '') return '—';
  const [int = '0', frac = ''] = String(value).split('.');
  const negative = int.startsWith('-');
  const grouped = int.replace('-', '').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const decimals = frac.slice(0, maxDecimals).replace(/0+$/, '');
  return `${negative ? '-' : ''}${grouped}${decimals ? `,${decimals}` : ''}`;
}

export const formatUsd = (value: string | number | null | undefined) =>
  value === null || value === undefined ? '—' : `${formatAmount(value, 2)} $`;

// Codes NOWPayments → libellés (le réseau compte : USDT TRC-20 ≠ USDT ERC-20)
const CRYPTO: Record<string, { name: string; network?: string }> = {
  usdttrc20: { name: 'USDT', network: 'Tron' }, usdterc20: { name: 'USDT', network: 'Ethereum' },
  usdtbsc: { name: 'USDT', network: 'BNB Chain' }, usdtmatic: { name: 'USDT', network: 'Polygon' },
  usdtsol: { name: 'USDT', network: 'Solana' }, usdcerc20: { name: 'USDC', network: 'Ethereum' },
  btc: { name: 'BTC' }, eth: { name: 'ETH' }, ltc: { name: 'LTC' }, trx: { name: 'TRX' },
  bnbbsc: { name: 'BNB', network: 'BNB Chain' }, sol: { name: 'SOL' }, ton: { name: 'TON' },
};
export const cryptoName = (code: string) => CRYPTO[code.toLowerCase()]?.name ?? code.toUpperCase();
export const cryptoLabel = (code: string) => {
  const c = CRYPTO[code.toLowerCase()];
  return c ? (c.network ? `${c.name} · ${c.network}` : c.name) : code.toUpperCase();
};

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'brand';
export const STATUS: Record<string, { label: string; tone: Tone }> = {
  // Factures
  pending: { label: 'En attente', tone: 'neutral' },
  confirming: { label: 'Confirmation', tone: 'info' },
  partially_paid: { label: 'Paiement partiel', tone: 'warning' },
  paid: { label: 'Payée', tone: 'success' },
  failed: { label: 'Échouée', tone: 'danger' },
  expired: { label: 'Expirée', tone: 'neutral' },
  refunded: { label: 'Remboursée', tone: 'warning' },
  // Retraits
  requested: { label: 'En traitement', tone: 'warning' },
  completed: { label: 'Envoyé', tone: 'success' },
  rejected: { label: 'Refusé', tone: 'danger' },
  // Vérifications et comptes
  approved: { label: 'Validé', tone: 'success' },
  active: { label: 'Actif', tone: 'success' },
  suspended: { label: 'Suspendu', tone: 'danger' },
};

export const LEVEL: Record<Level, { label: string; tone: Tone }> = {
  none: { label: 'Non vérifié', tone: 'warning' },
  personal: { label: 'Personnel vérifié', tone: 'success' },
  business: { label: 'Professionnel vérifié', tone: 'brand' },
};

export const ACCOUNT_TYPE: Record<AccountType, string> = { personal: 'Particulier', business: 'Entreprise' };

export const ROLE: Record<string, string> = {
  owner: 'Propriétaire', compliance: 'Conformité', finance: 'Finance', support: 'Support',
};
