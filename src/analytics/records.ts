/**
 * Personal records and best efforts.
 *
 * Everything here is *computed from the samples*, never guessed: a best 5 km is
 * the fastest 5 km actually contained in a recorded distance stream, and the
 * result carries the activity it came from so the claim can be checked. Where
 * the source data cannot support a record (no distance stream, no power meter)
 * the record is simply absent.
 */
import type { Activity } from '../core/types.ts';
import { M_PER_MILE } from '../core/units.ts';

export interface BestEffort {
  key: string;
  label: string;
  /** Metres for distance efforts, seconds for power efforts. */
  target: number;
  /** Seconds for distance efforts, watts for power efforts. */
  value: number;
  activityId: string;
  activityName?: string;
  date: number;
  sport: string;
}

export const RUN_DISTANCES: { key: string; label: string; metres: number }[] = [
  { key: '400m', label: '400 m', metres: 400 },
  { key: '1k', label: '1 km', metres: 1000 },
  { key: '1mi', label: '1 mile', metres: M_PER_MILE },
  { key: '5k', label: '5 km', metres: 5000 },
  { key: '10k', label: '10 km', metres: 10000 },
  { key: 'half', label: 'Half marathon', metres: 21097.5 },
  { key: 'marathon', label: 'Marathon', metres: 42195 },
];

export const POWER_WINDOWS: { key: string; label: string; seconds: number }[] = [
  { key: '5s', label: '5 sec', seconds: 5 },
  { key: '1m', label: '1 min', seconds: 60 },
  { key: '5m', label: '5 min', seconds: 300 },
  { key: '20m', label: '20 min', seconds: 1200 },
  { key: '60m', label: '60 min', seconds: 3600 },
];

const FOOT_SPORTS = new Set(['running', 'walking', 'hiking']);

/** Fastest time to cover each target distance, across all matching activities. */
export function bestDistanceEfforts(activities: Activity[], sports = FOOT_SPORTS): BestEffort[] {
  const best = new Map<string, BestEffort>();
  for (const activity of activities) {
    if (!sports.has(activity.sport)) continue;
    const streams = activity.streams;
    const distance = streams?.channels.distance;
    if (!streams || !distance) continue;
    for (const target of RUN_DISTANCES) {
      if ((activity.distance ?? 0) < target.metres * 0.98) continue;
      const seconds = fastestWindow(streams.time, distance, target.metres);
      if (seconds === undefined) continue;
      const existing = best.get(target.key);
      if (!existing || seconds < existing.value) {
        best.set(target.key, {
          key: target.key,
          label: target.label,
          target: target.metres,
          value: seconds,
          activityId: activity.id,
          activityName: activity.name,
          date: activity.startTime,
          sport: activity.sport,
        });
      }
    }
  }
  return RUN_DISTANCES.map((d) => best.get(d.key)).filter((b): b is BestEffort => !!b);
}

/**
 * Two-pointer sweep over the cumulative distance stream: the smallest time
 * span that covers `targetMetres`.
 */
export function fastestWindow(time: Float64Array, distance: Float32Array, targetMetres: number): number | undefined {
  let bestSeconds = Infinity;
  let start = 0;
  for (let end = 0; end < time.length; end++) {
    const dEnd = distance[end];
    if (!Number.isFinite(dEnd)) continue;
    while (start < end) {
      const dStart = distance[start];
      if (!Number.isFinite(dStart)) {
        start++;
        continue;
      }
      if (dEnd - dStart < targetMetres) break;
      const seconds = (time[end] - time[start]) / 1000;
      if (seconds > 0 && seconds < bestSeconds) bestSeconds = seconds;
      start++;
    }
  }
  return Number.isFinite(bestSeconds) ? bestSeconds : undefined;
}

/** Highest average power sustained over each window length. */
export function bestPowerEfforts(activities: Activity[]): BestEffort[] {
  const best = new Map<string, BestEffort>();
  for (const activity of activities) {
    const streams = activity.streams;
    const power = streams?.channels.power;
    if (!streams || !power) continue;
    for (const window of POWER_WINDOWS) {
      const watts = bestAverage(streams.time, power, window.seconds);
      if (watts === undefined) continue;
      const existing = best.get(window.key);
      if (!existing || watts > existing.value) {
        best.set(window.key, {
          key: window.key,
          label: window.label,
          target: window.seconds,
          value: watts,
          activityId: activity.id,
          activityName: activity.name,
          date: activity.startTime,
          sport: activity.sport,
        });
      }
    }
  }
  return POWER_WINDOWS.map((w) => best.get(w.key)).filter((b): b is BestEffort => !!b);
}

/** Best time-weighted average of a channel over a rolling window of seconds. */
export function bestAverage(time: Float64Array, values: Float32Array, windowSeconds: number): number | undefined {
  const n = time.length;
  if (n < 2) return undefined;
  const totalSpan = (time[n - 1] - time[0]) / 1000;
  if (totalSpan < windowSeconds) return undefined;

  // Prefix sums of value × dt so any window is O(1).
  const prefix = new Float64Array(n);
  const prefixTime = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    const dt = (time[i] - time[i - 1]) / 1000;
    const v = Number.isFinite(values[i]) ? values[i] : Number.isFinite(values[i - 1]) ? values[i - 1] : 0;
    const step = dt > 0 && dt < 3600 ? dt : 0;
    prefix[i] = prefix[i - 1] + v * step;
    prefixTime[i] = prefixTime[i - 1] + step;
  }

  let best = -Infinity;
  let start = 0;
  for (let end = 1; end < n; end++) {
    while (start < end && prefixTime[end] - prefixTime[start] > windowSeconds) start++;
    if (start === 0 && prefixTime[end] < windowSeconds) continue;
    const span = prefixTime[end] - prefixTime[start];
    if (span <= 0) continue;
    if (span < windowSeconds * 0.95) continue;
    const avg = (prefix[end] - prefix[start]) / span;
    if (avg > best) best = avg;
  }
  return Number.isFinite(best) ? best : undefined;
}

export interface Highlight {
  key: string;
  label: string;
  value: number;
  unitKind: 'distance' | 'duration' | 'elevation' | 'speed' | 'score' | 'power' | 'count';
  activityId?: string;
  date?: number;
  detail?: string;
}

/** Single-activity superlatives that any export can support. */
export function activityHighlights(activities: Activity[]): Highlight[] {
  const out: Highlight[] = [];
  const push = (
    key: string,
    label: string,
    pick: (a: Activity) => number | undefined,
    unitKind: Highlight['unitKind'],
    detail?: (a: Activity) => string,
  ) => {
    let bestActivity: Activity | undefined;
    let bestValue = -Infinity;
    for (const a of activities) {
      const v = pick(a);
      if (v === undefined || !Number.isFinite(v)) continue;
      if (v > bestValue) {
        bestValue = v;
        bestActivity = a;
      }
    }
    if (bestActivity) {
      out.push({
        key,
        label,
        value: bestValue,
        unitKind,
        activityId: bestActivity.id,
        date: bestActivity.startTime,
        detail: detail?.(bestActivity),
      });
    }
  };

  push('longestDistance', 'Longest activity', (a) => a.distance, 'distance', (a) => a.name ?? a.sport);
  push('longestDuration', 'Longest time', (a) => a.elapsedTime, 'duration', (a) => a.name ?? a.sport);
  push('mostAscent', 'Most climbing', (a) => a.ascent, 'elevation', (a) => a.name ?? a.sport);
  push('fastestSpeed', 'Highest average speed', (a) => (a.distance && a.distance > 1000 ? a.avgSpeed : undefined), 'speed', (a) => a.name ?? a.sport);
  push('maxPower', 'Highest power', (a) => a.maxPower, 'power', (a) => a.name ?? a.sport);
  push('maxHr', 'Highest heart rate', (a) => a.maxHr, 'count', (a) => a.name ?? a.sport);
  push('mostCalories', 'Most calories', (a) => a.calories, 'count', (a) => a.name ?? a.sport);
  push('bestTrainingEffect', 'Highest aerobic training effect', (a) => a.trainingEffectAerobic, 'score', (a) => a.name ?? a.sport);
  return out;
}
