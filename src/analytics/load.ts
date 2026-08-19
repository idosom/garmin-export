/**
 * Training load.
 *
 * Garmin only reports a load figure on some devices and only in some export
 * formats, so the load metric is chosen per dataset from the best source
 * actually present, and the choice is reported to the UI so a chart is never
 * silently built on a guess.
 */
import type { Activity, UserProfile } from '../core/types.ts';
import { addDays, daysBetween } from '../core/time.ts';
import { ewma } from '../core/stats.ts';
import { activityDayKey } from './calendar.ts';

export type LoadSource = 'device' | 'tss' | 'trimp' | 'duration';

export interface LoadModel {
  source: LoadSource;
  label: string;
  description: string;
  loadOf(activity: Activity): number;
}

const SPORT_INTENSITY: Record<string, number> = {
  running: 1.1,
  cycling: 0.85,
  swimming: 1.0,
  rowing: 1.0,
  hiking: 0.6,
  walking: 0.4,
  strength: 0.7,
  yoga: 0.3,
  cardio: 0.9,
  skiing: 0.8,
};

export function chooseLoadModel(activities: Activity[], user?: UserProfile): LoadModel {
  const withDeviceLoad = activities.filter((a) => a.trainingLoad !== undefined).length;
  const withTss = activities.filter((a) => a.tss !== undefined).length;
  const withHr = activities.filter((a) => a.avgHr !== undefined).length;

  if (withDeviceLoad >= activities.length * 0.5 && withDeviceLoad > 0) {
    return {
      source: 'device',
      label: 'Training load',
      description: `Reported by your device for ${withDeviceLoad} of ${activities.length} activities`,
      loadOf: (a) => a.trainingLoad ?? fallbackTrimp(a, hrBounds(activities, user)),
    };
  }
  if (withTss >= activities.length * 0.5 && withTss > 0) {
    return {
      source: 'tss',
      label: 'Training Stress Score',
      description: `From the TSS recorded on ${withTss} of ${activities.length} activities`,
      loadOf: (a) => a.tss ?? fallbackTrimp(a, hrBounds(activities, user)),
    };
  }
  if (withHr >= activities.length * 0.4 && withHr > 0) {
    const bounds = hrBounds(activities, user);
    return {
      source: 'trimp',
      label: 'Estimated load (HR)',
      description: `Banister TRIMP estimated from heart rate (rest ${bounds.rest}, max ${bounds.max} bpm)`,
      loadOf: (a) => fallbackTrimp(a, bounds),
    };
  }
  return {
    source: 'duration',
    label: 'Estimated load (duration)',
    description: 'Your export has no load or heart-rate data, so volume is weighted by sport instead',
    loadOf: (a) => durationLoad(a),
  };
}

export interface HrBounds {
  rest: number;
  max: number;
  /** True when the bounds were observed rather than stated by the profile. */
  estimated: boolean;
}

export function hrBounds(activities: Activity[], user?: UserProfile): HrBounds {
  let max = user?.maxHr ?? 0;
  let observedMax = 0;
  for (const a of activities) {
    if (a.maxHr && a.maxHr > observedMax && a.maxHr < 240) observedMax = a.maxHr;
  }
  if (!max) max = observedMax;
  if (!max) max = 190;
  const rest = user?.restingHr ?? 50;
  return { rest, max: Math.max(max, rest + 40), estimated: !user?.maxHr };
}

function fallbackTrimp(activity: Activity, bounds: HrBounds): number {
  const minutes = (activity.movingTime ?? activity.timerTime ?? activity.elapsedTime ?? 0) / 60;
  if (!minutes) return 0;
  if (activity.avgHr === undefined) return durationLoad(activity);
  const ratio = Math.max(0, Math.min(1, (activity.avgHr - bounds.rest) / (bounds.max - bounds.rest)));
  return minutes * ratio * 0.64 * Math.exp(1.92 * ratio) * 1.4;
}

function durationLoad(activity: Activity): number {
  const minutes = (activity.movingTime ?? activity.timerTime ?? activity.elapsedTime ?? 0) / 60;
  return minutes * (SPORT_INTENSITY[activity.sport] ?? 0.8);
}

export interface LoadSeries {
  dates: string[];
  daily: number[];
  /** Chronic (42-day) load — "fitness". */
  ctl: number[];
  /** Acute (7-day) load — "fatigue". */
  atl: number[];
  /** ctl − atl — "form". */
  tsb: number[];
  model: LoadModel;
}

/** Daily load plus the classic fitness/fatigue/form curves. */
export function loadSeries(activities: Activity[], model: LoadModel): LoadSeries | undefined {
  if (!activities.length) return undefined;
  const byDay = new Map<string, number>();
  for (const activity of activities) {
    const day = activityDayKey(activity);
    byDay.set(day, (byDay.get(day) ?? 0) + model.loadOf(activity));
  }
  const days = [...byDay.keys()].sort();
  const first = days[0];
  const last = days[days.length - 1];
  const span = daysBetween(first, last);
  if (span < 0 || span > 20000) return undefined;

  const dates: string[] = [];
  const daily: number[] = [];
  for (let i = 0; i <= span; i++) {
    const day = addDays(first, i);
    dates.push(day);
    daily.push(byDay.get(day) ?? 0);
  }
  const ctl = ewma(daily, 42);
  const atl = ewma(daily, 7);
  return { dates, daily, ctl, atl, tsb: ctl.map((c, i) => c - atl[i]), model };
}
