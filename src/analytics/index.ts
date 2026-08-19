/**
 * Dataset-level analytics.
 *
 * Everything is derived on demand from the normalized model; nothing here
 * invents a metric that the export did not contain.
 */
import type { Activity, DailyRecord, Dataset, WellnessMetricMeta } from '../core/types.ts';
import { wellnessMeta, WELLNESS_METRICS, sportMeta } from '../core/metrics.ts';
import { addDays, daysBetween, monthKey, weekStart } from '../core/time.ts';
import { linearTrend, mean, quantile } from '../core/stats.ts';
import { activityDayKey, bucketByDay } from './calendar.ts';
import { chooseLoadModel, loadSeries, type LoadModel, type LoadSeries } from './load.ts';

export * from './calendar.ts';
export * from './load.ts';
export * from './records.ts';

/* ---------------------------------------------------------------- overview */

export interface SportSummary {
  sport: string;
  label: string;
  count: number;
  duration: number;
  distance: number;
  share: number;
}

export interface Overview {
  range?: { start: number; end: number };
  activityCount: number;
  totalDuration: number;
  totalDistance: number;
  totalCalories?: number;
  totalAscent?: number;
  activeDays: number;
  daysCovered: number;
  sports: SportSummary[];
  recent: Activity[];
  longestStreak: number;
}

export function buildOverview(activities: Activity[], daily: DailyRecord[]): Overview {
  const sorted = [...activities].sort((a, b) => b.startTime - a.startTime);
  const byDay = bucketByDay(activities);

  let start = Infinity;
  let end = -Infinity;
  for (const a of activities) {
    start = Math.min(start, a.startTime);
    end = Math.max(end, a.endTime ?? a.startTime);
  }
  for (const d of daily) {
    const t = Date.parse(`${d.date}T12:00:00Z`);
    if (Number.isFinite(t)) {
      start = Math.min(start, t);
      end = Math.max(end, t);
    }
  }

  const totals = { duration: 0, distance: 0, calories: 0, ascent: 0, hasCalories: false, hasAscent: false };
  const bySport = new Map<string, SportSummary>();
  for (const a of activities) {
    const duration = a.movingTime ?? a.timerTime ?? a.elapsedTime ?? 0;
    totals.duration += duration;
    totals.distance += a.distance ?? 0;
    if (a.calories !== undefined) {
      totals.calories += a.calories;
      totals.hasCalories = true;
    }
    if (a.ascent !== undefined) {
      totals.ascent += a.ascent;
      totals.hasAscent = true;
    }
    let summary = bySport.get(a.sport);
    if (!summary) {
      summary = { sport: a.sport, label: sportMeta(a.sport).label, count: 0, duration: 0, distance: 0, share: 0 };
      bySport.set(a.sport, summary);
    }
    summary.count++;
    summary.duration += duration;
    summary.distance += a.distance ?? 0;
  }
  const sports = [...bySport.values()].sort((a, b) => b.duration - a.duration || b.count - a.count);
  for (const s of sports) s.share = totals.duration ? s.duration / totals.duration : 0;

  return {
    range: Number.isFinite(start) && Number.isFinite(end) ? { start, end } : undefined,
    activityCount: activities.length,
    totalDuration: totals.duration,
    totalDistance: totals.distance,
    totalCalories: totals.hasCalories ? totals.calories : undefined,
    totalAscent: totals.hasAscent ? totals.ascent : undefined,
    activeDays: byDay.size,
    daysCovered: Number.isFinite(start) && Number.isFinite(end) ? Math.max(1, Math.round((end - start) / 86400000) + 1) : 0,
    sports,
    recent: sorted.slice(0, 8),
    longestStreak: longestStreak([...byDay.keys()]),
  };
}

function longestStreak(days: string[]): number {
  if (!days.length) return 0;
  const sorted = [...days].sort();
  let best = 1;
  let current = 1;
  for (let i = 1; i < sorted.length; i++) {
    if (daysBetween(sorted[i - 1], sorted[i]) === 1) current++;
    else current = 1;
    if (current > best) best = current;
  }
  return best;
}

/* ---------------------------------------------------------------- training */

export interface VolumeBucket {
  key: string;
  /** Sortable position (`YYYY-MM-DD` of the bucket start). */
  start: string;
  count: number;
  duration: number;
  distance: number;
  load: number;
  bySport: Record<string, { count: number; duration: number; distance: number }>;
}

export type VolumeGrouping = 'week' | 'month';

export function volumeBuckets(activities: Activity[], grouping: VolumeGrouping, loadOf?: (a: Activity) => number): VolumeBucket[] {
  const map = new Map<string, VolumeBucket>();
  for (const activity of activities) {
    const day = activityDayKey(activity);
    const key = grouping === 'week' ? weekStart(day) : monthKey(day);
    let bucket = map.get(key);
    if (!bucket) {
      bucket = { key, start: grouping === 'week' ? key : `${key}-01`, count: 0, duration: 0, distance: 0, load: 0, bySport: {} };
      map.set(key, bucket);
    }
    const duration = activity.movingTime ?? activity.timerTime ?? activity.elapsedTime ?? 0;
    bucket.count++;
    bucket.duration += duration;
    bucket.distance += activity.distance ?? 0;
    bucket.load += loadOf?.(activity) ?? 0;
    const sport = (bucket.bySport[activity.sport] ??= { count: 0, duration: 0, distance: 0 });
    sport.count++;
    sport.duration += duration;
    sport.distance += activity.distance ?? 0;
  }

  const buckets = [...map.values()].sort((a, b) => (a.start < b.start ? -1 : 1));
  if (!buckets.length) return buckets;

  // Fill empty periods so a training chart shows rest weeks honestly.
  const filled: VolumeBucket[] = [];
  let cursor = buckets[0].start;
  const last = buckets[buckets.length - 1].start;
  const step = grouping === 'week' ? 7 : 0;
  let guard = 0;
  while (cursor <= last && guard++ < 5000) {
    const key = grouping === 'week' ? cursor : cursor.slice(0, 7);
    filled.push(map.get(key) ?? { key, start: cursor, count: 0, duration: 0, distance: 0, load: 0, bySport: {} });
    cursor = grouping === 'week' ? addDays(cursor, step) : nextMonth(cursor);
  }
  return filled;
}

function nextMonth(dayKey: string): string {
  const [y, m] = dayKey.split('-').map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}

export interface TrainingAnalysis {
  weekly: VolumeBucket[];
  monthly: VolumeBucket[];
  load?: LoadSeries;
  model: LoadModel;
  /** Ratio of the last 7 days of load to the trailing 28-day average. */
  acuteChronicRatio?: number;
}

export function buildTraining(dataset: Dataset): TrainingAnalysis {
  const model = chooseLoadModel(dataset.activities, dataset.user);
  const series = loadSeries(dataset.activities, model);
  let acuteChronicRatio: number | undefined;
  if (series && series.dates.length >= 28) {
    const atl = series.atl[series.atl.length - 1];
    const ctl = series.ctl[series.ctl.length - 1];
    if (ctl > 0) acuteChronicRatio = atl / ctl;
  }
  return {
    weekly: volumeBuckets(dataset.activities, 'week', model.loadOf),
    monthly: volumeBuckets(dataset.activities, 'month', model.loadOf),
    load: series,
    model,
    acuteChronicRatio,
  };
}

/* ---------------------------------------------------------------- wellness */

export interface MetricPoint {
  date: string;
  value: number;
}

export interface MetricSeries {
  meta: WellnessMetricMeta;
  points: MetricPoint[];
  latest?: MetricPoint;
  average?: number;
  min?: number;
  max?: number;
  /** Change per 30 days from a least-squares fit, in metric units. */
  trendPerMonth?: number;
  coverage: number;
}

export function availableMetrics(daily: DailyRecord[]): WellnessMetricMeta[] {
  const keys = new Set<string>();
  for (const day of daily) for (const key of Object.keys(day.values)) keys.add(key);
  const known = WELLNESS_METRICS.filter((m) => keys.has(m.key));
  const extra = [...keys]
    .filter((k) => !WELLNESS_METRICS.some((m) => m.key === k))
    .map((k) => wellnessMeta(k))
    .sort((a, b) => a.label.localeCompare(b.label));
  return [...known.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0)), ...extra];
}

export function metricSeries(daily: DailyRecord[], key: string, range?: { from: string; to: string }): MetricSeries {
  const meta = wellnessMeta(key);
  const points: MetricPoint[] = [];
  for (const day of daily) {
    if (range && (day.date < range.from || day.date > range.to)) continue;
    const value = day.values[key];
    if (value === undefined || !Number.isFinite(value)) continue;
    points.push({ date: day.date, value });
  }
  points.sort((a, b) => (a.date < b.date ? -1 : 1));

  const values = points.map((p) => p.value);
  const sortedValues = [...values].sort((a, b) => a - b);
  const first = points[0];
  const trend =
    points.length >= 4
      ? linearTrend(points.map((p) => ({ x: daysBetween(first.date, p.date), y: p.value })))
      : undefined;

  const span = points.length ? daysBetween(points[0].date, points[points.length - 1].date) + 1 : 0;
  return {
    meta,
    points,
    latest: points[points.length - 1],
    average: mean(values),
    min: sortedValues.length ? quantile(sortedValues, 0) : undefined,
    max: sortedValues.length ? quantile(sortedValues, 1) : undefined,
    trendPerMonth: trend === undefined ? undefined : trend * 30,
    coverage: span ? points.length / span : 0,
  };
}

/** Metrics with enough data to headline the overview. */
export function wellnessHighlights(daily: DailyRecord[], limit = 4): MetricSeries[] {
  return availableMetrics(daily)
    .filter((m) => (m.priority ?? 0) >= 60)
    .map((m) => metricSeries(daily, m.key))
    .filter((s) => s.points.length >= 3)
    .slice(0, limit);
}
