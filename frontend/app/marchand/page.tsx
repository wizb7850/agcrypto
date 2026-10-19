'use client';

import { useCallback, useEffect, useState } from 'react';
import { LoginForm } from '@/components/LoginForm';
import { Shell } from '@/components/Shell';
import { Alert, Badge, Card, Copy, Empty } from '@/components/ui';
import { api, session, type Balance, type Invoice, type Quote, type Withdrawal } from '@/lib/api';
import { currencyLabel, formatDate } from '@/lib/format';

export default function MerchantPage() {
  const [logged, setLogged] = useState<boolean | null>(null);
  useEffect(() => setLogged(!!session.get('merchant')), []);

  if (logged === null) return null;
  if (!logged) {
    return (
      <LoginForm
        role="merchant"
        title="Espace marchand"
        label="Clé API"
        hint="La clé commence par agc_. Elle t'a été remise à la création de ton compte marchand."
        checkPath="/v1/me"
        onLogin={() => setLogged(true)}
      />
    );
  }
  return <Dashboard onLogout={() => { session.clear('merchant'); setLogged(false); }} />;
}

function Dashboard({ onLogout }: { onLogout: () => void }) {
  const [name, setName] = useState('');
  const [balances, setBalances] = useState<Balance[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [me, b, i, w] = await Promise.all([
        api<{ name: string }>('merchant', '/v1/me'),
        api<{ balances: Balance[] }>('merchant', '/v1/balance'),
        api<{ invoices: Invoice[] }>('merchant', '/v1/invoices'),
        api<{ withdrawals: Withdrawal[] }>('merchant', '/v1/withdrawals'),
      ]);
      setName(me.name);
      setBalances(b.balances);
      setInvoices(i.invoices);
      setWithdrawals(w.withdrawals);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 15_000); // les paiements arrivent en continu
    return () => clearInterval(t);
  }, [refresh]);

  return (
    <Shell area="Espace marchand" subtitle={name} onLogout={onLogout}>
      {error && <Alert>{error}</Alert>}

      <div className="stats">
        {balances.length === 0 && <div className="stat"><span className="muted small">Solde</span><strong>0</strong></div>}
        {balances.map((b) => (
          <div className="stat" key={b.currency}>
            <span className="muted small">{currencyLabel(b.currency)}</span>
            <strong>{b.available}</strong>
          </div>
        ))}
      </div>

      <div className="grid-2">
        <CreateInvoice onCreated={refresh} />
        <RequestWithdrawal balances={balances} onRequested={refresh} />
      </div>

      <Card title="Factures">
        {invoices.length === 0 ? <Empty>Aucune facture pour l&apos;instant.</Empty> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Date</th><th>Commande</th><th>Montant</th><th>Statut</th><th>Lien de paiement</th></tr></thead>
              <tbody>
                {invoices.map((i) => (
                  <tr key={i.id}>
                    <td>{formatDate(i.created_at)}</td>
                    <td>{i.order_id}</td>
                    <td className="num">{i.amount} {i.currency}</td>
                    <td><Badge status={i.status} /></td>
                    <td><a href={i.checkout_url} target="_blank" rel="noreferrer">Ouvrir ↗</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Retraits">
        {withdrawals.length === 0 ? <Empty>Aucun retrait demandé.</Empty> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Date</th><th>Montant</th><th>Frais</th><th>Reçu</th><th>Adresse</th><th>Statut</th></tr></thead>
              <tbody>
                {withdrawals.map((w) => (
                  <tr key={w.id}>
                    <td>{formatDate(w.created_at)}</td>
                    <td className="num">{w.amount} {currencyLabel(w.currency)}</td>
                    <td className="num muted">{w.fee}</td>
                    <td className="num"><strong>{w.net_amount}</strong></td>
                    <td><Copy value={w.address} short /></td>
                    <td>
                      <Badge status={w.status} />
                      {w.tx_hash && <div className="small"><Copy value={w.tx_hash} short /></div>}
                      {w.reject_reason && <div className="small muted">{w.reject_reason}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </Shell>
  );
}

function CreateInvoice({ onCreated }: { onCreated: () => void }) {
  const [form, setForm] = useState({ amount: '', currency: 'EUR', order_id: '', description: '' });
  const [created, setCreated] = useState<Invoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const inv = await api<Invoice>('merchant', '/v1/invoices', {
        method: 'POST',
        body: { ...form, description: form.description || undefined },
      });
      setCreated(inv);
      setForm({ ...form, amount: '', order_id: '', description: '' });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card title="Nouvelle facture">
      <form className="form" onSubmit={submit}>
        <div className="row">
          <label>Montant
            <input inputMode="decimal" pattern="\d+(\.\d{1,8})?" placeholder="49.99" required
              value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value.replace(',', '.') })} />
          </label>
          <label className="narrow">Devise
            <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
              <option>EUR</option><option>USD</option><option>XOF</option><option>GBP</option>
            </select>
          </label>
        </div>
        <label>N° de commande
          <input required maxLength={100} placeholder="CMD-1042" value={form.order_id}
            onChange={(e) => setForm({ ...form, order_id: e.target.value })} />
        </label>
        <label><span>Description <span className="muted">(facultatif)</span></span>
          <input maxLength={500} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </label>
        {error && <Alert>{error}</Alert>}
        {created && (
          <Alert tone="success">
            Facture créée. Lien à envoyer au client :
            <Copy value={created.checkout_url} />
          </Alert>
        )}
        <button className="btn btn-primary" disabled={loading}>{loading ? 'Création…' : 'Créer le lien de paiement'}</button>
      </form>
    </Card>
  );
}

function RequestWithdrawal({ balances, onRequested }: { balances: Balance[]; onRequested: () => void }) {
  const [form, setForm] = useState({ currency: '', amount: '', address: '', extra_id: '' });
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const currency = form.currency || balances[0]?.currency || '';
  const available = balances.find((b) => b.currency === currency)?.available ?? '0';

  // Aperçu des frais pendant la saisie
  useEffect(() => {
    setQuote(null);
    setError(null);
    if (!currency || !/^\d+(\.\d+)?$/.test(form.amount) || Number(form.amount) <= 0) return;
    const t = setTimeout(() => {
      api<Quote>('merchant', `/v1/withdrawals/quote?currency=${currency}&amount=${form.amount}`)
        .then(setQuote)
        .catch((e: Error) => setError(e.message)); // ex. montant inférieur aux frais
    }, 300);
    return () => clearTimeout(t);
  }, [currency, form.amount]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const w = await api<Withdrawal>('merchant', '/v1/withdrawals', {
        method: 'POST',
        body: { currency, amount: form.amount, address: form.address.trim(), extra_id: form.extra_id.trim() || undefined },
      });
      setSuccess(`Demande envoyée : tu recevras ${w.net_amount} ${currencyLabel(w.currency)} après validation.`);
      setForm({ ...form, amount: '', address: '', extra_id: '' });
      onRequested();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  if (balances.length === 0) {
    return <Card title="Retrait"><Empty>Ton solde est vide. Les retraits seront possibles après ton premier paiement reçu.</Empty></Card>;
  }

  return (
    <Card title="Demander un retrait">
      <form className="form" onSubmit={submit}>
        <div className="row">
          <label>Crypto
            <select value={currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
              {balances.map((b) => <option key={b.currency} value={b.currency}>{currencyLabel(b.currency)}</option>)}
            </select>
          </label>
          <label>Montant
            <input inputMode="decimal" required placeholder={available} value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value.replace(',', '.') })} />
          </label>
        </div>
        <button type="button" className="link small" onClick={() => setForm({ ...form, amount: available })}>
          Tout retirer ({available})
        </button>
        <label>Adresse de réception ({currencyLabel(currency)})
          <input required minLength={10} spellCheck={false} value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })} />
        </label>
        <label><span>Memo / Tag <span className="muted">(seulement si ton wallet l&apos;exige)</span></span>
          <input value={form.extra_id} onChange={(e) => setForm({ ...form, extra_id: e.target.value })} />
        </label>
        {quote && (
          <dl className="quote">
            <dt>Frais</dt><dd>{quote.fee}</dd>
            <dt>Tu reçois</dt><dd><strong>{quote.net_amount} {currencyLabel(quote.currency)}</strong></dd>
          </dl>
        )}
        {error && <Alert>{error}</Alert>}
        {success && <Alert tone="success">{success}</Alert>}
        <button className="btn btn-primary" disabled={loading || !quote}>{loading ? 'Envoi…' : 'Demander le retrait'}</button>
      </form>
    </Card>
  );
}
