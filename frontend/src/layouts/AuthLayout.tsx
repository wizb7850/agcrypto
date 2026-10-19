import type { ReactNode } from 'react';
import { usePublicInfo } from '../auth/session';
import { formatAmount } from '../lib/format';

/** Pages de connexion / inscription : présentation à gauche, formulaire à droite. */
export function AuthLayout({ children, admin }: { children: ReactNode; admin?: boolean }) {
  const info = usePublicInfo();
  return (
    <div className="auth">
      <aside className="auth-aside">
        <div className="sidebar-brand" style={{ padding: 0 }}>
          <span className="logo">ag</span>
          <div>agcrypto{admin && <><br /><small>Back-office</small></>}</div>
        </div>
        <div>
          <h2>{admin ? 'Espace équipe' : 'Acceptez les paiements crypto, simplement.'}</h2>
          {!admin && (
            <ul>
              <li>Page de paiement à votre marque : USDT, Bitcoin, Ethereum…</li>
              <li>{info ? `${formatAmount(info.fees.payment_percent)} %` : 'Faibles frais'} par paiement, sans abonnement</li>
              <li>Fonds crédités sur votre solde, retraits vers votre portefeuille</li>
              <li>API et webhooks pour votre site</li>
            </ul>
          )}
        </div>
        <p className="small" style={{ color: '#94a3b8' }}>© {new Date().getFullYear()} agcrypto</p>
      </aside>
      <main className="auth-main">
        <div className="auth-card">{children}</div>
      </main>
    </div>
  );
}
