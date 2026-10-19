import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../../api/client';
import type { List, Withdrawal } from '../../api/types';
import { useCan } from '../../auth/session';
import { Alert, Badge, Button, Card, Copy, Empty, Field, Input, Loading, PageHeader, Pager, Tabs } from '../../components/ui';
import { useAction, useApi } from '../../hooks/useApi';
import { cryptoLabel, formatAmount, formatDate, formatUsd } from '../../lib/format';

const LIMIT = 20;

export default function AdminWithdrawals() {
  const [status, setStatus] = useState<'requested' | 'completed' | 'rejected'>('requested');
  const [offset, setOffset] = useState(0);
  const { data, error, reload } = useApi<List<'withdrawals', Withdrawal>>(`/admin/withdrawals?status=${status}&limit=${LIMIT}&offset=${offset}`);

  return (
    <>
      <PageHeader title="Retraits" subtitle="Envoie le montant net depuis NOWPayments ou le portefeuille de la plateforme, puis confirme avec le hash de la transaction." />
      <Card padded={false} title={
        <Tabs value={status} onChange={(v) => { setStatus(v); setOffset(0); }}
          options={[{ value: 'requested', label: 'À traiter' }, { value: 'completed', label: 'Envoyés' }, { value: 'rejected', label: 'Refusés' }]} />
      }>
        <div className="card-body stack">
          {error && <Alert>{error.message}</Alert>}
          {!data ? <Loading /> : data.withdrawals.length === 0 ? <Empty>Aucun retrait dans cette catégorie.</Empty>
            : data.withdrawals.map((w) => <WithdrawalItem key={w.id} w={w} onDone={() => void reload()} />)}
        </div>
        {data && <Pager total={data.total} limit={LIMIT} offset={offset} onChange={setOffset} />}
      </Card>
    </>
  );
}

function WithdrawalItem({ w, onDone }: { w: Withdrawal; onDone: () => void }) {
  const can = useCan();
  const [mode, setMode] = useState<'idle' | 'complete' | 'reject'>('idle');
  const [value, setValue] = useState('');
  const { run, pending, error } = useAction(async () => {
    await api(`/admin/withdrawals/${w.id}/${mode}`, { body: mode === 'complete' ? { tx_hash: value.trim() } : { reason: value.trim() } });
    onDone();
  });

  return (
    <article className="card card-body stack" style={{ boxShadow: 'none' }}>
      <div className="row-between">
        <div>
          <Link to={`/admin/marchands/${w.merchant_id}`}><strong>{w.merchant_name}</strong></Link>
          <div className="small muted">{formatDate(w.created_at)} · <code>{w.id}</code></div>
        </div>
        <Badge status={w.status} />
      </div>
      <div className="grid-3">
        <div className="kv"><span>Demandé</span><span className="num">{formatAmount(w.amount)} {cryptoLabel(w.currency)}</span></div>
        <div className="kv"><span>Frais retenus</span><span className="num">{formatAmount(w.fee)}</span></div>
        <div className="kv highlight"><span>À envoyer</span><span className="stat-value num">{formatAmount(w.net_amount)} {cryptoLabel(w.currency)}</span></div>
      </div>
      <div className="stack-sm">
        <div className="kv"><span>Adresse ({cryptoLabel(w.currency)})</span><Copy value={w.address} /></div>
        {w.extra_id && <div className="kv"><span>Memo / Tag</span><Copy value={w.extra_id} /></div>}
        {w.amount_usd && <span className="small muted">≈ {formatUsd(w.amount_usd)} au moment de la demande</span>}
        {w.tx_hash && <div className="kv"><span>Transaction</span><Copy value={w.tx_hash} /></div>}
        {w.reject_reason && <div className="kv"><span>Motif du refus</span><span>{w.reject_reason}</span></div>}
      </div>
      {w.status === 'requested' && can('withdrawals:process') && mode === 'idle' && (
        <div className="row">
          <Button onClick={() => { setMode('complete'); setValue(''); }}>J&apos;ai envoyé les fonds</Button>
          <Button variant="danger-outline" onClick={() => { setMode('reject'); setValue(''); }}>Refuser</Button>
        </div>
      )}
      {mode !== 'idle' && (
        <form className="form" onSubmit={(e) => { e.preventDefault(); void run(); }}>
          <Field label={mode === 'complete' ? 'Hash de la transaction envoyée' : 'Motif du refus (visible par le marchand)'}
            hint={mode === 'complete' ? `Vérifie : ${formatAmount(w.net_amount)} ${cryptoLabel(w.currency)} vers ${w.address}` : `Le montant de ${formatAmount(w.amount)} sera recrédité au marchand.`}>
            <Input autoFocus required minLength={mode === 'complete' ? 10 : 3} value={value} onChange={(e) => setValue(e.target.value)} />
          </Field>
          {error && <Alert>{error}</Alert>}
          <div className="row">
            <Button type="submit" variant={mode === 'complete' ? 'primary' : 'danger'} loading={pending}>
              {mode === 'complete' ? 'Confirmer l\'envoi' : 'Confirmer le refus'}
            </Button>
            <Button variant="ghost" onClick={() => setMode('idle')}>Annuler</Button>
          </div>
        </form>
      )}
    </article>
  );
}
