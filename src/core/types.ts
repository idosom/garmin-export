/**
 * The normalized data model.
 *
 * Everything the app renders is expressed in these types. Parsers are free to
 * emit whatever a particular Garmin device/export version happens to contain;
 * normalization funnels it into `Activity` / `DailyRecord`, keeping anything it
 * does not recognise in the `extra` bags so nothing is silently lost.
 *
 * Units are SI throughout the model (metres, seconds, m/s, kg, °C, watts, bpm).
 * Display conversion happens in the UI layer only.
 */

export type Scalar = number | string | boolean | null;

export type FileFormat = 'fit' | 'csv' | 'tcx' | 'gpx' | 'json' | 'zip' | 'unknown';

/** Where a piece of normalized data came from. */
export interface SourceRef {
  fileId: string;
  path: string;
  format: FileFormat;
}

/* ------------------------------------------------------------------ streams */

/**
 * Per-sample activity data, stored column-wise so a multi-year export stays in
 * a few tens of MB instead of millions of JS objects. `NaN` means "no sample".
 */
export interface ActivityStreams {
  /** Number of samples. */
  n: number;
  /** Epoch milliseconds, ascending. */
  time: Float64Array;
  /** Degrees. Kept at f64 — f32 would quantise position to ~1 m. */
  lat?: Float64Array;
  lon?: Float64Array;
  /** Everything else, keyed by channel id (see `CHANNEL_META`). */
  channels: Record<string, Float32Array>;
}

export interface ChannelMeta {
  label: string;
  /** SI unit stored in the stream. */
  unit: string;
  /** Drives unit conversion + formatting in the UI. */
  kind: MetricKind;
  /** Preferred chart colour slot (categorical palette index, 0-based). */
  slot?: number;
}

export type MetricKind =
  | 'distance'
  | 'speed'
  | 'pace'
  | 'duration'
  | 'elevation'
  | 'heartRate'
  | 'cadence'
  | 'power'
  | 'temperature'
  | 'energy'
  | 'mass'
  | 'percent'
  | 'count'
  | 'length_mm'
  | 'time_ms'
  | 'score'
  | 'ratio'
  | 'clock'
  | 'raw';

/* ------------------------------------------------------------------- laps */

export interface Lap {
  index: number;
  startTime?: number;
  endTime?: number;
  elapsedTime?: number;
  timerTime?: number;
  movingTime?: number;
  distance?: number;
  avgSpeed?: number;
  maxSpeed?: number;
  avgHr?: number;
  maxHr?: number;
  avgCadence?: number;
  maxCadence?: number;
  avgPower?: number;
  maxPower?: number;
  normalizedPower?: number;
  calories?: number;
  ascent?: number;
  descent?: number;
  avgTemperature?: number;
  intensity?: string;
  trigger?: string;
  sport?: string;
  extra: Record<string, Scalar>;
}

/* --------------------------------------------------------------- activity */

export interface LatLngBounds {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
}

export interface Activity {
  /** Stable id derived from start time + sport + distance (see `activityKey`). */
  id: string;
  name?: string;
  /** Normalized sport key, e.g. `running`, `cycling`, `swimming`, `strength`. */
  sport: string;
  subSport?: string;
  /** Epoch ms, UTC. */
  startTime: number;
  /** Minutes east of UTC where the activity happened, when the export says so. */
  timezoneOffsetMin?: number;
  endTime?: number;

  elapsedTime?: number;
  timerTime?: number;
  movingTime?: number;

  distance?: number;
  calories?: number;

  avgSpeed?: number;
  maxSpeed?: number;
  avgHr?: number;
  maxHr?: number;
  minHr?: number;
  avgCadence?: number;
  maxCadence?: number;
  avgPower?: number;
  maxPower?: number;
  normalizedPower?: number;

  ascent?: number;
  descent?: number;
  minElevation?: number;
  maxElevation?: number;

  avgTemperature?: number;
  minTemperature?: number;
  maxTemperature?: number;

  trainingEffectAerobic?: number;
  trainingEffectAnaerobic?: number;
  trainingLoad?: number;
  tss?: number;
  intensityFactor?: number;
  vo2max?: number;

  steps?: number;
  strokes?: number;
  poolLength?: number;

  avgVerticalOscillation?: number;
  avgGroundContactTime?: number;
  avgStrideLength?: number;
  avgVerticalRatio?: number;

  /** Seconds spent in each HR zone, when the device reported them. */
  hrZoneTimes?: number[];

  device?: string;
  manufacturer?: string;

  laps: Lap[];
  streams?: ActivityStreams;
  hasGps: boolean;
  bounds?: LatLngBounds;

  /** Unrecognised / device-specific / developer fields, preserved verbatim. */
  extra: Record<string, Scalar>;
  sources: SourceRef[];
}

/* -------------------------------------------------------------- wellness */

/** One calendar day of health data. Values are keyed by `WELLNESS_METRICS`. */
export interface DailyRecord {
  /** Local calendar day, `YYYY-MM-DD`. */
  date: string;
  values: Record<string, number>;
  sources: SourceRef[];
}

export interface WellnessMetricMeta {
  key: string;
  label: string;
  unit: string;
  kind: MetricKind;
  /** How daily values roll up over a period. */
  agg: 'sum' | 'avg' | 'min' | 'max' | 'last';
  /** Which direction is "better" — drives the trend colouring. */
  better?: 'up' | 'down';
  group: 'activity' | 'heart' | 'sleep' | 'stress' | 'body' | 'other';
  /** Larger number = shown earlier. */
  priority?: number;
  decimals?: number;
}

export interface UserProfile {
  name?: string;
  gender?: string;
  age?: number;
  heightM?: number;
  weightKg?: number;
  restingHr?: number;
  maxHr?: number;
  extra: Record<string, Scalar>;
}

/* ---------------------------------------------------------------- report */

export interface DeveloperFieldInfo {
  name: string;
  units?: string;
  developerDataIndex: number;
  fieldDefinitionNumber: number;
  nativeMesgNum?: number;
  count: number;
}

export type FileStatus = 'parsed' | 'empty' | 'skipped' | 'error';

export interface FileReport {
  id: string;
  /** Path inside the export (including any `archive.zip!/inner/path`). */
  path: string;
  name: string;
  size: number;
  format: FileFormat;
  /** Human label, e.g. "FIT activity", "Garmin Activities.csv". */
  detectedAs?: string;
  parser?: string;
  status: FileStatus;
  durationMs: number;
  /** Message/record type -> count, e.g. `{ record: 3812, session: 1 }`. */
  messageCounts: Record<string, number>;
  /** Field names seen, `messageType.field`. */
  fields: string[];
  /** Fields the profile could not name (`session.field_193`, CSV columns, …). */
  unknownFields: string[];
  developerFields: DeveloperFieldInfo[];
  warnings: string[];
  errors: string[];
  produced: { activities: number; dailyRecords: number; samples: number };
  /** Set when the file came out of an archive. */
  archive?: string;
}

export interface IngestReport {
  files: FileReport[];
  startedAt: number;
  finishedAt: number;
  totalBytes: number;
  duplicateActivitiesMerged: number;
  warnings: string[];
}

export interface Dataset {
  id: string;
  createdAt: number;
  label: string;
  activities: Activity[];
  daily: DailyRecord[];
  user?: UserProfile;
  report: IngestReport;
}

/* ---------------------------------------------------- parser intermediates */

/** What a format parser returns before normalization. */
export interface ParseResult {
  activities: RawActivity[];
  daily: RawDaily[];
  user?: UserProfile;
  messageCounts: Record<string, number>;
  fields: string[];
  unknownFields: string[];
  developerFields: DeveloperFieldInfo[];
  warnings: string[];
  detectedAs?: string;
  parser: string;
}

/**
 * Loose, parser-facing activity shape: every field optional, extra values
 * allowed. `normalizeActivity` turns this into an `Activity`.
 */
export interface RawActivity extends Partial<Omit<Activity, 'id' | 'laps' | 'streams' | 'extra' | 'sources' | 'hasGps'>> {
  laps?: Lap[];
  streams?: ActivityStreams;
  extra?: Record<string, Scalar>;
}

export interface RawDaily {
  date: string;
  values: Record<string, number>;
}

export function emptyParseResult(parser: string): ParseResult {
  return {
    activities: [],
    daily: [],
    messageCounts: {},
    fields: [],
    unknownFields: [],
    developerFields: [],
    warnings: [],
    parser,
  };
}
