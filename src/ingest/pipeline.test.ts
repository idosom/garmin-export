import { describe, expect, it } from 'vitest';
import { zipSync, strToU8, gzipSync } from 'fflate';
import { ingest, sourceFromBytes } from './pipeline.ts';
import { buildFitActivity, buildFitWellness } from '../demo/fixtures.ts';
import { buildActivitiesCsv, buildGpx, buildTcx } from '../demo/textFixtures.ts';

const RUN_START = Date.UTC(2024, 2, 15, 7, 0, 0);
const RIDE_START = Date.UTC(2024, 2, 17, 9, 30, 0);

function mixedExport(): Uint8Array {
  const runFit = buildFitActivity({
    start: RUN_START,
    sport: 'running',
    durationSec: 1800,
    distanceM: 8000,
    withDeveloperField: true,
  });
  return zipSync({
    'DI_CONNECT/DI-Connect-Fitness/2024-03-15_run.fit': runFit,
    'DI_CONNECT/DI-Connect-Wellness/2024-03_wellness.fit': buildFitWellness([
      { dayStart: Date.UTC(2024, 2, 15), steps: 12403, restingHr: 48, sleepHours: 7.4, stress: [22, 31] },
      { dayStart: Date.UTC(2024, 2, 16), steps: 8800, restingHr: 50, sleepHours: 6.8 },
    ]),
    'Activities/ride.tcx': strToU8(buildTcx({ start: RIDE_START, points: 40, sport: 'Biking' })),
    'Activities/hike.gpx': strToU8(buildGpx({ start: Date.UTC(2024, 2, 20, 8, 0, 0), points: 30, type: 'hiking' })),
    // Same run as the FIT file, exported as a CSV row → must be deduplicated.
    'Activities.csv': strToU8(
      buildActivitiesCsv([
        { date: '2024-03-15 07:00:00', type: 'Running', title: 'Morning run', distanceKm: 8, timeSeconds: 1800, calories: 496, avgHr: 141 },
      ]),
    ),
    'README.txt': strToU8('This export was produced by Garmin Connect.'),
    'photos/route.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    'nested/more.zip': zipSync({
      'extra/swim.fit': buildFitActivity({
        start: Date.UTC(2024, 2, 22, 12, 0, 0),
        sport: 'swimming',
        durationSec: 2400,
        distanceM: 1800,
        withGps: false,
      }),
    }),
  });
}

describe('ingest pipeline', () => {
  it('walks a mixed ZIP export and normalizes everything it finds', async () => {
    const phases: string[] = [];
    const dataset = await ingest([sourceFromBytes('export.zip', mixedExport())], {
      onProgress: (p) => phases.push(p.phase),
    });

    expect(phases).toContain('parsing');
    expect(phases[phases.length - 1]).toBe('done');

    const sports = dataset.activities.map((a) => a.sport).sort();
    expect(sports).toEqual(['cycling', 'hiking', 'running', 'swimming']);
    expect(dataset.daily.length).toBeGreaterThanOrEqual(2);
    expect(dataset.report.duplicateActivitiesMerged).toBe(1);
  });

  it('records what each file contributed', async () => {
    const dataset = await ingest([sourceFromBytes('export.zip', mixedExport())]);
    const byName = Object.fromEntries(dataset.report.files.map((f) => [f.name, f]));

    expect(byName['export.zip'].format).toBe('zip');
    expect(byName['2024-03-15_run.fit'].format).toBe('fit');
    expect(byName['2024-03-15_run.fit'].messageCounts.record).toBeGreaterThan(100);
    expect(byName['2024-03-15_run.fit'].developerFields[0].name).toBe('Form Power');
    expect(byName['ride.tcx'].format).toBe('tcx');
    expect(byName['hike.gpx'].format).toBe('gpx');
    expect(byName['Activities.csv'].produced.activities).toBe(1);
    expect(byName['2024-03_wellness.fit'].produced.dailyRecords).toBeGreaterThanOrEqual(2);
    expect(byName['README.txt'].status).toBe('skipped');
    expect(byName['route.png'].status).toBe('skipped');
    expect(byName['swim.fit'].archive).toContain('more.zip');
  });

  it('prefers the FIT copy of a duplicated activity but keeps both sources', async () => {
    const dataset = await ingest([sourceFromBytes('export.zip', mixedExport())]);
    const run = dataset.activities.find((a) => a.sport === 'running')!;
    expect(run.streams).toBeDefined();
    expect(run.sources.map((s) => s.format).sort()).toEqual(['csv', 'fit']);
    expect(run.name).toBe('Morning run');
  });

  it('accepts loose files as well as archives', async () => {
    const dataset = await ingest([
      sourceFromBytes('run.fit', buildFitActivity({ start: RUN_START, durationSec: 600, distanceM: 2000 })),
      sourceFromBytes('ride.tcx', strToU8(buildTcx({ start: RIDE_START, points: 20 }))),
    ]);
    expect(dataset.activities).toHaveLength(2);
    expect(dataset.report.files).toHaveLength(2);
  });

  it('unwraps gzipped files', async () => {
    const gz = gzipSync(buildFitActivity({ start: RUN_START, durationSec: 600, distanceM: 2000 }));
    const dataset = await ingest([sourceFromBytes('activity.fit.gz', gz)]);
    expect(dataset.activities).toHaveLength(1);
    expect(dataset.report.files.some((f) => f.detectedAs === 'gzip archive')).toBe(true);
  });

  it('reports malformed files without aborting the run', async () => {
    const dataset = await ingest([
      sourceFromBytes('broken.fit', new Uint8Array([12, 0x20, 0, 0, 99, 99, 99, 99, 0x2e, 0x46, 0x49, 0x54, 1, 2, 3])),
      sourceFromBytes('good.fit', buildFitActivity({ start: RUN_START, durationSec: 300, distanceM: 1000 })),
    ]);
    expect(dataset.activities).toHaveLength(1);
    const broken = dataset.report.files.find((f) => f.name === 'broken.fit')!;
    expect(broken.warnings.length + broken.errors.length).toBeGreaterThan(0);
  });

  it('handles wellness-only exports with no activities at all', async () => {
    const dataset = await ingest([
      sourceFromBytes(
        'wellness.fit',
        buildFitWellness([{ dayStart: Date.UTC(2024, 2, 15), steps: 5000, weightKg: 70, hrvMs: 55 }]),
      ),
    ]);
    expect(dataset.activities).toHaveLength(0);
    expect(dataset.daily).toHaveLength(1);
    expect(dataset.daily[0].values.weight).toBeCloseTo(70, 1);
  });
});
