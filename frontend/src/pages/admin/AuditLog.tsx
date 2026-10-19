import { useState } from 'react';
import { Link } from 'react-router';
import type { List } from '../../api/types';
import { Alert, Card, Empty, Loading, PageHeader, Pager } from '../../components/ui';
import { useApi } from '../../hooks/useApi';
import { formatDate } from '../../lib/format';

interface Entry { id: string; admin_email: string | null; action: string; target_type: string; target_id: string; details: Record<string, unknown> | null; ip: string | null; created_at: string }

const ACTIONS: Record<string, string> = {
  'kyc.approve': 'Dossier validé', 'kyc.reject': 'Dossier refusé', 'kyc.document_view': 'Document consulté',
  'withdrawal.complete': 'Retrait envoyé', 'withdrawal.reject': 'Retrait refusé',
  'merchant.suspend': 'Marchand suspendu', 'merchant.reactivate': 'Marchand réactivé',
  'team.create': 'Membre ajouté', 'team.update': 'Membre modifié',
};
const LIMIT = 50;

function Target({ e }: { e: Entry }) {
  if (e.target_type === 'merchant') return <Link to={`/admin/marchands/${e.target_id}`}><code>{e.target_id}</code></Link>;
  if (e.target_type === 'kyc_submission') return <Link to={`/admin/verifications/${e.target_id}`}><code>{e.target_id}</code></Link>;
  return <code>{e.target_id}</code>;
}

export default function AuditLog() {
  const [offset, setOffset] = useState(0);
  const { data, error } = useApi<List<'entries', Entry>>(`/admin/audit-log?limit=${LIMIT}&offset=${offset}`);
  return (
    <>
      <PageHeader title="Journal d'audit" subtitle="Toutes les actions de l'équipe : qui, quoi, quand. Ce journal ne peut pas être modifié." />
      <Card padded={false}>
        {error && <div className="card-body"><Alert>{error.message}</Alert></div>}
        {!data ? <Loading /> : data.entries.length === 0 ? <Empty>Aucune action pour l&apos;instant.</Empty> : (
          <>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Date</th><th>Membre</th><th>Action</th><th>Cible</th><th>Détails</th><th>IP</th></tr></thead>
                <tbody>
                  {data.entries.map((e) => (
                    <tr key={e.id}>
                      <td className="num">{formatDate(e.created_at)}</td>
                      <td>{e.admin_email ?? '—'}</td>
                      <td><strong>{ACTIONS[e.action] ?? e.action}</strong></td>
                      <td><Target e={e} /></td>
                      <td className="small muted">{e.details ? Object.entries(e.details).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => `${k}: ${String(v)}`).join(' · ') : '—'}</td>
                      <td className="small muted">{e.ip ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager total={data.total} limit={LIMIT} offset={offset} onChange={setOffset} />
          </>
        )}
      </Card>
    </>
  );
}
