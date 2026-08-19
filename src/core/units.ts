import type { MetricKind } from './types.ts';

export type UnitSystem = 'metric' | 'imperial';

export const M_PER_MILE = 1609.344;
export const M_PER_FOOT = 0.3048;
export const KG_PER_LB = 0.45359237;

export interface Formatted {
  value: string;
  unit: string;
}

export function formatNumber(n: number, decimals = 0): string {
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatDistance(metres: number | undefined, units: UnitSystem): Formatted {
  if (metres === undefined || !Number.isFinite(metres)) return { value: '—', unit: '' };
  if (units === 'imperial') {
    const mi = metres / M_PER_MILE;
    if (mi < 0.1) return { value: formatNumber(metres / M_PER_FOOT, 0), unit: 'ft' };
    return { value: formatNumber(mi, mi < 100 ? 2 : 1), unit: 'mi' };
  }
  if (metres < 1000) return { value: formatNumber(metres, 0), unit: 'm' };
  const km = metres / 1000;
  return { value: formatNumber(km, km < 100 ? 2 : 1), unit: 'km' };
}

export function formatElevation(metres: number | undefined, units: UnitSystem): Formatted {
  if (metres === undefined || !Number.isFinite(metres)) return { value: '—', unit: '' };
  return units === 'imperial'
    ? { value: formatNumber(metres / M_PER_FOOT, 0), unit: 'ft' }
    : { value: formatNumber(metres, 0), unit: 'm' };
}

export function formatMass(kg: number | undefined, units: UnitSystem): Formatted {
  if (kg === undefined || !Number.isFinite(kg)) return { value: '—', unit: '' };
  return units === 'imperial'
    ? { value: formatNumber(kg / KG_PER_LB, 1), unit: 'lb' }
    : { value: formatNumber(kg, 1), unit: 'kg' };
}

export function formatTemperature(c: number | undefined, units: UnitSystem): Formatted {
  if (c === undefined || !Number.isFinite(c)) return { value: '—', unit: '' };
  return units === 'imperial'
    ? { value: formatNumber(c * 1.8 + 32, 0), unit: '°F' }
    : { value: formatNumber(c, 0), unit: '°C' };
}

/** `1:04:12` / `4:12` / `12s`. */
export function formatDuration(seconds: number | undefined, opts: { compact?: boolean } = {}): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return '—';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (opts.compact) {
    if (h > 0) return `${h}h ${m.toString().padStart(2, '0')}m`;
    if (m > 0) return `${m}m ${s.toString().padStart(2, '0')}s`;
    return `${s}s`;
  }
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Hours, for training-volume readouts: `12h 30m`. */
export function formatHours(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${m.toString().padStart(2, '0')}m`;
}

/** Speed (m/s) → pace string per km / per mile. */
export function formatPace(speedMs: number | undefined, units: UnitSystem): Formatted {
  if (!speedMs || !Number.isFinite(speedMs) || speedMs <= 0) return { value: '—', unit: '' };
  const perUnit = units === 'imperial' ? M_PER_MILE : 1000;
  const secs = perUnit / speedMs;
  if (secs > 3600 * 3) return { value: '—', unit: '' };
  return { value: formatClock(secs), unit: units === 'imperial' ? '/mi' : '/km' };
}

/** Swim pace: seconds per 100 m (or 100 yd). */
export function formatPace100(speedMs: number | undefined, units: UnitSystem): Formatted {
  if (!speedMs || !Number.isFinite(speedMs) || speedMs <= 0) return { value: '—', unit: '' };
  const per = units === 'imperial' ? 91.44 : 100;
  return { value: formatClock(per / speedMs), unit: units === 'imperial' ? '/100yd' : '/100m' };
}

export function formatSpeed(speedMs: number | undefined, units: UnitSystem): Formatted {
  if (speedMs === undefined || !Number.isFinite(speedMs)) return { value: '—', unit: '' };
  return units === 'imperial'
    ? { value: formatNumber((speedMs * 3600) / M_PER_MILE, 1), unit: 'mph' }
    : { value: formatNumber((speedMs * 3600) / 1000, 1), unit: 'km/h' };
}

/** `m:ss`, used for pace and short durations. */
export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds)) return '—';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Time-of-day readout for bedtime / wake metrics.
 *
 * These are stored as *minutes since local noon* rather than a timestamp, so
 * that a 23:40 bedtime and a 00:20 bedtime are 40 minutes apart rather than 23
 * hours — averages and trends over midnight then behave sensibly.
 */
export function formatClockMinutes(minutesSinceNoon: number): string {
  if (!Number.isFinite(minutesSinceNoon)) return '—';
  const wrapped = ((Math.round(minutesSinceNoon) % 1440) + 1440) % 1440;
  const minuteOfDay = (wrapped + 720) % 1440;
  const date = new Date(Date.UTC(2000, 0, 1, Math.floor(minuteOfDay / 60), minuteOfDay % 60));
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
}

/**
 * Renders any model value using its metric kind. Central so the activity
 * detail view and the explorer can display metrics they know nothing about.
 */
export function formatByKind(
  value: number | undefined,
  kind: MetricKind,
  units: UnitSystem,
  decimals?: number,
): Formatted {
  if (value === undefined || value === null || !Number.isFinite(value)) return { value: '—', unit: '' };
  switch (kind) {
    case 'distance':
      return formatDistance(value, units);
    case 'elevation':
      return formatElevation(value, units);
    case 'mass':
      return formatMass(value, units);
    case 'temperature':
      return formatTemperature(value, units);
    case 'speed':
      return formatSpeed(value, units);
    case 'pace':
      return formatPace(value, units);
    case 'duration':
      return { value: formatHours(value), unit: '' };
    case 'clock':
      return { value: formatClockMinutes(value), unit: '' };
    case 'heartRate':
      return { value: formatNumber(value, decimals ?? 0), unit: 'bpm' };
    case 'power':
      return { value: formatNumber(value, decimals ?? 0), unit: 'W' };
    case 'cadence':
      return { value: formatNumber(value, decimals ?? 0), unit: 'rpm' };
    case 'energy':
      return { value: formatNumber(value, decimals ?? 0), unit: 'kcal' };
    case 'percent':
      return { value: formatNumber(value, decimals ?? 1), unit: '%' };
    case 'length_mm':
      return { value: formatNumber(value, decimals ?? 0), unit: 'mm' };
    case 'time_ms':
      return { value: formatNumber(value, decimals ?? 0), unit: 'ms' };
    case 'score':
      return { value: formatNumber(value, decimals ?? 0), unit: '' };
    case 'ratio':
      return { value: formatNumber(value, decimals ?? 2), unit: '' };
    case 'count':
    default:
      return { value: formatNumber(value, decimals ?? (Math.abs(value) < 10 && !Number.isInteger(value) ? 1 : 0)), unit: '' };
  }
}

export function joinFormatted(f: Formatted): string {
  return f.unit ? `${f.value} ${f.unit}` : f.value;
}

export function formatDate(ms: number, opts: Intl.DateTimeFormatOptions = {}): string {
  return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', ...opts });
}

export function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}
