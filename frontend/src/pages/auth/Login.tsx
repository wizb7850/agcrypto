import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { api } from '../../api/client';
import { useMerchant } from '../../auth/session';
import { Alert, Button, Field, Input } from '../../components/ui';
import { useAction } from '../../hooks/useApi';
import { AuthLayout } from '../../layouts/AuthLayout';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { reload } = useMerchant();
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/app';

  const { run, pending, error } = useAction(async () => {
    await api('/auth/merchant/login', { body: { email, password } });
    await reload();
    navigate(from, { replace: true });
  });

  return (
    <AuthLayout>
      <div>
        <h1>Connexion</h1>
        <p className="muted">Accède à ton espace marchand.</p>
      </div>
      <form className="form" onSubmit={(e) => { e.preventDefault(); void run(); }}>
        <Field label="E-mail">
          <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label={<span className="row-between">Mot de passe <Link to="/mot-de-passe-oublie" className="small">Mot de passe oublié ?</Link></span>}>
          <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error && <Alert>{error}</Alert>}
        <Button type="submit" block loading={pending}>Se connecter</Button>
      </form>
      <p className="muted">Pas encore de compte ? <Link to="/inscription">Créer un compte</Link></p>
    </AuthLayout>
  );
}
