import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api } from '../../api/client';
import type { Submission, UploadedDocument } from '../../api/types';
import { useCan } from '../../auth/session';
import { Alert, Badge, Button, Card, Field, LevelBadge, Loading, Modal, PageHeader, Textarea } from '../../components/ui';
import { useAction, useApi } from '../../hooks/useApi';
import { ACCOUNT_TYPE, formatDate } from '../../lib/format';

interface Detail extends Submission {
  data: Record<string, unknown>;
  merchant: { id: string; name: string; account_type: 'personal' | 'business'; verification_level: 'none' | 'personal' | 'business'; status: string; emails: string[]; created_at: string };
  documents: UploadedDocument[];
  history: Submission[];
}

const LABELS: Record<string, string> = {
  company_name: 'Raison sociale', registration_number: 'N° d\'immatriculation', activity: 'Activité', website: 'Site web',
  first_name: 'Prénom', last_name: 'Nom', role: 'Fonction', birth_date: 'Date de naissance', nationality: 'Nationalité',
  id_type: 'Pièce d\'identité', id_number: 'N° de pièce',
  address: 'Adresse', postal_code: 'Code postal', city: 'Ville', country: 'Pays',
};
const ID_TYPES: Record<string, string> = { passport: 'Passeport', id_card: 'Carte d\'identité', driving_license: 'Permis de conduire' };

// PostgreSQL (jsonb) ne conserve pas l'ordre des clés : on affiche dans un ordre logique
const ORDER = Object.keys(LABELS);
const display = (k: string, v: unknown) => {
  if (k === 'id_type') return ID_TYPES[String(v)] ?? String(v);
  if (k === 'birth_date' && typeof v === 'string') return new Date(`${v}T00:00:00`).toLocaleDateString('fr-FR');
  return String(v);
};

function Fields({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data).filter(([, v]) => typeof v !== 'object')
    .sort(([a], [b]) => (ORDER.indexOf(a) === -1 ? 99 : ORDER.indexOf(a)) - (ORDER.indexOf(b) === -1 ? 99 : ORDER.indexOf(b)));
  return (
    <dl className="dl">
      {entries.map(([k, v]) => (
        <div key={k} style={{ display: 'contents' }}>
          <dt>{LABELS[k] ?? k}</dt>
          <dd>{display(k, v)}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function KycReview() {
  const { id } = useParams();
  const navigate = useNavigate();
  const can = useCan();
  const { data, error, reload } = useApi<Detail>(`/admin/kyc/${id}`);
  const [rejecting, setRejecting] = useState(false);
  const approve = useAction(async () => {
    if (!window.confirm('Valider ce dossier ? Le compte passera au niveau correspondant et le marchand sera prévenu.')) return;
    await api(`/admin/kyc/${id}/approve`, { method: 'POST' });
    void reload();
  });

  if (error) return <Alert>{error.message}</Alert>;
  if (!data) return <Loading />;
  const representative = data.data.representative as Record<string, unknown> | undefined;

  return (
    <>
      <PageHeader
        title={<span className="row">Dossier {data.level === 'business' ? 'entreprise' : 'particulier'} <Badge status={data.status} /></span>}
        subtitle={<><Link to="/admin/verifications">← Vérifications</Link> · envoyé le {formatDate(data.submitted_at)}</>}
        actions={data.status === 'pending' && can('kyc:review') && (
          <>
            <Button variant="danger-outline" onClick={() => setRejecting(true)}>Refuser</Button>
            <Button loading={approve.pending} onClick={() => void approve.run()}>Valider le dossier</Button>
          </>
        )}
      />
      {approve.error && <Alert>{approve.error}</Alert>}
      {data.status === 'rejected' && <Alert title="Dossier refusé">{data.reject_reason}</Alert>}
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <Card title={data.level === 'business' ? 'Entreprise' : 'Identité'}><Fields data={data.data} /></Card>
        <div className="stack">
          <Card title="Compte marchand" actions={<Link to={`/admin/marchands/${data.merchant.id}`} className="small">Fiche →</Link>}>
            <dl className="dl">
              <dt>Nom</dt><dd>{data.merchant.name}</dd>
              <dt>E-mail</dt><dd>{data.merchant.emails.join(', ')}</dd>
              <dt>Profil</dt><dd>{ACCOUNT_TYPE[data.merchant.account_type]}</dd>
              <dt>Niveau actuel</dt><dd><LevelBadge level={data.merchant.verification_level} /></dd>
              <dt>Inscrit le</dt><dd>{formatDate(data.merchant.created_at)}</dd>
            </dl>
          </Card>
          {representative && <Card title="Dirigeant / représentant"><Fields data={representative} /></Card>}
        </div>
      </div>
      <Card title="Documents" subtitle="Chaque consultation est enregistrée dans le journal d'audit.">
        <div className="docs">
          {data.documents.map((d) => (
            <a key={d.id} className="doc" href={`/api/admin/kyc/documents/${d.id}`} target="_blank" rel="noreferrer">
              {d.mime_type === 'application/pdf'
                ? <div className="doc-pdf">PDF</div>
                : <img src={`/api/admin/kyc/documents/${d.id}`} alt={d.label} loading="lazy" />}
              <div><strong>{d.label}</strong><span className="muted">{d.file_name} · {Math.round(d.size / 1024)} Ko</span></div>
            </a>
          ))}
        </div>
      </Card>
      {data.history.length > 0 && (
        <Card title="Dossiers précédents">
          <div className="stack-sm">
            {data.history.map((h) => (
              <div key={h.id} className="row-between">
                <span>{formatDate(h.submitted_at)} · {h.level === 'business' ? 'Entreprise' : 'Particulier'} {h.reject_reason && <span className="muted">— {h.reject_reason}</span>}</span>
                <Badge status={h.status} />
              </div>
            ))}
          </div>
        </Card>
      )}
      {rejecting && <RejectModal id={data.id} onClose={() => setRejecting(false)} onDone={() => { setRejecting(false); navigate('/admin/verifications'); }} />}
    </>
  );
}

function RejectModal({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const { run, pending, error } = useAction(async () => {
    await api(`/admin/kyc/${id}/reject`, { body: { reason } });
    onDone();
  });
  return (
    <Modal title="Refuser le dossier" onClose={onClose}>
      <p className="muted">Le motif est envoyé au marchand : sois précis sur ce qu&apos;il doit corriger.</p>
      <form className="form" onSubmit={(e) => { e.preventDefault(); void run(); }}>
        <Field label="Motif"><Textarea required minLength={3} maxLength={500} placeholder="Ex. : le selfie est flou, merci d'en envoyer un nouveau où le visage et la pièce sont lisibles." value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        {error && <Alert>{error}</Alert>}
        <Button type="submit" variant="danger" loading={pending}>Refuser le dossier</Button>
      </form>
    </Modal>
  );
}
