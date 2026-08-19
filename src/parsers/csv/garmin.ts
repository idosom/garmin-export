/**
 * Garmin CSV → `ParseResult`.
 *
 * Garmin Connect exports several unrelated CSV shapes (the activity list, and
 * per-report wellness downloads) with no machine-readable indication of which
 * is which, and no units in the headers. So we map headers to model fields by
 * synonym, decide activities-vs-wellness from what matched, and *derive* the
 * distance unit from the data itself (pace × distance must equal time), which
 * is the only reliable signal in the file.
 */
import { parseCsv, normalizeHeader, parseNumberLoose, isMissing } from './csv.ts';
import { emptyParseResult, type ParseResult, type RawActivity, type RawDaily, type Scalar } from '../../core/types.ts';
import { parseDuration, parseTimestamp, dayKeyFromValue } from '../../core/time.ts';
import { normalizeSport } from '../../core/metrics.ts';
import { M_PER_MILE, M_PER_FOOT, KG_PER_LB } from '../../core/units.ts';

type Kind = 'text' | 'number' | 'duration' | 'pace' | 'date' | 'distance' | 'elevation' | 'mass' | 'speed' | 'temperature' | 'stride';

interface ColumnSpec {
  field: string;
  kind: Kind;
}

const A = (field: string, kind: Kind = 'number'): ColumnSpec => ({ field, kind });

/** Activity-list columns. Keys are `normalizeHeader` outputs. */
const ACTIVITY_COLUMNS: Record<string, ColumnSpec> = {
  activitytype: A('sport', 'text'),
  activity: A('sport', 'text'),
  type: A('sport', 'text'),
  date: A('startTime', 'date'),
  activitydate: A('startTime', 'date'),
  startdate: A('startTime', 'date'),
  starttime: A('startTime', 'date'),
  begintimestamp: A('startTime', 'date'),
  title: A('name', 'text'),
  activityname: A('name', 'text'),
  name: A('name', 'text'),
  description: A('description', 'text'),
  distance: A('distance', 'distance'),
  calories: A('calories'),
  totalcalories: A('calories'),
  time: A('elapsedTime', 'duration'),
  duration: A('elapsedTime', 'duration'),
  totaltime: A('elapsedTime', 'duration'),
  elapsedtime: A('elapsedTime', 'duration'),
  movingtime: A('movingTime', 'duration'),
  totaltimerduration: A('timerTime', 'duration'),
  avghr: A('avgHr'),
  averageheartrate: A('avgHr'),
  maxhr: A('maxHr'),
  maxheartrate: A('maxHr'),
  minhr: A('minHr'),
  aerobicte: A('trainingEffectAerobic'),
  aerobictrainingeffect: A('trainingEffectAerobic'),
  anaerobicte: A('trainingEffectAnaerobic'),
  anaerobictrainingeffect: A('trainingEffectAnaerobic'),
  trainingload: A('trainingLoad'),
  trainingstressscore: A('tss'),
  intensityfactor: A('intensityFactor'),
  avgruncadence: A('avgCadence'),
  avgbikecadence: A('avgCadence'),
  avgcadence: A('avgCadence'),
  averagecadence: A('avgCadence'),
  maxruncadence: A('maxCadence'),
  maxbikecadence: A('maxCadence'),
  maxcadence: A('maxCadence'),
  avgpace: A('avgSpeed', 'pace'),
  bestpace: A('maxSpeed', 'pace'),
  maxpace: A('maxSpeed', 'pace'),
  avgspeed: A('avgSpeed', 'speed'),
  maxspeed: A('maxSpeed', 'speed'),
  avgpower: A('avgPower'),
  maxpower: A('maxPower'),
  normalizedpowernp: A('normalizedPower'),
  normalizedpower: A('normalizedPower'),
  totalascent: A('ascent', 'elevation'),
  elevationgain: A('ascent', 'elevation'),
  totaldescent: A('descent', 'elevation'),
  elevationloss: A('descent', 'elevation'),
  minelevation: A('minElevation', 'elevation'),
  maxelevation: A('maxElevation', 'elevation'),
  avgstridelength: A('avgStrideLength', 'stride'),
  avgverticalratio: A('avgVerticalRatio'),
  avgverticaloscillation: A('avgVerticalOscillation'),
  avggroundcontacttime: A('avgGroundContactTime'),
  mintemp: A('minTemperature', 'temperature'),
  maxtemp: A('maxTemperature', 'temperature'),
  avgtemp: A('avgTemperature', 'temperature'),
  numberoflaps: A('lapCount'),
  bestlaptime: A('bestLapTime', 'duration'),
  steps: A('steps'),
  totalstrokes: A('strokes'),
  totalreps: A('reps'),
  vo2max: A('vo2max'),
};

/** Wellness / report columns keyed by `normalizeHeader`. */
const WELLNESS_COLUMNS: Record<string, ColumnSpec> = {
  date: A('__date', 'date'),
  day: A('__date', 'date'),
  calendardate: A('__date', 'date'),
  timestamp: A('__date', 'date'),
  steps: A('steps'),
  actual: A('steps'),
  totalsteps: A('steps'),
  stepgoal: A('stepsGoal'),
  goal: A('stepsGoal'),
  distance: A('walkingDistance', 'distance'),
  floorsclimbed: A('floorsClimbed'),
  floors: A('floorsClimbed'),
  calories: A('totalCalories'),
  totalcalories: A('totalCalories'),
  activecalories: A('activeCalories'),
  restingcalories: A('restingCalories'),
  restingheartrate: A('restingHr'),
  restinghr: A('restingHr'),
  averageheartrate: A('avgHr'),
  minheartrate: A('minHr'),
  maxheartrate: A('maxHr'),
  hrv: A('hrv'),
  hrvstatus: A('hrvStatusText', 'text'),
  overnighthrv: A('hrv'),
  vo2max: A('vo2max'),
  averagestress: A('stressAvg'),
  avgstresslevel: A('stressAvg'),
  stress: A('stressAvg'),
  maxstress: A('stressMax'),
  reststress: A('restStressSeconds', 'duration'),
  highstress: A('highStressSeconds', 'duration'),
  bodybattery: A('bodyBatteryMax'),
  bodybatteryhigh: A('bodyBatteryMax'),
  bodybatterylow: A('bodyBatteryMin'),
  bodybatterycharged: A('bodyBatteryCharged'),
  bodybatterydrained: A('bodyBatteryDrained'),
  sleepscore: A('sleepScore'),
  score: A('sleepScore'),
  duration: A('sleepDuration', 'duration'),
  totalsleep: A('sleepDuration', 'duration'),
  sleeptime: A('sleepDuration', 'duration'),
  deep: A('sleepDeep', 'duration'),
  deepsleep: A('sleepDeep', 'duration'),
  light: A('sleepLight', 'duration'),
  lightsleep: A('sleepLight', 'duration'),
  rem: A('sleepRem', 'duration'),
  remsleep: A('sleepRem', 'duration'),
  awake: A('sleepAwake', 'duration'),
  awaketime: A('sleepAwake', 'duration'),
  weight: A('weight', 'mass'),
  bmi: A('bmi'),
  bodyfat: A('bodyFat'),
  bodyfatpercentage: A('bodyFat'),
  skeletalmusclemass: A('muscleMass', 'mass'),
  musclemass: A('muscleMass', 'mass'),
  bonemass: A('boneMass', 'mass'),
  bodywater: A('bodyWater'),
  pulseox: A('spo2Avg'),
  spo2: A('spo2Avg'),
  respiration: A('respirationAvg'),
  intensityminutes: A('moderateIntensityMinutes'),
  moderateintensityminutes: A('moderateIntensityMinutes'),
  vigorousintensityminutes: A('vigorousIntensityMinutes'),
  fitnessage: A('fitnessAge'),
};

export function parseGarminCsv(text: string): ParseResult {
  const result = emptyParseResult('csv');
  const table = parseCsv(text);
  if (!table.headers.length || !table.rows.length) {
    result.warnings.push('CSV had no data rows');
    result.detectedAs = 'CSV (empty)';
    return result;
  }

  const normalized = table.headers.map(normalizeHeader);
  const activityHits = normalized.filter((h) => ACTIVITY_COLUMNS[h]).length;
  const wellnessHits = normalized.filter((h) => WELLNESS_COLUMNS[h]).length;
  const hasActivitySignature = normalized.includes('activitytype') || normalized.includes('avgpace') || normalized.includes('aerobicte');

  result.messageCounts = { row: table.rows.length, column: table.headers.length };
  result.fields = table.headers.filter(Boolean);

  if (hasActivitySignature || (activityHits >= 4 && activityHits >= wellnessHits)) {
    parseActivityRows(table.headers, normalized, table.rows, result);
  } else if (wellnessHits >= 2) {
    parseWellnessRows(table.headers, normalized, table.rows, result);
  } else {
    result.warnings.push(`Unrecognised CSV columns: ${table.headers.slice(0, 8).join(', ')}`);
    result.detectedAs = 'CSV (unrecognised)';
    result.unknownFields = table.headers.filter(Boolean);
  }
  return result;
}

/* --------------------------------------------------------------- activities */

function parseActivityRows(headers: string[], normalized: string[], rows: string[][], result: ParseResult) {
  const unitScale = detectDistanceUnit(headers, normalized, rows);
  if (unitScale.confidence !== 'high') {
    result.warnings.push(
      `Distance/elevation units are not stated in Garmin CSVs; assuming ${unitScale.metric ? 'kilometres and metres' : 'miles and feet'} (${unitScale.confidence} confidence)`,
    );
  }
  const distanceFactor = unitScale.metric ? 1000 : M_PER_MILE;
  const elevationFactor = unitScale.metric ? 1 : M_PER_FOOT;
  const unknown: string[] = [];

  for (const row of rows) {
    const act: RawActivity = { sport: 'other', laps: [], extra: {} };
    const extra: Record<string, Scalar> = {};
    let sawValue = false;

    for (let c = 0; c < headers.length; c++) {
      const raw = row[c];
      if (isMissing(raw)) continue;
      const spec = ACTIVITY_COLUMNS[normalized[c]];
      const value = raw.trim();
      if (!spec) {
        const n = parseNumberLoose(value);
        extra[headers[c] || `column_${c}`] = n ?? value;
        if (!unknown.includes(headers[c])) unknown.push(headers[c]);
        continue;
      }
      sawValue = true;
      switch (spec.kind) {
        case 'text':
          if (spec.field === 'sport') act.sport = normalizeSport(value);
          else (act as Record<string, unknown>)[spec.field] = value;
          break;
        case 'date': {
          // Activity CSVs record local wall-clock time with no zone.
          const t = parseTimestamp(value, true);
          if (t !== undefined) act.startTime = t;
          break;
        }
        case 'duration': {
          const d = parseDuration(value);
          if (d !== undefined) assign(act, extra, spec.field, d);
          break;
        }
        case 'pace': {
          const secs = parseDuration(value);
          if (secs && secs > 0) assign(act, extra, spec.field, distanceFactor / secs);
          break;
        }
        case 'speed': {
          const n = parseNumberLoose(value);
          if (n !== undefined) assign(act, extra, spec.field, (n * distanceFactor) / 3600);
          break;
        }
        case 'distance': {
          const n = parseNumberLoose(value);
          if (n !== undefined) assign(act, extra, spec.field, n * distanceFactor);
          break;
        }
        case 'elevation': {
          const n = parseNumberLoose(value);
          if (n !== undefined) assign(act, extra, spec.field, n * elevationFactor);
          break;
        }
        case 'temperature': {
          const n = parseNumberLoose(value);
          if (n !== undefined) assign(act, extra, spec.field, unitScale.metric ? n : ((n - 32) * 5) / 9);
          break;
        }
        case 'stride': {
          const n = parseNumberLoose(value);
          // Model unit is millimetres; the CSV states metres or feet.
          if (n !== undefined) assign(act, extra, spec.field, n * (unitScale.metric ? 1000 : 304.8));
          break;
        }
        default: {
          const n = parseNumberLoose(value);
          if (n !== undefined) assign(act, extra, spec.field, n);
          else extra[spec.field] = value;
        }
      }
    }

    if (!sawValue || act.startTime === undefined) continue;
    if (act.distance && act.elapsedTime && !act.avgSpeed) act.avgSpeed = act.distance / act.elapsedTime;
    act.extra = extra;
    result.activities.push(act);
  }

  result.unknownFields = unknown;
  result.detectedAs = `Garmin activity CSV (${result.activities.length} rows)`;
  if (!result.activities.length) result.warnings.push('No rows had a usable date');
}

/** Fields that live on `Activity` rather than in `extra`. */
const ACTIVITY_FIELDS = new Set(
  Object.values(ACTIVITY_COLUMNS)
    .map((c) => c.field)
    .filter((f) => !['lapCount', 'bestLapTime', 'reps', 'description'].includes(f)),
);

function assign(act: RawActivity, extra: Record<string, Scalar>, field: string, value: number) {
  if (ACTIVITY_FIELDS.has(field)) (act as unknown as Record<string, number>)[field] = value;
  else extra[field] = value;
}

/**
 * Garmin CSVs state no units, and the pace column is always in the *same*
 * unit as the distance column, so those two can never disagree. What does
 * disambiguate is stride length: `stride × cadence / 60` is the average speed,
 * and comparing that against `distance / time` differs by a factor of ~5.3
 * between the two unit systems. Falls back to a Fahrenheit check, then to
 * metric (Garmin's default).
 */
function detectDistanceUnit(
  headers: string[],
  normalized: string[],
  rows: string[][],
): { metric: boolean; confidence: 'high' | 'low' } {
  void headers;
  const col = (...names: string[]) => normalized.findIndex((h) => names.includes(h));
  const distCol = col('distance');
  const timeCol = col('time', 'duration', 'elapsedtime');
  const strideCol = col('avgstridelength');
  const cadenceCol = col('avgruncadence', 'avgcadence');

  if (distCol >= 0 && timeCol >= 0 && strideCol >= 0 && cadenceCol >= 0) {
    let metricVotes = 0;
    let imperialVotes = 0;
    for (const row of rows) {
      if (metricVotes + imperialVotes >= 20) break;
      const dist = parseNumberLoose(row[distCol]);
      const time = parseDuration(row[timeCol]);
      const stride = parseNumberLoose(row[strideCol]);
      const cadence = parseNumberLoose(row[cadenceCol]);
      if (!dist || !time || !stride || !cadence) continue;
      if (dist < 0.5 || time < 60 || stride <= 0 || cadence < 40) continue;
      // Speed implied by stride × cadence, expressed in "distance units / s".
      const fromStride = (stride * cadence) / 60;
      const fromDistance = dist / time;
      // Metric: stride m, distance km  → ratio ≈ 1000. Imperial: stride ft,
      // distance mi → ratio ≈ 5280.
      const ratio = fromStride / fromDistance;
      if (ratio > 700 && ratio < 1400) metricVotes++;
      else if (ratio > 3700 && ratio < 7400) imperialVotes++;
    }
    if (metricVotes + imperialVotes >= 3) {
      return { metric: metricVotes >= imperialVotes, confidence: 'high' };
    }
  }

  const tempCol = col('maxtemp', 'mintemp', 'avgtemp');
  if (tempCol >= 0) {
    const temps = rows
      .slice(0, 100)
      .map((r) => parseNumberLoose(r[tempCol]))
      .filter((v): v is number => v !== undefined);
    if (temps.length >= 5) {
      const avg = temps.reduce((a, b) => a + b, 0) / temps.length;
      if (avg > 45) return { metric: false, confidence: 'low' };
      if (avg < 40) return { metric: true, confidence: 'low' };
    }
  }

  return { metric: true, confidence: 'low' };
}

/* ----------------------------------------------------------------- wellness */

function parseWellnessRows(headers: string[], normalized: string[], rows: string[][], result: ParseResult) {
  const byDate = new Map<string, RawDaily>();
  const unknown: string[] = [];
  const massImperial = headers.some((h) => /\blbs?\b/i.test(h));
  const distImperial = headers.some((h) => /\bmi\b|miles/i.test(h));

  for (const row of rows) {
    let date: string | undefined;
    const values: Record<string, number> = {};

    for (let c = 0; c < headers.length; c++) {
      const raw = row[c];
      if (isMissing(raw)) continue;
      const spec = WELLNESS_COLUMNS[normalized[c]];
      const value = raw.trim();
      if (!spec) {
        if (!unknown.includes(headers[c])) unknown.push(headers[c]);
        const n = parseNumberLoose(value);
        if (n !== undefined && headers[c]) values[camelize(headers[c])] = n;
        continue;
      }
      if (spec.field === '__date') {
        date = dayKeyFromValue(value);
        continue;
      }
      switch (spec.kind) {
        case 'duration': {
          // Sleep columns are written as `7:30` meaning 7 h 30 m, which the
          // generic clock parser would read as 7 minutes 30 seconds.
          const hoursMinutes = /^(\d{1,2}):(\d{2})$/.exec(value);
          const d =
            hoursMinutes && spec.field.startsWith('sleep')
              ? Number(hoursMinutes[1]) * 3600 + Number(hoursMinutes[2]) * 60
              : parseDuration(value);
          if (d !== undefined) values[spec.field] = d;
          break;
        }
        case 'mass': {
          const n = parseNumberLoose(value);
          if (n !== undefined) values[spec.field] = massImperial ? n * KG_PER_LB : n;
          break;
        }
        case 'distance': {
          const n = parseNumberLoose(value);
          if (n !== undefined) values[spec.field] = n * (distImperial ? M_PER_MILE : 1000);
          break;
        }
        case 'text':
          break;
        default: {
          const n = parseNumberLoose(value);
          if (n !== undefined) values[spec.field] = n;
        }
      }
    }

    if (!date || !Object.keys(values).length) continue;
    const existing = byDate.get(date);
    if (existing) Object.assign(existing.values, values);
    else byDate.set(date, { date, values });
  }

  result.daily = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  result.unknownFields = unknown;
  const metrics = new Set<string>();
  for (const d of result.daily) for (const k of Object.keys(d.values)) metrics.add(k);
  result.detectedAs = `Garmin wellness CSV (${[...metrics].slice(0, 4).join(', ')}${metrics.size > 4 ? '…' : ''})`;
  if (!result.daily.length) result.warnings.push('No rows had a usable date');
}

function camelize(header: string): string {
  const parts = header
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ');
  return parts.map((p, i) => (i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1))).join('');
}
