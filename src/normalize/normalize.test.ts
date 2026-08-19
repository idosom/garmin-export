import { describe, expect, it } from 'vitest';
import { normalizeActivity, activityKey } from './activity.ts';
import { dedupeActivities, mergeDaily } from './dedupe.ts';
import type { Activity, RawActivity, SourceRef } from '../core/types.ts';
import { SampleBuilder } from '../parsers/streams.ts';

const fit: SourceRef = { fileId: 'f1', path: 'a.fit', format: 'fit' };
const csv: SourceRef = { fileId: 'f2', path: 'a.csv', format: 'csv' };
const START = Date.UTC(2024, 5, 1, 6, 0, 0);

function activity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: 'x',
    sport: 'running',
    startTime: START,
    laps: [],
    hasGps: false,
    extra: {},
    sources: [fit],
    ...overrides,
  };
}

describe('activity normalization', () => {
  it('requires a start time', () => {
    expect(normalizeActivity({ sport: 'running' } as RawActivity, fit)).toBeUndefined();
  });

  it('leaves unavailable metrics undefined rather than zero', () => {
    const result = normalizeActivity({ sport: 'strength', startTime: START, elapsedTime: 2700 }, fit)!;
    expect(result.distance).toBeUndefined();
    expect(result.avgHr).toBeUndefined();
    expect(result.ascent).toBeUndefined();
    expect(result.elapsedTime).toBe(2700);
  });

  it('derives summary values from samples when the file omits them', () => {
    const builder = new SampleBuilder();
    for (let i = 0; i < 100; i++) {
      builder.push(START + i * 1000, { heartRate: 120 + i / 4, speed: 3, elevation: 10 + i * 0.5 }, 40 + i * 0.0001, -73);
    }
    const streams = builder.build()!;
    const result = normalizeActivity({ sport: 'running', startTime: START, streams } as RawActivity, fit)!;
    expect(result.avgHr).toBeCloseTo(132.4, 0);
    expect(result.maxHr).toBeCloseTo(144.75, 1);
    expect(result.hasGps).toBe(true);
    expect(result.ascent).toBeGreaterThan(40);
    expect(result.distance).toBeGreaterThan(0);
    expect(result.movingTime).toBeGreaterThan(0);
  });

  it('keeps unknown fields in extra', () => {
    const result = normalizeActivity(
      { sport: 'running', startTime: START, extra: { field_193: 42, sportProfile: 'Trail', bogus: NaN } },
      fit,
    )!;
    expect(result.extra.field_193).toBe(42);
    expect(result.extra.sportProfile).toBe('Trail');
    expect(result.extra.bogus).toBeUndefined();
  });

  it('gives the same id to the same activity from different files', () => {
    const a = activityKey({ startTime: START, sport: 'running', distance: 10000, elapsedTime: 3000 });
    const b = activityKey({ startTime: START + 20_000, sport: 'running', distance: 10020, elapsedTime: 3005 });
    expect(a).toBe(b);
  });

  it('normalizes odd sport spellings', () => {
    expect(normalizeActivity({ sport: 'Trail Running', startTime: START }, fit)!.sport).toBe('running');
    expect(normalizeActivity({ sport: 'INDOOR_CYCLING', startTime: START }, fit)!.sport).toBe('cycling');
    expect(normalizeActivity({ sport: 'quidditch', startTime: START }, fit)!.sport).toBe('quidditch');
  });
});

describe('duplicate merging', () => {
  it('merges the same activity recorded in two formats, keeping the richer one', () => {
    const rich = activity({ id: 'a', distance: 10000, elapsedTime: 3000, streams: { n: 1, time: new Float64Array([START]), channels: {} } });
    const poor = activity({ id: 'b', distance: 10010, elapsedTime: 3002, calories: 700, name: 'Morning run', sources: [csv] });
    const { activities, merged } = dedupeActivities([poor, rich]);
    expect(merged).toBe(1);
    expect(activities).toHaveLength(1);
    expect(activities[0].streams).toBeDefined();
    expect(activities[0].calories).toBe(700);
    expect(activities[0].name).toBe('Morning run');
    expect(activities[0].sources).toHaveLength(2);
  });

  it('merges timezone-shifted copies of one activity', () => {
    const utc = activity({ id: 'a', distance: 10000, elapsedTime: 3000 });
    const local = activity({ id: 'b', startTime: START + 2 * 3600_000, distance: 10000, elapsedTime: 3000, sources: [csv] });
    expect(dedupeActivities([utc, local]).activities).toHaveLength(1);
  });

  it('keeps genuinely different activities apart', () => {
    const morning = activity({ id: 'a', distance: 10000, elapsedTime: 3000 });
    const evening = activity({ id: 'b', startTime: START + 2 * 3600_000, distance: 4000, elapsedTime: 1200, sources: [csv] });
    expect(dedupeActivities([morning, evening]).activities).toHaveLength(2);
  });

  it('keeps a brick session as two activities', () => {
    const ride = activity({ id: 'a', sport: 'cycling', distance: 40000, elapsedTime: 3600 });
    const run = activity({ id: 'b', sport: 'running', startTime: START + 3600_000, distance: 10000, elapsedTime: 2700 });
    expect(dedupeActivities([ride, run]).activities).toHaveLength(2);
  });

  it('merges daily records from several files without losing metrics', () => {
    const merged = mergeDaily([
      { date: '2024-06-01', values: { steps: 8000 }, sources: [{ fileId: 'a', path: 'a', format: 'fit' }] },
      { date: '2024-06-01', values: { restingHr: 48, steps: 9999 }, sources: [{ fileId: 'b', path: 'b', format: 'json' }] },
      { date: '2024-06-02', values: { steps: 3000 }, sources: [{ fileId: 'a', path: 'a', format: 'fit' }] },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0].values.steps).toBe(8000);
    expect(merged[0].values.restingHr).toBe(48);
    expect(merged[0].sources).toHaveLength(2);
  });
});
