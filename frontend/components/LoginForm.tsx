'use client';

import { useState } from 'react';
import { api, session, type Role } from '@/lib/api';
import { Alert } from './ui';

/** Connexion par clé : vérifie la clé auprès du backend avant de l'enregistrer. */
export function LoginForm({ role, title, label, hint, checkPath, onLogin }: {
  role: Role; title: string; label: string; hint: string; checkPath: string; onLogin: () => void;
}) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api(role, checkPath, { token: value.trim() });
      session.set(role, value.trim());
      onLogin();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="center">
      <form className="card login" onSubmit={submit}>
        <h1>{title}</h1>
        <label>
          {label}
          <input type="password" autoComplete="off" required value={value} onChange={(e) => setValue(e.target.value)} />
        </label>
        <p className="muted small">{hint}</p>
        {error && <Alert>{error}</Alert>}
        <button className="btn btn-primary" disabled={loading || !value}>{loading ? 'Vérification…' : 'Se connecter'}</button>
      </form>
    </main>
  );
}
