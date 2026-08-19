/**
 * Duplicate handling.
 *
 * A single ride commonly appears three times in one export: the original FIT,
 * a TCX or GPX copy, and a row in `Activities.csv`. They disagree about
 * precision and sometimes about the clock (CSV rows carry local wall-clock time
 * with no zone), so matching is done in two passes: exact-ish, then a
 * whole-hour-offset pass that also requires the duration and distance to agree.
 */
import type { Activity } from '../core/types.ts';

const FORMAT_RANK: Record<string, number> = { fit: 4, tcx: 3, gpx: 2, json: 1, csv: 0, unknown: 0, zip: 0 };

export interface DedupeResult {
  activities: Activity[];
  merged: number;
}

export function dedupeActivities(activities: Activity[]): DedupeResult {
  const sorted = [...activities].sort((a, b) => a.startTime - b.startTime || rank(b) - rank(a));
  const kept: Activity[] = [];
  let merged = 0;

  // `sorted` is ascending by start time, so a match can only be within the
  // timezone-shift window — scanning backwards keeps this linear on big exports.
  const WINDOW_MS = 15 * 3600_000;
  for (const candidate of sorted) {
    let match: Activity | undefined;
    for (let i = kept.length - 1; i >= 0; i--) {
      const existing = kept[i];
      if (candidate.startTime - existing.startTime > WINDOW_MS) break;
      if (isSameActivity(existing, candidate)) {
        match = existing;
        break;
      }
    }
    if (match) {
      mergeInto(match, candidate);
      merged++;
    } else {
      kept.push(candidate);
    }
  }

  kept.sort((a, b) => b.startTime - a.startTime);
  return { activities: kept, merged };
}

function rank(a: Activity): number {
  const format = a.sources[0]?.format ?? 'unknown';
  return (FORMAT_RANK[format] ?? 0) * 10 + (a.streams ? 5 : 0) + (a.laps.length ? 1 : 0);
}

function isSameActivity(a: Activity, b: Activity): boolean {
  if (a.sport !== b.sport && a.sport !== 'other' && b.sport !== 'other') return false;
  const dt = Math.abs(a.startTime - b.startTime);
  if (dt <= 120_000) return closeEnough(a, b, 0.15);
  // Timezone-shifted duplicate: whole (or half) hour apart, same shape.
  if (dt < 15 * 3600_000) {
    const remainder = dt % 1800_000;
    if (remainder <= 120_000 || remainder >= 1800_000 - 120_000) return closeEnough(a, b, 0.03);
  }
  return false;
}

function closeEnough(a: Activity, b: Activity, tolerance: number): boolean {
  const durA = a.elapsedTime ?? a.timerTime;
  const durB = b.elapsedTime ?? b.timerTime;
  if (durA && durB && relDiff(durA, durB) > tolerance && Math.abs(durA - durB) > 90) return false;
  if (a.distance && b.distance && relDiff(a.distance, b.distance) > tolerance && Math.abs(a.distance - b.distance) > 200) {
    return false;
  }
  return true;
}

function relDiff(a: number, b: number): number {
  const max = Math.max(Math.abs(a), Math.abs(b));
  return max === 0 ? 0 : Math.abs(a - b) / max;
}

/** Keeps the richer record and back-fills anything only the other one knew. */
function mergeInto(target: Activity, other: Activity) {
  const winner = rank(target) >= rank(other) ? target : other;
  const loser = winner === target ? other : target;

  if (winner !== target) {
    // Promote the richer record in place so array identity is preserved.
    const snapshot: Activity = { ...winner };
    Object.assign(target, snapshot);
  }

  for (const [key, value] of Object.entries(loser) as [keyof Activity, unknown][]) {
    if (key === 'sources' || key === 'extra' || key === 'laps' || key === 'streams' || key === 'id') continue;
    if (value === undefined || value === null) continue;
    if (target[key] === undefined || target[key] === null) {
      (target as unknown as Record<string, unknown>)[key] = value;
    }
  }
  if (!target.laps.length && loser.laps.length) target.laps = loser.laps;
  if (!target.streams && loser.streams) target.streams = loser.streams;
  target.extra = { ...loser.extra, ...target.extra };
  const seen = new Set(target.sources.map((s) => `${s.fileId}:${s.path}`));
  for (const s of loser.sources) {
    if (!seen.has(`${s.fileId}:${s.path}`)) {
      target.sources.push(s);
      seen.add(`${s.fileId}:${s.path}`);
    }
  }
  if (!target.hasGps && loser.hasGps) {
    target.hasGps = true;
    target.bounds = loser.bounds;
  }
}

/** Merges wellness days coming from several files, newest source winning. */
export function mergeDaily(
  records: { date: string; values: Record<string, number>; sources: { fileId: string; path: string; format: string }[] }[],
): typeof records {
  const byDate = new Map<string, (typeof records)[number]>();
  for (const record of records) {
    const existing = byDate.get(record.date);
    if (!existing) {
      byDate.set(record.date, { ...record, values: { ...record.values }, sources: [...record.sources] });
      continue;
    }
    for (const [key, value] of Object.entries(record.values)) {
      if (existing.values[key] === undefined || !Number.isFinite(existing.values[key])) existing.values[key] = value;
    }
    for (const source of record.sources) {
      if (!existing.sources.some((s) => s.fileId === source.fileId && s.path === source.path)) existing.sources.push(source);
    }
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}
