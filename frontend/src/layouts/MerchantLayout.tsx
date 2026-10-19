import { Link, useLocation, useNavigate } from 'react-router';
import { useMerchant } from '../auth/session';
import { Alert, LevelBadge } from '../components/ui';
import { AppShell } from './AppShell';

export default function MerchantLayout() {
  const { me, logout } = useMerchant();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const m = me!.merchant;
  const unverified = m.verification_level === 'none';

  const banner = m.status === 'suspended'
    ? <Alert title="Compte suspendu">{m.suspended_reason ?? 'Contacte le support.'} Les paiements et retraits sont bloqués.</Alert>
    : unverified && pathname !== '/app/verification'
      ? <Alert tone="warning" title="Compte non vérifié">
          <span>Vérifie ton identité pour retirer tes fonds et augmenter tes limites. <Link to="/app/verification">Vérifier mon compte →</Link></span>
        </Alert>
      : null;

  return (
    <AppShell
      area="Espace marchand"
      nav={[
        { to: '/app', label: 'Tableau de bord', icon: 'home', end: true },
        { to: '/app/factures', label: 'Factures', icon: 'invoice' },
        { to: '/app/retraits', label: 'Retraits', icon: 'withdraw' },
        { to: '/app/verification', label: 'Vérification', icon: 'shield', badge: unverified ? 'dot' : undefined },
        { to: '/app/integration', label: 'Intégration API', icon: 'code' },
        { to: '/app/parametres', label: 'Paramètres', icon: 'settings' },
      ]}
      account={<div className="stack-sm"><span className="who" title={me!.user.email}>{m.name}</span><LevelBadge level={m.verification_level} /></div>}
      banner={banner}
      onLogout={async () => { await logout(); navigate('/connexion'); }}
    />
  );
}
