import { useMemo, useState } from 'react';
import { addDays, daysBetween, weekStart } from '../../core/time.ts';

export interface HeatmapValue {
  date: string;
  value: number;
  tooltip: string;
}

export interface ActivityHeatmapProps {
  values: HeatmapValue[];
  from: string;
  to: string;
  /** Sequential ramp; the lightest step means "near zero". */
  hue?: 'blue' | 'orange';
  cell?: number;
  onSelect?: (date: string) => void;
  emptyMessage?: string;
}

const BLUE = ['#cde2fb', '#9ec5f4', '#5598e7', '#2a78d6', '#184f95'];
const ORANGE = ['#fbdccd', '#f5b394', '#ef8a5c', '#e0662f', '#a8481d'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** GitHub-style day grid: one column per week, one row per weekday. */
export function ActivityHeatmap({ values, from, to, hue = 'blue', cell = 12, onSelect, emptyMessage }: ActivityHeatmapProps) {
  const [hovered, setHovered] = useState<{ x: number; y: number; text: string } | null>(null);

  const { weeks, byDate, max, monthLabels } = useMemo(() => {
    const byDate = new Map(values.map((v) => [v.date, v]));
    const start = weekStart(from);
    const totalDays = Math.max(0, daysBetween(start, to)) + 1;
    const weekCount = Math.ceil(totalDays / 7);
    const weeks: string[][] = [];
    const monthLabels: { index: number; label: string }[] = [];
    let lastMonth = '';
    for (let w = 0; w < weekCount; w++) {
      const days: string[] = [];
      for (let d = 0; d < 7; d++) days.push(addDays(start, w * 7 + d));
      weeks.push(days);
      const month = days[0].slice(0, 7);
      if (month !== lastMonth) {
        monthLabels.push({ index: w, label: MONTHS[Number(days[0].slice(5, 7)) - 1] });
        lastMonth = month;
      }
    }
    const max = values.reduce((m, v) => Math.max(m, v.value), 0);
    return { weeks, byDate, max, monthLabels };
  }, [values, from, to]);

  if (!values.length) return <p className="muted">{emptyMessage ?? 'No activity in this range'}</p>;

  const ramp = hue === 'orange' ? ORANGE : BLUE;
  const gap = 3;
  const width = weeks.length * (cell + gap);

  return (
    <div style={{ position: 'relative', overflowX: 'auto' }}>
      <svg width={Math.max(width, 10)} height={7 * (cell + gap) + 18} role="img" aria-label="Activity calendar heatmap">
        {monthLabels.map((m) => (
          <text key={`${m.index}-${m.label}`} x={m.index * (cell + gap)} y={9} fontSize={10} fill="var(--text-muted)">
            {m.label}
          </text>
        ))}
        {weeks.map((days, w) =>
          days.map((date, d) => {
            const entry = byDate.get(date);
            const level = entry && max > 0 ? Math.min(ramp.length - 1, Math.floor((entry.value / max) * ramp.length)) : -1;
            const inRange = date >= from && date <= to;
            return (
              <rect
                key={date}
                x={w * (cell + gap)}
                y={16 + d * (cell + gap)}
                width={cell}
                height={cell}
                rx={2.5}
                fill={level >= 0 ? ramp[level] : 'var(--surface-sunken)'}
                opacity={inRange ? 1 : 0.25}
                style={{ cursor: entry && onSelect ? 'pointer' : 'default' }}
                onPointerEnter={(event) => {
                  const rect = (event.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                  setHovered({
                    x: event.clientX - rect.left,
                    y: event.clientY - rect.top,
                    text: entry?.tooltip ?? `${date} — no activity`,
                  });
                }}
                onPointerLeave={() => setHovered(null)}
                onClick={() => entry && onSelect?.(date)}
              />
            );
          }),
        )}
      </svg>
      {hovered && (
        <div className="chart-tooltip" style={{ left: hovered.x, top: hovered.y - 4 }}>
          {hovered.text}
        </div>
      )}
      <div className="legend" style={{ justifyContent: 'flex-end', gap: 6 }}>
        <span className="muted" style={{ fontSize: 11 }}>Less</span>
        {ramp.map((c) => (
          <span key={c} className="swatch" style={{ background: c, width: 10, height: 10 }} />
        ))}
        <span className="muted" style={{ fontSize: 11 }}>More</span>
      </div>
    </div>
  );
}
