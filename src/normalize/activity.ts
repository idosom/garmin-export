/**
 * `RawActivity` → `Activity`.
 *
 * Fills in whatever the source file did not state but the samples can prove
 * (distance, ascent, HR range, bounds), and leaves everything else undefined —
 * the UI distinguishes "no data" from zero, so guessing here would be a lie.
 */
import type { Activity, ActivityStreams, RawActivity, SourceRef } from '../core/types.ts';
import { normalizeSport } from '../core/metrics.ts';
import { haversine, maxOf, mean, minOf } from '../core/stats.ts';
import { elevationStats } from '../parsers/tcx.ts';

export function normalizeActivity(raw: RawActivity, source: SourceRef): Activity | undefined {
  const streams = raw.streams;
  const startTime = raw.startTime ?? (streams && streams.n ? streams.time[0] : undefined);
  if (startTime === undefined || !Number.isFinite(startTime)) return undefined;

  const sport = normalizeSport(raw.sport);
  const activity: Activity = {
    id: '',
    name: raw.name,
    sport,
    subSport: raw.subSport,
    startTime,
    timezoneOffsetMin: raw.timezoneOffsetMin,
    endTime: raw.endTime,
    elapsedTime: positive(raw.elapsedTime),
    timerTime: positive(raw.timerTime),
    movingTime: positive(raw.movingTime),
    distance: positive(raw.distance),
    calories: positive(raw.calories),
    avgSpeed: positive(raw.avgSpeed),
    maxSpeed: positive(raw.maxSpeed),
    avgHr: positive(raw.avgHr),
    maxHr: positive(raw.maxHr),
    minHr: positive(raw.minHr),
    avgCadence: positive(raw.avgCadence),
    maxCadence: positive(raw.maxCadence),
    avgPower: positive(raw.avgPower),
    maxPower: positive(raw.maxPower),
    normalizedPower: positive(raw.normalizedPower),
    ascent: nonNegative(raw.ascent),
    descent: nonNegative(raw.descent),
    minElevation: finite(raw.minElevation),
    maxElevation: finite(raw.maxElevation),
    avgTemperature: finite(raw.avgTemperature),
    minTemperature: finite(raw.minTemperature),
    maxTemperature: finite(raw.maxTemperature),
    trainingEffectAerobic: positive(raw.trainingEffectAerobic),
    trainingEffectAnaerobic: positive(raw.trainingEffectAnaerobic),
    trainingLoad: positive(raw.trainingLoad),
    tss: positive(raw.tss),
    intensityFactor: positive(raw.intensityFactor),
    vo2max: positive(raw.vo2max),
    steps: positive(raw.steps),
    strokes: positive(raw.strokes),
    poolLength: positive(raw.poolLength),
    avgVerticalOscillation: positive(raw.avgVerticalOscillation),
    avgGroundContactTime: positive(raw.avgGroundContactTime),
    avgStrideLength: positive(raw.avgStrideLength),
    avgVerticalRatio: positive(raw.avgVerticalRatio),
    hrZoneTimes: raw.hrZoneTimes?.some((v) => v > 0) ? raw.hrZoneTimes : undefined,
    device: raw.device,
    manufacturer: raw.manufacturer,
    laps: (raw.laps ?? []).map((lap, i) => ({ ...lap, index: lap.index ?? i, extra: lap.extra ?? {} })),
    streams,
    hasGps: false,
    extra: cleanExtra(raw.extra),
    sources: [source],
  };

  if (streams && streams.n > 0) deriveFromStreams(activity, streams);
  deriveFromLaps(activity);

  if (activity.endTime === undefined && activity.elapsedTime !== undefined) {
    activity.endTime = activity.startTime + activity.elapsedTime * 1000;
  }
  if (activity.elapsedTime === undefined && activity.endTime !== undefined) {
    activity.elapsedTime = (activity.endTime - activity.startTime) / 1000;
  }
  if (activity.avgSpeed === undefined && activity.distance && (activity.movingTime || activity.timerTime || activity.elapsedTime)) {
    activity.avgSpeed = activity.distance / (activity.movingTime ?? activity.timerTime ?? activity.elapsedTime!);
  }
  if (activity.avgStrideLength === undefined && activity.distance && activity.steps) {
    activity.avgStrideLength = (activity.distance / activity.steps) * 1000;
  }

  activity.id = activityKey(activity);
  return activity;
}

/** Deterministic id: same activity from two files gets the same key. */
export function activityKey(activity: Pick<Activity, 'startTime' | 'sport' | 'distance' | 'elapsedTime'>): string {
  const minute = Math.round(activity.startTime / 60000);
  const dist = activity.distance ? Math.round(activity.distance / 50) : 0;
  const dur = activity.elapsedTime ? Math.round(activity.elapsedTime / 30) : 0;
  return `${minute}-${activity.sport}-${dist}-${dur}`;
}

function deriveFromStreams(activity: Activity, streams: ActivityStreams) {
  const { channels } = streams;

  if (streams.lat && streams.lon) {
    let minLat = Infinity;
    let minLon = Infinity;
    let maxLat = -Infinity;
    let maxLon = -Infinity;
    let count = 0;
    for (let i = 0; i < streams.n; i++) {
      const la = streams.lat[i];
      const lo = streams.lon[i];
      if (!Number.isFinite(la) || !Number.isFinite(lo)) continue;
      if (Math.abs(la) > 90 || Math.abs(lo) > 180) continue;
      count++;
      if (la < minLat) minLat = la;
      if (la > maxLat) maxLat = la;
      if (lo < minLon) minLon = lo;
      if (lo > maxLon) maxLon = lo;
    }
    if (count > 1) {
      activity.hasGps = true;
      activity.bounds = { minLat, minLon, maxLat, maxLon };
    }
  }

  if (activity.distance === undefined) {
    const distanceChannel = channels.distance;
    if (distanceChannel) {
      const last = lastFinite(distanceChannel);
      const first = firstFinite(distanceChannel);
      if (last !== undefined && first !== undefined && last > first) activity.distance = last - first;
    }
    if (activity.distance === undefined && streams.lat && streams.lon) {
      let total = 0;
      let prevLat: number | undefined;
      let prevLon: number | undefined;
      for (let i = 0; i < streams.n; i++) {
        const la = streams.lat[i];
        const lo = streams.lon[i];
        if (!Number.isFinite(la) || !Number.isFinite(lo)) continue;
        if (prevLat !== undefined && prevLon !== undefined) {
          const step = haversine(prevLat, prevLon, la, lo);
          if (step < 1000) total += step; // ignore GPS jumps
        }
        prevLat = la;
        prevLon = lo;
      }
      if (total > 0) activity.distance = total;
    }
  }

  if (activity.avgHr === undefined) activity.avgHr = round1(mean(channels.heartRate ?? []));
  if (activity.maxHr === undefined) activity.maxHr = maxOf(channels.heartRate ?? []);
  if (activity.minHr === undefined) activity.minHr = minOf(channels.heartRate ?? []);
  if (activity.maxSpeed === undefined) activity.maxSpeed = maxOf(channels.speed ?? []);
  if (activity.avgCadence === undefined) activity.avgCadence = round1(meanOfNonZero(channels.cadence));
  if (activity.maxCadence === undefined) activity.maxCadence = maxOf(channels.cadence ?? []);
  if (activity.avgPower === undefined) activity.avgPower = round1(mean(channels.power ?? []));
  if (activity.maxPower === undefined) activity.maxPower = maxOf(channels.power ?? []);
  if (activity.avgTemperature === undefined) activity.avgTemperature = round1(mean(channels.temperature ?? []));
  if (activity.minTemperature === undefined) activity.minTemperature = minOf(channels.temperature ?? []);
  if (activity.maxTemperature === undefined) activity.maxTemperature = maxOf(channels.temperature ?? []);

  if (channels.elevation && (activity.ascent === undefined || activity.minElevation === undefined)) {
    const stats = elevationStats(channels.elevation);
    activity.ascent ??= Math.round(stats.ascent);
    activity.descent ??= Math.round(stats.descent);
    activity.minElevation ??= stats.min;
    activity.maxElevation ??= stats.max;
  }

  if (activity.elapsedTime === undefined && streams.n > 1) {
    activity.elapsedTime = (streams.time[streams.n - 1] - streams.time[0]) / 1000;
  }
  if (activity.movingTime === undefined && channels.speed) {
    activity.movingTime = movingTimeFromSpeed(streams);
  }
}

function deriveFromLaps(activity: Activity) {
  if (!activity.laps.length) return;
  if (activity.distance === undefined) {
    const total = activity.laps.reduce((sum, l) => sum + (l.distance ?? 0), 0);
    if (total > 0) activity.distance = total;
  }
  if (activity.elapsedTime === undefined) {
    const total = activity.laps.reduce((sum, l) => sum + (l.elapsedTime ?? 0), 0);
    if (total > 0) activity.elapsedTime = total;
  }
  if (activity.calories === undefined) {
    const total = activity.laps.reduce((sum, l) => sum + (l.calories ?? 0), 0);
    if (total > 0) activity.calories = total;
  }
}

/** Seconds where the athlete was actually moving, from the speed channel. */
function movingTimeFromSpeed(streams: ActivityStreams): number | undefined {
  const speed = streams.channels.speed;
  if (!speed) return undefined;
  let seconds = 0;
  let counted = false;
  for (let i = 1; i < streams.n; i++) {
    const dt = (streams.time[i] - streams.time[i - 1]) / 1000;
    if (!Number.isFinite(dt) || dt <= 0 || dt > 60) continue;
    const v = speed[i];
    if (Number.isFinite(v) && v > 0.3) {
      seconds += dt;
      counted = true;
    }
  }
  return counted ? seconds : undefined;
}

function cleanExtra(extra: Record<string, unknown> | undefined): Activity['extra'] {
  const out: Activity['extra'] = {};
  if (!extra) return out;
  for (const [k, v] of Object.entries(extra)) {
    if (v === undefined) continue;
    if (typeof v === 'number' && !Number.isFinite(v)) continue;
    out[k] = v as Activity['extra'][string];
  }
  return out;
}

function positive(v: number | undefined): number | undefined {
  return v !== undefined && Number.isFinite(v) && v > 0 ? v : undefined;
}
function nonNegative(v: number | undefined): number | undefined {
  return v !== undefined && Number.isFinite(v) && v >= 0 ? v : undefined;
}
function finite(v: number | undefined): number | undefined {
  return v !== undefined && Number.isFinite(v) ? v : undefined;
}
function round1(v: number | undefined): number | undefined {
  return v === undefined ? undefined : Math.round(v * 10) / 10;
}
function meanOfNonZero(arr: Float32Array | undefined): number | undefined {
  if (!arr) return undefined;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < arr.length; i++) {
    if (Number.isFinite(arr[i]) && arr[i] > 0) {
      sum += arr[i];
      n++;
    }
  }
  return n ? sum / n : undefined;
}
function firstFinite(arr: Float32Array): number | undefined {
  for (let i = 0; i < arr.length; i++) if (Number.isFinite(arr[i])) return arr[i];
  return undefined;
}
function lastFinite(arr: Float32Array): number | undefined {
  for (let i = arr.length - 1; i >= 0; i--) if (Number.isFinite(arr[i])) return arr[i];
  return undefined;
}
