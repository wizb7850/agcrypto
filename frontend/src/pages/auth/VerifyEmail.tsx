import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { api } from '../../api/client';
import { useMerchant, usePublicInfo } from '../../auth/session';
import { Alert, Button, Field, Input, Loading } from '../../components/ui';
import { useAction } from '../../hooks/useApi';
import { AuthLayout } from '../../layouts/AuthLayout';

export default function VerifyEmail() {
  const { me, loading, reload, logout } = useMerchant();
  const info = usePublicInfo();
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown(cooldown - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const verify = useAction(async () => {
    await api('/auth/merchant/verify-email', { body: { code } });
    await reload();
    navigate('/app', { replace: true });
  });
  const resend = useAction(async () => {
    await api('/auth/merchant/resend-verification', { method: 'POST' });
    setSent(true);
    setCooldown(60);
  });

  if (loading) return <Loading full />;
  if (!me) return <Navigate to="/connexion" replace />;
  if (me.user.email_verified) return <Navigate to="/app" replace />;

  return (
    <AuthLayout>
      <div>
        <h1>Vérifie ton e-mail</h1>
        <p className="muted">Nous avons envoyé un code à 6 chiffres à <strong>{me.user.email}</strong>. Il est valable 30 minutes.</p>
      </div>
      {info?.dev_mailbox_url && (
        <Alert tone="info">En local, les e-mails arrivent dans la boîte de test : <a href={info.dev_mailbox_url} target="_blank" rel="noreferrer">{info.dev_mailbox_url}</a></Alert>
      )}
      <form className="form" onSubmit={(e) => { e.preventDefault(); void verify.run(); }}>
        <Field label="Code de vérification">
          <Input className="input-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required autoFocus
            value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
        </Field>
        {verify.error && <Alert>{verify.error}</Alert>}
        {resend.error && <Alert>{resend.error}</Alert>}
        {sent && !resend.error && <Alert tone="success">Nouveau code envoyé.</Alert>}
        <Button type="submit" block loading={verify.pending} disabled={code.length !== 6}>Valider</Button>
      </form>
      <div className="row-between">
        <button type="button" className="link-btn" disabled={cooldown > 0 || resend.pending} onClick={() => void resend.run()}>
          {cooldown > 0 ? `Renvoyer le code (${cooldown} s)` : 'Renvoyer le code'}
        </button>
        <button type="button" className="link-btn" onClick={async () => { await logout(); navigate('/connexion'); }}>Changer de compte</button>
      </div>
    </AuthLayout>
  );
}
