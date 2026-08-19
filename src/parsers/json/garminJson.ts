/**
 * Garmin JSON → `ParseResult`.
 *
 * The "Export Your Data" archive carries most wellness history as JSON
 * (`UDSFile_*.json`, `*_sleepData.json`, `*_summarizedActivities.json`, …).
 * These files are not documented, so the parser is structural rather than
 * schema-driven: find arrays of objects, decide per object whether it looks
 * like a day of wellness or an activity, and map keys by synonym. Unknown
 * numeric keys are kept so they still surface in the Data Explorer.
 */
import { emptyParseResult, type ParseResult, type RawActivity, type Scalar } from '../../core/types.ts';
import { dayKeyFromValue, parseTimestamp } from '../../core/time.ts';
import { normalizeSport } from '../../core/metrics.ts';
import { DailyBuilder } from '../daily.ts';

const DATE_KEYS = ['calendarDate', 'calendar_date', 'date', 'day', 'statisticsStartDate', 'summaryDate'];

/** Garmin JSON key → wellness metric key. Values are already SI unless noted. */
const WELLNESS_KEYS: Record<string, string> = {
  totalSteps: 'steps',
  steps: 'steps',
  stepGoal: 'stepsGoal',
  totalDistanceMeters: 'walkingDistance',
  totalDistance: 'walkingDistance',
  totalKilocalories: 'totalCalories',
  activeKilocalories: 'activeCalories',
  bmrKilocalories: 'restingCalories',
  restingHeartRate: 'restingHr',
  restingHeartRateTimestamp: '',
  minHeartRate: 'minHr',
  maxHeartRate: 'maxHr',
  currentDayRestingHeartRate: 'restingHr',
  averageStressLevel: 'stressAvg',
  maxStressLevel: 'stressMax',
  restStressDuration: 'restStressSeconds',
  highStressDuration: 'highStressSeconds',
  sleepingSeconds: 'sleepDuration',
  sleepTimeSeconds: 'sleepDuration',
  deepSleepSeconds: 'sleepDeep',
  lightSleepSeconds: 'sleepLight',
  remSleepSeconds: 'sleepRem',
  awakeSleepSeconds: 'sleepAwake',
  awakeSeconds: 'sleepAwake',
  overallScore: 'sleepScore',
  sleepScore: 'sleepScore',
  moderateIntensityMinutes: 'moderateIntensityMinutes',
  vigorousIntensityMinutes: 'vigorousIntensityMinutes',
  floorsAscended: 'floorsClimbed',
  floorsClimbed: 'floorsClimbed',
  bodyBatteryChargedValue: 'bodyBatteryCharged',
  bodyBatteryDrainedValue: 'bodyBatteryDrained',
  bodyBatteryHighestValue: 'bodyBatteryMax',
  bodyBatteryLowestValue: 'bodyBatteryMin',
  bodyBatteryMostRecentValue: 'bodyBattery',
  vo2MaxValue: 'vo2max',
  vO2MaxValue: 'vo2max',
  vo2MaxPreciseValue: 'vo2max',
  avgWakingRespirationValue: 'respirationAvg',
  avgSpo2: 'spo2Avg',
  averageSpo2: 'spo2Avg',
  averageSpO2: 'spo2Avg',
  lastNightAvg: 'hrv',
  lastNightAverage: 'hrv',
  weeklyAvg: 'hrvWeekly',
  weeklyAverage: 'hrvWeekly',
  bodyFat: 'bodyFat',
  bodyFatPercentage: 'bodyFat',
  bmi: 'bmi',
  muscleMass: 'muscleMass',
  boneMass: 'boneMass',
  bodyWater: 'bodyWater',
  fitnessAge: 'fitnessAge',
};

/** Keys whose Garmin JSON unit differs from the model unit. */
const CONVERSIONS: Record<string, (v: number) => number> = {
  weight: (v) => (v > 500 ? v / 1000 : v), // grams in most exports
  muscleMass: (v) => (v > 500 ? v / 1000 : v),
  boneMass: (v) => (v > 500 ? v / 1000 : v),
};

const ACTIVITY_HINTS = ['activityId', 'activityType', 'beginTimestamp', 'startTimeGmt', 'startTimeLocal', 'activityName'];

export function parseGarminJson(text: string, fileName = ''): ParseResult {
  const result = emptyParseResult('json');
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch (err) {
    result.warnings.push(`Invalid JSON: ${(err as Error).message}`);
    result.detectedAs = 'JSON (unparseable)';
    return result;
  }

  const objects: Record<string, unknown>[] = [];
  collectRecords(root, objects, 0);
  if (!objects.length) {
    result.warnings.push('No record objects found in JSON');
    result.detectedAs = 'JSON (no records)';
    return result;
  }

  const daily = new DailyBuilder();
  const unknown = new Set<string>();
  const seenKeys = new Set<string>();
  let wellnessRows = 0;
  let activityRows = 0;
  const centimetreUnits = /summarizedActivities/i.test(fileName) || objects.some((o) => 'summarizedActivitiesExport' in o);

  for (const obj of objects) {
    for (const k of Object.keys(obj)) seenKeys.add(k);
    if (looksLikeActivity(obj)) {
      const act = readActivity(obj, centimetreUnits, unknown);
      if (act) {
        result.activities.push(act);
        activityRows++;
      }
      continue;
    }
    const date = findDate(obj);
    if (!date) continue;
    let wrote = false;
    for (const [key, raw] of Object.entries(obj)) {
      if (raw === null || raw === undefined) continue;
      if (typeof raw === 'object') {
        // Nested score objects: `{"sleepScores":{"overallScore":82}}`.
        for (const [k2, v2] of Object.entries(raw as Record<string, unknown>)) {
          const metric = WELLNESS_KEYS[k2];
          if (metric && typeof v2 === 'number') {
            daily.observe(date, metric, convert(metric, v2));
            wrote = true;
          }
        }
        continue;
      }
      if (typeof raw !== 'number') continue;
      const metric = WELLNESS_KEYS[key];
      if (metric === '') continue;
      if (metric) {
        daily.observe(date, metric, convert(metric, raw));
        wrote = true;
      } else if (!DATE_KEYS.includes(key) && !/pk$|id$|timestamp$/i.test(key)) {
        unknown.add(key);
      }
    }
    if (wrote) wellnessRows++;
  }

  result.daily = daily.build();
  result.messageCounts = {
    record: objects.length,
    ...(wellnessRows ? { wellnessDay: wellnessRows } : {}),
    ...(activityRows ? { activity: activityRows } : {}),
  };
  result.fields = [...seenKeys].sort();
  result.unknownFields = [...unknown].sort();
  if (!result.daily.length && !result.activities.length) {
    result.warnings.push('JSON records did not contain recognisable Garmin metrics');
  }
  result.detectedAs = activityRows
    ? `Garmin JSON activities (${activityRows})`
    : result.daily.length
      ? `Garmin JSON wellness (${result.daily.length} days)`
      : 'Garmin JSON';
  return result;
}

function convert(metric: string, value: number): number {
  const fn = CONVERSIONS[metric];
  return fn ? fn(value) : value;
}

/** Walks the document collecting plain objects that look like records. */
function collectRecords(node: unknown, out: Record<string, unknown>[], depth: number) {
  if (depth > 6 || out.length > 200000) return;
  if (Array.isArray(node)) {
    for (const item of node) collectRecords(item, out, depth + 1);
    return;
  }
  if (!node || typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;
  const arrayValues = Object.values(obj).filter((v) => Array.isArray(v)) as unknown[][];
  const hasOwnData = findDate(obj) !== undefined || looksLikeActivity(obj);
  if (hasOwnData) out.push(obj);
  // A wrapper such as `{"summarizedActivitiesExport": [...]}` — descend.
  for (const arr of arrayValues) collectRecords(arr, out, depth + 1);
  if (!hasOwnData && !arrayValues.length) {
    for (const v of Object.values(obj)) {
      if (v && typeof v === 'object') collectRecords(v, out, depth + 1);
    }
  }
}

function findDate(obj: Record<string, unknown>): string | undefined {
  for (const key of DATE_KEYS) {
    const v = obj[key];
    if (typeof v === 'string' || typeof v === 'number') {
      const day = dayKeyFromValue(v);
      if (day) return day;
    }
  }
  return undefined;
}

function looksLikeActivity(obj: Record<string, unknown>): boolean {
  const hits = ACTIVITY_HINTS.filter((k) => k in obj).length;
  return hits >= 2 && ('duration' in obj || 'distance' in obj || 'elapsedDuration' in obj);
}

const ACTIVITY_JSON_KEYS = new Set([
  'activityId', 'activityName', 'name', 'activityType', 'sportType', 'beginTimestamp', 'startTimeGmt',
  'startTimeLocal', 'duration', 'elapsedDuration', 'movingDuration', 'distance', 'calories',
  'averageHR', 'avgHr', 'maxHR', 'maxHr', 'avgSpeed', 'maxSpeed', 'elevationGain', 'elevationLoss',
  'minElevation', 'maxElevation', 'avgPower', 'maxPower', 'normPower', 'aerobicTrainingEffect',
  'anaerobicTrainingEffect', 'activityTrainingLoad', 'vO2MaxValue', 'steps', 'avgBikeCadence',
  'avgRunCadence', 'maxRunCadence', 'maxBikeCadence', 'avgTemperature', 'maxTemperature',
  'timeZoneId', 'startLatitude', 'startLongitude',
]);

function readActivity(obj: Record<string, unknown>, centimetres: boolean, unknown: Set<string>): RawActivity | undefined {
  const start =
    parseTimestamp(obj.beginTimestamp) ??
    parseTimestamp(obj.startTimeGmt) ??
    parseTimestamp(obj.startTimeLocal);
  if (start === undefined) return undefined;

  const n = (k: string): number | undefined => {
    const v = obj[k];
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
  };
  const distanceFactor = centimetres ? 0.01 : 1;
  const durationFactor = 0.001; // Garmin JSON durations are milliseconds
  const speedFactor = centimetres ? 0.01 : 1;

  const typeValue = obj.activityType;
  const sportRaw =
    typeof typeValue === 'string'
      ? typeValue
      : typeValue && typeof typeValue === 'object'
        ? String((typeValue as Record<string, unknown>).typeKey ?? '')
        : (obj.sportType as string | undefined);

  const extra: Record<string, Scalar> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (ACTIVITY_JSON_KEYS.has(k)) continue;
    if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') {
      extra[k] = v;
      if (typeof v === 'number') unknown.add(k);
    }
  }

  const duration = n('duration');
  const act: RawActivity = {
    sport: normalizeSport(sportRaw),
    name: typeof obj.activityName === 'string' ? obj.activityName : typeof obj.name === 'string' ? obj.name : undefined,
    startTime: start,
    elapsedTime: mul(n('elapsedDuration') ?? duration, durationFactor),
    timerTime: mul(duration, durationFactor),
    movingTime: mul(n('movingDuration'), durationFactor),
    distance: mul(n('distance'), distanceFactor),
    calories: n('calories'),
    avgHr: n('averageHR') ?? n('avgHr'),
    maxHr: n('maxHR') ?? n('maxHr'),
    avgSpeed: mul(n('avgSpeed'), speedFactor),
    maxSpeed: mul(n('maxSpeed'), speedFactor),
    avgPower: n('avgPower'),
    maxPower: n('maxPower'),
    normalizedPower: n('normPower'),
    avgCadence: n('avgRunCadence') ?? n('avgBikeCadence'),
    maxCadence: n('maxRunCadence') ?? n('maxBikeCadence'),
    ascent: mul(n('elevationGain'), distanceFactor),
    descent: mul(n('elevationLoss'), distanceFactor),
    minElevation: mul(n('minElevation'), distanceFactor),
    maxElevation: mul(n('maxElevation'), distanceFactor),
    avgTemperature: n('avgTemperature'),
    maxTemperature: n('maxTemperature'),
    trainingEffectAerobic: n('aerobicTrainingEffect'),
    trainingEffectAnaerobic: n('anaerobicTrainingEffect'),
    trainingLoad: n('activityTrainingLoad'),
    vo2max: n('vO2MaxValue'),
    steps: n('steps'),
    laps: [],
    extra,
  };
  if (act.elapsedTime !== undefined) act.endTime = start + act.elapsedTime * 1000;
  return act;
}

function mul(v: number | undefined, factor: number): number | undefined {
  return v === undefined ? undefined : v * factor;
}
