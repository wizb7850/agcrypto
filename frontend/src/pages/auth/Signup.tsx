import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../../api/client';
import type { AccountType } from '../../api/types';
import { useMerchant, usePublicInfo } from '../../auth/session';
import { Alert, Button, Field, Input } from '../../components/ui';
import { useAction } from '../../hooks/useApi';
import { formatUsd } from '../../lib/format';
import { AuthLayout } from '../../layouts/AuthLayout';

export default function Signup() {
  const [type, setType] = useState<AccountType>('business');
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' });
  const [accepted, setAccepted] = useState(false);
  const { reload } = useMerchant();
  const info = usePublicInfo();
  const navigate = useNavigate();

  const { run, pending, error, setError } = useAction(async () => {
    if (form.password !== form.confirm) throw new Error('Les deux mots de passe ne correspondent pas');
    await api('/auth/merchant/signup', { body: { account_type: type, name: form.name, email: form.email, password: form.password } });
    await reload();
    navigate('/verifier-email', { replace: true });
  });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => { setError(null); setForm({ ...form, [k]: e.target.value }); };

  return (
    <AuthLayout>
      <div>
        <h1>Créer un compte</h1>
        <p className="muted">Choisis le profil qui te correspond.</p>
      </div>
      <div className="choices">
        <button type="button" className={`choice ${type === 'business' ? 'selected' : ''}`} onClick={() => setType('business')}>
          <strong>Entreprise</strong>
          <span className="muted">Société, boutique en ligne, association. Aucune limite après vérification de l&apos;entreprise.</span>
        </button>
        <button type="button" className={`choice ${type === 'personal' ? 'selected' : ''}`} onClick={() => setType('personal')}>
          <strong>Particulier</strong>
          <span className="muted">
            Activité individuelle. Après vérification d&apos;identité :
            {info ? ` ${formatUsd(info.limits.personal_receive_usd_30d)} / mois, retraits ${formatUsd(info.limits.personal_withdraw_usd_24h)} / jour.` : ' limites mensuelles.'}
          </span>
        </button>
      </div>
      <form className="form" onSubmit={(e) => { e.preventDefault(); void run(); }}>
        <Field label={type === 'business' ? 'Nom de l\'entreprise' : 'Nom et prénom'}>
          <Input required minLength={2} maxLength={100} autoComplete={type === 'business' ? 'organization' : 'name'} value={form.name} onChange={set('name')} />
        </Field>
        <Field label="E-mail">
          <Input type="email" required autoComplete="email" value={form.email} onChange={set('email')} />
        </Field>
        <div className="grid-2">
          <Field label="Mot de passe" hint="10 caractères minimum">
            <Input type="password" required minLength={10} autoComplete="new-password" value={form.password} onChange={set('password')} />
          </Field>
          <Field label="Confirmation">
            <Input type="password" required minLength={10} autoComplete="new-password" value={form.confirm} onChange={set('confirm')} />
          </Field>
        </div>
        <label className="check">
          <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
          <span>J&apos;accepte les conditions d&apos;utilisation et la politique de confidentialité, et je confirme ne pas utiliser le service pour des activités illégales.</span>
        </label>
        {error && <Alert>{error}</Alert>}
        <Button type="submit" block loading={pending} disabled={!accepted}>Créer mon compte</Button>
      </form>
      <p className="muted">Déjà inscrit ? <Link to="/connexion">Se connecter</Link></p>
    </AuthLayout>
  );
}
