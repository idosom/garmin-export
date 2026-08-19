/**
 * Time helpers.
 *
 * Garmin exports mix UTC timestamps (FIT `timestamp`, TCX `<Time>`) with local
 * wall-clock strings (CSV date columns, JSON `calendarDate`). Everything in the
 * model is epoch-ms UTC plus an optional offset, and calendar-day bucketing is
 * always done against the *local* day the user experienced.
 */

/** FIT timestamps count seconds from 1989-12-31T00:00:00Z. */
export const FIT_EPOCH_MS = 631065600000;

export const DAY_MS = 86400000;

export function fitTimestampToMs(seconds: number): number {
  return FIT_EPOCH_MS + seconds * 1000;
}

export function msToFitTimestamp(ms: number): number {
  return Math.round((ms - FIT_EPOCH_MS) / 1000);
}

/** `YYYY-MM-DD` for an instant, shifted by an optional local offset (minutes). */
export function localDayKey(ms: number, offsetMin = 0): string {
  const d = new Date(ms + offsetMin * 60000);
  return isoDay(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export function isoDay(y: number, m: number, d: number): string {
  return `${y.toString().padStart(4, '0')}-${m.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`;
}

/** Midnight UTC of a `YYYY-MM-DD` key — used purely as a sortable position. */
export function dayKeyToMs(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, (m ?? 1) - 1, d ?? 1);
}

export function addDays(key: string, n: number): string {
  return localDayKey(dayKeyToMs(key) + n * DAY_MS);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((dayKeyToMs(b) - dayKeyToMs(a)) / DAY_MS);
}

/** Monday-based ISO week key, `YYYY-Www`. */
export function weekKey(dayKey: string): string {
  const ms = dayKeyToMs(dayKey);
  const d = new Date(ms);
  const dayIdx = (d.getUTCDay() + 6) % 7; // Mon=0
  const thursday = new Date(ms + (3 - dayIdx) * DAY_MS);
  const year = thursday.getUTCFullYear();
  const jan1 = Date.UTC(year, 0, 1);
  const week = Math.floor((thursday.getTime() - jan1) / (7 * DAY_MS)) + 1;
  return `${year}-W${week.toString().padStart(2, '0')}`;
}

/** Monday of the week containing `dayKey`. */
export function weekStart(dayKey: string): string {
  const d = new Date(dayKeyToMs(dayKey));
  const dayIdx = (d.getUTCDay() + 6) % 7;
  return addDays(dayKey, -dayIdx);
}

export function monthKey(dayKey: string): string {
  return dayKey.slice(0, 7);
}

/**
 * Best-effort timestamp parser for the many date shapes in Garmin exports.
 * Returns epoch ms, or `undefined` when the value is not a date.
 *
 * @param naiveAsLocal when a value carries no timezone (Garmin's CSV date
 *   columns are the account's local wall clock) interpret it in the viewer's
 *   timezone instead of UTC, so the activity shows the time it was recorded.
 */
export function parseTimestamp(value: unknown, naiveAsLocal = false): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value.getTime();
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return undefined;
    // Heuristics: seconds vs milliseconds vs FIT seconds.
    if (value > 1e12) return value;
    if (value > 1e9) return value * 1000;
    if (value > 3e8) return fitTimestampToMs(value);
    return undefined;
  }
  const s = String(value).trim();
  if (!s) return undefined;
  if (/^\d{13,}$/.test(s)) return Number(s);
  if (/^\d{10}$/.test(s)) return Number(s) * 1000;

  // ISO-ish: 2024-03-15T06:31:00Z / 2024-03-15 06:31:00 / 2024-03-15
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/.exec(s);
  if (iso) {
    const [, y, mo, d, h = '0', mi = '0', se = '0', frac = '0', tz] = iso;
    const ms = Math.round(Number(`0.${frac}`) * 1000);
    if (!tz && naiveAsLocal) return new Date(+y, +mo - 1, +d, +h, +mi, +se, ms).getTime();
    const base = Date.UTC(+y, +mo - 1, +d, +h, +mi, +se, ms);
    if (!tz || tz === 'Z') return base;
    const sign = tz.startsWith('-') ? -1 : 1;
    const [th, tm] = tz.slice(1).replace(':', '').match(/\d{2}/g)!.map(Number);
    return base - sign * (th * 60 + tm) * 60000;
  }

  // Garmin CSV local formats: 2024-03-15 06:31:00 handled above; also
  // "15/03/2024 06:31" and "03/15/2024 6:31:00 AM".
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?$/.exec(s);
  if (slash) {
    const [, a, b, y, h = '0', mi = '0', se = '0', ampm] = slash;
    // Ambiguous day/month: treat >12 as the day, otherwise assume US order
    // (which is what Garmin Connect emits for en-US accounts).
    let month = +a;
    let day = +b;
    if (+a > 12) {
      day = +a;
      month = +b;
    }
    let hour = +h;
    if (ampm) {
      const pm = ampm.toLowerCase() === 'pm';
      if (pm && hour < 12) hour += 12;
      if (!pm && hour === 12) hour = 0;
    }
    return naiveAsLocal
      ? new Date(+y, month - 1, day, hour, +mi, +se).getTime()
      : Date.UTC(+y, month - 1, day, hour, +mi, +se);
  }

  const parsed = Date.parse(s);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Parses Garmin duration strings: `01:23:45`, `23:45`, `1:23:45.6`,
 * `45.6`, `1h 5m`, plain seconds.
 */
export function parseDuration(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  const s = String(value).trim();
  if (!s || s === '--' || s === '-') return undefined;
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  const parts = s.split(':');
  if (parts.length >= 2 && parts.every((p) => /^\d*\.?\d*$/.test(p.trim()))) {
    let total = 0;
    for (const p of parts) total = total * 60 + Number(p || 0);
    return Number.isFinite(total) ? total : undefined;
  }
  const hms = /^(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+(?:\.\d+)?)\s*m(?:in)?)?\s*(?:(\d+(?:\.\d+)?)\s*s)?$/i.exec(s);
  if (hms && (hms[1] || hms[2] || hms[3])) {
    return (Number(hms[1] ?? 0) * 3600) + (Number(hms[2] ?? 0) * 60) + Number(hms[3] ?? 0);
  }
  return undefined;
}

/**
 * Pulls a calendar-day key out of a value that is already a date (`2024-03-15`,
 * `2024-03-15T00:00:00`), without a timezone round-trip that could shift the
 * day. Falls back to parsing for anything else.
 */
export function dayKeyFromValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  }
  const t = parseTimestamp(value);
  return t === undefined ? undefined : localDayKey(t);
}

/** `YYYY-MM-DD` in the viewer's own timezone. */
export function viewerDayKey(ms: number): string {
  const d = new Date(ms);
  return isoDay(d.getFullYear(), d.getMonth() + 1, d.getDate());
}
