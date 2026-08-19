import { useMemo, useState } from 'react';
import { useDataset } from '../../state/dataset.tsx';
import { useFormatters, activityTitle, activityDuration } from '../format.ts';
import { Card, EmptyState, Badge, Segmented } from '../components/primitives.tsx';
import { SportIcon, IconChevronRight } from '../components/icons.tsx';
import { sportMeta } from '../../core/metrics.ts';
import { seriesColor } from '../charts/chartUtils.ts';
import { dayKeyToMs, isoDay, viewerDayKey } from '../../core/time.ts';
import { formatByKind } from '../../core/units.ts';
import type { Activity } from '../../core/types.ts';

const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export function CalendarView({ onOpenActivity }: { onOpenActivity: (activity: Activity) => void }) {
  const { dataset, days, metrics, overview } = useDataset();
  const fmt = useFormatters();
  const [overlay, setOverlay] = useState<string>('none');
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const overlayOptions = useMemo(
    () => metrics.filter((m) => ['sleepDuration', 'restingHr', 'steps', 'bodyBatteryMax', 'stressAvg', 'hrv', 'weight'].includes(m.key)),
    [metrics],
  );

  const dailyByDate = useMemo(() => new Map(dataset.daily.map((d) => [d.date, d])), [dataset.daily]);

  const { months, maxDuration, overlayRange } = useMemo(() => {
    const dates: string[] = [];
    for (const key of days.keys()) dates.push(key);
    for (const record of dataset.daily) dates.push(record.date);
    if (!dates.length) return { months: [], maxDuration: 0, overlayRange: undefined };
    dates.sort();
    const first = dates[0];
    const last = dates[dates.length - 1];

    const months: { key: string; year: number; month: number }[] = [];
    let year = Number(first.slice(0, 4));
    let month = Number(first.slice(5, 7));
    const endYear = Number(last.slice(0, 4));
    const endMonth = Number(last.slice(5, 7));
    for (let guard = 0; guard < 600; guard++) {
      months.push({ key: `${year}-${String(month).padStart(2, '0')}`, year, month });
      if (year === endYear && month === endMonth) break;
      month += 1;
      if (month > 12) {
        month = 1;
        year += 1;
      }
    }

    let maxDuration = 0;
    for (const bucket of days.values()) maxDuration = Math.max(maxDuration, bucket.duration);

    let overlayRange: { min: number; max: number } | undefined;
    if (overlay !== 'none') {
      let min = Infinity;
      let max = -Infinity;
      for (const record of dataset.daily) {
        const value = record.values[overlay];
        if (value === undefined || !Number.isFinite(value)) continue;
        min = Math.min(min, value);
        max = Math.max(max, value);
      }
      if (Number.isFinite(min) && max > min) overlayRange = { min, max };
    }

    return { months: months.reverse(), maxDuration, overlayRange };
  }, [days, dataset.daily, overlay]);

  if (!months.length) {
    return (
      <Card>
        <EmptyState title="Nothing to show on a calendar" description="No activities or wellness days were found in this export." />
      </Card>
    );
  }

  const selectedBucket = selectedDay ? days.get(selectedDay) : undefined;
  const selectedWellness = selectedDay ? dailyByDate.get(selectedDay) : undefined;
  const today = viewerDayKey(Date.now());

  return (
    <>
      <div className="toolbar">
        <Segmented
          ariaLabel="Wellness overlay"
          value={overlay === 'none' ? 'none' : 'metric'}
          onChange={(value) => setOverlay(value === 'none' ? 'none' : (overlayOptions[0]?.key ?? 'none'))}
          options={[
            { value: 'none', label: 'Training only' },
            { value: 'metric', label: 'With wellness' },
          ]}
        />
        {overlay !== 'none' && overlayOptions.length > 0 && (
          <select className="input" value={overlay} onChange={(e) => setOverlay(e.target.value)} aria-label="Overlay metric">
            {overlayOptions.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        )}
        <span className="spacer" />
        <Badge>{days.size} active days</Badge>
        <Badge>{dataset.daily.length} wellness days</Badge>
      </div>

      {selectedDay && (
        <Card
          title={new Date(dayKeyToMs(selectedDay)).toLocaleDateString(undefined, {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}
          actions={
            <button type="button" className="btn small ghost" onClick={() => setSelectedDay(null)}>
              Clear
            </button>
          }
        >
          {selectedBucket ? (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
              {selectedBucket.activities.map((activity) => {
                const meta = sportMeta(activity.sport);
                return (
                  <li key={activity.id}>
                    <button
                      type="button"
                      className="btn"
                      style={{ width: '100%', justifyContent: 'flex-start', gap: 10 }}
                      onClick={() => onOpenActivity(activity)}
                    >
                      <span style={{ color: seriesColor(meta.slot), display: 'flex' }}>
                        <SportIcon icon={meta.icon} size={16} />
                      </span>
                      <span>{activityTitle(activity)}</span>
                      <span className="muted num" style={{ marginLeft: 'auto' }}>
                        {fmt.duration(activityDuration(activity))}
                        {activity.distance ? ` · ${fmt.distance(activity.distance)}` : ''}
                      </span>
                      <IconChevronRight size={14} className="muted" />
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="muted" style={{ fontSize: 13 }}>No activities recorded on this day.</p>
          )}

          {selectedWellness && (
            <div className="metric-grid" style={{ marginTop: 12 }}>
              {Object.entries(selectedWellness.values)
                .slice(0, 12)
                .map(([key, value]) => {
                  const meta = metrics.find((m) => m.key === key);
                  if (!meta) return null;
                  const formatted = formatByKind(value, meta.kind, fmt.units, meta.decimals);
                  return (
                    <div className="metric-cell" key={key}>
                      <span className="k">{meta.label}</span>
                      <span className="v">
                        {formatted.value}
                        {formatted.unit ? <span className="unit"> {formatted.unit}</span> : null}
                      </span>
                    </div>
                  );
                })}
            </div>
          )}
        </Card>
      )}

      <Card
        title="Calendar"
        note="hue = sport, depth = training time; the bar under a day shows the wellness metric"
        actions={
          <span className="legend" style={{ padding: 0 }}>
            {overview.sports.slice(0, 6).map((sport) => (
              <span className="legend-item" key={sport.sport}>
                <span className="swatch" style={{ background: seriesColor(sportMeta(sport.sport).slot) }} />
                {sport.label}
              </span>
            ))}
          </span>
        }
      >
        <div className="calendar-months">
          {months.slice(0, 24).map((month) => (
            <div className="calendar-month" key={month.key}>
              <h3>
                {new Date(Date.UTC(month.year, month.month - 1, 1)).toLocaleDateString(undefined, {
                  month: 'long',
                  year: 'numeric',
                })}
              </h3>
              <div className="calendar-grid">
                {DOW.map((label, i) => (
                  <div className="calendar-dow" key={`${label}-${i}`}>
                    {label}
                  </div>
                ))}
                {monthCells(month.year, month.month).map((cell, i) => {
                  if (!cell) return <div key={`empty-${i}`} />;
                  const bucket = days.get(cell);
                  const intensity = bucket && maxDuration ? Math.min(1, bucket.duration / maxDuration) : 0;
                  const sport = bucket?.sports[0];
                  const background = bucket
                    ? `color-mix(in srgb, ${seriesColor(sport ? sportMeta(sport).slot : 0)} ${Math.round(30 + intensity * 70)}%, var(--surface-sunken))`
                    : undefined;
                  const wellnessValue = overlayRange ? dailyByDate.get(cell)?.values[overlay] : undefined;
                  return (
                    <button
                      key={cell}
                      type="button"
                      className={`calendar-day${bucket ? ' has-activity' : ''}${cell === today ? ' today' : ''}`}
                      style={background ? { background, color: intensity > 0.55 ? '#fff' : 'var(--text-primary)' } : undefined}
                      onClick={() => setSelectedDay(cell === selectedDay ? null : cell)}
                      title={dayTooltip(cell, bucket, wellnessValue, overlay, metrics, fmt.units)}
                      aria-label={dayTooltip(cell, bucket, wellnessValue, overlay, metrics, fmt.units)}
                    >
                      {Number(cell.slice(8, 10))}
                      {wellnessValue !== undefined && overlayRange && (
                        <span
                          className="wellness-dot"
                          style={{
                            background: seriesColor(3),
                            opacity: 0.35 + 0.65 * ((wellnessValue - overlayRange.min) / (overlayRange.max - overlayRange.min)),
                          }}
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        {months.length > 24 && (
          <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
            Showing the most recent 24 months of {months.length}.
          </p>
        )}
      </Card>
    </>
  );
}

function monthCells(year: number, month: number): (string | null)[] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const leading = (first.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: (string | null)[] = new Array(leading).fill(null);
  for (let day = 1; day <= daysInMonth; day++) cells.push(isoDay(year, month, day));
  return cells;
}

function dayTooltip(
  date: string,
  bucket: { count: number; duration: number; distance: number } | undefined,
  wellnessValue: number | undefined,
  overlay: string,
  metrics: { key: string; label: string; kind: Parameters<typeof formatByKind>[1]; decimals?: number }[],
  units: 'metric' | 'imperial',
): string {
  const parts = [date];
  if (bucket) {
    parts.push(`${bucket.count} activit${bucket.count === 1 ? 'y' : 'ies'}`);
    parts.push(`${Math.round(bucket.duration / 60)} min`);
  } else {
    parts.push('rest day');
  }
  if (wellnessValue !== undefined) {
    const meta = metrics.find((m) => m.key === overlay);
    if (meta) {
      const formatted = formatByKind(wellnessValue, meta.kind, units, meta.decimals);
      parts.push(`${meta.label}: ${formatted.value}${formatted.unit ? ` ${formatted.unit}` : ''}`);
    }
  }
  return parts.join(' · ');
}
