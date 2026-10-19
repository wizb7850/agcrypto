import { useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { Icon } from '../components/icons';
import { Button } from '../components/ui';

export interface NavItem { to: string; label: string; icon: string; end?: boolean; badge?: number | 'dot' }

/** Mise en page commune (espace marchand et back-office) : barre latérale + contenu. */
export function AppShell({ area, nav, account, banner, onLogout }: {
  area: string; nav: NavItem[]; account: ReactNode; banner?: ReactNode; onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  // Ferme le menu mobile à chaque changement de page
  const [lastPath, setLastPath] = useState(location.pathname);
  if (lastPath !== location.pathname) { setLastPath(location.pathname); setOpen(false); }

  return (
    <div className="shell">
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <span className="logo">ag</span>
          <div>agcrypto<br /><small>{area}</small></div>
        </div>
        <nav className="nav">
          {nav.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end}>
              <Icon name={item.icon} />
              {item.label}
              {item.badge === 'dot' && <span className="dot" title="Action requise" />}
              {typeof item.badge === 'number' && item.badge > 0 && <span className="count">{item.badge}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          {account}
          <Button variant="ghost" size="sm" onClick={onLogout}><Icon name="logout" size={16} /> Déconnexion</Button>
        </div>
      </aside>
      {open && <div className="backdrop" onClick={() => setOpen(false)} />}
      <div className="main">
        <div className="topbar-mobile">
          <button type="button" className="icon-btn" aria-label="Menu" onClick={() => setOpen(true)}><Icon name="menu" size={22} /></button>
          agcrypto <span className="muted small">{area}</span>
        </div>
        <main className="content">
          {banner}
          <Outlet />
        </main>
      </div>
    </div>
  );
}
