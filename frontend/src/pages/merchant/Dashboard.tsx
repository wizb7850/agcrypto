import { Link, useNavigate } from 'react-router';
import type { Dashboard as DashboardData } from '../../api/types';
import { useMerchant } from '../../auth/session';
import { InvoiceTable } from '../../components/InvoiceTable';
import { LimitsCard } from '../../components/LimitsCard';
import { Alert, Button, Card, Empty, Loading, PageHeader, Stat } from '../../components/ui';
import { useApi } from '../../hooks/useApi';
import { cryptoLabel, formatAmount, formatUsd } from '../../lib/format';

export default function Dashboard() {
  const { me } = useMerchant();
  const navigate = useNavigate();
  const { data, error, loading } = useApi<DashboardData>('/v1/dashboard');

  return (
    <>
      <PageHeader
        title={`Bonjour, ${me!.merchant.name}`}
        subtitle="Vue d'ensemble de ton activité sur les 30 derniers jours."
        actions={<Button onClick={() => navigate('/app/factures?nouvelle=1')}>+ Nouvelle facture</Button>}
      />
      {error && <Alert>{error.message}</Alert>}
      {loading && !data && <Loading />}
      {data && (
        <>
          <div className="stats">
            <Stat label="Volume encaissé (30 j)" value={formatUsd(data.stats_30d.volume_usd)} />
            <Stat label="Factures payées (30 j)" value={data.stats_30d.paid_invoices} hint={`sur ${data.stats_30d.created_invoices} créées`} />
            <Stat label="Taux de conversion" value={`${data.stats_30d.conversion_rate} %`} hint="factures payées / créées" />
            <Stat label="Retraits en traitement" value={data.pending_withdrawals} href="/app/retraits" />
          </div>
          <div className="grid-2">
            <Card title="Soldes" subtitle="Fonds disponibles, commission déduite"
              actions={<Link to="/app/retraits" className="btn btn-secondary btn-sm">Retirer</Link>}>
              {data.balances.length === 0 ? <Empty>Aucun fonds pour l&apos;instant. Crée une facture pour recevoir ton premier paiement.</Empty> : (
                <div className="stack">
                  {data.balances.map((b) => (
                    <div key={b.currency} className="row-between">
                      <span className="muted">{cryptoLabel(b.currency)}</span>
                      <span className="stat-value num">{formatAmount(b.available)}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
            <LimitsCard limits={data.limits} />
          </div>
          <Card title="Dernières factures" padded={false} actions={<Link to="/app/factures" className="small">Tout voir →</Link>}>
            <InvoiceTable invoices={data.recent_invoices} empty="Aucune facture pour l'instant." />
          </Card>
        </>
      )}
    </>
  );
}
