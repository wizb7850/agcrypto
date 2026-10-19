import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { List, Submission } from '../../api/types';
import { Alert, Badge, Card, Empty, Loading, PageHeader, Pager, Tabs } from '../../components/ui';
import { useApi } from '../../hooks/useApi';
import { ACCOUNT_TYPE, formatDate } from '../../lib/format';

type Row = Submission & { merchant_id: string; merchant_name: string; account_type: 'personal' | 'business' };
const LIMIT = 25;

export default function KycQueue() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [offset, setOffset] = useState(0);
  const { data, error } = useApi<List<'submissions', Row>>(`/admin/kyc?status=${status}&limit=${LIMIT}&offset=${offset}`);

  return (
    <>
      <PageHeader title="Vérifications" subtitle="Dossiers KYC (particuliers) et KYB (entreprises). Les plus anciens en premier." />
      <Card padded={false} title={
        <Tabs value={status} onChange={(v) => { setStatus(v); setOffset(0); }}
          options={[{ value: 'pending', label: 'À examiner' }, { value: 'approved', label: 'Validés' }, { value: 'rejected', label: 'Refusés' }]} />
      }>
        {error && <div className="card-body"><Alert>{error.message}</Alert></div>}
        {!data ? <Loading /> : data.submissions.length === 0 ? <Empty>Aucun dossier dans cette catégorie.</Empty> : (
          <>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Envoyé le</th><th>Marchand</th><th>Type de dossier</th><th>Profil du compte</th><th>Statut</th></tr></thead>
                <tbody>
                  {data.submissions.map((s) => (
                    <tr key={s.id} className="clickable" onClick={() => navigate(`/admin/verifications/${s.id}`)}>
                      <td className="num">{formatDate(s.submitted_at)}</td>
                      <td><strong>{s.merchant_name}</strong></td>
                      <td>{s.level === 'business' ? 'Entreprise (KYB)' : 'Particulier (KYC)'}</td>
                      <td>{ACCOUNT_TYPE[s.account_type]}</td>
                      <td><Badge status={s.status} /></td>
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
