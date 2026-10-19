'use client';

import { useCallback, useEffect, useState } from 'react';
import { LoginForm } from '@/components/LoginForm';
import { Shell } from '@/components/Shell';
import { Alert, Badge, Card, Copy, Empty } from '@/components/ui';
import { api, session, type Revenue, type Withdrawal } from '@/lib/api';
import { currencyLabel, formatDate } from '@/lib/format';

const TABS = [
  { status: 'requested', label: 'À traiter' },
  { status: 'completed', label: 'Envoyés' },
  { status: 'rejected', label: 'Refusés' },
] as const;

export default function AdminPage() {
  const [logged, setLogged] = useState<boolean | null>(null);
  useEffect(() => setLogged(!!session.get('admin')), []);

  if (logged === null) return null;
  if (!logged) {
    return (
      <LoginForm
        role="admin"
        title="Back-office"
        label="Jeton administrateur"
        hint="Valeur de ADMIN_TOKEN dans le fichier .env du backend."
        checkPath="/admin/revenue"
        onLogin={() => setLogged(true)}
      />
    );
  }
  return <BackOffice onLogout={() => { session.clear('admin'); setLogged(false); }} />;
}

function BackOffice({ onLogout }: { onLogout: () => void }) {
  const [tab, setTab] = useState<(typeof TABS)[number]['status']>('requested');
  const [rows, setRows] = useState<Withdrawal[]>([]);
  const [revenue, setRevenue] = useState<Revenue[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [w, r] = await Promise.all([
        api<{ withdrawals: Withdrawal[] }>('admin', `/admin/withdrawals?status=${tab}`),
        api<{ revenue: Revenue[] }>('admin', '/admin/revenue'),
      ]);
      setRows(w.withdrawals);
      setRevenue(r.revenue);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [tab]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 20_000);
    return () => clearInterval(t);
  }, [refresh]);

  return (
    <Shell area="Back-office" onLogout={onLogout}>
      {error && <Alert>{error}</Alert>}

      <h2 className="section-title">Revenus</h2>
      <div className="stats">
        {revenue.length === 0 && <div className="stat"><span className="muted small">Total</span><strong>0</strong></div>}
        {revenue.map((r) => (
          <div className="stat" key={r.currency}>
            <span className="muted small">{currencyLabel(r.currency)}</span>
            <strong>{r.total}</strong>
            <span className="muted small">paiements {r.payment_fees} · retraits {r.withdrawal_fees}</span>
          </div>
        ))}
      </div>

      <Card
        title="Retraits"
        action={
          <div className="tabs" role="tablist">
            {TABS.map((t) => (
              <button key={t.status} role="tab" aria-selected={tab === t.status}
                className={tab === t.status ? 'tab active' : 'tab'} onClick={() => setTab(t.status)}>
                {t.label}
              </button>
            ))}
          </div>
        }
      >
        {rows.length === 0 ? <Empty>Aucun retrait dans cette catégorie.</Empty> : (
          <div className="list">
            {rows.map((w) => <WithdrawalRow key={w.id} w={w} onDone={refresh} />)}
          </div>
        )}
      </Card>
    </Shell>
  );
}

function WithdrawalRow({ w, onDone }: { w: Withdrawal; onDone: () => void }) {
  const [mode, setMode] = useState<'idle' | 'complete' | 'reject'>('idle');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api('admin', `/admin/withdrawals/${w.id}/${mode}`, {
        method: 'POST',
        body: mode === 'complete' ? { tx_hash: value.trim() } : { reason: value.trim() },
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <article className="item">
      <div className="item-main">
        <div>
          <strong>{w.merchant_name}</strong>
          <div className="muted small">{formatDate(w.created_at)} · {w.id}</div>
        </div>
        <Badge status={w.status} />
      </div>

      <dl className="facts">
        <div><dt>Demandé</dt><dd>{w.amount} {currencyLabel(w.currency)}</dd></div>
        <div><dt>Frais retenus</dt><dd>{w.fee}</dd></div>
        <div className="highlight"><dt>À envoyer</dt><dd>{w.net_amount} {currencyLabel(w.currency)}</dd></div>
        <div className="wide"><dt>Adresse</dt><dd><Copy value={w.address} /></dd></div>
        {w.extra_id && <div><dt>Memo / Tag</dt><dd><Copy value={w.extra_id} /></dd></div>}
        {w.tx_hash && <div className="wide"><dt>Transaction</dt><dd><Copy value={w.tx_hash} /></dd></div>}
        {w.reject_reason && <div className="wide"><dt>Motif du refus</dt><dd>{w.reject_reason}</dd></div>}
      </dl>

      {w.status === 'requested' && mode === 'idle' && (
        <div className="actions">
          <button className="btn btn-primary" onClick={() => { setMode('complete'); setValue(''); }}>J&apos;ai envoyé les fonds</button>
          <button className="btn btn-danger-ghost" onClick={() => { setMode('reject'); setValue(''); }}>Refuser</button>
        </div>
      )}

      {mode !== 'idle' && (
        <form className="form inline-form" onSubmit={submit}>
          <label>
            {mode === 'complete' ? 'Hash de la transaction envoyée' : 'Motif du refus (visible par le marchand)'}
            <input autoFocus required minLength={mode === 'complete' ? 10 : 1} value={value}
              onChange={(e) => setValue(e.target.value)} spellCheck={mode === 'reject'} />
          </label>
          {mode === 'complete' && (
            <p className="muted small">Vérifie avant de valider : {w.net_amount} {currencyLabel(w.currency)} vers {w.address}.</p>
          )}
          {mode === 'reject' && <p className="muted small">Le montant de {w.amount} sera recrédité sur le solde du marchand.</p>}
          {error && <Alert>{error}</Alert>}
          <div className="actions">
            <button className={mode === 'complete' ? 'btn btn-primary' : 'btn btn-danger'} disabled={loading}>
              {loading ? '…' : mode === 'complete' ? 'Confirmer l’envoi' : 'Confirmer le refus'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setMode('idle')}>Annuler</button>
          </div>
        </form>
      )}
    </article>
  );
}
