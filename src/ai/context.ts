import type { Dataset, DailyRecord, WellnessMetricMeta } from '../core/types.ts';
import type { Overview } from '../analytics/index.ts';
import { WELLNESS_METRICS } from '../core/metrics.ts';
import { formatByKind, formatDate, joinFormatted, type UnitSystem } from '../core/units.ts';
import { activityTitle, activityDuration } from '../ui/format.ts';

/** Aggregates a wellness metric the same way the rest of the app does — e.g. weight is a point-in-time "last", not an average. */
function aggregate(daily: DailyRecord[], key: string, agg: WellnessMetricMeta['agg']): number | undefined {
  const points = daily
    .map((d) => ({ date: d.date, value: d.values[key] }))
    .filter((p): p is { date: string; value: number } => p.value !== undefined && Number.isFinite(p.value));
  if (!points.length) return undefined;
  switch (agg) {
    case 'sum':
      return points.reduce((sum, p) => sum + p.value, 0);
    case 'min':
      return Math.min(...points.map((p) => p.value));
    case 'max':
      return Math.max(...points.map((p) => p.value));
    case 'last':
      return points.reduce((latest, p) => (p.date > latest.date ? p : latest)).value;
    case 'avg':
    default:
      return points.reduce((sum, p) => sum + p.value, 0) / points.length;
  }
}

const WELLNESS_SUMMARY_KEYS = ['sleepDuration', 'restingHr', 'hrv', 'stressAvg', 'weight', 'vo2max'];

/** A compact plain-text summary of the dataset, used as the assistant's grounding context. */
export function buildDatasetContext(dataset: Dataset, overview: Overview, units: UnitSystem): string {
  const lines: string[] = [];

  lines.push(`Dataset "${dataset.label}": ${dataset.activities.length} activities, ${dataset.daily.length} days of wellness data.`);
  if (overview.range) {
    lines.push(`Date range: ${formatDate(overview.range.start)} to ${formatDate(overview.range.end)}.`);
  }

  const parts = [
    `${overview.activityCount} activities`,
    `${joinFormatted(formatByKind(overview.totalDuration, 'duration', units))} training time`,
    `${joinFormatted(formatByKind(overview.totalDistance, 'distance', units))} distance`,
  ];
  if (overview.totalAscent !== undefined) parts.push(`${joinFormatted(formatByKind(overview.totalAscent, 'elevation', units))} elevation gain`);
  if (overview.totalCalories !== undefined) parts.push(`${Math.round(overview.totalCalories)} kcal burned`);
  lines.push(`Totals: ${parts.join(', ')}. ${overview.activeDays} active days, longest streak ${overview.longestStreak} days.`);

  if (overview.sports.length) {
    const bySport = overview.sports
      .map((s) => `${s.label} (${s.count}, ${joinFormatted(formatByKind(s.duration, 'duration', units))}, ${Math.round(s.share * 100)}%)`)
      .join('; ');
    lines.push(`By sport: ${bySport}.`);
  }

  if (overview.recent.length) {
    lines.push('Most recent activities:');
    for (const a of overview.recent.slice(0, 8)) {
      const hr = a.avgHr !== undefined ? `, avg HR ${Math.round(a.avgHr)} bpm` : '';
      lines.push(
        `- ${formatDate(a.startTime)} ${activityTitle(a)}: ${joinFormatted(formatByKind(a.distance, 'distance', units))}, ` +
          `${joinFormatted(formatByKind(activityDuration(a), 'duration', units))}${hr}`,
      );
    }
  }

  const wellness: string[] = [];
  for (const key of WELLNESS_SUMMARY_KEYS) {
    const meta = WELLNESS_METRICS.find((m) => m.key === key);
    if (!meta) continue;
    const value = aggregate(dataset.daily, key, meta.agg);
    if (value === undefined) continue;
    const suffix = meta.agg === 'avg' ? ' avg' : meta.agg === 'last' ? ' latest' : ` ${meta.agg}`;
    wellness.push(`${meta.label}: ${joinFormatted(formatByKind(value, meta.kind, units, meta.decimals))}${suffix}`);
  }
  if (wellness.length) lines.push(`Wellness: ${wellness.join(', ')}.`);

  return lines.join('\n');
}

export const ASSISTANT_SYSTEM_PROMPT =
  'You are a helpful fitness data analyst embedded in a Garmin export dashboard. ' +
  'Answer questions about the user\'s training and health data using only the summary provided below. ' +
  'Be concise. If the data needed to answer isn\'t in the summary, say so instead of guessing.';
