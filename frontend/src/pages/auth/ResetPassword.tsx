import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api } from '../../api/client';
import { Alert, Button, Field, Input } from '../../components/ui';
import { useAction } from '../../hooks/useApi';
import { AuthLayout } from '../../layouts/AuthLayout';

export default function ResetPassword() {
  const token = useSearchParams()[0].get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);
  const { run, pending, error } = useAction(async () => {
    if (password !== confirm) throw new Error('Les deux mots de passe ne correspondent pas');
    await api('/auth/merchant/password/reset', { body: { token, password } });
    setDone(true);
  });

  return (
    <AuthLayout>
      <div>
        <h1>Nouveau mot de passe</h1>
        <p className="muted">Toutes tes sessions ouvertes seront déconnectées.</p>
      </div>
      {!token && <Alert>Lien incomplet : ouvre le lien reçu par e-mail.</Alert>}
      {done ? (
        <Alert tone="success" title="Mot de passe modifié">
          <span><Link to="/connexion">Se connecter avec le nouveau mot de passe →</Link></span>
        </Alert>
      ) : (
        <form className="form" onSubmit={(e) => { e.preventDefault(); void run(); }}>
          <Field label="Nouveau mot de passe" hint="10 caractères minimum">
            <Input type="password" required minLength={10} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Field label="Confirmation">
            <Input type="password" required minLength={10} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
          {error && <Alert>{error}</Alert>}
          <Button type="submit" block loading={pending} disabled={!token}>Enregistrer</Button>
        </form>
      )}
    </AuthLayout>
  );
}
