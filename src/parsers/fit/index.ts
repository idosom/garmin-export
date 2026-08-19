/**
 * FIT → `ParseResult`.
 *
 * Handles the two shapes Garmin exports contain: *activity* files (file_id
 * type 4: session/lap/record) and *wellness / monitoring* files (monitoring,
 * stress_level, sleep_level, weight_scale, hrv_status_summary, …). A single
 * file may contain either, both, or something we have never seen — in which
 * case its messages still land in the report so the Data Explorer can show them.
 */
import { decodeFit, type DecodedMessage, type FitValue } from './decoder.ts';
import { SampleBuilder } from '../streams.ts';
import { DailyBuilder } from '../daily.ts';
import { emptyParseResult, type Lap, type ParseResult, type RawActivity, type Scalar, type UserProfile } from '../../core/types.ts';
import { localDayKey } from '../../core/time.ts';
import { normalizeSport } from '../../core/metrics.ts';

/** FIT record field → normalized stream channel. `null` = intentionally dropped. */
const RECORD_CHANNELS: Record<string, string | null> = {
  timestamp: null,
  position_lat: null,
  position_long: null,
  altitude: null,
  enhanced_altitude: null,
  speed: null,
  enhanced_speed: null,
  cadence: null,
  fractional_cadence: null,
  cadence256: null,
  compressed_speed_distance: null,
  heart_rate: 'heartRate',
  distance: 'distance',
  power: 'power',
  temperature: 'temperature',
  grade: 'grade',
  vertical_oscillation: 'verticalOscillation',
  vertical_ratio: 'verticalRatio',
  stance_time: 'groundContactTime',
  stance_time_balance: 'groundContactBalance',
  stance_time_percent: 'stanceTimePercent',
  step_length: 'stepLength',
  enhanced_respiration_rate: 'respirationRate',
  gps_accuracy: 'gpsAccuracy',
  vertical_speed: 'verticalSpeed',
  calories: 'calories',
  total_hemoglobin_conc: 'totalHemoglobinConc',
  saturated_hemoglobin_percent: 'saturatedHemoglobinPercent',
  core_temperature: 'coreTemperature',
  battery_soc: 'batteryLevel',
  left_right_balance: 'leftRightBalance',
  motor_power: 'motorPower',
  activity_type: null,
  device_index: null,
  zone: null,
  resistance: 'resistance',
  cycles: null,
  total_cycles: null,
  accumulated_power: null,
  time_from_course: null,
  cycle_length: null,
  left_torque_effectiveness: 'leftTorqueEffectiveness',
  right_torque_effectiveness: 'rightTorqueEffectiveness',
  left_pedal_smoothness: 'leftPedalSmoothness',
  right_pedal_smoothness: 'rightPedalSmoothness',
  combined_pedal_smoothness: 'combinedPedalSmoothness',
  left_pco: 'leftPco',
  right_pco: 'rightPco',
  ball_speed: 'ballSpeed',
  stroke_type: null,
};

const FOOT_SPORTS = new Set(['running', 'walking', 'hiking']);

export function parseFit(data: Uint8Array): ParseResult {
  const result = emptyParseResult('fit');
  const samples = new SampleBuilder();
  const daily = new DailyBuilder();
  const dailyAgg: Record<string, 'sum' | 'avg' | 'min' | 'max' | 'last'> = {};

  const sessions: DecodedMessage[] = [];
  const lapMsgs: DecodedMessage[] = [];
  let fileType: string | undefined;
  let fileCreatedAt: number | undefined;
  let deviceName: string | undefined;
  let manufacturer: string | undefined;
  let user: UserProfile | undefined;

  /** Local-time offset in minutes, derived from `local_timestamp` pairs. */
  let tzOffsetMin: number | undefined;

  // Monitoring is cumulative per (day, activity type); we keep maxima and sum
  // the activity types at the end.
  const monitoring = new Map<string, Map<string, { steps?: number; distance?: number; activeTime?: number }>>();
  const sleepEvents: { t: number; level: string }[] = [];
  let hrvSampleCount = 0;

  const summary = decodeFit(data, {
    onMessage: (msg) => {
      switch (msg.name) {
        case 'file_id':
          fileType = str(msg.fields.type);
          fileCreatedAt = numOf(msg.fields.time_created);
          if (!manufacturer) manufacturer = str(msg.fields.manufacturer);
          if (!deviceName && typeof msg.fields.product_name === 'string') deviceName = msg.fields.product_name;
          break;
        case 'device_info': {
          const name = typeof msg.fields.product_name === 'string' ? msg.fields.product_name : undefined;
          if (name && !deviceName) deviceName = name;
          if (!manufacturer) manufacturer = str(msg.fields.manufacturer);
          break;
        }
        case 'activity': {
          const local = numOf(msg.fields.local_timestamp);
          const utc = numOf(msg.fields.timestamp);
          if (local !== undefined && utc !== undefined) tzOffsetMin = Math.round((local - utc) / 60000);
          break;
        }
        case 'record':
          handleRecord(msg);
          break;
        case 'session':
          sessions.push(msg);
          break;
        case 'lap':
          lapMsgs.push(msg);
          break;
        case 'user_profile':
          user = readUserProfile(msg);
          break;
        case 'monitoring_info': {
          const local = numOf(msg.fields.local_timestamp);
          const utc = numOf(msg.fields.timestamp);
          if (local !== undefined && utc !== undefined) tzOffsetMin = Math.round((local - utc) / 60000);
          break;
        }
        case 'monitoring':
          handleMonitoring(msg);
          break;
        case 'stress_level': {
          const t = numOf(msg.fields.stress_level_time) ?? msg.timestamp;
          const v = numOf(msg.fields.stress_level_value);
          if (t !== undefined && v !== undefined && v >= 0) {
            const day = localDayKey(t, tzOffsetMin ?? 0);
            daily.observe(day, 'stressAvg', v);
            daily.observe(day, 'stressMax', v);
            dailyAgg.stressAvg = 'avg';
            dailyAgg.stressMax = 'max';
          }
          break;
        }
        case 'hrv_status_summary': {
          if (msg.timestamp === undefined) break;
          const day = localDayKey(msg.timestamp, tzOffsetMin ?? 0);
          daily.observe(day, 'hrv', numOf(msg.fields.last_night_average));
          daily.observe(day, 'hrvWeekly', numOf(msg.fields.weekly_average));
          dailyAgg.hrv = 'avg';
          dailyAgg.hrvWeekly = 'avg';
          break;
        }
        case 'hrv':
          hrvSampleCount += Array.isArray(msg.fields.time) ? msg.fields.time.length : 1;
          break;
        case 'sleep_level': {
          const level = str(msg.fields.sleep_level);
          if (msg.timestamp !== undefined && level) sleepEvents.push({ t: msg.timestamp, level });
          break;
        }
        case 'weight_scale': {
          if (msg.timestamp === undefined) break;
          const day = localDayKey(msg.timestamp, tzOffsetMin ?? 0);
          daily.observeMany(day, {
            weight: numOf(msg.fields.weight),
            bodyFat: numOf(msg.fields.percent_fat),
            bodyWater: numOf(msg.fields.percent_hydration),
            muscleMass: numOf(msg.fields.muscle_mass),
            boneMass: numOf(msg.fields.bone_mass),
            bmi: numOf(msg.fields.bmi),
            metabolicAge: numOf(msg.fields.metabolic_age),
          });
          break;
        }
        case 'max_met_data': {
          const t = numOf(msg.fields.update_time) ?? msg.timestamp;
          const vo2 = numOf(msg.fields.vo2_max);
          if (t !== undefined && vo2 !== undefined) {
            daily.observe(localDayKey(t, tzOffsetMin ?? 0), 'vo2max', vo2);
            dailyAgg.vo2max = 'max';
          }
          break;
        }
        case 'spo2_data': {
          const v = numOf(msg.fields.reading_spo2);
          if (msg.timestamp !== undefined && v !== undefined && v > 0) {
            daily.observe(localDayKey(msg.timestamp, tzOffsetMin ?? 0), 'spo2Avg', v);
            dailyAgg.spo2Avg = 'avg';
          }
          break;
        }
        case 'respiration_rate': {
          const v = numOf(msg.fields.respiration_rate);
          if (msg.timestamp !== undefined && v !== undefined && v > 0) {
            daily.observe(localDayKey(msg.timestamp, tzOffsetMin ?? 0), 'respirationAvg', v);
            dailyAgg.respirationAvg = 'avg';
          }
          break;
        }
        case 'sleep_assessment': {
          const day = msg.timestamp !== undefined ? localDayKey(msg.timestamp, tzOffsetMin ?? 0) : undefined;
          const score = numOf(msg.fields.overall_sleep_score);
          if (day && score !== undefined) daily.observe(day, 'sleepScore', score);
          break;
        }
        default:
          break;
      }
    },
  });

  result.messageCounts = summary.messageCounts;
  result.fields = summary.fields;
  result.unknownFields = summary.unknownFields;
  result.developerFields = summary.developerFields;
  result.warnings = summary.warnings;

  if (!summary.ok) {
    result.warnings.push('File did not decode as FIT');
    return result;
  }

  flushMonitoring();
  flushSleep();

  result.daily = daily.build(dailyAgg);
  if (user) result.user = user;

  /* ------------------------------------------------------------ activities */

  const laps = lapMsgs.map((m, i) => readLap(m, i));

  if (sessions.length) {
    for (const session of sessions) {
      const act = readSession(session);
      const start = act.startTime!;
      const end = act.endTime ?? start + (act.elapsedTime ?? 0) * 1000;
      act.laps = laps.filter((l) => l.startTime === undefined || (l.startTime >= start - 1000 && l.startTime <= end + 1000));
      const stream = sessions.length === 1 ? samples.build() : samples.build({ start: start - 1000, end: end + 1000 });
      applyStreamConventions(stream, act.sport ?? 'other');
      act.streams = stream;
      result.activities.push(act);
    }
  } else if (samples.length > 0) {
    // Some devices (and partial exports) ship records with no session message.
    const stream = samples.build();
    const sport = normalizeSport(fileType === 'course' ? 'other' : undefined);
    applyStreamConventions(stream, sport);
    const start = stream ? stream.time[0] : fileCreatedAt;
    const end = stream ? stream.time[stream.n - 1] : undefined;
    if (start !== undefined) {
      result.activities.push({
        sport,
        startTime: start,
        endTime: end,
        elapsedTime: end !== undefined ? (end - start) / 1000 : undefined,
        laps,
        timezoneOffsetMin: tzOffsetMin,
        device: deviceName,
        manufacturer,
        extra: { note: 'Reconstructed from record messages — the file had no session summary' },
        streams: stream,
      });
      result.warnings.push('No session message found; activity summary reconstructed from records');
    }
  }

  for (const act of result.activities) {
    act.timezoneOffsetMin ??= tzOffsetMin;
    act.device ??= deviceName;
    act.manufacturer ??= manufacturer;
    if (hrvSampleCount) act.extra = { ...(act.extra ?? {}), hrvBeatIntervals: hrvSampleCount };
  }

  result.detectedAs = describe(fileType, result);
  return result;

  /* -------------------------------------------------------------- handlers */

  function handleRecord(msg: DecodedMessage) {
    const t = msg.timestamp;
    if (t === undefined) return;
    const fields = msg.fields;
    const values: Record<string, number | undefined> = {};

    const speed = numOf(fields.enhanced_speed) ?? numOf(fields.speed);
    if (speed !== undefined) values.speed = speed;
    const elevation = numOf(fields.enhanced_altitude) ?? numOf(fields.altitude);
    if (elevation !== undefined) values.elevation = elevation;
    const cadence = numOf(fields.cadence256) ?? sumDefined(numOf(fields.cadence), numOf(fields.fractional_cadence));
    if (cadence !== undefined) values.cadence = cadence;

    for (const [key, value] of Object.entries(fields)) {
      const mapped = RECORD_CHANNELS[key];
      if (mapped === null) continue;
      const channel = mapped ?? key;
      if (typeof value === 'number') {
        values[channel] = key === 'left_right_balance' ? value & 0x7f : value;
      }
    }

    samples.push(t, values, numOf(fields.position_lat), numOf(fields.position_long));
  }

  function handleMonitoring(msg: DecodedMessage) {
    const t = msg.timestamp;
    if (t === undefined) return;
    const day = localDayKey(t, tzOffsetMin ?? 0);
    const type = str(msg.fields.activity_type) ?? 'generic';

    const cycles = numOf(msg.fields.cycles);
    const distance = numOf(msg.fields.distance);
    const activeTime = numOf(msg.fields.active_time);
    if (cycles !== undefined || distance !== undefined || activeTime !== undefined) {
      let byType = monitoring.get(day);
      if (!byType) {
        byType = new Map();
        monitoring.set(day, byType);
      }
      const prev = byType.get(type) ?? {};
      // `cycles` are strides for foot activity types; Garmin reports these as steps.
      const steps = cycles !== undefined && (type === 'walking' || type === 'running') ? cycles * 2 : undefined;
      byType.set(type, {
        steps: maxDefined(prev.steps, steps),
        distance: maxDefined(prev.distance, distance),
        activeTime: maxDefined(prev.activeTime, activeTime),
      });
    }

    const hr = numOf(msg.fields.heart_rate);
    if (hr !== undefined && hr > 0) {
      daily.observe(day, 'avgHr', hr);
      daily.observe(day, 'minHr', hr);
      daily.observe(day, 'maxHr', hr);
      dailyAgg.avgHr = 'avg';
      dailyAgg.minHr = 'min';
      dailyAgg.maxHr = 'max';
    }
    for (const [field, key, agg] of [
      ['calories', 'totalCalories', 'max'],
      ['active_calories', 'activeCalories', 'max'],
      ['moderate_activity_minutes', 'moderateIntensityMinutes', 'max'],
      ['vigorous_activity_minutes', 'vigorousIntensityMinutes', 'max'],
      ['ascent', 'ascent', 'max'],
    ] as const) {
      const v = numOf(msg.fields[field]);
      if (v !== undefined) {
        daily.observe(day, key, v);
        dailyAgg[key] = agg;
      }
    }
  }

  function flushMonitoring() {
    for (const [day, byType] of monitoring) {
      let steps = 0;
      let distance = 0;
      let activeTime = 0;
      let any = false;
      for (const v of byType.values()) {
        if (v.steps !== undefined) {
          steps += v.steps;
          any = true;
        }
        if (v.distance !== undefined) {
          distance += v.distance;
          any = true;
        }
        if (v.activeTime !== undefined) {
          activeTime += v.activeTime;
          any = true;
        }
      }
      if (!any) continue;
      if (steps > 0) daily.observe(day, 'steps', steps);
      if (distance > 0) daily.observe(day, 'walkingDistance', distance);
      if (activeTime > 0) daily.observe(day, 'activeSeconds', activeTime);
    }
  }

  function flushSleep() {
    if (sleepEvents.length < 2) return;
    sleepEvents.sort((a, b) => a.t - b.t);
    // Split into nights whenever there is a gap of more than 4 hours.
    let night: typeof sleepEvents = [];
    const nights: (typeof sleepEvents)[] = [];
    for (const ev of sleepEvents) {
      if (night.length && ev.t - night[night.length - 1].t > 4 * 3600_000) {
        nights.push(night);
        night = [];
      }
      night.push(ev);
    }
    if (night.length) nights.push(night);

    for (const events of nights) {
      if (events.length < 2) continue;
      const stages: Record<string, number> = {};
      for (let i = 0; i < events.length - 1; i++) {
        const dur = (events[i + 1].t - events[i].t) / 1000;
        if (dur <= 0 || dur > 6 * 3600) continue;
        stages[events[i].level] = (stages[events[i].level] ?? 0) + dur;
      }
      const end = events[events.length - 1].t;
      const day = localDayKey(end, tzOffsetMin ?? 0);
      const asleep = (stages.light ?? 0) + (stages.deep ?? 0) + (stages.rem ?? 0);
      if (asleep <= 0) continue;
      daily.observeMany(day, {
        sleepDuration: asleep,
        sleepDeep: stages.deep,
        sleepLight: stages.light,
        sleepRem: stages.rem,
        sleepAwake: stages.awake,
        sleepStart: minutesSinceNoon(events[0].t, tzOffsetMin ?? 0),
        sleepEnd: minutesSinceNoon(end, tzOffsetMin ?? 0),
      });
    }
  }

  function readSession(msg: DecodedMessage): RawActivity {
    const fields = msg.fields;
    const sport = normalizeSport(str(fields.sport) ?? undefined);
    const startTime = numOf(fields.start_time) ?? numOf(fields.timestamp);
    const elapsed = numOf(fields.total_elapsed_time);
    const totalCycles = numOf(fields.total_cycles);
    const act: RawActivity = {
      sport,
      subSport: str(fields.sub_sport),
      name: typeof fields.sport_profile_name === 'string' ? fields.sport_profile_name : undefined,
      startTime,
      endTime: startTime !== undefined && elapsed !== undefined ? startTime + elapsed * 1000 : numOf(fields.timestamp),
      elapsedTime: elapsed,
      timerTime: numOf(fields.total_timer_time),
      movingTime: numOf(fields.total_moving_time),
      distance: numOf(fields.total_distance),
      calories: numOf(fields.total_calories),
      avgSpeed: numOf(fields.enhanced_avg_speed) ?? numOf(fields.avg_speed),
      maxSpeed: numOf(fields.enhanced_max_speed) ?? numOf(fields.max_speed),
      avgHr: numOf(fields.avg_heart_rate),
      maxHr: numOf(fields.max_heart_rate),
      minHr: numOf(fields.min_heart_rate),
      avgCadence: sumDefined(numOf(fields.avg_cadence), numOf(fields.avg_fractional_cadence)),
      maxCadence: sumDefined(numOf(fields.max_cadence), numOf(fields.max_fractional_cadence)),
      avgPower: numOf(fields.avg_power),
      maxPower: numOf(fields.max_power),
      normalizedPower: numOf(fields.normalized_power),
      ascent: sumDefined(numOf(fields.total_ascent), numOf(fields.total_fractional_ascent)),
      descent: sumDefined(numOf(fields.total_descent), numOf(fields.total_fractional_descent)),
      minElevation: numOf(fields.enhanced_min_altitude) ?? numOf(fields.min_altitude),
      maxElevation: numOf(fields.enhanced_max_altitude) ?? numOf(fields.max_altitude),
      avgTemperature: numOf(fields.avg_temperature),
      maxTemperature: numOf(fields.max_temperature),
      trainingEffectAerobic: numOf(fields.total_training_effect),
      trainingEffectAnaerobic: numOf(fields.total_anaerobic_training_effect),
      tss: numOf(fields.training_stress_score),
      intensityFactor: numOf(fields.intensity_factor),
      poolLength: numOf(fields.pool_length),
      avgVerticalOscillation: numOf(fields.avg_vertical_oscillation),
      avgGroundContactTime: numOf(fields.avg_stance_time),
      hrZoneTimes: Array.isArray(fields.time_in_hr_zone)
        ? (fields.time_in_hr_zone as number[]).filter((v) => typeof v === 'number')
        : undefined,
      laps: [],
      extra: collectExtra(fields, SESSION_MAPPED),
    };
    if (totalCycles !== undefined) {
      if (FOOT_SPORTS.has(sport)) act.steps = Math.round(totalCycles * 2);
      else if (sport === 'swimming') act.strokes = Math.round(totalCycles);
      else act.extra!.totalCycles = totalCycles;
    }
    if (act.distance && act.steps) act.avgStrideLength = (act.distance / act.steps) * 1000;
    return act;
  }

  function readLap(msg: DecodedMessage, index: number): Lap {
    const fields = msg.fields;
    return {
      index: numOf(fields.message_index) ?? index,
      startTime: numOf(fields.start_time) ?? numOf(fields.timestamp),
      elapsedTime: numOf(fields.total_elapsed_time),
      timerTime: numOf(fields.total_timer_time),
      movingTime: numOf(fields.total_moving_time),
      distance: numOf(fields.total_distance),
      avgSpeed: numOf(fields.enhanced_avg_speed) ?? numOf(fields.avg_speed),
      maxSpeed: numOf(fields.enhanced_max_speed) ?? numOf(fields.max_speed),
      avgHr: numOf(fields.avg_heart_rate),
      maxHr: numOf(fields.max_heart_rate),
      avgCadence: sumDefined(numOf(fields.avg_cadence), numOf(fields.avg_fractional_cadence)),
      maxCadence: numOf(fields.max_cadence),
      avgPower: numOf(fields.avg_power),
      maxPower: numOf(fields.max_power),
      normalizedPower: numOf(fields.normalized_power),
      calories: numOf(fields.total_calories),
      ascent: numOf(fields.total_ascent),
      descent: numOf(fields.total_descent),
      avgTemperature: numOf(fields.avg_temperature),
      intensity: str(fields.intensity),
      trigger: str(fields.lap_trigger),
      sport: str(fields.sport),
      extra: collectExtra(fields, LAP_MAPPED),
    };
  }

  function readUserProfile(msg: DecodedMessage): UserProfile {
    const fields = msg.fields;
    return {
      name: typeof fields.friendly_name === 'string' ? fields.friendly_name : undefined,
      gender: str(fields.gender),
      age: numOf(fields.age),
      heightM: numOf(fields.height),
      weightKg: numOf(fields.weight),
      restingHr: numOf(fields.resting_heart_rate),
      maxHr: numOf(fields.default_max_heart_rate),
      extra: collectExtra(fields, USER_MAPPED),
    };
  }
}

/* ------------------------------------------------------------------ helpers */

function describe(fileType: string | undefined, result: ParseResult): string {
  if (result.activities.length) {
    const sports = [...new Set(result.activities.map((a) => a.sport))].join(', ');
    return `FIT activity${result.activities.length > 1 ? ` ×${result.activities.length}` : ''}${sports ? ` (${sports})` : ''}`;
  }
  if (result.daily.length) return 'FIT wellness / monitoring';
  return fileType ? `FIT ${fileType}` : 'FIT';
}

/**
 * Sport-dependent conventions applied after the sport is known: Garmin reports
 * foot-sport cadence in strides per minute but displays steps per minute.
 */
function applyStreamConventions(stream: ReturnType<SampleBuilder['build']>, sport: string) {
  if (!stream) return;
  if (FOOT_SPORTS.has(sport) && stream.channels.cadence) {
    const c = stream.channels.cadence;
    for (let i = 0; i < c.length; i++) c[i] = c[i] * 2;
  }
}

const SESSION_MAPPED = new Set([
  'sport', 'sub_sport', 'sport_profile_name', 'start_time', 'timestamp', 'total_elapsed_time',
  'total_timer_time', 'total_moving_time', 'total_distance', 'total_calories', 'avg_speed',
  'enhanced_avg_speed', 'max_speed', 'enhanced_max_speed', 'avg_heart_rate', 'max_heart_rate',
  'min_heart_rate', 'avg_cadence', 'avg_fractional_cadence', 'max_cadence', 'max_fractional_cadence',
  'avg_power', 'max_power', 'normalized_power', 'total_ascent', 'total_descent',
  'total_fractional_ascent', 'total_fractional_descent', 'min_altitude', 'max_altitude',
  'enhanced_min_altitude', 'enhanced_max_altitude', 'avg_temperature', 'max_temperature',
  'total_training_effect', 'total_anaerobic_training_effect', 'training_stress_score',
  'intensity_factor', 'pool_length', 'avg_vertical_oscillation', 'avg_stance_time',
  'time_in_hr_zone', 'total_cycles', 'event', 'event_type', 'event_group', 'message_index',
  'first_lap_index', 'trigger',
]);

const LAP_MAPPED = new Set([
  'message_index', 'start_time', 'timestamp', 'total_elapsed_time', 'total_timer_time',
  'total_moving_time', 'total_distance', 'avg_speed', 'enhanced_avg_speed', 'max_speed',
  'enhanced_max_speed', 'avg_heart_rate', 'max_heart_rate', 'avg_cadence', 'avg_fractional_cadence',
  'max_cadence', 'avg_power', 'max_power', 'normalized_power', 'total_calories', 'total_ascent',
  'total_descent', 'avg_temperature', 'intensity', 'lap_trigger', 'sport', 'event', 'event_type',
  'event_group',
]);

const USER_MAPPED = new Set([
  'friendly_name', 'gender', 'age', 'height', 'weight', 'resting_heart_rate',
  'default_max_heart_rate', 'timestamp', 'message_index',
]);

/** Everything the typed model did not claim, so nothing is lost. */
function collectExtra(fields: Record<string, FitValue>, mapped: Set<string>): Record<string, Scalar> {
  const extra: Record<string, Scalar> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (mapped.has(key)) continue;
    if (Array.isArray(value)) {
      if (value.length && value.length <= 24) extra[key] = value.join(', ');
      continue;
    }
    extra[key] = value;
  }
  return extra;
}

/** Local minutes since noon — see `formatClockMinutes`. */
function minutesSinceNoon(ms: number, offsetMin: number): number {
  const local = new Date(ms + offsetMin * 60000);
  const minuteOfDay = local.getUTCHours() * 60 + local.getUTCMinutes();
  return (minuteOfDay + 1440 - 720) % 1440;
}

function numOf(v: FitValue | undefined): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function str(v: FitValue | undefined): string | undefined {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  return undefined;
}

function sumDefined(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return a + b;
}

function maxDefined(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.max(a, b);
}
