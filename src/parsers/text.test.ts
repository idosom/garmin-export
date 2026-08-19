import { describe, expect, it } from 'vitest';
import { parseGpx } from './gpx.ts';
import { parseTcx } from './tcx.ts';
import { parseGarminCsv } from './csv/garmin.ts';
import { parseGarminJson } from './json/garminJson.ts';
import { buildGpx, buildTcx, buildActivitiesCsv, buildWellnessCsv } from '../demo/textFixtures.ts';
import { normalizeActivity } from '../normalize/activity.ts';

const SOURCE = { fileId: 'f1', path: 'x', format: 'gpx' as const };
const START = Date.UTC(2024, 2, 15, 7, 0, 0);

describe('GPX', () => {
  const result = parseGpx(buildGpx({ start: START, points: 40, name: 'Riverside Loop', type: 'trail_running' }));

  it('reads track metadata and points', () => {
    expect(result.activities).toHaveLength(1);
    const activity = result.activities[0];
    expect(activity.name).toBe('Riverside Loop');
    expect(activity.sport).toBe('running');
    expect(activity.startTime).toBe(START);
    expect(activity.streams!.n).toBe(40);
  });

  it('reads TrackPointExtension channels', () => {
    const channels = Object.keys(result.activities[0].streams!.channels);
    expect(channels).toEqual(expect.arrayContaining(['heartRate', 'cadence', 'temperature', 'elevation']));
  });

  it('derives distance and elevation from the track when absent', () => {
    const activity = normalizeActivity(result.activities[0], SOURCE)!;
    expect(activity.hasGps).toBe(true);
    expect(activity.distance).toBeGreaterThan(1000);
    expect(activity.ascent).toBeGreaterThan(0);
    expect(activity.bounds!.maxLat).toBeGreaterThan(activity.bounds!.minLat);
  });

  it('keeps unknown numeric extension elements as channels', () => {
    const withPower = parseGpx(buildGpx({ start: START, points: 5, withPower: true }));
    expect(Object.keys(withPower.activities[0].streams!.channels)).toContain('power');
  });

  it('handles a GPX file with no track points', () => {
    const empty = parseGpx('<?xml version="1.0"?><gpx><metadata><time>2024-01-01T00:00:00Z</time></metadata></gpx>');
    expect(empty.activities).toHaveLength(0);
    expect(empty.warnings.length).toBeGreaterThan(0);
  });

  it('decodes XML entities in names', () => {
    const gpx = buildGpx({ start: START, points: 3, name: 'Ben &amp; Jerry Hill' });
    expect(parseGpx(gpx).activities[0].name).toBe('Ben & Jerry Hill');
  });
});

describe('TCX', () => {
  const result = parseTcx(buildTcx({ start: START, points: 60, sport: 'Biking', laps: 3 }));

  it('reads activity, laps and trackpoints', () => {
    expect(result.activities).toHaveLength(1);
    const activity = result.activities[0];
    expect(activity.sport).toBe('cycling');
    expect(activity.startTime).toBe(START);
    expect(activity.laps).toHaveLength(3);
    expect(activity.streams!.n).toBe(60);
  });

  it('aggregates lap summaries into the activity', () => {
    const activity = result.activities[0];
    expect(activity.distance).toBeGreaterThan(7000);
    expect(activity.calories).toBeGreaterThan(0);
    expect(activity.avgHr).toBeGreaterThan(100);
    expect(activity.maxHr).toBeGreaterThanOrEqual(activity.avgHr!);
  });

  it('reads TPX extension channels', () => {
    const channels = Object.keys(result.activities[0].streams!.channels);
    expect(channels).toEqual(expect.arrayContaining(['speed', 'power', 'heartRate', 'cadence', 'distance', 'elevation']));
  });

  it('handles a lap with no trackpoints', () => {
    const tcx = `<?xml version="1.0"?><TrainingCenterDatabase><Activities><Activity Sport="Running">
      <Id>2024-03-15T07:00:00Z</Id>
      <Lap StartTime="2024-03-15T07:00:00Z"><TotalTimeSeconds>600</TotalTimeSeconds><DistanceMeters>2000</DistanceMeters><Calories>150</Calories></Lap>
    </Activity></Activities></TrainingCenterDatabase>`;
    const parsed = parseTcx(tcx);
    expect(parsed.activities).toHaveLength(1);
    expect(parsed.activities[0].distance).toBe(2000);
    expect(parsed.activities[0].streams).toBeUndefined();
    const activity = normalizeActivity(parsed.activities[0], SOURCE)!;
    expect(activity.hasGps).toBe(false);
  });
});

describe('Garmin activity CSV', () => {
  const csv = buildActivitiesCsv([
    { date: '2024-03-15 07:00:00', type: 'Trail Running', title: 'Ridge loop', distanceKm: 12.4, timeSeconds: 4020, calories: 1024, avgHr: 148, maxHr: 172, ascentM: 320, cadence: 168, strideM: 1.12, aerobicTe: 3.6 },
    { date: '2024-03-17 09:30:00', type: 'Cycling', title: 'Coffee ride', distanceKm: 48.2, timeSeconds: 5400, calories: 1290, avgHr: 132, maxHr: 165, ascentM: 410 },
    { date: '2024-03-18 18:00:00', type: 'Strength Training', title: 'Gym', distanceKm: 0, timeSeconds: 2700, calories: 310 },
  ]);
  const result = parseGarminCsv(csv);

  it('maps the Garmin column set onto the model', () => {
    expect(result.activities).toHaveLength(3);
    const [run] = result.activities;
    expect(run.sport).toBe('running');
    expect(run.name).toBe('Ridge loop');
    expect(run.distance).toBeCloseTo(12400, 0);
    expect(run.elapsedTime).toBe(4020);
    expect(run.calories).toBe(1024);
    expect(run.avgHr).toBe(148);
    expect(run.ascent).toBe(320);
    expect(run.trainingEffectAerobic).toBeCloseTo(3.6, 1);
  });

  it('converts pace columns to speed', () => {
    const run = result.activities[0];
    expect(run.avgSpeed).toBeCloseTo(12400 / 4020, 1);
    expect(run.maxSpeed!).toBeGreaterThan(run.avgSpeed!);
  });

  it('treats "--" as missing rather than zero', () => {
    const strength = result.activities[2];
    expect(strength.avgHr).toBeUndefined();
    expect(strength.ascent).toBeUndefined();
    expect(strength.calories).toBe(310);
  });

  it('parses thousands separators', () => {
    expect(result.activities[1].calories).toBe(1290);
  });

  it('keeps unrecognised columns in extra', () => {
    const withExtra = parseGarminCsv('Activity Type,Date,Distance,Time,Mystery Metric\nRunning,2024-03-15 07:00:00,5.00,00:25:00,42');
    expect(withExtra.activities[0].extra!['Mystery Metric']).toBe(42);
    expect(withExtra.unknownFields).toContain('Mystery Metric');
  });

  it('detects imperial exports from stride length and cadence', () => {
    const imperial = buildActivitiesCsv([
      { date: '2024-03-15 07:00:00', type: 'Running', title: 'A', distanceKm: 6.2, timeSeconds: 3000, cadence: 170, strideM: 3.83 },
      { date: '2024-03-16 07:00:00', type: 'Running', title: 'B', distanceKm: 3.1, timeSeconds: 1500, cadence: 172, strideM: 3.79 },
      { date: '2024-03-17 07:00:00', type: 'Running', title: 'C', distanceKm: 13.1, timeSeconds: 6600, cadence: 168, strideM: 3.72 },
    ]);
    const parsed = parseGarminCsv(imperial);
    // 6.2 miles ≈ 9977 m, not 6200 m.
    expect(parsed.activities[0].distance).toBeGreaterThan(9000);
  });

  it('reads a wellness CSV as daily records', () => {
    const wellness = parseGarminCsv(
      buildWellnessCsv([
        { date: '2024-03-15', restingHr: 48, steps: 12403, sleepSeconds: 27000, stress: 28, weightKg: 74.5 },
        { date: '2024-03-16', restingHr: 51, steps: 8100, sleepSeconds: 21600, stress: 35 },
      ]),
    );
    expect(wellness.activities).toHaveLength(0);
    expect(wellness.daily).toHaveLength(2);
    expect(wellness.daily[0].values.restingHr).toBe(48);
    expect(wellness.daily[0].values.steps).toBe(12403);
    expect(wellness.daily[0].values.sleepDuration).toBe(27000);
    expect(wellness.daily[0].values.weight).toBeCloseTo(74.5, 1);
    expect(wellness.daily[1].values.weight).toBeUndefined();
  });

  it('reads `7:30` sleep durations as hours and minutes', () => {
    const parsed = parseGarminCsv('Date,Sleep Time,Resting Heart Rate\n2024-03-15,7:30,48');
    expect(parsed.daily[0].values.sleepDuration).toBe(27000);
  });

  it('reports unrecognised CSVs instead of guessing', () => {
    const junk = parseGarminCsv('alpha,beta\n1,2\n3,4');
    expect(junk.activities).toHaveLength(0);
    expect(junk.daily).toHaveLength(0);
    expect(junk.warnings.join(' ')).toMatch(/Unrecognised/);
  });

  it('handles semicolon-delimited files and decimal commas', () => {
    const euro = 'Activity Type;Date;Distance;Time;Calories\nRunning;2024-03-15 07:00:00;10,05;00:52:33;620';
    const parsed = parseGarminCsv(euro);
    expect(parsed.activities).toHaveLength(1);
    expect(parsed.activities[0].distance).toBeCloseTo(10050, 0);
    expect(parsed.activities[0].elapsedTime).toBe(3153);
  });
});

describe('Garmin JSON', () => {
  it('reads UDS-style wellness days', () => {
    const json = JSON.stringify([
      {
        calendarDate: '2024-03-15',
        totalSteps: 9421,
        totalKilocalories: 2712,
        activeKilocalories: 812,
        restingHeartRate: 49,
        averageStressLevel: 27,
        maxStressLevel: 88,
        sleepingSeconds: 26400,
        bodyBatteryHighestValue: 92,
        bodyBatteryLowestValue: 24,
        floorsAscended: 14,
        unknownFutureMetric: 5,
      },
    ]);
    const result = parseGarminJson(json, 'UDSFile_2024-03-15.json');
    expect(result.daily).toHaveLength(1);
    const values = result.daily[0].values;
    expect(values.steps).toBe(9421);
    expect(values.restingHr).toBe(49);
    expect(values.bodyBatteryMax).toBe(92);
    expect(values.bodyBatteryMin).toBe(24);
    expect(values.sleepDuration).toBe(26400);
    expect(result.unknownFields).toContain('unknownFutureMetric');
  });

  it('reads summarizedActivities with centimetre units', () => {
    const json = JSON.stringify([
      {
        summarizedActivitiesExport: [
          {
            activityId: 12345,
            activityName: 'Lunch ride',
            activityType: 'cycling',
            beginTimestamp: START,
            duration: 3600000,
            distance: 3000000,
            elevationGain: 25000,
            calories: 780,
            avgHr: 134,
            maxHr: 168,
            avgSpeed: 833,
          },
        ],
      },
    ]);
    const result = parseGarminJson(json, 'x_summarizedActivities.json');
    expect(result.activities).toHaveLength(1);
    const activity = result.activities[0];
    expect(activity.sport).toBe('cycling');
    expect(activity.distance).toBe(30000);
    expect(activity.ascent).toBe(250);
    expect(activity.timerTime).toBe(3600);
    expect(activity.avgSpeed).toBeCloseTo(8.33, 2);
  });

  it('reports invalid JSON without throwing', () => {
    const result = parseGarminJson('{not json', 'broken.json');
    expect(result.warnings.join(' ')).toMatch(/Invalid JSON/);
  });
});
