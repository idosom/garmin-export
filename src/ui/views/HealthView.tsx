import { useMemo, useState } from 'react';
import { useDataset } from '../../state/dataset.tsx';
import { useFormatters } from '../format.ts';
import { Card, EmptyState, Segmented, Badge } from '../components/primitives.tsx';
import { LineChart } from '../charts/LineChart.tsx';
import { BarChart } from '../charts/BarChart.tsx';
import { Sparkline } from '../charts/Sparkline.tsx';
import { metricSeries, type MetricSeries } from '../../analytics/index.ts';
import { dayKeyToMs, localDayKey } from '../../core/time.ts';
import { formatByKind, joinFormatted } from '../../core/units.ts';
import { seriesColor } from '../charts/chartUtils.ts';
import { rollingMean } from '../../core/stats.ts';
import { wellnessMeta } from '../../core/metrics.ts';

type RangeKey = '30' | '90' | '365' | 'all';

const GROUP_LABELS: Record<string, string> = {
  sleep: 'Sleep',
  heart: 'Heart',
  stress: 'Stress & Body Battery',
  activity: 'Daily activity',
  body: 'Body composition',
  other: 'Other metrics',
};

export function HealthView() {
  const { dataset, metrics } = useDataset();
  const fmt = useFormatters();
  const [range, setRange] = useState<RangeKey>('90');
  const [selected, setSelected] = useState<string | null>(null);

  const bounds = useMemo(() => {
    if (!dataset.daily.length) return undefined;
    const dates = dataset.daily.map((d) => d.date).sort();
    const last = dates[dates.length - 1];
    if (range === 'all') return { from: dates[0], to: last };
    const to = last;
    const from = localDayKey(dayKeyToMs(last) - Number(range) * 86400000);
    return { from: from < dates[0] ? dates[0] : from, to };
  }, [dataset.daily, range]);

  const allSeries = useMemo(
    () => metrics.map((meta) => metricSeries(dataset.daily, meta.key, bounds)).filter((s) => s.points.length > 0),
    [metrics, dataset.daily, bounds],
  );

  const featuredKey = selected ?? allSeries.find((s) => s.points.length > 2)?.meta.key ?? allSeries[0]?.meta.key;
  const featured = allSeries.find((s) => s.meta.key === featuredKey);

  const sleepStages = useMemo(() => buildSleepStages(dataset.daily, bounds), [dataset.daily, bounds]);

  if (!dataset.daily.length) {
    return (
      <Card>
        <EmptyState
          title="No wellness data found"
          description="Sleep, stress, steps, HRV, Body Battery and weight come from the wellness files in a Garmin export (FIT monitoring files, the JSON files under DI_CONNECT, or Connect's CSV reports). None were present in what you uploaded."
        />
      </Card>
    );
  }

  const grouped = new Map<string, MetricSeries[]>();
  for (const series of allSeries) {
    const list = grouped.get(series.meta.group) ?? [];
    list.push(series);
    grouped.set(series.meta.group, list);
  }

  return (
    <>
      <div className="toolbar">
        <Segmented
          ariaLabel="Date range"
          value={range}
          onChange={setRange}
          options={[
            { value: '30', label: '30 days' },
            { value: '90', label: '90 days' },
            { value: '365', label: '1 year' },
            { value: 'all', label: 'All' },
          ]}
        />
        <span className="spacer" />
        <Badge>{allSeries.length} metrics available</Badge>
        {bounds && (
          <Badge>
            {bounds.from} → {bounds.to}
          </Badge>
        )}
      </div>

      {featured && (
        <Card
          title={featured.meta.label}
          note={`${featured.points.length} days recorded${featured.coverage < 0.9 ? ` · ${Math.round(featured.coverage * 100)}% coverage` : ''}`}
          actions={
            <select
              className="input"
              style={{ padding: '3px 24px 3px 8px', fontSize: 12 }}
              value={featuredKey}
              onChange={(e) => setSelected(e.target.value)}
              aria-label="Choose the metric to chart"
            >
              {allSeries.map((series) => (
                <option key={series.meta.key} value={series.meta.key}>
                  {series.meta.label}
                </option>
              ))}
            </select>
          }
        >
          <FeaturedChart series={featured} unitSystem={fmt.units} />
          <div className="grid grid-stats" style={{ marginTop: 12, gap: 10 }}>
            <SmallStat label="Latest" value={format(featured.latest?.value, featured, fmt.units)} />
            <SmallStat label="Average" value={format(featured.average, featured, fmt.units)} />
            <SmallStat label="Lowest" value={format(featured.min, featured, fmt.units)} />
            <SmallStat label="Highest" value={format(featured.max, featured, fmt.units)} />
            {featured.trendPerMonth !== undefined && (
              <SmallStat
                label="Trend"
                value={`${featured.trendPerMonth >= 0 ? '+' : '−'}${format(Math.abs(featured.trendPerMonth), featured, fmt.units)} / month`}
                tone={
                  featured.meta.better
                    ? (featured.meta.better === 'up') === (featured.trendPerMonth > 0)
                      ? 'good'
                      : 'bad'
                    : undefined
                }
              />
            )}
          </div>
        </Card>
      )}

      {sleepStages.length > 2 && (
        <Card title="Sleep composition" note="stacked stages per night">
          <BarChart
            height={230}
            data={sleepStages}
            formatValue={(v) => fmt.duration(v)}
            formatY={(v) => `${(v / 3600).toFixed(0)}h`}
            ariaLabel="Sleep stages per night"
          />
        </Card>
      )}

      {[...grouped.entries()].map(([group, series]) => (
        <Card key={group} title={GROUP_LABELS[group] ?? group} note={`${series.length} metric${series.length === 1 ? '' : 's'}`} padded={false}>
          <div className="metric-grid">
            {series.map((item, i) => (
              <button
                key={item.meta.key}
                type="button"
                className="metric-cell"
                style={{ textAlign: 'left', border: 'none', cursor: 'pointer' }}
                onClick={() => setSelected(item.meta.key)}
                aria-pressed={item.meta.key === featuredKey}
              >
                <span className="k">{item.meta.label}</span>
                <span className="v">{format(item.latest?.value, item, fmt.units)}</span>
                <Sparkline
                  points={item.points.map((p) => ({ x: dayKeyToMs(p.date), y: p.value }))}
                  color={seriesColor(i % 8)}
                  width={132}
                  height={26}
                />
                <span className="k">
                  avg {format(item.average, item, fmt.units)} · {item.points.length} days
                </span>
              </button>
            ))}
          </div>
        </Card>
      ))}
    </>
  );
}

function FeaturedChart({ series, unitSystem }: { series: MetricSeries; unitSystem: 'metric' | 'imperial' }) {
  const points = series.points.map((p) => ({ x: dayKeyToMs(p.date), y: p.value }));
  const smoothed = rollingMean(series.points.map((p) => p.value), 7);
  const format = (value: number) => joinFormatted(formatByKind(value, series.meta.kind, unitSystem, series.meta.decimals));

  return (
    <LineChart
      height={260}
      xType="time"
      formatY={(value) => formatByKind(value, series.meta.kind, unitSystem, series.meta.decimals).value}
      series={[
        {
          key: series.meta.key,
          label: series.meta.label,
          points,
          color: seriesColor(0),
          area: true,
          width: points.length > 200 ? 1.4 : 2,
          format,
        },
        ...(points.length > 10
          ? [
              {
                key: 'avg7',
                label: '7-day average',
                points: series.points.map((p, i) => ({ x: dayKeyToMs(p.date), y: smoothed[i] })),
                color: seriesColor(1),
                format,
              },
            ]
          : []),
      ]}
      ariaLabel={`${series.meta.label} over time`}
    />
  );
}

function SmallStat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="card stat" style={{ padding: '10px 12px' }}>
      <span className="stat-label">{label}</span>
      <span className="stat-value num" style={{ fontSize: 18, color: tone === 'good' ? 'var(--good-text)' : tone === 'bad' ? 'var(--critical)' : undefined }}>
        {value}
      </span>
    </div>
  );
}

function format(value: number | undefined, series: MetricSeries, units: 'metric' | 'imperial' = 'metric'): string {
  if (value === undefined) return '—';
  return joinFormatted(formatByKind(value, series.meta.kind, units, series.meta.decimals));
}

const SLEEP_STAGES = [
  { key: 'sleepDeep', label: 'Deep', slot: 6 },
  { key: 'sleepRem', label: 'REM', slot: 0 },
  { key: 'sleepLight', label: 'Light', slot: 2 },
  { key: 'sleepAwake', label: 'Awake', slot: 3 },
];

function buildSleepStages(daily: { date: string; values: Record<string, number> }[], bounds?: { from: string; to: string }) {
  const rows = daily
    .filter((day) => (!bounds || (day.date >= bounds.from && day.date <= bounds.to)) && SLEEP_STAGES.some((s) => day.values[s.key] !== undefined))
    .slice(-120);
  return rows.map((day) => ({
    key: day.date,
    label: new Date(dayKeyToMs(day.date)).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    segments: SLEEP_STAGES.filter((stage) => day.values[stage.key] !== undefined).map((stage) => ({
      key: stage.key,
      label: stage.label,
      value: day.values[stage.key],
      color: seriesColor(stage.slot),
    })),
    detail:
      day.values.sleepScore !== undefined
        ? [{ label: wellnessMeta('sleepScore').label, value: String(Math.round(day.values.sleepScore)) }]
        : undefined,
  }));
}
