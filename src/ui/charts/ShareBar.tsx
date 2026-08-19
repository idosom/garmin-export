import { seriesColor } from './chartUtils.ts';

export interface ShareItem {
  key: string;
  label: string;
  value: number;
  color?: string;
  detail?: string;
}

export interface ShareBarProps {
  items: ShareItem[];
  formatValue?: (value: number) => string;
  emptyMessage?: string;
}

/**
 * A stacked share bar plus a labelled list. Preferred over a pie: the list
 * carries the actual numbers, so identity never depends on colour alone.
 */
export function ShareBar({ items, formatValue, emptyMessage = 'No data' }: ShareBarProps) {
  const total = items.reduce((sum, item) => sum + Math.max(0, item.value), 0);
  if (!total) return <p className="muted">{emptyMessage}</p>;

  return (
    <div>
      <div style={{ display: 'flex', gap: 2, height: 12, borderRadius: 6, overflow: 'hidden' }}>
        {items.map((item, i) => (
          <div
            key={item.key}
            title={`${item.label} — ${((item.value / total) * 100).toFixed(1)}%`}
            style={{
              width: `${(item.value / total) * 100}%`,
              background: item.color ?? seriesColor(i),
              minWidth: item.value > 0 ? 3 : 0,
            }}
          />
        ))}
      </div>
      <ul style={{ listStyle: 'none', margin: '12px 0 0', padding: 0, display: 'grid', gap: 7 }}>
        {items.map((item, i) => (
          <li key={item.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <span className="swatch" style={{ background: item.color ?? seriesColor(i) }} />
            <span style={{ color: 'var(--text-primary)' }}>{item.label}</span>
            {item.detail && <span className="muted" style={{ fontSize: 12 }}>{item.detail}</span>}
            <span className="num" style={{ marginLeft: 'auto', color: 'var(--text-secondary)' }}>
              {formatValue ? formatValue(item.value) : item.value.toLocaleString()}
            </span>
            <span className="num muted" style={{ width: 44, textAlign: 'right' }}>
              {((item.value / total) * 100).toFixed(0)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
