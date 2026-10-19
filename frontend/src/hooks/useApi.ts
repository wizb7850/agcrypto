import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';

/** Charge une ressource de l'API et expose { data, error, loading, reload }. path = null : rien à charger. */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<ApiError | undefined>();
  const [loading, setLoading] = useState(path !== null);
  const requestId = useRef(0);

  const reload = useCallback(async () => {
    if (path === null) return;
    const id = ++requestId.current;
    setLoading(true);
    try {
      const result = await api<T>(path);
      if (id === requestId.current) { setData(result); setError(undefined); }
    } catch (e) {
      if (id === requestId.current) setError(e instanceof ApiError ? e : new ApiError(0, 'error', String(e)));
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [path]);

  useEffect(() => { void reload(); }, [reload]);
  return { data, error, loading, reload };
}

/** Exécute une action (formulaire, bouton) avec état de chargement et message d'erreur. */
export function useAction<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async (...args: A): Promise<R | undefined> => {
    setPending(true);
    setError(null);
    try {
      return await fn(...args);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return undefined;
    } finally {
      setPending(false);
    }
  }, [fn]);
  return { run, pending, error, setError };
}
