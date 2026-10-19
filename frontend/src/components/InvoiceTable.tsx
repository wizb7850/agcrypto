import type { Invoice } from '../api/types';
import { formatAmount, formatDate, formatUsd } from '../lib/format';
import { Badge, Copy, Empty } from './ui';

export function InvoiceTable({ invoices, onOpen, empty }: { invoices: Invoice[]; onOpen?: (inv: Invoice) => void; empty?: string }) {
  if (invoices.length === 0) return <Empty>{empty ?? 'Aucune facture.'}</Empty>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr><th>Date</th><th>Commande</th><th>Montant</th><th>≈ USD</th><th>Statut</th><th>Lien de paiement</th></tr>
        </thead>
        <tbody>
          {invoices.map((i) => (
            <tr key={i.id} className={onOpen ? 'clickable' : undefined} onClick={() => onOpen?.(i)}>
              <td className="num">{formatDate(i.created_at)}</td>
              <td><strong>{i.order_id}</strong>{i.description && <div className="small muted">{i.description}</div>}</td>
              <td className="num">{formatAmount(i.amount, 2)} {i.currency}</td>
              <td className="num muted">{formatUsd(i.amount_usd)}</td>
              <td><Badge status={i.status} /></td>
              <td><Copy value={i.checkout_url} label="Copier le lien" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
