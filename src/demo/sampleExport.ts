/**
 * A synthetic "Garmin export" used by the Load sample export button.
 *
 * It is generated in the browser and pushed through exactly the same ingestion
 * pipeline as a real upload — nothing is mocked downstream — so it doubles as
 * an end-to-end check that parsing, normalization and the dashboard all work.
 */
import { zipSync, strToU8 } from 'fflate';
import { buildFitActivity, buildFitWellness, buildFitUserProfile, type FitWellnessDay } from './fixtures.ts';
import { buildActivitiesCsv, buildGpx, buildTcx, type CsvActivityRow } from './textFixtures.ts';

interface PlannedActivity {
  start: number;
  /** FIT sport enum name. */
  sport: string;
  subSport?: string;
  durationSec: number;
  distanceM: number;
  title: string;
  withPower: boolean;
  withGps: boolean;
  hrBase: number;
  ascentM: number;
}

const DAY = 86400000;

/** Deterministic pseudo-random so the sample looks the same every time. */
function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

function planActivities(weeks: number, endDay: number): PlannedActivity[] {
  const random = rng(20240315);
  const plan: PlannedActivity[] = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const weekStart = endDay - w * 7 * DAY;
    const easyWeek = w % 4 === 0;
    // `training` + `strength_training` is how Garmin encodes a gym session.
    const sessions: [number, string, string][] = [
      [1, 'running', 'Easy run'],
      [2, 'cycling', 'Morning ride'],
      [3, 'running', 'Intervals'],
      [4, 'training', 'Strength session'],
      [5, 'swimming', 'Pool swim'],
      [6, 'running', 'Long run'],
    ];
    for (const [dayOffset, sport, title] of sessions) {
      if (easyWeek && (sport === 'training' || title === 'Intervals')) continue;
      if (random() < 0.12) continue;
      const start = weekStart + dayOffset * DAY + (6 + Math.floor(random() * 5)) * 3600_000 + Math.floor(random() * 40) * 60_000;
      if (start > Date.now()) continue;
      const base = {
        running: { duration: 2400 + random() * 1800, distance: 7000 + random() * 5000, hr: 116 },
        cycling: { duration: 4200 + random() * 3600, distance: 35000 + random() * 30000, hr: 104 },
        swimming: { duration: 2100 + random() * 900, distance: 1600 + random() * 900, hr: 108 },
        training: { duration: 2700 + random() * 900, distance: 0, hr: 92 },
      }[sport] ?? { duration: 1800, distance: 0, hr: 100 };
      const long = title === 'Long run';
      const hard = title === 'Intervals';
      plan.push({
        start,
        sport,
        subSport: hard ? 'track' : long ? 'trail' : sport === 'training' ? 'strength_training' : undefined,
        durationSec: Math.round(base.duration * (long ? 1.6 : easyWeek ? 0.8 : 1)),
        distanceM: Math.round(base.distance * (long ? 1.7 : easyWeek ? 0.8 : 1)),
        title,
        withPower: sport === 'cycling',
        withGps: sport !== 'training' && sport !== 'swimming',
        hrBase: Math.round(base.hr + (hard ? 16 : long ? 4 : 0) + random() * 8 - (easyWeek ? 6 : 0)),
        ascentM: sport === 'training' || sport === 'swimming' ? 0 : Math.round(base.distance / 1000) * (4 + Math.round(random() * 9)),
      });
    }
  }
  return plan.sort((a, b) => a.start - b.start);
}

export function buildSampleExport(weeks = 14): Uint8Array {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const endDay = today.getTime();
  const plan = planActivities(weeks, endDay);
  const files: Record<string, Uint8Array> = {};

  for (const [i, activity] of plan.entries()) {
    const name = `${new Date(activity.start).toISOString().slice(0, 10)}_${activity.sport}_${i}.fit`;
    files[`DI_CONNECT/DI-Connect-Fitness/${name}`] = buildFitActivity({
      start: activity.start,
      sport: activity.sport,
      subSport: activity.subSport,
      durationSec: activity.durationSec,
      distanceM: activity.distanceM,
      withDistance: activity.distanceM > 0,
      ascentM: activity.ascentM,
      hrBase: activity.hrBase,
      sampleIntervalSec: activity.durationSec > 5000 ? 10 : 5,
      withGps: activity.withGps,
      withPower: activity.withPower,
      withCadence: activity.sport !== 'training',
      withDeveloperField: activity.sport === 'cycling',
      withUnknownField: i % 7 === 0,
      laps: activity.title === 'Intervals' ? 6 : 3,
      deviceName: activity.sport === 'cycling' ? 'Edge 840' : 'Forerunner 965',
    });
  }

  // Wellness for every day in the window.
  const random = rng(77);
  const days: FitWellnessDay[] = [];
  for (let d = weeks * 7; d >= 0; d--) {
    const dayStart = endDay - d * DAY;
    const trained = plan.some((a) => Math.abs(a.start - dayStart) < DAY && a.start >= dayStart);
    days.push({
      dayStart,
      steps: Math.round(6500 + random() * 6000 + (trained ? 3000 : 0)),
      distanceM: Math.round(4800 + random() * 5200),
      calories: Math.round(2350 + random() * 500 + (trained ? 400 : 0)),
      activeCalories: Math.round(320 + random() * 300 + (trained ? 500 : 0)),
      restingHr: Math.round(48 + random() * 6 + (trained ? 1 : 0)),
      stress: Array.from({ length: 6 }, () => Math.round(14 + random() * 45)),
      sleepHours: 6.4 + random() * 1.9,
      weightKg: d % 3 === 0 ? Math.round((73.5 + random() * 1.6 - d * 0.004) * 10) / 10 : undefined,
      hrvMs: Math.round(48 + random() * 22),
      vo2max: d % 7 === 0 ? Math.round((49 + (weeks * 7 - d) * 0.012 + random()) * 10) / 10 : undefined,
    });
  }
  // Split across two files, the way a real export is chunked by month.
  const half = Math.ceil(days.length / 2);
  files['DI_CONNECT/DI-Connect-Wellness/wellness_part1.fit'] = buildFitWellness(days.slice(0, half), -new Date().getTimezoneOffset());
  files['DI_CONNECT/DI-Connect-Wellness/wellness_part2.fit'] = buildFitWellness(days.slice(half), -new Date().getTimezoneOffset());
  files['DI_CONNECT/DI-Connect-User/user_profile.fit'] = buildFitUserProfile('Sample athlete', 73.8, 48);

  // The same activities also exported as a CSV list, plus one GPX and one TCX
  // that duplicate FIT files — exactly the redundancy real exports contain.
  const csvRows: CsvActivityRow[] = plan.slice(-12).map((a) => ({
    date: new Date(a.start).toISOString().slice(0, 19).replace('T', ' '),
    type: a.sport === 'training' ? 'Strength Training' : a.sport.charAt(0).toUpperCase() + a.sport.slice(1),
    title: a.title,
    distanceKm: Math.round((a.distanceM / 1000) * 100) / 100,
    timeSeconds: a.durationSec,
    calories: Math.round(a.durationSec * 0.16),
    avgHr: a.hrBase + 21,
    maxHr: a.hrBase + 52,
    ascentM: a.ascentM || undefined,
    cadence: a.sport === 'running' ? 168 : undefined,
    strideM: a.sport === 'running' ? 1.12 : undefined,
    aerobicTe: 3.2,
  }));
  files['Activities.csv'] = strToU8(buildActivitiesCsv(csvRows));

  const gpxActivity = plan.filter((a) => a.sport === 'running').slice(-1)[0];
  if (gpxActivity) {
    files['Uploads/2024_trail_run.gpx'] = strToU8(
      buildGpx({ start: gpxActivity.start - 21 * DAY, points: 220, intervalSec: 10, name: 'Coastal trail', type: 'trail_running' }),
    );
  }
  const tcxActivity = plan.filter((a) => a.sport === 'cycling').slice(-1)[0];
  if (tcxActivity) {
    files['Uploads/club_ride.tcx'] = strToU8(
      buildTcx({ start: tcxActivity.start - 35 * DAY, points: 260, intervalSec: 15, sport: 'Biking', laps: 4 }),
    );
  }

  files['README.txt'] = strToU8(
    'Sample export generated inside the browser for demonstration.\nIt contains no real personal data.',
  );

  return zipSync(files, { level: 4 });
}

export function sampleExportFile(): File {
  const bytes = buildSampleExport();
  return new File([bytes as unknown as BlobPart], 'sample-garmin-export.zip', { type: 'application/zip' });
}
