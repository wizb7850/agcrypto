import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../../api/client';
import { Alert, Button, Field, Input } from '../../components/ui';
import { useAction } from '../../hooks/useApi';
import { AuthLayout } from '../../layouts/AuthLayout';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(false);
  const { run, pending, error } = useAction(async () => {
    await api('/auth/merchant/password/forgot', { body: { email } });
    setDone(true);
  });

  return (
    <AuthLayout>
      <div>
        <h1>Mot de passe oublié</h1>
        <p className="muted">Indique ton e-mail : tu recevras un lien pour choisir un nouveau mot de passe.</p>
      </div>
      {done ? (
        <Alert tone="success" title="Demande envoyée">
          Si un compte existe pour {email}, un e-mail vient d&apos;être envoyé. Le lien est valable 1 heure.
        </Alert>
      ) : (
        <form className="form" onSubmit={(e) => { e.preventDefault(); void run(); }}>
          <Field label="E-mail">
            <Input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          {error && <Alert>{error}</Alert>}
          <Button type="submit" block loading={pending}>Envoyer le lien</Button>
        </form>
      )}
      <p className="muted"><Link to="/connexion">← Retour à la connexion</Link></p>
    </AuthLayout>
  );
}
