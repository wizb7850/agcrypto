import Link from 'next/link';

export default function Home() {
  return (
    <main className="center">
      <div className="home">
        <h1 className="brand-lg">agcrypto</h1>
        <p className="muted">Passerelle de paiement crypto</p>
        <div className="home-links">
          <Link href="/marchand" className="card home-link">
            <strong>Espace marchand</strong>
            <span className="muted small">Soldes, factures, retraits</span>
          </Link>
          <Link href="/admin" className="card home-link">
            <strong>Back-office</strong>
            <span className="muted small">Validation des retraits, revenus</span>
          </Link>
        </div>
      </div>
    </main>
  );
}
