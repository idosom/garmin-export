import type { ChannelMeta, WellnessMetricMeta, MetricKind } from './types.ts';

/* --------------------------------------------------------- stream channels */

/**
 * Known per-sample channels. Anything not listed here still flows through the
 * app (charts, explorer, tooltips) using `fallbackChannelMeta`.
 */
export const CHANNEL_META: Record<string, ChannelMeta> = {
  heartRate: { label: 'Heart rate', unit: 'bpm', kind: 'heartRate', slot: 7 },
  speed: { label: 'Speed', unit: 'm/s', kind: 'speed', slot: 0 },
  pace: { label: 'Pace', unit: 's/m', kind: 'pace', slot: 0 },
  elevation: { label: 'Elevation', unit: 'm', kind: 'elevation', slot: 2 },
  cadence: { label: 'Cadence', unit: 'rpm', kind: 'cadence', slot: 4 },
  power: { label: 'Power', unit: 'W', kind: 'power', slot: 6 },
  temperature: { label: 'Temperature', unit: '°C', kind: 'temperature', slot: 3 },
  distance: { label: 'Distance', unit: 'm', kind: 'distance' },
  grade: { label: 'Grade', unit: '%', kind: 'percent' },
  verticalOscillation: { label: 'Vertical oscillation', unit: 'mm', kind: 'length_mm' },
  verticalRatio: { label: 'Vertical ratio', unit: '%', kind: 'percent' },
  groundContactTime: { label: 'Ground contact time', unit: 'ms', kind: 'time_ms' },
  groundContactBalance: { label: 'GCT balance', unit: '%', kind: 'percent' },
  stepLength: { label: 'Step length', unit: 'mm', kind: 'length_mm' },
  respirationRate: { label: 'Respiration', unit: 'brpm', kind: 'count' },
  gpsAccuracy: { label: 'GPS accuracy', unit: 'm', kind: 'distance' },
  verticalSpeed: { label: 'Vertical speed', unit: 'm/s', kind: 'speed' },
  leftRightBalance: { label: 'L/R balance', unit: '%', kind: 'percent' },
  calories: { label: 'Calories', unit: 'kcal', kind: 'energy' },
  strokes: { label: 'Strokes', unit: '', kind: 'count' },
  saturatedHemoglobinPercent: { label: 'SmO₂', unit: '%', kind: 'percent' },
  totalHemoglobinConc: { label: 'THb', unit: 'g/dl', kind: 'raw' },
  coreTemperature: { label: 'Core temperature', unit: '°C', kind: 'temperature' },
  batteryLevel: { label: 'Device battery', unit: '%', kind: 'percent' },
};

/** Channels that make sense as a chart line in the activity detail view. */
export const PLOTTABLE_CHANNELS = [
  'heartRate',
  'speed',
  'elevation',
  'cadence',
  'power',
  'temperature',
  'grade',
  'verticalOscillation',
  'groundContactTime',
  'stepLength',
  'verticalRatio',
  'respirationRate',
  'verticalSpeed',
  'leftRightBalance',
  'saturatedHemoglobinPercent',
  'coreTemperature',
];

export function channelMeta(key: string): ChannelMeta {
  return CHANNEL_META[key] ?? fallbackChannelMeta(key);
}

export function fallbackChannelMeta(key: string): ChannelMeta {
  return { label: humanize(key), unit: '', kind: 'raw' };
}

/* -------------------------------------------------------- wellness metrics */

const W = (
  key: string,
  label: string,
  unit: string,
  kind: MetricKind,
  agg: WellnessMetricMeta['agg'],
  group: WellnessMetricMeta['group'],
  opts: Partial<WellnessMetricMeta> = {},
): WellnessMetricMeta => ({ key, label, unit, kind, agg, group, ...opts });

export const WELLNESS_METRICS: WellnessMetricMeta[] = [
  W('steps', 'Steps', 'steps', 'count', 'sum', 'activity', { better: 'up', priority: 100 }),
  W('stepsGoal', 'Step goal', 'steps', 'count', 'avg', 'activity', { priority: 5 }),
  W('walkingDistance', 'Daily distance', 'm', 'distance', 'sum', 'activity', { better: 'up', priority: 60 }),
  W('floorsClimbed', 'Floors climbed', 'floors', 'count', 'sum', 'activity', { better: 'up', priority: 40 }),
  W('activeCalories', 'Active calories', 'kcal', 'energy', 'sum', 'activity', { better: 'up', priority: 45 }),
  W('restingCalories', 'Resting calories', 'kcal', 'energy', 'sum', 'activity', { priority: 10 }),
  W('totalCalories', 'Total calories', 'kcal', 'energy', 'sum', 'activity', { priority: 30 }),
  W('activeSeconds', 'Active time', 's', 'duration', 'sum', 'activity', { better: 'up', priority: 35 }),
  W('moderateIntensityMinutes', 'Moderate intensity', 'min', 'count', 'sum', 'activity', { better: 'up', priority: 25 }),
  W('vigorousIntensityMinutes', 'Vigorous intensity', 'min', 'count', 'sum', 'activity', { better: 'up', priority: 25 }),

  W('restingHr', 'Resting heart rate', 'bpm', 'heartRate', 'avg', 'heart', { better: 'down', priority: 95, decimals: 0 }),
  W('minHr', 'Minimum heart rate', 'bpm', 'heartRate', 'min', 'heart', { priority: 15 }),
  W('maxHr', 'Maximum heart rate', 'bpm', 'heartRate', 'max', 'heart', { priority: 15 }),
  W('avgHr', 'Average heart rate', 'bpm', 'heartRate', 'avg', 'heart', { priority: 20 }),
  W('hrv', 'HRV (overnight avg)', 'ms', 'time_ms', 'avg', 'heart', { better: 'up', priority: 90, decimals: 0 }),
  W('hrvWeekly', 'HRV 7-day average', 'ms', 'time_ms', 'avg', 'heart', { better: 'up', priority: 20 }),
  W('vo2max', 'VO₂ max', 'ml/kg/min', 'score', 'max', 'heart', { better: 'up', priority: 85, decimals: 1 }),
  W('spo2Avg', 'Pulse ox (avg)', '%', 'percent', 'avg', 'heart', { better: 'up', priority: 30 }),
  W('respirationAvg', 'Respiration (avg)', 'brpm', 'count', 'avg', 'heart', { priority: 20, decimals: 1 }),

  W('sleepDuration', 'Sleep', 's', 'duration', 'avg', 'sleep', { better: 'up', priority: 98 }),
  W('sleepDeep', 'Deep sleep', 's', 'duration', 'avg', 'sleep', { priority: 50 }),
  W('sleepLight', 'Light sleep', 's', 'duration', 'avg', 'sleep', { priority: 45 }),
  W('sleepRem', 'REM sleep', 's', 'duration', 'avg', 'sleep', { priority: 48 }),
  W('sleepAwake', 'Awake', 's', 'duration', 'avg', 'sleep', { better: 'down', priority: 40 }),
  W('sleepScore', 'Sleep score', 'pts', 'score', 'avg', 'sleep', { better: 'up', priority: 80, decimals: 0 }),
  W('sleepStart', 'Bedtime', 'clock', 'clock', 'avg', 'sleep', { priority: 22 }),
  W('sleepEnd', 'Wake time', 'clock', 'clock', 'avg', 'sleep', { priority: 22 }),

  W('stressAvg', 'Average stress', 'pts', 'score', 'avg', 'stress', { better: 'down', priority: 88, decimals: 0 }),
  W('stressMax', 'Peak stress', 'pts', 'score', 'max', 'stress', { better: 'down', priority: 30 }),
  W('restStressSeconds', 'Restful time', 's', 'duration', 'sum', 'stress', { better: 'up', priority: 20 }),
  W('highStressSeconds', 'High stress time', 's', 'duration', 'sum', 'stress', { better: 'down', priority: 20 }),
  W('bodyBatteryMax', 'Body Battery (high)', 'pts', 'score', 'max', 'stress', { better: 'up', priority: 86, decimals: 0 }),
  W('bodyBatteryMin', 'Body Battery (low)', 'pts', 'score', 'min', 'stress', { better: 'up', priority: 55, decimals: 0 }),
  W('bodyBatteryCharged', 'Body Battery charged', 'pts', 'score', 'avg', 'stress', { better: 'up', priority: 25 }),
  W('bodyBatteryDrained', 'Body Battery drained', 'pts', 'score', 'avg', 'stress', { priority: 25 }),

  W('weight', 'Weight', 'kg', 'mass', 'last', 'body', { priority: 92, decimals: 1 }),
  W('bodyFat', 'Body fat', '%', 'percent', 'last', 'body', { better: 'down', priority: 60, decimals: 1 }),
  W('bmi', 'BMI', '', 'score', 'last', 'body', { priority: 40, decimals: 1 }),
  W('muscleMass', 'Muscle mass', 'kg', 'mass', 'last', 'body', { better: 'up', priority: 35, decimals: 1 }),
  W('boneMass', 'Bone mass', 'kg', 'mass', 'last', 'body', { priority: 20, decimals: 1 }),
  W('bodyWater', 'Body water', '%', 'percent', 'last', 'body', { priority: 20, decimals: 1 }),
  W('fitnessAge', 'Fitness age', 'yr', 'score', 'last', 'body', { better: 'down', priority: 30 }),
];

const WELLNESS_BY_KEY = new Map(WELLNESS_METRICS.map((m) => [m.key, m]));

export function wellnessMeta(key: string): WellnessMetricMeta {
  return (
    WELLNESS_BY_KEY.get(key) ?? {
      key,
      label: humanize(key),
      unit: '',
      kind: 'raw',
      agg: 'avg',
      group: 'other',
      priority: 0,
    }
  );
}

/* ------------------------------------------------------------------ sports */

export interface SportMeta {
  key: string;
  label: string;
  /** Icon id understood by `<SportIcon>`. */
  icon: string;
  /** Categorical palette slot. */
  slot: number;
  /** Distance-based sports get pace/speed columns and PR calculations. */
  distanceBased: boolean;
  /** `pace` shows min/km, `speed` shows km/h, `pace100` shows min/100 m. */
  rate: 'pace' | 'speed' | 'pace100' | 'none';
}

const SPORTS: SportMeta[] = [
  { key: 'running', label: 'Running', icon: 'run', slot: 0, distanceBased: true, rate: 'pace' },
  { key: 'cycling', label: 'Cycling', icon: 'bike', slot: 1, distanceBased: true, rate: 'speed' },
  { key: 'swimming', label: 'Swimming', icon: 'swim', slot: 2, distanceBased: true, rate: 'pace100' },
  { key: 'walking', label: 'Walking', icon: 'walk', slot: 3, distanceBased: true, rate: 'pace' },
  { key: 'hiking', label: 'Hiking', icon: 'hike', slot: 4, distanceBased: true, rate: 'pace' },
  { key: 'strength', label: 'Strength', icon: 'strength', slot: 5, distanceBased: false, rate: 'none' },
  { key: 'cardio', label: 'Cardio', icon: 'cardio', slot: 6, distanceBased: false, rate: 'none' },
  { key: 'rowing', label: 'Rowing', icon: 'row', slot: 7, distanceBased: true, rate: 'pace' },
  { key: 'skiing', label: 'Skiing', icon: 'ski', slot: 2, distanceBased: true, rate: 'speed' },
  { key: 'yoga', label: 'Yoga', icon: 'yoga', slot: 4, distanceBased: false, rate: 'none' },
  { key: 'other', label: 'Other', icon: 'other', slot: 6, distanceBased: false, rate: 'none' },
];

const SPORT_BY_KEY = new Map(SPORTS.map((s) => [s.key, s]));

/** Maps the many names Garmin uses for the same thing onto our sport keys. */
const SPORT_ALIASES: Record<string, string> = {
  run: 'running',
  running: 'running',
  trail_running: 'running',
  treadmill_running: 'running',
  track_running: 'running',
  street_running: 'running',
  indoor_running: 'running',
  virtual_run: 'running',
  obstacle_run: 'running',
  ultra_run: 'running',
  bike: 'cycling',
  biking: 'cycling',
  cycling: 'cycling',
  road_biking: 'cycling',
  mountain_biking: 'cycling',
  indoor_cycling: 'cycling',
  virtual_ride: 'cycling',
  gravel_cycling: 'cycling',
  cyclocross: 'cycling',
  e_biking: 'cycling',
  spinning: 'cycling',
  commuting: 'cycling',
  swim: 'swimming',
  swimming: 'swimming',
  lap_swimming: 'swimming',
  open_water: 'swimming',
  open_water_swimming: 'swimming',
  walk: 'walking',
  walking: 'walking',
  casual_walking: 'walking',
  speed_walking: 'walking',
  hike: 'hiking',
  hiking: 'hiking',
  mountaineering: 'hiking',
  training: 'strength',
  strength_training: 'strength',
  weight_training: 'strength',
  strength: 'strength',
  fitness_equipment: 'cardio',
  cardio: 'cardio',
  cardio_training: 'cardio',
  elliptical: 'cardio',
  stair_climbing: 'cardio',
  indoor_cardio: 'cardio',
  hiit: 'cardio',
  rowing: 'rowing',
  indoor_rowing: 'rowing',
  kayaking: 'rowing',
  paddling: 'rowing',
  stand_up_paddleboarding: 'rowing',
  alpine_skiing: 'skiing',
  cross_country_skiing: 'skiing',
  backcountry_skiing: 'skiing',
  resort_skiing: 'skiing',
  snowboarding: 'skiing',
  snowshoeing: 'skiing',
  yoga: 'yoga',
  pilates: 'yoga',
  breathwork: 'yoga',
  meditation: 'yoga',
};

/** Normalizes any Garmin sport label ("Trail Running", `trail_running`, 6). */
export function normalizeSport(raw: string | number | undefined | null): string {
  if (raw === undefined || raw === null || raw === '') return 'other';
  const s = String(raw)
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
  if (!s) return 'other';
  if (SPORT_ALIASES[s]) return SPORT_ALIASES[s];
  if (SPORT_BY_KEY.has(s)) return s;
  // Fuzzy: "trail_running_v2", "indoor_cycling_2" …
  for (const [alias, key] of Object.entries(SPORT_ALIASES)) {
    if (s.includes(alias)) return key;
  }
  return s;
}

export function sportMeta(key: string): SportMeta {
  const known = SPORT_BY_KEY.get(key);
  if (known) return known;
  // Unknown sports still get a stable colour + label so the UI never breaks.
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return {
    key,
    label: humanize(key),
    icon: 'other',
    slot: hash % 8,
    distanceBased: false,
    rate: 'none',
  };
}

export function humanize(key: string): string {
  const spaced = key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
