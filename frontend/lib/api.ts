// Client HTTP vers le backend (via le proxy /api de Next.js).
// La clé est gardée en sessionStorage : elle disparaît à la fermeture de l'onglet.

export type Role = 'merchant' | 'admin';
const STORAGE_KEY: Record<Role, string> = { merchant: 'agc.merchantKey', admin: 'agc.adminToken' };

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const session = {
  get(role: Role): string | null {
    try { return sessionStorage.getItem(STORAGE_KEY[role]); } catch { return null; }
  },
  set(role: Role, value: string) {
    try { sessionStorage.setItem(STORAGE_KEY[role], value); } catch { /* navigation privée */ }
  },
  clear(role: Role) {
    try { sessionStorage.removeItem(STORAGE_KEY[role]); } catch { /* navigation privée */ }
  },
};

export async function api<T>(role: Role, path: string, init: { method?: string; body?: unknown; token?: string } = {}): Promise<T> {
  const token = init.token ?? session.get(role);
  const res = await fetch(`/api${path}`, {
    method: init.method ?? 'GET',
    headers: {
      ...(token && { authorization: `Bearer ${token}` }),
      ...(init.body !== undefined && { 'content-type': 'application/json' }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = res.status === 401 ? 'Accès refusé : identifiant invalide ou expiré'
      : res.status >= 500 && !data.message ? 'Le serveur ne répond pas. Le backend est-il lancé ?'
      : data.message ?? `Erreur ${res.status}`;
    throw new ApiError(res.status, message);
  }
  return data as T;
}

// ---- Types renvoyés par le backend ----
export interface Balance { currency: string; available: string }
export interface Invoice {
  id: string; order_id: string; status: string; amount: string; currency: string;
  description: string | null; checkout_url: string; created_at: string;
}
export interface Withdrawal {
  id: string; merchant_id: string; merchant_name?: string; status: string; currency: string;
  amount: string; fee: string; net_amount: string; address: string; extra_id: string | null;
  tx_hash: string | null; reject_reason: string | null; created_at: string; processed_at: string | null;
}
export interface Quote { currency: string; amount: string; fee: string; net_amount: string }
export interface Revenue { currency: string; payment_fees: string; withdrawal_fees: string; total: string }
