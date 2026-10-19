import { useState } from 'react';
import { api } from '../../api/client';
import { useAdmin } from '../../auth/session';
import { Alert, Button, Card, Copy, Field, Input, Loading, Modal, PageHeader, Select } from '../../components/ui';
import { useAction, useApi } from '../../hooks/useApi';
import { formatDate } from '../../lib/format';

interface Member { id: string; email: string; role: string; disabled: boolean; created_at: string }
interface TeamData { members: Member[]; roles: { id: string; label: string }[] }

export default function Team() {
  const { me } = useAdmin();
  const { data, error, reload } = useApi<TeamData>('/admin/team');
  const [form, setForm] = useState({ email: '', role: 'support' });
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);
  const add = useAction(async () => {
    setCreated(await api<{ email: string; password: string }>('/admin/team', { body: form }));
    setForm({ email: '', role: 'support' });
    void reload();
  });
  const update = useAction(async (id: string, body: { role?: string; disabled?: boolean }) => {
    await api(`/admin/team/${id}`, { method: 'PUT', body });
    void reload();
  });

  return (
    <>
      <PageHeader title="Équipe" subtitle="Chaque membre a son propre compte et un rôle qui limite ce qu'il peut faire." />
      {error && <Alert>{error.message}</Alert>}
      {!data ? <Loading /> : (
        <>
          <Card title="Ajouter un membre">
            <form className="row" onSubmit={(e) => { e.preventDefault(); void add.run(); }} style={{ alignItems: 'flex-end' }}>
              <div className="grow"><Field label="E-mail"><Input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field></div>
              <div style={{ minWidth: 260 }}>
                <Field label="Rôle">
                  <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                    {data.roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                  </Select>
                </Field>
              </div>
              <Button type="submit" loading={add.pending}>Ajouter</Button>
            </form>
            {add.error && <div style={{ marginTop: 12 }}><Alert>{add.error}</Alert></div>}
          </Card>
          <Card title="Membres" padded={false}>
            {update.error && <div className="card-body"><Alert>{update.error}</Alert></div>}
            <div className="table-wrap">
              <table>
                <thead><tr><th>E-mail</th><th>Rôle</th><th>Statut</th><th>Ajouté le</th><th /></tr></thead>
                <tbody>
                  {data.members.map((m) => {
                    const self = m.id === me!.id;
                    return (
                      <tr key={m.id}>
                        <td>{m.email} {self && <span className="badge badge-brand">Toi</span>}</td>
                        <td>
                          <Select style={{ width: 240 }} value={m.role} disabled={self || update.pending}
                            onChange={(e) => void update.run(m.id, { role: e.target.value })}>
                            {data.roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                          </Select>
                        </td>
                        <td>{m.disabled ? <span className="badge badge-danger">Désactivé</span> : <span className="badge badge-success">Actif</span>}</td>
                        <td className="num">{formatDate(m.created_at)}</td>
                        <td style={{ textAlign: 'right' }}>
                          {!self && (
                            <Button variant={m.disabled ? 'secondary' : 'danger-outline'} size="sm"
                              onClick={() => void update.run(m.id, { disabled: !m.disabled })}>
                              {m.disabled ? 'Réactiver' : 'Désactiver'}
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
      {created && (
        <Modal title="Membre ajouté" onClose={() => setCreated(null)}>
          <Alert tone="warning" title="Transmets ces accès de façon sécurisée">Le mot de passe ne sera plus affiché.</Alert>
          <dl className="dl">
            <dt>E-mail</dt><dd>{created.email}</dd>
            <dt>Mot de passe</dt><dd><Copy value={created.password} /></dd>
            <dt>Connexion</dt><dd>{window.location.origin}/admin/connexion</dd>
          </dl>
          <Button onClick={() => setCreated(null)}>Terminé</Button>
        </Modal>
      )}
    </>
  );
}
