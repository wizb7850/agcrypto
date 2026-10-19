import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useAdmin, useCan } from '../auth/session';
import { useApi } from '../hooks/useApi';
import { ROLE } from '../lib/format';
import { AppShell, type NavItem } from './AppShell';

export interface Overview {
  merchants: { total: number; verified: number; business: number; suspended: number };
  pending_kyc: number;
  pending_withdrawals: number;
  paid_30d: { volume_usd: string; count: number };
}

export default function AdminLayout() {
  const { me, logout } = useAdmin();
  const can = useCan();
  const navigate = useNavigate();
  const overview = useApi<Overview>('/admin/overview');
  // Compteurs de la barre latérale rafraîchis chaque minute
  useEffect(() => {
    const t = setInterval(() => void overview.reload(), 60_000);
    return () => clearInterval(t);
  }, [overview.reload]);

  const nav: (NavItem & { permission: string })[] = [
    { to: '/admin', label: 'Vue d\'ensemble', icon: 'home', end: true, permission: 'overview:read' },
    { to: '/admin/marchands', label: 'Marchands', icon: 'store', permission: 'merchants:read' },
    { to: '/admin/verifications', label: 'Vérifications', icon: 'shield', permission: 'kyc:read', badge: overview.data?.pending_kyc },
    { to: '/admin/retraits', label: 'Retraits', icon: 'withdraw', permission: 'withdrawals:read', badge: overview.data?.pending_withdrawals },
    { to: '/admin/journal', label: 'Journal d\'audit', icon: 'list', permission: 'audit:read' },
    { to: '/admin/equipe', label: 'Équipe', icon: 'users', permission: 'team:manage' },
  ];

  return (
    <AppShell
      area="Back-office"
      nav={nav.filter((n) => can(n.permission))}
      account={<div className="stack-sm"><span className="who" title={me!.email}>{me!.email}</span><span className="badge badge-brand">{ROLE[me!.role] ?? me!.role}</span></div>}
      onLogout={async () => { await logout(); navigate('/admin/connexion'); }}
    />
  );
}
