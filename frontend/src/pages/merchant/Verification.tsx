import { useRef, useState } from 'react';
import { api } from '../../api/client';
import type { Level, UploadedDocument, VerificationStatus } from '../../api/types';
import { useMerchant, usePublicInfo } from '../../auth/session';
import { LimitsCard } from '../../components/LimitsCard';
import { Alert, Button, Card, Field, Input, Loading, PageHeader, Select } from '../../components/ui';
import { useAction, useApi } from '../../hooks/useApi';
import { formatDate, formatUsd } from '../../lib/format';

type Kind = 'personal' | 'business';
const ID_TYPES = [
  { value: 'id_card', label: 'Carte d\'identité' },
  { value: 'passport', label: 'Passeport' },
  { value: 'driving_license', label: 'Permis de conduire' },
];

export default function Verification() {
  const { data, error, reload } = useApi<VerificationStatus>('/v1/verification');
  const { reload: reloadSession } = useMerchant();

  if (error) return <Alert>{error.message}</Alert>;
  if (!data) return <Loading />;
  const latest = data.latest_submission;
  const pending = latest?.status === 'pending';
  const canSubmit = !pending && data.level !== 'business';

  return (
    <>
      <PageHeader title="Vérification du compte" subtitle="Obligatoire pour retirer tes fonds. Tes documents sont stockés de façon sécurisée et ne sont vus que par notre équipe conformité." />
      <LevelsOverview current={data.level} />
      {pending && (
        <Alert tone="info" title="Dossier en cours d'examen">
          Envoyé le {formatDate(latest.submitted_at)}. Notre équipe le vérifie généralement sous 24 à 48 h ouvrées ; tu recevras un e-mail.
        </Alert>
      )}
      {latest?.status === 'rejected' && (
        <Alert title="Dossier à corriger">
          <span>Motif : {latest.reject_reason}</span>
          <span>Corrige les éléments concernés et renvoie ton dossier ci-dessous.</span>
        </Alert>
      )}
      {data.level === 'business' && <Alert tone="success" title="Compte professionnel vérifié">Ton compte n&apos;a aucune limite d&apos;encaissement ni de retrait.</Alert>}
      <div className="grid-2" style={{ alignItems: 'start' }}>
        {canSubmit
          ? <SubmissionForm status={data} onSubmitted={() => { void reload(); void reloadSession(); }} />
          : <LimitsCard limits={data.limits} />}
        {canSubmit && <LimitsCard limits={data.limits} />}
      </div>
    </>
  );
}

function LevelsOverview({ current }: { current: Level }) {
  const info = usePublicInfo();
  const l = info?.limits;
  const levels: { id: Level; title: string; items: string[] }[] = [
    { id: 'none', title: 'Non vérifié', items: [`Encaissement jusqu'à ${l ? formatUsd(l.unverified_receive_usd) : '…'} au total`, 'Retraits bloqués'] },
    { id: 'personal', title: 'Particulier vérifié', items: [
      `Encaissement ${l ? formatUsd(l.personal_receive_usd_30d) : '…'} / 30 jours`,
      `Retraits ${l ? formatUsd(l.personal_withdraw_usd_24h) : '…'} / 24 h`, 'Pièce d\'identité + selfie + justificatif de domicile'] },
    { id: 'business', title: 'Entreprise vérifiée', items: ['Encaissement illimité', 'Retraits illimités', 'Documents de l\'entreprise + identité du dirigeant'] },
  ];
  return (
    <div className="levels">
      {levels.map((lv) => (
        <div key={lv.id} className={`level ${lv.id === current ? 'current' : ''}`}>
          <div className="row-between"><strong>{lv.title}</strong>{lv.id === current && <span className="badge badge-brand">Ton niveau</span>}</div>
          <ul>{lv.items.map((i) => <li key={i}>{i}</li>)}</ul>
        </div>
      ))}
    </div>
  );
}

const emptyPerson = { first_name: '', last_name: '', birth_date: '', nationality: '', id_type: 'id_card', id_number: '' };
const emptyAddress = { country: '', city: '', address: '', postal_code: '' };

function SubmissionForm({ status, onSubmitted }: { status: VerificationStatus; onSubmitted: () => void }) {
  // Un compte particulier déjà vérifié ne peut que passer en entreprise
  const initial: Kind = status.level === 'personal' ? 'business' : status.account_type;
  const [kind, setKind] = useState<Kind>(initial);
  const [person, setPerson] = useState({ ...emptyPerson, ...emptyAddress });
  const [company, setCompany] = useState({ company_name: '', registration_number: '', website: '', activity: '', ...emptyAddress });
  const [rep, setRep] = useState({ ...emptyPerson, role: '' });
  const [docs, setDocs] = useState<Record<string, UploadedDocument>>({});

  const idType = kind === 'personal' ? person.id_type : rep.id_type;
  const required = status.requirements[kind].documents.filter((d) => !(idType === 'passport' && d.endsWith('id_back')));
  const optional = status.requirements[kind].optional_documents;
  const missing = required.filter((d) => !docs[d]);

  const { run, pending, error } = useAction(async () => {
    const strip = <T extends Record<string, string>>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v.trim() !== ''));
    const data = kind === 'personal' ? strip(person) : { ...strip(company), representative: strip(rep) };
    await api('/v1/verification/submissions', {
      body: { level: kind, data, document_ids: [...required, ...optional].map((k) => docs[k]?.id).filter(Boolean) },
    });
    onSubmitted();
  });

  // Relie un champ de formulaire à une clé de l'état (les PersonFields/AddressFields passent la clé en texte)
  const bind = <T extends Record<string, string>>(state: T, set: (v: T) => void, key: string) => ({
    value: state[key] ?? '',
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => set({ ...state, [key]: e.target.value }),
  });

  return (
    <Card title={status.level === 'personal' ? 'Passer en compte professionnel' : 'Envoyer mon dossier'}
      subtitle="Les informations doivent correspondre exactement à tes documents.">
      <form className="form" onSubmit={(e) => { e.preventDefault(); void run(); }}>
        {status.level === 'none' && (
          <div className="choices">
            <button type="button" className={`choice ${kind === 'personal' ? 'selected' : ''}`} onClick={() => { setKind('personal'); setDocs({}); }}>
              <strong>Particulier</strong><span className="muted">Vérification d&apos;identité (KYC)</span>
            </button>
            <button type="button" className={`choice ${kind === 'business' ? 'selected' : ''}`} onClick={() => { setKind('business'); setDocs({}); }}>
              <strong>Entreprise</strong><span className="muted">Vérification de l&apos;entreprise (KYB)</span>
            </button>
          </div>
        )}

        {kind === 'personal' ? (
          <fieldset className="fieldset">
            <legend>Identité</legend>
            <PersonFields state={person} bind={(k) => bind(person, setPerson, k)} />
            <AddressFields bind={(k) => bind(person, setPerson, k)} />
          </fieldset>
        ) : (
          <>
            <fieldset className="fieldset">
              <legend>Entreprise</legend>
              <div className="grid-2">
                <Field label="Raison sociale"><Input required {...bind(company, setCompany, 'company_name')} /></Field>
                <Field label="N° d'immatriculation (RCCM, SIREN…)"><Input required {...bind(company, setCompany, 'registration_number')} /></Field>
              </div>
              <Field label="Activité" hint="Ce que vend l'entreprise, en quelques mots."><Input required minLength={3} {...bind(company, setCompany, 'activity')} /></Field>
              <Field label="Site web (facultatif)"><Input type="url" placeholder="https://" {...bind(company, setCompany, 'website')} /></Field>
              <AddressFields bind={(k) => bind(company, setCompany, k)} />
            </fieldset>
            <fieldset className="fieldset">
              <legend>Dirigeant ou représentant légal</legend>
              <PersonFields state={rep} bind={(k) => bind(rep, setRep, k)} />
              <Field label="Fonction"><Input required placeholder="Gérant, Président…" {...bind(rep, setRep, 'role')} /></Field>
            </fieldset>
          </>
        )}

        <fieldset className="fieldset">
          <legend>Documents</legend>
          <p className="small muted">JPG, PNG, WEBP ou PDF, 10 Mo maximum, lisibles et en couleur.</p>
          <div className="uploads">
            {[...required, ...optional].map((k) => (
              <DocumentUpload key={`${kind}-${k}`} kind={k} label={status.document_kinds[k] ?? k} optional={optional.includes(k)}
                doc={docs[k]} onUploaded={(d) => setDocs((prev) => ({ ...prev, [k]: d }))} />
            ))}
          </div>
        </fieldset>

        {error && <Alert>{error}</Alert>}
        <Button type="submit" loading={pending} disabled={missing.length > 0}>
          {missing.length > 0 ? `Encore ${missing.length} document${missing.length > 1 ? 's' : ''} à envoyer` : 'Envoyer mon dossier'}
        </Button>
      </form>
    </Card>
  );
}

type Bind = (key: string) => { value: string; onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void };

function PersonFields({ state, bind }: { state: { id_type: string }; bind: Bind }) {
  return (
    <>
      <div className="grid-2">
        <Field label="Prénom"><Input required autoComplete="given-name" {...bind('first_name')} /></Field>
        <Field label="Nom"><Input required autoComplete="family-name" {...bind('last_name')} /></Field>
      </div>
      <div className="grid-2">
        <Field label="Date de naissance"><Input type="date" required {...bind('birth_date')} /></Field>
        <Field label="Nationalité"><Input required {...bind('nationality')} /></Field>
      </div>
      <div className="grid-2">
        <Field label="Pièce d'identité">
          <Select {...bind('id_type')}>{ID_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</Select>
        </Field>
        <Field label={state.id_type === 'passport' ? 'N° du passeport' : 'N° de la pièce'}><Input required {...bind('id_number')} /></Field>
      </div>
    </>
  );
}

function AddressFields({ bind }: { bind: Bind }) {
  return (
    <>
      <Field label="Adresse"><Input required autoComplete="street-address" {...bind('address')} /></Field>
      <div className="grid-3">
        <Field label="Ville"><Input required autoComplete="address-level2" {...bind('city')} /></Field>
        <Field label="Code postal"><Input autoComplete="postal-code" {...bind('postal_code')} /></Field>
        <Field label="Pays"><Input required autoComplete="country-name" {...bind('country')} /></Field>
      </div>
    </>
  );
}

function DocumentUpload({ kind, label, optional, doc, onUploaded }: {
  kind: string; label: string; optional: boolean; doc?: UploadedDocument; onUploaded: (d: UploadedDocument) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const { run, pending, error } = useAction(async (file: File) => {
    const form = new FormData();
    form.append('file', file);
    onUploaded(await api<UploadedDocument>(`/v1/verification/documents?kind=${kind}`, { form }));
  });
  return (
    <div className={`upload ${doc ? 'done' : ''}`}>
      <div className="grow">
        <strong>{label}{optional && <span className="muted"> (facultatif)</span>}</strong>
        <span className="small muted">{error ? <span style={{ color: 'var(--danger)' }}>{error}</span> : doc ? `✓ ${doc.file_name}` : 'Aucun fichier'}</span>
      </div>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,application/pdf"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void run(f); e.target.value = ''; }} />
      <Button variant="secondary" size="sm" loading={pending} onClick={() => input.current?.click()}>{doc ? 'Remplacer' : 'Choisir'}</Button>
    </div>
  );
}
