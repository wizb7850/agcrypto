import { useEffect, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { LEVEL, STATUS } from '../lib/format';
import type { Level } from '../api/types';

// Composants d'interface réutilisés par toutes les pages. Le style est dans styles/app.css.

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-outline';

export function Button({ variant = 'primary', size, block, loading, children, className = '', ...props }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm'; block?: boolean; loading?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || loading}
      className={`btn btn-${variant} ${size ? `btn-${size}` : ''} ${block ? 'btn-block' : ''} ${className}`}
    >
      {loading && <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />}
      {children}
    </button>
  );
}

export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  // L'aide est en dehors de l'étiquette : le nom lu par les lecteurs d'écran reste court et exact.
  return (
    <div className="field">
      <label>
        <span>{label}</span>
        {children}
      </label>
      {hint && <small>{hint}</small>}
    </div>
  );
}

export const Input = (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} className={`input ${props.className ?? ''}`} />;
export const Select = (props: SelectHTMLAttributes<HTMLSelectElement>) => <select {...props} className={`input ${props.className ?? ''}`} />;
export const Textarea = (props: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...props} className={`input ${props.className ?? ''}`} />;

export function Card({ title, subtitle, actions, children, padded = true }:
  { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; padded?: boolean }) {
  return (
    <section className="card">
      {(title || actions) && (
        <header className="card-head">
          <div>
            {title && <h2>{title}</h2>}
            {subtitle && <p>{subtitle}</p>}
          </div>
          {actions && <div className="row">{actions}</div>}
        </header>
      )}
      {padded ? <div className="card-body">{children}</div> : children}
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}

export function Stat({ label, value, hint, href }: { label: string; value: ReactNode; hint?: ReactNode; href?: string }) {
  const body = (
    <>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {hint && <span className="stat-hint">{hint}</span>}
    </>
  );
  return href ? <a className="stat" href={href}>{body}</a> : <div className="stat">{body}</div>;
}

export function Badge({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, tone: 'neutral' };
  return <span className={`badge badge-${s.tone}`}>{s.label}</span>;
}

export function LevelBadge({ level }: { level: Level }) {
  const l = LEVEL[level];
  return <span className={`badge badge-${l.tone}`}>{l.label}</span>;
}

export function Alert({ tone = 'danger', title, children }: { tone?: 'danger' | 'success' | 'warning' | 'info'; title?: ReactNode; children?: ReactNode }) {
  return (
    <div className={`alert alert-${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <div>
        {title && <strong>{title}</strong>}
        {children}
      </div>
    </div>
  );
}

export function Copy({ value, short, label }: { value: string; short?: boolean; label?: string }) {
  const [done, setDone] = useState(false);
  const text = short && value.length > 20 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;
  return (
    <button
      type="button"
      className="copy"
      title={value}
      onClick={async (e) => {
        e.stopPropagation();
        await navigator.clipboard.writeText(value);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {label ? <span className="copy-label">{done ? 'Copié ✓' : label}</span> : <>
        <code>{text}</code>
        <span className="copy-icon">{done ? 'Copié ✓' : 'Copier'}</span>
      </>}
    </button>
  );
}

export function Loading({ full }: { full?: boolean }) {
  return <div className="loading" style={full ? { minHeight: '100vh' } : undefined}><div className="spinner" /></div>;
}

export const Empty = ({ children }: { children: ReactNode }) => <div className="empty">{children}</div>;

export function Tabs<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={value === o.value}
          className={value === o.value ? 'tab active' : 'tab'} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({ title, onClose, wide, children }: { title: ReactNode; onClose: () => void; wide?: boolean; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" aria-label="Fermer" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function Progress({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 100;
  return (
    <div className={`progress ${pct >= 100 ? 'full' : pct >= 80 ? 'high' : ''}`} role="progressbar" aria-valuenow={Math.round(pct)}>
      <div style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Pagination simple « précédent / suivant ». */
export function Pager({ total, limit, offset, onChange }: { total: number; limit: number; offset: number; onChange: (offset: number) => void }) {
  if (total <= limit) return null;
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.ceil(total / limit);
  return (
    <div className="pager">
      <span>{total} résultats · page {page} / {pages}</span>
      <div className="row">
        <Button variant="secondary" size="sm" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>Précédent</Button>
        <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => onChange(offset + limit)}>Suivant</Button>
      </div>
    </div>
  );
}
