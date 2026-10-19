import { useState } from 'react';
import { api } from '../../api/client';
import type { Settings as SettingsData } from '../../api/types';
import { useMerchant } from '../../auth/session';
import { Alert, Button, Card, Field, Input, LevelBadge, PageHeader } from '../../components/ui';
import { useAction, useApi } from '../../hooks/useApi';
import { ACCOUNT_TYPE, cryptoLabel, formatAmount, formatDay } from '../../lib/format';

export default function Settings() {
  const { me, reload } = useMerchant();
  const { data } = useApi<SettingsData>('/v1/settings');
  const m = me!.merchant;
  const [form, setForm] = useState({ current: '', next: '', confirm: '' });
  const [done, setDone] = useState(false);
  const change = useAction(async () => {
    if (form.next !== form.confirm) throw new Error('Les deux mots de passe ne correspondent pas');
    await api('/auth/merchant/password/change', { body: { current_password: form.current, new_password: form.next } });
    setForm({ current: '', next: '', confirm: '' });
    setDone(true);
    void reload();
  });

  return (
    <>
      <PageHeader title="Paramètres" />
      <div className="grid-2">
        <Card title="Compte">
          <dl className="dl">
            <dt>Nom</dt><dd>{m.name}</dd>
            <dt>E-mail</dt><dd>{me!.user.email}</dd>
            <dt>Profil</dt><dd>{ACCOUNT_TYPE[m.account_type]}</dd>
            <dt>Vérification</dt><dd><LevelBadge level={m.verification_level} /></dd>
            <dt>Membre depuis</dt><dd>{formatDay(m.created_at)}</dd>
            <dt>Identifiant</dt><dd><code>{m.id}</code></dd>
          </dl>
        </Card>
        <Card title="Changer de mot de passe" subtitle="Toutes tes autres sessions seront déconnectées.">
          <form className="form" onSubmit={(e) => { e.preventDefault(); void change.run(); }}>
            <Field label="Mot de passe actuel">
              <Input type="password" required autoComplete="current-password" value={form.current} onChange={(e) => setForm({ ...form, current: e.target.value })} />
            </Field>
            <Field label="Nouveau mot de passe" hint="10 caractères minimum">
              <Input type="password" required minLength={10} autoComplete="new-password" value={form.next} onChange={(e) => setForm({ ...form, next: e.target.value })} />
            </Field>
            <Field label="Confirmation">
              <Input type="password" required minLength={10} autoComplete="new-password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} />
            </Field>
            {change.error && <Alert>{change.error}</Alert>}
            {done && <Alert tone="success">Mot de passe modifié.</Alert>}
            <Button type="submit" loading={change.pending}>Enregistrer</Button>
          </form>
        </Card>
      </div>
      {data && (
        <Card title="Tarifs" subtitle="Frais appliqués à ton compte.">
          <dl className="dl">
            <dt>Paiement reçu</dt><dd>{formatAmount(data.fees.payment_percent)} % du montant reçu</dd>
            <dt>Retrait</dt>
            <dd>
              {formatAmount(data.fees.withdrawal_percent)} % du montant
              {Object.keys(data.fees.withdrawal_fixed).length > 0 && (
                <> + frais réseau fixes : {Object.entries(data.fees.withdrawal_fixed).map(([c, v]) => `${formatAmount(v)} ${cryptoLabel(c)}`).join(' · ')}</>
              )}
            </dd>
            <dt>Cryptos acceptées</dt><dd>{data.checkout_currencies.map(cryptoLabel).join(', ')}</dd>
          </dl>
        </Card>
      )}
    </>
  );
}
