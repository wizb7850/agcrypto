import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { api, type Area } from '../api/client';
import type { AdminMe, MerchantMe, PublicInfo } from '../api/types';
import { Loading } from '../components/ui';

// Sessions marchand et équipe : chargées une fois au démarrage, rechargées après connexion/déconnexion.
// Le cookie de session est HttpOnly : le frontend ne le voit jamais, il interroge /auth/.../me.

interface Session<T> { me: T | null; loading: boolean; reload: () => Promise<void>; logout: () => Promise<void> }

function useSessionState<T>(area: Area): Session<T> {
  const [me, setMe] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    try {
      setMe(await api<T>(`/auth/${area}/me`));
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, [area]);
  const logout = useCallback(async () => {
    await api(`/auth/${area}/logout`, { method: 'POST' }).catch(() => undefined);
    setMe(null);
  }, [area]);

  useEffect(() => { void reload(); }, [reload]);
  // Une requête renvoie 401 (session expirée) : on considère l'utilisateur déconnecté
  useEffect(() => {
    const onUnauthorized = (e: Event) => { if ((e as CustomEvent).detail === area) setMe(null); };
    window.addEventListener('agc:unauthorized', onUnauthorized);
    return () => window.removeEventListener('agc:unauthorized', onUnauthorized);
  }, [area]);
  return { me, loading, reload, logout };
}

const MerchantContext = createContext<Session<MerchantMe> | null>(null);
const AdminContext = createContext<Session<AdminMe> | null>(null);
const InfoContext = createContext<PublicInfo | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const merchant = useSessionState<MerchantMe>('merchant');
  const admin = useSessionState<AdminMe>('admin');
  const [info, setInfo] = useState<PublicInfo | null>(null);
  useEffect(() => { api<PublicInfo>('/public/info').then(setInfo).catch(() => undefined); }, []);
  return (
    <InfoContext.Provider value={info}>
      <MerchantContext.Provider value={merchant}>
        <AdminContext.Provider value={admin}>{children}</AdminContext.Provider>
      </MerchantContext.Provider>
    </InfoContext.Provider>
  );
}

export const useMerchant = () => useContext(MerchantContext)!;
export const useAdmin = () => useContext(AdminContext)!;
/** Tarifs, limites et devises (peut être null pendant le chargement). */
export const usePublicInfo = () => useContext(InfoContext);

/** Protège l'espace marchand : connexion et e-mail vérifié requis. */
export function RequireMerchant() {
  const { me, loading } = useMerchant();
  const location = useLocation();
  if (loading) return <Loading full />;
  if (!me) return <Navigate to="/connexion" replace state={{ from: location.pathname }} />;
  if (!me.user.email_verified) return <Navigate to="/verifier-email" replace />;
  return <Outlet />;
}

/** Protège le back-office. */
export function RequireAdmin() {
  const { me, loading } = useAdmin();
  const location = useLocation();
  if (loading) return <Loading full />;
  if (!me) return <Navigate to="/admin/connexion" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}

export const useCan = () => {
  const { me } = useAdmin();
  return (permission: string) => me?.permissions.includes(permission) ?? false;
};
