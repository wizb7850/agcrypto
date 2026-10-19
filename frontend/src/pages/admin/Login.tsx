import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { api } from '../../api/client';
import { useAdmin } from '../../auth/session';
import { Alert, Button, Field, Input } from '../../components/ui';
import { useAction } from '../../hooks/useApi';
import { AuthLayout } from '../../layouts/AuthLayout';

export default function AdminLogin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { reload } = useAdmin();
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/admin';
  const { run, pending, error } = useAction(async () => {
    await api('/auth/admin/login', { body: { email, password } });
    await reload();
    navigate(from, { replace: true });
  });

  return (
    <AuthLayout admin>
      <div>
        <h1>Back-office</h1>
        <p className="muted">Connexion réservée à l&apos;équipe agcrypto.</p>
      </div>
      <form className="form" onSubmit={(e) => { e.preventDefault(); void run(); }}>
        <Field label="E-mail"><Input type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Mot de passe"><Input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        {error && <Alert>{error}</Alert>}
        <Button type="submit" block loading={pending}>Se connecter</Button>
      </form>
      <p className="small muted">Pas de compte ? Le propriétaire de la plateforme crée les accès depuis l&apos;onglet Équipe.</p>
    </AuthLayout>
  );
}
