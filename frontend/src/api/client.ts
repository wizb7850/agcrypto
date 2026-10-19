// Client HTTP vers le backend. Toutes les requêtes passent par /api (proxy Vite en dev, reverse proxy en prod),
// avec le cookie de session et l'en-tête anti-CSRF attendu par l'API.

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export type Area = 'merchant' | 'admin';

/** Prévient l'application qu'une session a expiré (le garde de route redirige vers la connexion). */
const notifyUnauthorized = (area: Area) => window.dispatchEvent(new CustomEvent('agc:unauthorized', { detail: area }));

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: opts.method ?? (opts.body !== undefined || opts.form ? 'POST' : 'GET'),
      credentials: 'same-origin',
      headers: {
        'x-agcrypto-csrf': '1',
        ...(opts.body !== undefined && { 'content-type': 'application/json' }),
      },
      body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
    });
  } catch {
    throw new ApiError(0, 'network', 'Impossible de joindre le serveur. Vérifie ta connexion.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/')) notifyUnauthorized(path.startsWith('/admin') ? 'admin' : 'merchant');
    const message = data.message
      ?? (res.status >= 500 ? 'Le serveur ne répond pas correctement. Réessaie dans un instant.' : `Erreur ${res.status}`);
    throw new ApiError(res.status, data.error ?? 'error', message);
  }
  return data as T;
}

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));
