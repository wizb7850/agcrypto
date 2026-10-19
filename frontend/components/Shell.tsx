'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

export function Shell({ area, subtitle, onLogout, children }: {
  area: string; subtitle?: string; onLogout: () => void; children: ReactNode;
}) {
  return (
    <>
      <nav className="topbar">
        <Link href="/" className="brand">agcrypto</Link>
        <span className="area">{area}</span>
        <span className="spacer" />
        {subtitle && <span className="muted small">{subtitle}</span>}
        <button className="btn btn-ghost" onClick={onLogout}>Déconnexion</button>
      </nav>
      <main className="container">{children}</main>
    </>
  );
}
