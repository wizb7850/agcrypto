import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import type { AdminMerchant, List } from '../../api/types';
import { Alert, Badge, Card, Empty, Input, LevelBadge, Loading, PageHeader, Pager, Select } from '../../components/ui';
import { useApi } from '../../hooks/useApi';
import { ACCOUNT_TYPE, formatDate } from '../../lib/format';

const LIMIT = 25;

export default function Merchants() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [level, setLevel] = useState('');
  const [offset, setOffset] = useState(0);
  // Recherche déclenchée 300 ms après la frappe
  useEffect(() => { const t = setTimeout(() => { setSearch(q.trim()); setOffset(0); }, 300); return () => clearTimeout(t); }, [q]);
  const params = new URLSearchParams({ limit: String(LIMIT), offset: String(offset), ...(search && { q: search }), ...(status && { status }), ...(level && { level }) });
  const { data, error } = useApi<List<'merchants', AdminMerchant>>(`/admin/merchants?${params}`);

  return (
    <>
      <PageHeader title="Marchands" subtitle="Recherche par nom, e-mail ou identifiant." />
      <Card padded={false} title={
        <div className="row">
          <Input style={{ width: 280 }} placeholder="Rechercher…" value={q} onChange={(e) => setQ(e.target.value)} />
          <Select style={{ width: 170 }} value={level} onChange={(e) => { setLevel(e.target.value); setOffset(0); }}>
            <option value="">Tous les niveaux</option>
            <option value="none">Non vérifiés</option>
            <option value="personal">Personnels vérifiés</option>
            <option value="business">Professionnels vérifiés</option>
          </Select>
          <Select style={{ width: 150 }} value={status} onChange={(e) => { setStatus(e.target.value); setOffset(0); }}>
            <option value="">Tous les statuts</option>
            <option value="active">Actifs</option>
            <option value="suspended">Suspendus</option>
          </Select>
        </div>
      }>
        {error && <div className="card-body"><Alert>{error.message}</Alert></div>}
        {!data ? <Loading /> : data.merchants.length === 0 ? <Empty>Aucun marchand.</Empty> : (
          <>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Marchand</th><th>Profil</th><th>Vérification</th><th>Statut</th><th>Inscrit le</th></tr></thead>
                <tbody>
                  {data.merchants.map((m) => (
                    <tr key={m.id} className="clickable" onClick={() => navigate(`/admin/marchands/${m.id}`)}>
                      <td><strong>{m.name}</strong><div className="small muted">{m.email}</div></td>
                      <td>{ACCOUNT_TYPE[m.account_type]}</td>
                      <td><LevelBadge level={m.verification_level} /></td>
                      <td><Badge status={m.status} /></td>
                      <td className="num">{formatDate(m.created_at)}</td>
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
