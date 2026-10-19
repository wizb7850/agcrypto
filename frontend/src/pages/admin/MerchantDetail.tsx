import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { api } from '../../api/client';
import type { Balance, Invoice, Limits, List, Submission, Withdrawal } from '../../api/types';
import { useCan } from '../../auth/session';
import { InvoiceTable } from '../../components/InvoiceTable';
import { LimitsCard } from '../../components/LimitsCard';
import { Alert, Badge, Button, Card, Empty, Field, LevelBadge, Loading, Modal, PageHeader, Textarea } from '../../components/ui';
import { useAction, useApi } from '../../hooks/useApi';
import { ACCOUNT_TYPE, cryptoLabel, formatAmount, formatDate } from '../../lib/format';

interface MerchantCard {
  id: string; name: string; account_type: 'personal' | 'business'; verification_level: 'none' | 'personal' | 'business';
  status: string; suspended_reason: string | null; webhook_url: string | null; created_at: string;
  users: { email: string; email_verified: boolean; created_at: string }[];
  balances: Balance[]; limits: Limits; active_api_keys: number;
  invoices: List<'invoices', Invoice>; withdrawals: List<'withdrawals', Withdrawal>; kyc_submissions: Submission[];
}

export default function MerchantDetail() {
  const { id } = useParams();
  const can = useCan();
  const { data, error, reload } = useApi<MerchantCard>(`/admin/merchants/${id}`);
  const [suspending, setSuspending] = useState(false);
  const reactivate = useAction(async () => {
    await api(`/admin/merchants/${id}/reactivate`, { method: 'POST' });
    void reload();
  });

  if (error) return <Alert>{error.message}</Alert>;
  if (!data) return <Loading />;
  return (
    <>
      <PageHeader
        title={<span className="row">{data.name} <Badge status={data.status} /> <LevelBadge level={data.verification_level} /></span>}
        subtitle={<><Link to="/admin/marchands">← Marchands</Link> · {ACCOUNT_TYPE[data.account_type]} · inscrit le {formatDate(data.created_at)}</>}
        actions={can('merchants:suspend') && (data.status === 'active'
          ? <Button variant="danger-outline" onClick={() => setSuspending(true)}>Suspendre</Button>
          : <Button loading={reactivate.pending} onClick={() => void reactivate.run()}>Réactiver</Button>)}
      />
      {data.status === 'suspended' && <Alert title="Compte suspendu">{data.suspended_reason}</Alert>}
      {reactivate.error && <Alert>{reactivate.error}</Alert>}
      <div className="grid-2">
        <Card title="Informations">
          <dl className="dl">
            <dt>Identifiant</dt><dd><code>{data.id}</code></dd>
            <dt>Utilisateurs</dt>
            <dd>{data.users.map((u) => <div key={u.email}>{u.email} {!u.email_verified && <span className="badge badge-warning">e-mail non vérifié</span>}</div>)}</dd>
            <dt>Clés API actives</dt><dd>{data.active_api_keys}</dd>
            <dt>Webhook</dt><dd>{data.webhook_url ?? <span className="muted">Non configuré</span>}</dd>
            <dt>Soldes</dt>
            <dd>{data.balances.length === 0 ? <span className="muted">Aucun</span> : data.balances.map((b) => (
              <div key={b.currency} className="num">{formatAmount(b.available)} {cryptoLabel(b.currency)}</div>
            ))}</dd>
          </dl>
        </Card>
        <LimitsCard limits={data.limits} />
      </div>
      <Card title="Vérifications" padded={false}>
        {data.kyc_submissions.length === 0 ? <Empty>Aucun dossier envoyé.</Empty> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Envoyé le</th><th>Niveau</th><th>Statut</th><th>Motif</th><th /></tr></thead>
              <tbody>
                {data.kyc_submissions.map((s) => (
                  <tr key={s.id}>
                    <td className="num">{formatDate(s.submitted_at)}</td>
                    <td>{s.level === 'business' ? 'Entreprise' : 'Particulier'}</td>
                    <td><Badge status={s.status} /></td>
                    <td className="small">{s.reject_reason ?? '—'}</td>
                    <td style={{ textAlign: 'right' }}>{can('kyc:read') && <Link to={`/admin/verifications/${s.id}`}>Ouvrir →</Link>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title="Dernières factures" padded={false}><InvoiceTable invoices={data.invoices.invoices} /></Card>
      <Card title="Derniers retraits" padded={false}>
        {data.withdrawals.withdrawals.length === 0 ? <Empty>Aucun retrait.</Empty> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Date</th><th>Montant</th><th>Net envoyé</th><th>Statut</th></tr></thead>
              <tbody>
                {data.withdrawals.withdrawals.map((w) => (
                  <tr key={w.id}>
                    <td className="num">{formatDate(w.created_at)}</td>
                    <td className="num">{formatAmount(w.amount)} {cryptoLabel(w.currency)}</td>
                    <td className="num">{formatAmount(w.net_amount)}</td>
                    <td><Badge status={w.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {suspending && <SuspendModal id={data.id} onClose={() => setSuspending(false)} onDone={() => { setSuspending(false); void reload(); }} />}
    </>
  );
}

function SuspendModal({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const { run, pending, error } = useAction(async () => {
    await api(`/admin/merchants/${id}/suspend`, { body: { reason } });
    onDone();
  });
  return (
    <Modal title="Suspendre le marchand" onClose={onClose}>
      <p className="muted">Les paiements, factures et retraits seront bloqués. Le marchand est prévenu par e-mail avec le motif.</p>
      <form className="form" onSubmit={(e) => { e.preventDefault(); void run(); }}>
        <Field label="Motif"><Textarea required minLength={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        {error && <Alert>{error}</Alert>}
        <Button type="submit" variant="danger" loading={pending}>Suspendre</Button>
      </form>
    </Modal>
  );
}
