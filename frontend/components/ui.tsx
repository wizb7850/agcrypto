'use client';

import { useState, type ReactNode } from 'react';
import { STATUS } from '@/lib/format';

export function Badge({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, tone: 'neutral' as const };
  return <span className={`badge badge-${s.tone}`}>{s.label}</span>;
}

export function Card({ title, action, children }: { title?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      {(title || action) && (
        <header className="card-head">
          {title && <h2>{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Alert({ tone = 'danger', children }: { tone?: 'danger' | 'success' | 'info'; children: ReactNode }) {
  return <div className={`alert alert-${tone}`} role="alert">{children}</div>;
}

export function Copy({ value, short }: { value: string; short?: boolean }) {
  const [done, setDone] = useState(false);
  const text = short && value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
  return (
    <button
      type="button"
      className="copy"
      title={value}
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      <code>{text}</code>
      <span>{done ? '✓' : '⧉'}</span>
    </button>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}
