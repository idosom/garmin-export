import { useMemo, useState } from 'react';
import { useDataset } from '../../state/dataset.tsx';
import { useFormatters } from '../format.ts';
import { Card, EmptyState, Segmented, Badge, Alert } from '../components/primitives.tsx';
import { BarChart } from '../charts/BarChart.tsx';
import { LineChart } from '../charts/LineChart.tsx';
import { ShareBar } from '../charts/ShareBar.tsx';
import { ActivityHeatmap } from '../charts/ActivityHeatmap.tsx';
import { IconTrophy } from '../components/icons.tsx';
import { sportMeta } from '../../core/metrics.ts';
import { seriesColor } from '../charts/chartUtils.ts';
import { dayKeyToMs } from '../../core/time.ts';
import { formatClock, formatDate } from '../../core/units.ts';
import { bestDistanceEfforts, bestPowerEfforts, activityHighlights } from '../../analytics/records.ts';
import type { Activity } from '../../core/types.ts';

type Grouping = 'week' | 'month';
type Measure = 'duration' | 'distance' | 'load';

export function TrainingView({ onOpenActivity }: { onOpenActivity: (activity: Activity) => void }) {
  const { dataset, training, overview } = useDataset();
  const fmt = useFormatters();
  const [grouping, setGrouping] = useState<Grouping>('week');
  const [measure, setMeasure] = useState<Measure>('duration');

  const buckets = grouping === 'week' ? training.weekly : training.monthly;

  const distanceEfforts = useMemo(() => bestDistanceEfforts(dataset.activities), [dataset.activities]);
  const powerEfforts = useMemo(() => bestPowerEfforts(dataset.activities), [dataset.activities]);
  const highlights = useMemo(() => activityHighlights(dataset.activities), [dataset.activities]);
  const byId = useMemo(() => new Map(dataset.activities.map((a) => [a.id, a])), [dataset.activities]);

  if (!dataset.activities.length) {
    return (
      <Card>
        <EmptyState
          title="No training data"
          description="Training analysis needs activity files. Wellness-only exports still show everything in Health & wellness."
        />
      </Card>
    );
  }

  const measureValue = (bucket: (typeof buckets)[number], sport?: string) => {
    if (sport) {
      const entry = bucket.bySport[sport];
      if (!entry) return 0;
      return measure === 'distance' ? entry.distance : entry.duration;
    }
    return measure === 'distance' ? bucket.distance : measure === 'load' ? bucket.load : bucket.duration;
  };

  const formatMeasure = (value: number) =>
    measure === 'distance' ? fmt.distance(value) : measure === 'load' ? Math.round(value).toString() : fmt.hours(value);

  const recent = buckets.slice(-(grouping === 'week' ? 26 : 24));
  const acwr = training.acuteChronicRatio;

  return (
    <>
      <div className="toolbar">
        <Segmented
          ariaLabel="Group by"
          value={grouping}
          onChange={setGrouping}
          options={[
            { value: 'week', label: 'Weekly' },
            { value: 'month', label: 'Monthly' },
          ]}
        />
        <Segmented
          ariaLabel="Measure"
          value={measure}
          onChange={setMeasure}
          options={[
            { value: 'duration', label: 'Time' },
            { value: 'distance', label: 'Distance' },
            { value: 'load', label: 'Load' },
          ]}
        />
        <span className="spacer" />
        {acwr !== undefined && (
          <Badge tone={acwr > 1.5 ? 'bad' : acwr < 0.8 ? 'warn' : 'good'}>
            Acute:chronic {acwr.toFixed(2)}
          </Badge>
        )}
        <Badge>{training.model.label}</Badge>
      </div>

      <Card
        title={`${grouping === 'week' ? 'Weekly' : 'Monthly'} training volume`}
        note={measure === 'load' ? training.model.description : 'stacked by sport'}
      >
        <BarChart
          height={280}
          data={recent.map((bucket) => ({
            key: bucket.key,
            label:
              grouping === 'week'
                ? new Date(dayKeyToMs(bucket.start)).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                : new Date(dayKeyToMs(bucket.start)).toLocaleDateString(undefined, { month: 'short', year: '2-digit' }),
            segments:
              measure === 'load'
                ? [{ key: 'load', label: training.model.label, value: bucket.load, color: seriesColor(0) }]
                : Object.keys(bucket.bySport).map((sport) => ({
                    key: sport,
                    label: sportMeta(sport).label,
                    value: measureValue(bucket, sport),
                    color: seriesColor(sportMeta(sport).slot),
                  })),
            detail: [
              { label: 'Activities', value: String(bucket.count) },
              ...(measure !== 'duration' ? [{ label: 'Time', value: fmt.hours(bucket.duration) }] : []),
              ...(measure !== 'distance' && bucket.distance ? [{ label: 'Distance', value: fmt.distance(bucket.distance) }] : []),
            ],
          }))}
          formatValue={formatMeasure}
          formatY={(v) => (measure === 'distance' ? fmt.distanceParts(v).value : measure === 'load' ? String(Math.round(v)) : `${Math.round(v / 3600)}h`)}
          ariaLabel="Training volume"
        />
      </Card>

      <div className="grid grid-2">
        <Card title="Sport distribution" note="whole export, by moving time">
          <ShareBar
            items={overview.sports.map((sport) => ({
              key: sport.sport,
              label: sport.label,
              value: sport.duration,
              color: seriesColor(sportMeta(sport.sport).slot),
              detail: sport.distance > 0 ? fmt.distance(sport.distance) : `${sport.count} sessions`,
            }))}
            formatValue={(v) => fmt.hours(v)}
          />
        </Card>

        <Card title="Training load" note={training.model.description}>
          {training.load && training.load.dates.length > 7 ? (
            <>
              <LineChart
                height={240}
                xType="time"
                series={[
                  {
                    key: 'ctl',
                    label: 'Fitness (42-day)',
                    color: seriesColor(0),
                    area: true,
                    points: training.load.dates.map((date, i) => ({ x: dayKeyToMs(date), y: training.load!.ctl[i] })),
                    format: (v) => v.toFixed(0),
                  },
                  {
                    key: 'atl',
                    label: 'Fatigue (7-day)',
                    color: seriesColor(1),
                    points: training.load.dates.map((date, i) => ({ x: dayKeyToMs(date), y: training.load!.atl[i] })),
                    format: (v) => v.toFixed(0),
                  },
                  {
                    key: 'tsb',
                    label: 'Form',
                    color: seriesColor(2),
                    dashed: true,
                    points: training.load.dates.map((date, i) => ({ x: dayKeyToMs(date), y: training.load!.tsb[i] })),
                    format: (v) => v.toFixed(0),
                  },
                ]}
                formatY={(v) => v.toFixed(0)}
                ariaLabel="Fitness, fatigue and form over time"
              />
              {training.model.source !== 'device' && (
                <Alert>
                  Your export does not contain a device training-load figure, so this curve is derived: {training.model.description}.
                </Alert>
              )}
            </>
          ) : (
            <EmptyState title="Not enough history" description="A few weeks of activities are needed before fitness and fatigue curves mean anything." />
          )}
        </Card>
      </div>

      {(distanceEfforts.length > 0 || powerEfforts.length > 0) && (
        <div className="grid grid-2">
          {distanceEfforts.length > 0 && (
            <Card title="Best efforts" note="fastest recorded splits" actions={<IconTrophy size={15} className="muted" />} padded={false}>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th className="no-sort">Distance</th>
                      <th className="no-sort right">Time</th>
                      <th className="no-sort right">Pace</th>
                      <th className="no-sort right">When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {distanceEfforts.map((effort) => {
                      const activity = byId.get(effort.activityId);
                      return (
                        <tr key={effort.key} onClick={() => activity && onOpenActivity(activity)}>
                          <td className="primary">{effort.label}</td>
                          <td className="right num">{formatClock(effort.value)}</td>
                          <td className="right num">{fmt.rate(effort.sport, effort.target / effort.value)}</td>
                          <td className="right num muted">{formatDate(effort.date)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="muted" style={{ fontSize: 11.5, padding: '8px 12px 12px' }}>
                Computed by sliding a window across every recorded distance stream — not from the activity summaries.
              </p>
            </Card>
          )}

          {powerEfforts.length > 0 && (
            <Card title="Power curve" note="best average power by duration" padded={false}>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th className="no-sort">Duration</th>
                      <th className="no-sort right">Power</th>
                      <th className="no-sort right">When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {powerEfforts.map((effort) => {
                      const activity = byId.get(effort.activityId);
                      return (
                        <tr key={effort.key} onClick={() => activity && onOpenActivity(activity)}>
                          <td className="primary">{effort.label}</td>
                          <td className="right num">{Math.round(effort.value)} W</td>
                          <td className="right num muted">{formatDate(effort.date)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}

      {highlights.length > 0 && (
        <Card title="Personal bests" note="single-activity records in this export" padded={false}>
          <div className="metric-grid">
            {highlights.map((highlight) => {
              const activity = highlight.activityId ? byId.get(highlight.activityId) : undefined;
              const value =
                highlight.unitKind === 'distance'
                  ? fmt.distance(highlight.value)
                  : highlight.unitKind === 'duration'
                    ? fmt.duration(highlight.value)
                    : highlight.unitKind === 'elevation'
                      ? fmt.elevation(highlight.value)
                      : highlight.unitKind === 'speed'
                        ? fmt.rate(activity?.sport ?? 'other', highlight.value)
                        : highlight.unitKind === 'power'
                          ? `${Math.round(highlight.value)} W`
                          : highlight.unitKind === 'score'
                            ? highlight.value.toFixed(1)
                            : Math.round(highlight.value).toLocaleString();
              return (
                <button
                  key={highlight.key}
                  type="button"
                  className="metric-cell"
                  style={{ textAlign: 'left', border: 'none', cursor: activity ? 'pointer' : 'default' }}
                  onClick={() => activity && onOpenActivity(activity)}
                >
                  <span className="k">{highlight.label}</span>
                  <span className="v">{value}</span>
                  <span className="k">{highlight.date ? formatDate(highlight.date) : ''}</span>
                </button>
              );
            })}
          </div>
        </Card>
      )}

      <TrainingHeatmap />
    </>
  );
}

/** Extracted so the hook order stays stable regardless of the early return above. */
function TrainingHeatmap() {
  const { days, dataset } = useDataset();
  const fmt = useFormatters();
  const values = useMemo(
    () =>
      [...days.values()].map((bucket) => ({
        date: bucket.date,
        value: bucket.duration,
        tooltip: `${bucket.date} · ${bucket.count} activity${bucket.count === 1 ? '' : 'ies'} · ${fmt.hours(bucket.duration)}`,
      })),
    [days, fmt],
  );
  if (!values.length) return null;
  const dates = values.map((v) => v.date).sort();
  return (
    <Card title="Consistency" note={`${values.length} active days`}>
      <ActivityHeatmap values={values} from={dates[0]} to={dates[dates.length - 1]} />
      <p className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>
        {dataset.activities.length} activities across {dates.length} days.
      </p>
    </Card>
  );
}
