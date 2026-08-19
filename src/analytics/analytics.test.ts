import { describe, expect, it } from 'vitest';
import { buildOverview, volumeBuckets, buildTraining, metricSeries, availableMetrics } from './index.ts';
import { bestDistanceEfforts, bestPowerEfforts, activityHighlights, fastestWindow, bestAverage } from './records.ts';
import { chooseLoadModel } from './load.ts';
import { ingest, sourceFromBytes } from '../ingest/pipeline.ts';
import { buildFitActivity, buildFitWellness } from '../demo/fixtures.ts';
import type { Activity, DailyRecord, Dataset } from '../core/types.ts';

const DAY = 86400000;
const BASE = Date.UTC(2024, 0, 8, 7, 0, 0);

function fakeActivity(over: Partial<Activity>): Activity {
  return {
    id: Math.random().toString(36),
    sport: 'running',
    startTime: BASE,
    elapsedTime: 3600,
    distance: 10000,
    laps: [],
    hasGps: false,
    extra: {},
    sources: [{ fileId: 'f', path: 'p', format: 'fit' }],
    ...over,
  };
}

describe('overview', () => {
  const activities = [
    fakeActivity({ startTime: BASE, sport: 'running', distance: 10000, elapsedTime: 3000, calories: 700, ascent: 100 }),
    fakeActivity({ startTime: BASE + DAY, sport: 'cycling', distance: 40000, elapsedTime: 5400, calories: 1100 }),
    fakeActivity({ startTime: BASE + 2 * DAY, sport: 'running', distance: 5000, elapsedTime: 1500 }),
  ];
  const overview = buildOverview(activities, []);

  it('totals volume and breaks it down by sport', () => {
    expect(overview.activityCount).toBe(3);
    expect(overview.totalDistance).toBe(55000);
    expect(overview.totalDuration).toBe(9900);
    expect(overview.totalCalories).toBe(1800);
    expect(overview.sports.map((s) => s.sport)).toEqual(['cycling', 'running']);
    expect(overview.sports[0].share + overview.sports[1].share).toBeCloseTo(1, 6);
  });

  it('counts active days and streaks', () => {
    expect(overview.activeDays).toBe(3);
    expect(overview.longestStreak).toBe(3);
  });

  it('omits totals for metrics no activity reported', () => {
    const noAscent = buildOverview([fakeActivity({ ascent: undefined, calories: undefined })], []);
    expect(noAscent.totalAscent).toBeUndefined();
    expect(noAscent.totalCalories).toBeUndefined();
  });
});

describe('training volume', () => {
  it('groups by week and fills rest weeks with zeroes', () => {
    const weeks = volumeBuckets(
      [fakeActivity({ startTime: BASE }), fakeActivity({ startTime: BASE + 21 * DAY })],
      'week',
    );
    expect(weeks).toHaveLength(4);
    expect(weeks[0].count).toBe(1);
    expect(weeks[1].count).toBe(0);
    expect(weeks[3].count).toBe(1);
  });

  it('groups by month', () => {
    const months = volumeBuckets([fakeActivity({ startTime: BASE }), fakeActivity({ startTime: BASE + 40 * DAY })], 'month');
    expect(months.map((m) => m.key)).toEqual(['2024-01', '2024-02']);
  });
});

describe('training load model selection', () => {
  it('uses the device figure when the export has one', () => {
    const model = chooseLoadModel([fakeActivity({ trainingLoad: 210 }), fakeActivity({ trainingLoad: 180 })]);
    expect(model.source).toBe('device');
    expect(model.loadOf(fakeActivity({ trainingLoad: 210 }))).toBe(210);
  });

  it('falls back to heart rate, then to duration', () => {
    expect(chooseLoadModel([fakeActivity({ avgHr: 150 })]).source).toBe('trimp');
    expect(chooseLoadModel([fakeActivity({})]).source).toBe('duration');
  });

  it('produces fitness/fatigue curves over the covered days', () => {
    const dataset: Dataset = {
      id: 'd',
      createdAt: 0,
      label: 'x',
      activities: [fakeActivity({ startTime: BASE, avgHr: 150 }), fakeActivity({ startTime: BASE + 10 * DAY, avgHr: 160 })],
      daily: [],
      report: { files: [], startedAt: 0, finishedAt: 0, totalBytes: 0, duplicateActivitiesMerged: 0, warnings: [] },
    };
    const training = buildTraining(dataset);
    expect(training.load!.dates).toHaveLength(11);
    expect(training.load!.ctl[10]).toBeGreaterThan(0);
    expect(training.load!.tsb).toHaveLength(11);
  });
});

describe('best efforts', () => {
  it('finds the fastest window inside a distance stream', async () => {
    const dataset = await ingest([
      sourceFromBytes('run.fit', buildFitActivity({ start: BASE, sport: 'running', durationSec: 3600, distanceM: 12000 })),
    ]);
    const efforts = bestDistanceEfforts(dataset.activities);
    const fiveK = efforts.find((e) => e.key === '5k')!;
    expect(fiveK).toBeDefined();
    expect(fiveK.value).toBeGreaterThan(1100);
    expect(fiveK.value).toBeLessThan(1800);
    // A 10 km best must be slower than a 5 km best over the same run.
    const tenK = efforts.find((e) => e.key === '10k')!;
    expect(tenK.value).toBeGreaterThan(fiveK.value);
    expect(efforts.find((e) => e.key === 'marathon')).toBeUndefined();
  });

  it('computes best average power windows', async () => {
    const dataset = await ingest([
      sourceFromBytes('ride.fit', buildFitActivity({ start: BASE, sport: 'cycling', durationSec: 4200, distanceM: 34000, withPower: true })),
    ]);
    const powers = bestPowerEfforts(dataset.activities);
    expect(powers.map((p) => p.key)).toContain('5m');
    const oneMin = powers.find((p) => p.key === '1m')!;
    const twentyMin = powers.find((p) => p.key === '20m')!;
    expect(oneMin.value).toBeGreaterThanOrEqual(twentyMin.value);
    expect(powers.find((p) => p.key === '60m')).toBeDefined();
  });

  it('returns nothing when there are no usable streams', () => {
    expect(bestDistanceEfforts([fakeActivity({})])).toEqual([]);
    expect(bestPowerEfforts([fakeActivity({})])).toEqual([]);
  });

  it('handles gaps in the stream', () => {
    const time = new Float64Array([0, 1000, 2000, 3000, 4000]);
    const distance = new Float32Array([0, NaN, 200, 300, 400]);
    expect(fastestWindow(time, distance, 200)).toBeCloseTo(2, 5);
    const values = new Float32Array([100, 200, 200, 200, 100]);
    expect(bestAverage(time, values, 2)).toBeGreaterThan(150);
  });

  it('reports superlatives with the activity they came from', () => {
    const long = fakeActivity({ distance: 42000, elapsedTime: 14000 });
    const highlights = activityHighlights([long, fakeActivity({ distance: 5000 })]);
    const longest = highlights.find((h) => h.key === 'longestDistance')!;
    expect(longest.value).toBe(42000);
    expect(longest.activityId).toBe(long.id);
  });
});

describe('wellness series', () => {
  const daily: DailyRecord[] = [
    { date: '2024-01-01', values: { restingHr: 52, steps: 8000 }, sources: [] },
    { date: '2024-01-02', values: { restingHr: 51, steps: 12000 }, sources: [] },
    { date: '2024-01-04', values: { restingHr: 49, steps: 9000 }, sources: [] },
    { date: '2024-01-05', values: { restingHr: 48 }, sources: [] },
  ];

  it('lists only metrics that actually have values', () => {
    const keys = availableMetrics(daily).map((m) => m.key);
    expect(keys).toContain('restingHr');
    expect(keys).toContain('steps');
    expect(keys).not.toContain('bodyBatteryMax');
  });

  it('summarizes a metric and its trend', () => {
    const series = metricSeries(daily, 'restingHr');
    expect(series.points).toHaveLength(4);
    expect(series.latest!.value).toBe(48);
    expect(series.min).toBe(48);
    expect(series.max).toBe(52);
    expect(series.trendPerMonth!).toBeLessThan(0);
    expect(series.coverage).toBeCloseTo(4 / 5, 5);
  });

  it('filters by date range', () => {
    expect(metricSeries(daily, 'steps', { from: '2024-01-02', to: '2024-01-04' }).points).toHaveLength(2);
  });

  it('works on a wellness-only export', async () => {
    const dataset = await ingest([
      sourceFromBytes(
        'w.fit',
        buildFitWellness([
          { dayStart: Date.UTC(2024, 0, 1), steps: 9000, sleepHours: 7 },
          { dayStart: Date.UTC(2024, 0, 2), steps: 11000, sleepHours: 8 },
        ]),
      ),
    ]);
    const overview = buildOverview(dataset.activities, dataset.daily);
    expect(overview.activityCount).toBe(0);
    expect(overview.range).toBeDefined();
    expect(availableMetrics(dataset.daily).length).toBeGreaterThan(0);
  });
});
