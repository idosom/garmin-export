import { useMemo, useState } from 'react';
import { useDataset } from '../../state/dataset.tsx';
import { useFormatters, activityTitle, activityDuration } from '../format.ts';
import { Card, EmptyState, Stat, Badge } from '../components/primitives.tsx';
import { ShareBar } from '../charts/ShareBar.tsx';
import { BarChart } from '../charts/BarChart.tsx';
import { SportIcon, IconActivities, IconChevronRight } from '../components/icons.tsx';
import { sportMeta } from '../../core/metrics.ts';
import { seriesColor } from '../charts/chartUtils.ts';
import { wellnessHighlights } from '../../analytics/index.ts';
import { dayKeyToMs } from '../../core/time.ts';
import { formatByKind, formatBytes, formatDate } from '../../core/units.ts';
import type { Activity } from '../../core/types.ts';

export function OverviewView({
  onOpenActivity,
  onShowExplorer,
}: {
  onOpenActivity: (activity: Activity) => void;
  onShowExplorer?: () => void;
}) {
  const { dataset, overview, training } = useDataset();
  const fmt = useFormatters();
  const [summaryDismissed, setSummaryDismissed] = useState(false);

  const highlights = useMemo(() => wellnessHighlights(dataset.daily, 4), [dataset.daily]);
  const recentWeeks = training.weekly.slice(-12);

  const hasActivities = overview.activityCount > 0;
  const hasWellness = dataset.daily.length > 0;

  if (!hasActivities && !hasWellness) {
    return (
      <Card>
        <EmptyState
          title="Nothing to summarise yet"
          description="The files that were read did not contain any activities or wellness records. The Data explorer shows exactly what was found in each file."
        />
      </Card>
    );
  }

  return (
    <>
      {!summaryDismissed && (
        <ImportSummary onDismiss={() => setSummaryDismissed(true)} onShowExplorer={onShowExplorer} />
      )}

      <div className="grid grid-stats">
        {hasActivities && (
          <>
            <Stat
              label="Activities"
              value={fmt.number(overview.activityCount)}
              sub={overview.range ? `${formatDate(overview.range.start)} – ${formatDate(overview.range.end)}` : undefined}
            />
            <Stat label="Training time" value={fmt.hours(overview.totalDuration)} sub={`${overview.activeDays} active days`} />
            <Stat
              label="Distance"
              value={fmt.distanceParts(overview.totalDistance).value}
              unit={fmt.distanceParts(overview.totalDistance).unit}
              sub={overview.longestStreak > 1 ? `Longest streak ${overview.longestStreak} days` : undefined}
            />
            {overview.totalAscent !== undefined && (
              <Stat
                label="Elevation gain"
                value={fmt.elevationParts(overview.totalAscent).value}
                unit={fmt.elevationParts(overview.totalAscent).unit}
                sub={overview.totalCalories !== undefined ? `${fmt.number(overview.totalCalories)} kcal burned` : undefined}
              />
            )}
          </>
        )}
        {!hasActivities && hasWellness && (
          <Stat label="Wellness days" value={fmt.number(dataset.daily.length)} sub="This export contains health data only" />
        )}
      </div>

      {highlights.length > 0 && (
        <div className="grid grid-stats">
          {highlights.map((series, i) => {
            const formatted = formatByKind(series.latest?.value, series.meta.kind, fmt.units, series.meta.decimals);
            const trend = series.trendPerMonth;
            const better = series.meta.better;
            const direction = trend === undefined || Math.abs(trend) < 1e-6 ? 'flat' : trend > 0 ? 'up' : 'down';
            const good = better ? (better === 'up' ? direction === 'up' : direction === 'down') : undefined;
            const trendMagnitude =
              trend === undefined ? undefined : formatByKind(Math.abs(trend), series.meta.kind, fmt.units, series.meta.decimals).value;
            // A change that rounds away to nothing is "flat", not a tiny decline.
            const trendIsZero = trendMagnitude === undefined || /^[0:\s]*$/.test(trendMagnitude.replace(/[.,]/g, ''));
            const trendText = trendIsZero ? undefined : `${trendMagnitude} / month`;
            return (
              <Stat
                key={series.meta.key}
                label={series.meta.label}
                value={formatted.value}
                unit={formatted.unit}
                delta={
                  trendText
                    ? { value: trendText, direction: good === undefined ? 'flat' : good ? 'up' : 'down' }
                    : { value: 'steady', direction: 'flat' }
                }
                sub={`${series.points.length} days recorded`}
                spark={series.points.map((p) => ({ x: dayKeyToMs(p.date), y: p.value }))}
                sparkColor={seriesColor(i + 2)}
              />
            );
          })}
        </div>
      )}

      <div className="grid grid-2">
        {hasActivities && (
          <Card title="Activity mix" note="by moving time">
            <ShareBar
              items={overview.sports.map((sport) => ({
                key: sport.sport,
                label: sport.label,
                value: sport.duration,
                color: seriesColor(sportMeta(sport.sport).slot),
                detail: `${sport.count} ${sport.count === 1 ? 'activity' : 'activities'}`,
              }))}
              formatValue={(v) => fmt.hours(v)}
            />
          </Card>
        )}

        {hasActivities && recentWeeks.length > 1 && (
          <Card title="Recent training volume" note={`last ${recentWeeks.length} weeks`}>
            <BarChart
              height={200}
              data={recentWeeks.map((week) => ({
                key: week.key,
                label: new Date(dayKeyToMs(week.start)).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
                segments: Object.entries(week.bySport).map(([sport, value]) => ({
                  key: sport,
                  label: sportMeta(sport).label,
                  value: value.duration,
                  color: seriesColor(sportMeta(sport).slot),
                })),
                detail: [{ label: 'Activities', value: String(week.count) }],
              }))}
              formatValue={(v) => fmt.hours(v)}
              formatY={(v) => `${Math.round(v / 3600)}h`}
              ariaLabel="Weekly training volume"
            />
          </Card>
        )}
      </div>

      {hasActivities && (
        <Card title="Recent activity" actions={<Badge>{overview.recent.length} shown</Badge>} padded={false}>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {overview.recent.map((activity) => {
              const meta = sportMeta(activity.sport);
              return (
                <li key={activity.id}>
                  <button type="button" className="recent-item" onClick={() => onOpenActivity(activity)}>
                    <span className="recent-icon" style={{ color: seriesColor(meta.slot) }}>
                      <SportIcon icon={meta.icon} size={17} />
                    </span>
                    <span className="recent-main">
                      <span className="recent-title">{activityTitle(activity)}</span>
                      <span className="recent-when">
                        {new Date(activity.startTime).toLocaleString(undefined, {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </span>
                    <span className="recent-metric wide muted optional">
                      {activity.distance ? fmt.distance(activity.distance) : '—'}
                    </span>
                    <span className="recent-metric narrow">{fmt.duration(activityDuration(activity))}</span>
                    <span className="recent-metric narrow muted optional">
                      {activity.avgHr ? `${Math.round(activity.avgHr)} bpm` : '—'}
                    </span>
                    <IconChevronRight size={15} className="muted" />
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {!hasActivities && hasWellness && (
        <Card title="Health data">
          <EmptyState
            icon={<IconActivities size={20} />}
            title="No activities in this export"
            description="Wellness records were found, so the Health & wellness view has your longitudinal data. Activity files (FIT/TCX/GPX) would add training analysis."
          />
        </Card>
      )}

      {hasWellness && highlights.length === 0 && (
        <Card title="Health data">
          <p className="muted" style={{ fontSize: 13 }}>
            {dataset.daily.length} day{dataset.daily.length === 1 ? '' : 's'} of wellness data were found, but not enough of any single
            metric to chart a trend yet. See Health &amp; wellness for the detail.
          </p>
        </Card>
      )}
    </>
  );
}

/** What the import actually found — shown once, right after parsing. */
function ImportSummary({ onDismiss, onShowExplorer }: { onDismiss: () => void; onShowExplorer?: () => void }) {
  const { dataset } = useDataset();
  const report = dataset.report;

  const formats = useMemo(() => {
    const counts = new Map<string, number>();
    for (const file of report.files) {
      if (file.status !== 'parsed' || file.format === 'zip') continue;
      counts.set(file.format, (counts.get(file.format) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [report.files]);

  const parsed = report.files.filter((f) => f.status === 'parsed').length;
  const problems = report.files.filter((f) => f.errors.length).length;
  const metrics = new Set<string>();
  for (const day of dataset.daily) for (const key of Object.keys(day.values)) metrics.add(key);

  return (
    <Card
      title="What was found in this export"
      actions={
        <>
          {onShowExplorer && (
            <button type="button" className="btn small ghost" onClick={onShowExplorer}>
              Inspect the files
            </button>
          )}
          <button type="button" className="btn small ghost" onClick={onDismiss} aria-label="Hide the import summary">
            Dismiss
          </button>
        </>
      }
    >
      <p style={{ fontSize: 13.5, color: 'var(--text-secondary)' }}>
        Read <strong>{report.files.length.toLocaleString()}</strong> files ({formatBytes(report.totalBytes)}), parsed{' '}
        <strong>{parsed.toLocaleString()}</strong> of them into <strong>{dataset.activities.length.toLocaleString()}</strong>{' '}
        activities and <strong>{dataset.daily.length.toLocaleString()}</strong> days of wellness data
        {report.duplicateActivitiesMerged > 0
          ? `, merging ${report.duplicateActivitiesMerged} duplicate ${report.duplicateActivitiesMerged === 1 ? 'copy' : 'copies'}`
          : ''}
        {problems > 0 ? `. ${problems} file${problems === 1 ? '' : 's'} could not be read` : ''}.
      </p>
      <div className="chip-list" style={{ marginTop: 10 }}>
        {formats.map(([format, count]) => (
          <Badge key={format} tone="accent">
            {format.toUpperCase()} · {count}
          </Badge>
        ))}
        {metrics.size > 0 && <Badge>{metrics.size} wellness metrics</Badge>}
        {dataset.user?.name && <Badge>Profile: {dataset.user.name}</Badge>}
      </div>
    </Card>
  );
}
