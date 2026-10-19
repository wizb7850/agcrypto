import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../../api/client';
import type { Balance, Limits, List, Quote, Withdrawal } from '../../api/types';
import { useMerchant } from '../../auth/session';
import { Alert, Badge, Button, Card, Copy, Empty, Field, Input, Loading, PageHeader, Pager, Select } from '../../components/ui';
import { useAction, useApi } from '../../hooks/useApi';
import { cryptoLabel, formatAmount, formatDate, formatUsd } from '../../lib/format';

const LIMIT = 20;

export default function Withdrawals() {
  const [offset, setOffset] = useState(0);
  const balances = useApi<{ balances: Balance[] }>('/v1/balance');
  const limits = useApi<Limits>('/v1/limits');
  const history = useApi<List<'withdrawals', Withdrawal>>(`/v1/withdrawals?limit=${LIMIT}&offset=${offset}`);
  const refresh = () => { void balances.reload(); void limits.reload(); void history.reload(); };

  return (
    <>
      <PageHeader title="Retraits" subtitle="Envoie tes fonds vers ton portefeuille. Chaque retrait est contrôlé par notre équipe avant envoi." />
      <div className="grid-2">
        <Card title="Demander un retrait">
          {!balances.data || !limits.data ? <Loading /> : <WithdrawForm balances={balances.data.balances} limits={limits.data} onDone={refresh} />}
        </Card>
        <Card title="Soldes disponibles">
          {balances.data?.balances.length === 0 && <Empty>Aucun fonds disponible.</Empty>}
          <div className="stack">
            {balances.data?.balances.map((b) => (
              <div key={b.currency} className="row-between">
                <span className="muted">{cryptoLabel(b.currency)}</span>
                <span className="stat-value num">{formatAmount(b.available)}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
      <Card title="Historique" padded={false}>
        {history.error && <div className="card-body"><Alert>{history.error.message}</Alert></div>}
        {!history.data ? <Loading /> : history.data.withdrawals.length === 0 ? <Empty>Aucun retrait pour l&apos;instant.</Empty> : (
          <>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Date</th><th>Montant</th><th>Frais</th><th>Reçu</th><th>Adresse</th><th>Statut</th></tr></thead>
                <tbody>
                  {history.data.withdrawals.map((w) => (
                    <tr key={w.id}>
                      <td className="num">{formatDate(w.created_at)}</td>
                      <td className="num">{formatAmount(w.amount)} {cryptoLabel(w.currency)}</td>
                      <td className="num muted">{formatAmount(w.fee)}</td>
                      <td className="num"><strong>{formatAmount(w.net_amount)}</strong></td>
                      <td><Copy value={w.address} short /></td>
                      <td>
                        <Badge status={w.status} />
                        {w.tx_hash && <div className="small" style={{ marginTop: 4 }}><Copy value={w.tx_hash} short /></div>}
                        {w.reject_reason && <div className="small muted">{w.reject_reason}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager total={history.data.total} limit={LIMIT} offset={offset} onChange={setOffset} />
          </>
        )}
      </Card>
    </>
  );
}

function WithdrawForm({ balances, limits, onDone }: { balances: Balance[]; limits: Limits; onDone: () => void }) {
  const { me } = useMerchant();
  const [form, setForm] = useState({ currency: balances[0]?.currency ?? '', amount: '', address: '', extra_id: '' });
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [success, setSuccess] = useState<Withdrawal | null>(null);
  const available = balances.find((b) => b.currency === form.currency)?.available ?? '0';

  // Aperçu des frais pendant la saisie
  useEffect(() => {
    setQuote(null);
    setQuoteError(null);
    if (!form.currency || !/^\d+(\.\d+)?$/.test(form.amount) || Number(form.amount) <= 0) return;
    const t = setTimeout(() => {
      api<Quote>(`/v1/withdrawals/quote?currency=${form.currency}&amount=${form.amount}`)
        .then(setQuote).catch((e: Error) => setQuoteError(e.message));
    }, 300);
    return () => clearTimeout(t);
  }, [form.currency, form.amount]);

  const { run, pending, error } = useAction(async () => {
    const w = await api<Withdrawal>('/v1/withdrawals', {
      body: { currency: form.currency, amount: form.amount, address: form.address.trim(), extra_id: form.extra_id.trim() || undefined },
    });
    setSuccess(w);
    setForm({ ...form, amount: '', address: '', extra_id: '' });
    onDone();
  });

  if (!limits.withdraw.allowed) {
    return (
      <Alert tone="warning" title="Vérification requise">
        <span>Pour des raisons de sécurité, les retraits sont ouverts après la vérification de ton identité. <Link to="/app/verification">Vérifier mon compte →</Link></span>
      </Alert>
    );
  }
  if (me!.merchant.status !== 'active') return <Alert>Compte suspendu : retraits indisponibles.</Alert>;
  if (balances.length === 0) return <Empty>Ton solde est vide. Les retraits seront possibles après ton premier paiement reçu.</Empty>;

  return (
    <form className="form" onSubmit={(e) => { e.preventDefault(); void run(); }}>
      <div className="grid-2">
        <Field label="Crypto">
          <Select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
            {balances.map((b) => <option key={b.currency} value={b.currency}>{cryptoLabel(b.currency)}</option>)}
          </Select>
        </Field>
        <Field label={<span className="row-between">Montant <button type="button" className="link-btn small" onClick={() => setForm({ ...form, amount: available })}>Max ({formatAmount(available)})</button></span>}>
          <Input inputMode="decimal" required placeholder="0.00" value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value.replace(',', '.') })} />
        </Field>
      </div>
      <Field label={`Adresse de réception (${cryptoLabel(form.currency)})`} hint="Vérifie le réseau : un envoi sur le mauvais réseau est perdu.">
        <Input required minLength={10} spellCheck={false} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
      </Field>
      <Field label="Memo / Tag (seulement si ton portefeuille l'exige)">
        <Input value={form.extra_id} onChange={(e) => setForm({ ...form, extra_id: e.target.value })} />
      </Field>
      {quote && (
        <div className="highlight row-between">
          <div className="kv"><span>Frais</span><span className="num">{formatAmount(quote.fee)}</span></div>
          <div className="kv" style={{ textAlign: 'right' }}><span>Tu reçois</span><span className="stat-value num">{formatAmount(quote.net_amount)} {cryptoLabel(quote.currency)}</span></div>
        </div>
      )}
      {limits.withdraw.limit_usd !== null && (
        <p className="small muted">Limite restante sur 24 h : {formatUsd(limits.withdraw.remaining_usd)}</p>
      )}
      {quoteError && <Alert>{quoteError}</Alert>}
      {error && <Alert>{error}</Alert>}
      {success && <Alert tone="success" title="Demande enregistrée">Tu recevras {formatAmount(success.net_amount)} {cryptoLabel(success.currency)} après contrôle par notre équipe.</Alert>}
      <Button type="submit" loading={pending} disabled={!quote}>Demander le retrait</Button>
    </form>
  );
}
