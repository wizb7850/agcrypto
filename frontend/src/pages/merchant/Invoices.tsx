import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { api } from '../../api/client';
import type { Invoice, List, Payment } from '../../api/types';
import { useMerchant, usePublicInfo } from '../../auth/session';
import { InvoiceTable } from '../../components/InvoiceTable';
import { Alert, Badge, Button, Card, Copy, Field, Input, Loading, Modal, PageHeader, Pager, Select, Tabs } from '../../components/ui';
import { useAction, useApi } from '../../hooks/useApi';
import { cryptoLabel, formatAmount, formatDate, formatUsd } from '../../lib/format';

const FILTERS = [
  { value: '', label: 'Toutes' },
  { value: 'pending', label: 'En attente' },
  { value: 'confirming', label: 'Confirmation' },
  { value: 'paid', label: 'Payées' },
  { value: 'partially_paid', label: 'Partielles' },
  { value: 'expired', label: 'Expirées' },
];
const LIMIT = 20;

export default function Invoices() {
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState('');
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Invoice | null>(null);
  const creating = params.get('nouvelle') === '1';
  const query = `/v1/invoices?limit=${LIMIT}&offset=${offset}${status ? `&status=${status}` : ''}`;
  const { data, error, loading, reload } = useApi<List<'invoices', Invoice>>(query);
  const { me } = useMerchant();

  return (
    <>
      <PageHeader
        title="Factures"
        subtitle="Chaque facture génère un lien de paiement à envoyer à ton client."
        actions={<Button disabled={me!.merchant.status !== 'active'} onClick={() => setParams({ nouvelle: '1' })}>+ Nouvelle facture</Button>}
      />
      <Card padded={false} title={<Tabs value={status} options={FILTERS} onChange={(v) => { setStatus(v); setOffset(0); }} />}>
        {error && <div className="card-body"><Alert>{error.message}</Alert></div>}
        {loading && !data ? <Loading /> : data && (
          <>
            <InvoiceTable invoices={data.invoices} onOpen={setSelected}
              empty={status ? 'Aucune facture avec ce statut.' : 'Aucune facture : crée ta première facture.'} />
            <Pager total={data.total} limit={LIMIT} offset={offset} onChange={setOffset} />
          </>
        )}
      </Card>
      {creating && <CreateInvoice onClose={() => setParams({})} onCreated={() => void reload()} />}
      {selected && <InvoiceDetail invoice={selected} onClose={() => setSelected(null)} />}
    </>
  );
}

function CreateInvoice({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const info = usePublicInfo();
  const currencies = info?.price_currencies ?? ['EUR', 'USD'];
  const [form, setForm] = useState({ amount: '', currency: currencies.includes('EUR') ? 'EUR' : currencies[0] ?? 'USD', order_id: '', description: '', success_url: '' });
  const [created, setCreated] = useState<Invoice | null>(null);
  const { run, pending, error } = useAction(async () => {
    const inv = await api<Invoice>('/v1/invoices', {
      body: {
        amount: form.amount, currency: form.currency, order_id: form.order_id,
        description: form.description || undefined, success_url: form.success_url || undefined,
      },
    });
    setCreated(inv);
    onCreated();
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <Modal title={created ? 'Facture créée' : 'Nouvelle facture'} onClose={onClose}>
      {created ? (
        <>
          <Alert tone="success" title={`${formatAmount(created.amount, 2)} ${created.currency} — commande ${created.order_id}`}>
            Envoie ce lien à ton client : il choisira sa crypto et paiera sur ta page de paiement.
          </Alert>
          <Copy value={created.checkout_url} />
          <div className="row">
            <a className="btn btn-secondary" href={created.checkout_url} target="_blank" rel="noreferrer">Ouvrir la page de paiement ↗</a>
            <Button variant="ghost" onClick={onClose}>Fermer</Button>
          </div>
        </>
      ) : (
        <form className="form" onSubmit={(e) => { e.preventDefault(); void run(); }}>
          <div className="grid-2">
            <Field label="Montant">
              <Input inputMode="decimal" required placeholder="49.99" pattern="\d+([.,]\d{1,8})?" value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value.replace(',', '.') })} />
            </Field>
            <Field label="Devise">
              <Select value={form.currency} onChange={set('currency')}>
                {currencies.map((c) => <option key={c}>{c}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Numéro de commande" hint="Ta référence interne. Un même numéro renvoie la même facture.">
            <Input required maxLength={100} placeholder="CMD-1042" value={form.order_id} onChange={set('order_id')} />
          </Field>
          <Field label="Description (facultatif)" hint="Affichée au client sur la page de paiement.">
            <Input maxLength={500} value={form.description} onChange={set('description')} />
          </Field>
          <Field label="Page de retour après paiement (facultatif)">
            <Input type="url" placeholder="https://ma-boutique.com/merci" value={form.success_url} onChange={set('success_url')} />
          </Field>
          {error && <Alert>{error}</Alert>}
          <Button type="submit" loading={pending}>Créer le lien de paiement</Button>
        </form>
      )}
    </Modal>
  );
}

function InvoiceDetail({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const { data } = useApi<Invoice & { payments: Payment[] }>(`/v1/invoices/${invoice.id}`);
  const inv = data ?? invoice;
  return (
    <Modal title={`Facture ${inv.order_id}`} onClose={onClose} wide>
      <dl className="dl">
        <dt>Statut</dt><dd><Badge status={inv.status} /></dd>
        <dt>Montant</dt><dd className="num">{formatAmount(inv.amount, 2)} {inv.currency} <span className="muted">≈ {formatUsd(inv.amount_usd)}</span></dd>
        {inv.description && <><dt>Description</dt><dd>{inv.description}</dd></>}
        <dt>Créée le</dt><dd>{formatDate(inv.created_at)}</dd>
        <dt>Expire le</dt><dd>{formatDate(inv.expires_at)}</dd>
        <dt>Lien de paiement</dt><dd><Copy value={inv.checkout_url} /></dd>
        <dt>Identifiant</dt><dd><code>{inv.id}</code></dd>
      </dl>
      <h3>Paiements</h3>
      {!data ? <Loading /> : data.payments.length === 0 ? <p className="muted">Le client n&apos;a pas encore choisi de crypto.</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Crypto</th><th>Montant demandé</th><th>Reçu</th><th>Adresse</th><th>Statut</th></tr></thead>
            <tbody>
              {data.payments.map((p) => (
                <tr key={p.id}>
                  <td>{p.pay_currency ? cryptoLabel(p.pay_currency) : '—'}</td>
                  <td className="num">{formatAmount(p.pay_amount)}</td>
                  <td className="num">{formatAmount(p.actually_paid)}</td>
                  <td>{p.pay_address ? <Copy value={p.pay_address} short /> : '—'}</td>
                  <td><Badge status={p.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
