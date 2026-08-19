import type { ReactNode } from 'react';
import { IconAlert, IconInfo } from './icons.tsx';
import { Sparkline } from '../charts/Sparkline.tsx';
import type { PathPoint } from '../charts/chartUtils.ts';

export function Card({
  title,
  note,
  actions,
  children,
  padded = true,
  className,
}: {
  title?: ReactNode;
  note?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  padded?: boolean;
  className?: string;
}) {
  return (
    <section className={`card${className ? ` ${className}` : ''}`}>
      {(title || actions) && (
        <header className="card-header">
          {title && <h2 className="card-title">{title}</h2>}
          {note && <span className="card-note">{note}</span>}
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      <div className={padded ? 'card-body' : ''}>{children}</div>
    </section>
  );
}

export function Stat({
  label,
  value,
  unit,
  sub,
  delta,
  spark,
  sparkColor,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  sub?: ReactNode;
  delta?: { value: string; direction: 'up' | 'down' | 'flat' };
  spark?: PathPoint[];
  sparkColor?: string;
}) {
  return (
    <div className="card stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value num">
        {value}
        {unit && <span className="unit">{unit}</span>}
      </span>
      {(sub || delta) && (
        <span className="stat-sub">
          {delta && (
            <span className={`delta ${delta.direction}`}>
              {delta.direction === 'up' ? '↑' : delta.direction === 'down' ? '↓' : '→'} {delta.value}
            </span>
          )}
          {delta && sub ? ' · ' : ''}
          {sub}
        </span>
      )}
      {spark && spark.length > 2 && (
        <span className="stat-spark">
          <Sparkline points={spark} color={sparkColor} width={140} height={28} />
        </span>
      )}
    </div>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button key={option.value} type="button" aria-pressed={value === option.value} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({ title, description, icon, action }: { title: string; description?: ReactNode; icon?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon ?? <IconInfo size={20} />}</div>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}

export function Alert({ kind = 'info', children }: { kind?: 'info' | 'warn' | 'error'; children: ReactNode }) {
  return (
    <div className={`alert ${kind}`} role={kind === 'error' ? 'alert' : undefined}>
      <span className="alert-icon">{kind === 'info' ? <IconInfo size={15} /> : <IconAlert size={15} />}</span>
      <div>{children}</div>
    </div>
  );
}

export function Badge({ children, tone }: { children: ReactNode; tone?: 'accent' | 'good' | 'warn' | 'bad' }) {
  return <span className={`badge${tone ? ` ${tone}` : ''}`}>{children}</span>;
}

/** A value that may be absent — never renders a misleading zero. */
export function Value({ text, unit }: { text: string | undefined; unit?: string }) {
  if (text === undefined || text === '—') return <span className="dash">—</span>;
  return (
    <span className="num">
      {text}
      {unit ? <span className="unit"> {unit}</span> : null}
    </span>
  );
}
