import type { Revenue } from '../../api/types';
import { useAdmin, useCan } from '../../auth/session';
import { Alert, Card, Empty, Loading, PageHeader, Stat } from '../../components/ui';
import { useApi } from '../../hooks/useApi';
import type { Overview as OverviewData } from '../../layouts/AdminLayout';
import { cryptoLabel, formatAmount, formatUsd } from '../../lib/format';

export default function Overview() {
  const { me } = useAdmin();
  const can = useCan();
  const { data, error } = useApi<OverviewData>('/admin/overview');
  const revenue = useApi<{ revenue: Revenue[] }>(can('revenue:read') ? '/admin/revenue' : null);

  return (
    <>
      <PageHeader title="Vue d'ensemble" subtitle={`Connecté en tant que ${me!.email}`} />
      {error && <Alert>{error.message}</Alert>}
      {!data ? <Loading /> : (
        <div className="stats">
          <Stat label="Vérifications en attente" value={data.pending_kyc} href={can('kyc:read') ? '/admin/verifications' : undefined} />
          <Stat label="Retraits à traiter" value={data.pending_withdrawals} href={can('withdrawals:read') ? '/admin/retraits' : undefined} />
          <Stat label="Marchands" value={data.merchants.total}
            hint={`${data.merchants.verified} vérifiés · ${data.merchants.business} pros · ${data.merchants.suspended} suspendus`} />
          <Stat label="Volume payé (30 j)" value={formatUsd(data.paid_30d.volume_usd)} hint={`${data.paid_30d.count} factures payées`} />
        </div>
      )}
      {can('revenue:read') && (
        <Card title="Revenus de la plateforme" subtitle="Commissions sur paiements + frais de retraits effectués" padded={false}>
          {!revenue.data ? <Loading /> : revenue.data.revenue.length === 0 ? <Empty>Aucun revenu pour l&apos;instant.</Empty> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Crypto</th><th>Commissions paiements</th><th>Frais de retraits</th><th>Total</th></tr></thead>
                <tbody>
                  {revenue.data.revenue.map((r) => (
                    <tr key={r.currency}>
                      <td>{cryptoLabel(r.currency)}</td>
                      <td className="num">{formatAmount(r.payment_fees)}</td>
                      <td className="num">{formatAmount(r.withdrawal_fees)}</td>
                      <td className="num"><strong>{formatAmount(r.total)}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </>
  );
}
