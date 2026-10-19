import { useState } from 'react';
import { api } from '../../api/client';
import type { ApiKey, Settings } from '../../api/types';
import { useMerchant, usePublicInfo } from '../../auth/session';
import { Alert, Badge, Button, Card, Copy, Empty, Field, Input, Loading, Modal, PageHeader } from '../../components/ui';
import { useAction, useApi } from '../../hooks/useApi';
import { formatDate } from '../../lib/format';

export default function Integration() {
  const info = usePublicInfo();
  const apiBase = info?.api_base_url ?? 'https://api.agcrypto.com';
  return (
    <>
      <PageHeader title="Intégration API" subtitle="Connecte ton site : crée des factures par l'API et reçois les notifications de paiement." />
      <ApiKeys />
      <Webhook />
      <Card title="Démarrage rapide" subtitle="Créer une facture depuis ton serveur, puis rediriger le client vers checkout_url."
        actions={<a className="btn btn-secondary btn-sm" href={`${apiBase}/docs`} target="_blank" rel="noreferrer">Documentation complète ↗</a>}>
        <div className="stack">
          <pre className="code">{`curl -X POST ${apiBase}/v1/invoices \\
  -H "Authorization: Bearer agc_TA_CLE_API" \\
  -H "Content-Type: application/json" \\
  -d '{"amount":"49.99","currency":"EUR","order_id":"CMD-1042",
       "success_url":"https://ma-boutique.com/merci"}'`}</pre>
          <p className="small muted">Vérification d&apos;un webhook (Node.js) : refuse toute notification dont la signature est invalide ou trop ancienne.</p>
          <pre className="code">{`import crypto from 'node:crypto';

function verifyAgcrypto(rawBody, header, secret) {
  const { t, v1 } = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false; // plus de 5 minutes
  const expected = crypto.createHmac('sha256', secret).update(\`\${t}.\${rawBody}\`).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1));
}
// en-tête : x-agcrypto-signature — événements : invoice.paid, invoice.confirming,
// invoice.expired, withdrawal.completed, withdrawal.rejected…`}</pre>
        </div>
      </Card>
    </>
  );
}

function ApiKeys() {
  const { me } = useMerchant();
  const { data, error, reload } = useApi<{ api_keys: ApiKey[] }>('/v1/api-keys');
  const [name, setName] = useState('');
  const [created, setCreated] = useState<{ key: string; name: string | null } | null>(null);
  const create = useAction(async () => {
    setCreated(await api<{ key: string; name: string | null }>('/v1/api-keys', { body: { name: name || undefined } }));
    setName('');
    void reload();
  });
  const revoke = useAction(async (k: ApiKey) => {
    if (!window.confirm(`Révoquer la clé ${k.name ?? k.prefix} ? Les appels utilisant cette clé échoueront immédiatement.`)) return;
    await api(`/v1/api-keys/${k.id}`, { method: 'DELETE' });
    void reload();
  });

  return (
    <Card title="Clés API" subtitle="À garder secrètes, sur ton serveur uniquement (jamais dans le code d'une page web)." padded={false}>
      <div className="card-body">
        <form className="row" onSubmit={(e) => { e.preventDefault(); void create.run(); }}>
          <div className="grow"><Input placeholder="Nom de la clé (ex. Site principal)" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} /></div>
          <Button type="submit" loading={create.pending} disabled={me!.merchant.status !== 'active'}>Créer une clé</Button>
        </form>
        {(create.error || revoke.error || error) && <div style={{ marginTop: 12 }}><Alert>{create.error ?? revoke.error ?? error?.message}</Alert></div>}
      </div>
      {!data ? <Loading /> : data.api_keys.length === 0 ? <Empty>Aucune clé : crée ta première clé pour connecter ton site.</Empty> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Nom</th><th>Clé</th><th>Créée le</th><th>Statut</th><th /></tr></thead>
            <tbody>
              {data.api_keys.map((k) => (
                <tr key={k.id}>
                  <td>{k.name ?? <span className="muted">Sans nom</span>}</td>
                  <td><code>{k.prefix}…</code></td>
                  <td className="num">{formatDate(k.created_at)}</td>
                  <td>{k.revoked_at ? <Badge status="rejected" /> : <span className="badge badge-success">Active</span>}</td>
                  <td style={{ textAlign: 'right' }}>{!k.revoked_at && <Button variant="danger-outline" size="sm" onClick={() => void revoke.run(k)}>Révoquer</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {created && (
        <Modal title="Nouvelle clé API" onClose={() => setCreated(null)}>
          <Alert tone="warning" title="Copie cette clé maintenant">Elle ne sera plus jamais affichée. En cas de perte, révoque-la et crée-en une nouvelle.</Alert>
          <Copy value={created.key} />
          <Button onClick={() => setCreated(null)}>J&apos;ai copié la clé</Button>
        </Modal>
      )}
    </Card>
  );
}

function Webhook() {
  const { data, reload } = useApi<Settings>('/v1/settings');
  const [url, setUrl] = useState<string | null>(null);
  const [reveal, setReveal] = useState(false);
  const [saved, setSaved] = useState(false);
  const value = url ?? data?.webhook_url ?? '';
  const save = useAction(async () => {
    await api('/v1/settings', { method: 'PUT', body: { webhook_url: value.trim() || null } });
    setSaved(true);
    void reload();
  });
  const rotate = useAction(async () => {
    if (!window.confirm('Générer un nouveau secret ? L\'ancien cessera immédiatement de fonctionner : pense à mettre à jour ton site.')) return;
    await api('/v1/settings/webhook-secret', { method: 'POST' });
    setReveal(true);
    void reload();
  });

  if (!data) return <Card title="Webhook"><Loading /></Card>;
  return (
    <Card title="Webhook" subtitle="Ton serveur reçoit une notification signée à chaque changement de statut (paiement reçu, retrait envoyé…).">
      <div className="stack">
        <form className="row" onSubmit={(e) => { e.preventDefault(); void save.run(); }}>
          <div className="grow">
            <Input type="url" placeholder="https://ma-boutique.com/webhooks/agcrypto" value={value} onChange={(e) => { setUrl(e.target.value); setSaved(false); }} />
          </div>
          <Button type="submit" variant="secondary" loading={save.pending}>Enregistrer</Button>
        </form>
        {save.error && <Alert>{save.error}</Alert>}
        {saved && !save.error && <Alert tone="success">URL enregistrée.</Alert>}
        <Field label="Secret de signature" hint="Sert à vérifier que les notifications viennent bien d'agcrypto (en-tête x-agcrypto-signature).">
          <div className="row">
            {reveal ? <Copy value={data.webhook_secret} /> : <code className="muted">whsec_••••••••••••••••</code>}
            <Button variant="ghost" size="sm" onClick={() => setReveal(!reveal)}>{reveal ? 'Masquer' : 'Afficher'}</Button>
            <Button variant="danger-outline" size="sm" loading={rotate.pending} onClick={() => void rotate.run()}>Régénérer</Button>
          </div>
        </Field>
        {rotate.error && <Alert>{rotate.error}</Alert>}
      </div>
    </Card>
  );
}
