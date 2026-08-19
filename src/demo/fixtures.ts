/**
 * Synthetic Garmin files.
 *
 * Used by the test suite and by the app's "Load sample export" button. The FIT
 * builders produce real, CRC-valid binaries through the encoder, so tests
 * exercise the same code path a device file would.
 */
import { encodeFit, rawValue, enumRaw, BT, type EncodeMessage } from '../parsers/fit/encoder.ts';

const MESG = { fileId: 0, userProfile: 3, session: 18, lap: 19, record: 20, deviceInfo: 23, weightScale: 30, activity: 34, monitoring: 55, monitoringInfo: 103, fieldDescription: 206, developerDataId: 207, stressLevel: 227, maxMetData: 229, sleepLevel: 346, hrvStatus: 370 } as const;

export interface FitActivityOptions {
  start: number;
  sport?: string;
  subSport?: string;
  durationSec?: number;
  distanceM?: number;
  sampleIntervalSec?: number;
  withGps?: boolean;
  withHeartRate?: boolean;
  withPower?: boolean;
  withCadence?: boolean;
  withTemperature?: boolean;
  /** Emit a developer field (`Form Power`) on every record. */
  withDeveloperField?: boolean;
  /** Emit a record field that is not in the profile table. */
  withUnknownField?: boolean;
  laps?: number;
  deviceName?: string;
  corruptCrc?: boolean;
  /** Omit the session message, leaving only records. */
  omitSession?: boolean;
  /** Average heart rate to centre the synthetic HR trace on. */
  hrBase?: number;
  /** Set false for activities with no distance at all (gym sessions). */
  withDistance?: boolean;
  ascentM?: number;
}

export function buildFitActivity(opts: FitActivityOptions): Uint8Array {
  const {
    start,
    sport = 'running',
    subSport,
    durationSec = 1800,
    distanceM = 5000,
    sampleIntervalSec = 5,
    withGps = true,
    withHeartRate = true,
    withPower = false,
    withCadence = true,
    withTemperature = true,
    withDeveloperField = false,
    withUnknownField = false,
    laps = 2,
    deviceName = 'Forerunner 965',
    hrBase = 118,
    withDistance = true,
    ascentM = 86,
  } = opts;

  const messages: EncodeMessage[] = [];
  const rec = (field: number, value: number) => rawValue(MESG.record, field, value) as number;

  messages.push({
    mesgNum: MESG.fileId,
    fields: [
      { num: 0, baseType: BT.enum, value: enumRaw('file', 'activity') },
      { num: 1, baseType: BT.uint16, value: 1 },
      { num: 2, baseType: BT.uint16, value: 4315 },
      { num: 3, baseType: BT.uint32z, value: 3948572 },
      { num: 4, baseType: BT.uint32, value: rawValue(MESG.fileId, 4, start) as number },
      { num: 8, baseType: BT.string, value: deviceName },
    ],
  });

  messages.push({
    mesgNum: MESG.deviceInfo,
    fields: [
      { num: 253, baseType: BT.uint32, value: rawValue(MESG.deviceInfo, 253, start) as number },
      { num: 0, baseType: BT.uint8, value: 0 },
      { num: 2, baseType: BT.uint16, value: 1 },
      { num: 4, baseType: BT.uint16, value: 4315 },
      { num: 27, baseType: BT.string, value: deviceName },
    ],
  });

  if (withDeveloperField) {
    messages.push({
      mesgNum: MESG.developerDataId,
      fields: [
        { num: 1, baseType: BT.byte, value: Array.from({ length: 16 }, (_, i) => i) },
        { num: 3, baseType: BT.uint8, value: 0 },
        { num: 4, baseType: BT.uint32, value: 1 },
      ],
    });
    messages.push({
      mesgNum: MESG.fieldDescription,
      fields: [
        { num: 0, baseType: BT.uint8, value: 0 },
        { num: 1, baseType: BT.uint8, value: 0 },
        { num: 2, baseType: BT.uint8, value: BT.uint16 & 0x1f },
        { num: 3, baseType: BT.string, value: 'Form Power' },
        { num: 8, baseType: BT.string, value: 'W' },
        { num: 14, baseType: BT.uint16, value: MESG.record },
      ],
    });
  }

  const samples = Math.max(2, Math.floor(durationSec / sampleIntervalSec));
  const baseLat = 47.6062;
  const baseLon = -122.3321;
  const hrs: number[] = [];

  // Shape the speed trace first, then scale it so the integral is exactly the
  // requested distance — otherwise the summary and the samples disagree.
  const shape = Array.from({ length: samples }, (_, i) =>
    0.85 + 0.3 * Math.sin((i / (samples - 1)) * Math.PI * 3),
  );
  const integral = shape.reduce((a, b) => a + b, 0) * sampleIntervalSec;
  const speeds = shape.map((v) => (v * distanceM) / integral);
  let cumulative = 0;

  for (let i = 0; i < samples; i++) {
    const t = start + i * sampleIntervalSec * 1000;
    const progress = i / (samples - 1);
    const speed = speeds[i];
    const hr = hrBase + 42 * progress + 6 * Math.sin(progress * 12);
    hrs.push(hr);

    const fields: EncodeMessage['fields'] = [{ num: 253, baseType: BT.uint32, value: rec(253, t) }];
    if (withDistance) {
      fields.push(
        { num: 5, baseType: BT.uint32, value: rec(5, cumulative) },
        { num: 6, baseType: BT.uint16, value: rec(6, speed) },
      );
    }
    if (withGps) {
      // Indoor sessions have no barometric/GPS altitude at all.
      fields.push({ num: 2, baseType: BT.uint16, value: rec(2, 30 + 25 * Math.sin(progress * Math.PI * 2)) });
    }
    if (withGps && withDistance) {
      fields.push(
        { num: 0, baseType: BT.sint32, value: rec(0, baseLat + Math.sin(progress * Math.PI * 2) * 0.012) },
        { num: 1, baseType: BT.sint32, value: rec(1, baseLon + Math.cos(progress * Math.PI * 2) * 0.016) },
      );
    }
    if (withHeartRate) fields.push({ num: 3, baseType: BT.uint8, value: Math.round(hr) });
    if (withCadence) fields.push({ num: 4, baseType: BT.uint8, value: Math.round(84 + 3 * Math.sin(progress * 8)) });
    if (withPower) fields.push({ num: 7, baseType: BT.uint16, value: Math.round(210 + 60 * Math.sin(progress * 6)) });
    if (withTemperature) fields.push({ num: 13, baseType: BT.sint8, value: Math.round(14 + 4 * progress) });
    if (withUnknownField) fields.push({ num: 90, baseType: BT.sint8, value: Math.round(10 * Math.sin(progress * 4)) });

    cumulative = Math.min(distanceM, cumulative + speed * sampleIntervalSec);

    messages.push({
      mesgNum: MESG.record,
      fields,
      devFields: withDeveloperField
        ? [{ num: 0, devIndex: 0, baseType: BT.uint16, value: Math.round(180 + 40 * Math.sin(progress * 5)) }]
        : undefined,
    });
  }

  const avgSpeed = distanceM / durationSec;
  const maxSpeed = Math.max(...speeds);
  const avgHr = hrs.reduce((a, b) => a + b, 0) / hrs.length;
  const maxHr = Math.max(...hrs);

  const lapCount = Math.max(1, laps);
  const lapDuration = durationSec / lapCount;
  for (let i = 0; i < lapCount; i++) {
    const lapStart = start + i * lapDuration * 1000;
    messages.push({
      mesgNum: MESG.lap,
      fields: [
        { num: 253, baseType: BT.uint32, value: rawValue(MESG.lap, 253, lapStart + lapDuration * 1000) as number },
        { num: 254, baseType: BT.uint16, value: i },
        { num: 2, baseType: BT.uint32, value: rawValue(MESG.lap, 2, lapStart) as number },
        { num: 7, baseType: BT.uint32, value: rawValue(MESG.lap, 7, lapDuration) as number },
        { num: 8, baseType: BT.uint32, value: rawValue(MESG.lap, 8, lapDuration) as number },
        ...(withDistance
          ? [
              { num: 9, baseType: BT.uint32, value: rawValue(MESG.lap, 9, distanceM / lapCount) as number },
              { num: 13, baseType: BT.uint16, value: rawValue(MESG.lap, 13, avgSpeed) as number },
            ]
          : []),
        { num: 11, baseType: BT.uint16, value: Math.round((durationSec / lapCount) * 0.16) },
        { num: 15, baseType: BT.uint8, value: Math.round(avgHr) },
        { num: 16, baseType: BT.uint8, value: Math.round(maxHr) },
        { num: 24, baseType: BT.enum, value: enumRaw('lap_trigger', 'distance') },
      ],
    });
  }

  if (!opts.omitSession) {
    messages.push({
      mesgNum: MESG.session,
      fields: [
        { num: 253, baseType: BT.uint32, value: rawValue(MESG.session, 253, start + durationSec * 1000) as number },
        { num: 2, baseType: BT.uint32, value: rawValue(MESG.session, 2, start) as number },
        { num: 5, baseType: BT.enum, value: enumRaw('sport', sport) },
        ...(subSport ? [{ num: 6, baseType: BT.enum, value: enumRaw('sub_sport', subSport) }] : []),
        { num: 7, baseType: BT.uint32, value: rawValue(MESG.session, 7, durationSec) as number },
        { num: 8, baseType: BT.uint32, value: rawValue(MESG.session, 8, durationSec * 0.97) as number },
        ...(withDistance
          ? [
              { num: 9, baseType: BT.uint32, value: rawValue(MESG.session, 9, distanceM) as number },
              // `total_cycles` is strides for foot sports, strokes for swims and
              // pedal revolutions for rides — the decoder converts accordingly.
              { num: 10, baseType: BT.uint32, value: Math.round(cycleCount(sport, distanceM, durationSec)) },
              { num: 14, baseType: BT.uint16, value: rawValue(MESG.session, 14, avgSpeed) as number },
              { num: 15, baseType: BT.uint16, value: rawValue(MESG.session, 15, maxSpeed) as number },
            ]
          : []),
        { num: 11, baseType: BT.uint16, value: Math.round(durationSec * 0.16) },
        { num: 16, baseType: BT.uint8, value: Math.round(avgHr) },
        { num: 17, baseType: BT.uint8, value: Math.round(maxHr) },
        ...(ascentM > 0
          ? [
              { num: 22, baseType: BT.uint16, value: Math.round(ascentM) },
              { num: 23, baseType: BT.uint16, value: Math.round(ascentM * 0.95) },
            ]
          : []),
        { num: 24, baseType: BT.uint8, value: rawValue(MESG.session, 24, 3.4) as number },
        { num: 26, baseType: BT.uint16, value: lapCount },
        { num: 65, baseType: BT.uint32, value: [60, 300, 600, 500, 120].map((s) => s * 1000) },
        { num: 137, baseType: BT.uint8, value: rawValue(MESG.session, 137, 1.8) as number },
      ],
    });

    messages.push({
      mesgNum: MESG.activity,
      fields: [
        { num: 253, baseType: BT.uint32, value: rawValue(MESG.activity, 253, start + durationSec * 1000) as number },
        { num: 0, baseType: BT.uint32, value: rawValue(MESG.activity, 0, durationSec) as number },
        { num: 1, baseType: BT.uint16, value: 1 },
        { num: 5, baseType: BT.uint32, value: rawValue(MESG.activity, 5, start + durationSec * 1000 - 7 * 3600_000) as number },
      ],
    });
  }

  return encodeFit(messages, { corruptCrc: opts.corruptCrc });
}

/** Strides / strokes / pedal revolutions, depending on the sport. */
function cycleCount(sport: string, distanceM: number, durationSec: number): number {
  if (sport === 'running' || sport === 'walking' || sport === 'hiking') return distanceM / 2.3;
  if (sport === 'swimming') return distanceM / 2.1;
  return (durationSec * 85) / 60;
}

export interface FitWellnessDay {
  /** Local midnight of the day, epoch ms. */
  dayStart: number;
  steps?: number;
  distanceM?: number;
  calories?: number;
  activeCalories?: number;
  restingHr?: number;
  stress?: number[];
  sleepHours?: number;
  weightKg?: number;
  hrvMs?: number;
  vo2max?: number;
}

/** A Garmin-style wellness/monitoring FIT file covering one or more days. */
export function buildFitWellness(days: FitWellnessDay[], tzOffsetMin = 0): Uint8Array {
  const messages: EncodeMessage[] = [];
  const first = days[0];

  messages.push({
    mesgNum: MESG.fileId,
    fields: [
      { num: 0, baseType: BT.enum, value: 32 },
      { num: 1, baseType: BT.uint16, value: 1 },
      { num: 4, baseType: BT.uint32, value: rawValue(MESG.fileId, 4, first.dayStart) as number },
    ],
  });
  messages.push({
    mesgNum: MESG.monitoringInfo,
    fields: [
      { num: 253, baseType: BT.uint32, value: rawValue(MESG.monitoringInfo, 253, first.dayStart) as number },
      { num: 0, baseType: BT.uint32, value: rawValue(MESG.monitoringInfo, 0, first.dayStart + tzOffsetMin * 60000) as number },
    ],
  });

  for (const day of days) {
    const hours = 16;
    for (let h = 0; h < hours; h++) {
      const t = day.dayStart + (h + 6) * 3600_000;
      const fraction = (h + 1) / hours;
      const fields: EncodeMessage['fields'] = [
        { num: 253, baseType: BT.uint32, value: rawValue(MESG.monitoring, 253, t) as number },
        { num: 5, baseType: BT.enum, value: enumRaw('activity_type', 'walking') },
      ];
      if (day.steps) {
        // `cycles` are strides; the decoder doubles them back to steps.
        fields.push({ num: 3, baseType: BT.uint32, value: rawValue(MESG.monitoring, 3, (day.steps * fraction) / 2) as number });
      }
      if (day.distanceM) fields.push({ num: 2, baseType: BT.uint32, value: rawValue(MESG.monitoring, 2, day.distanceM * fraction) as number });
      if (day.calories) fields.push({ num: 1, baseType: BT.uint16, value: Math.round(day.calories * fraction) });
      if (day.activeCalories) fields.push({ num: 19, baseType: BT.uint16, value: Math.round(day.activeCalories * fraction) });
      if (day.restingHr) fields.push({ num: 27, baseType: BT.uint8, value: Math.round(day.restingHr + 20 * Math.sin(h)) });
      messages.push({ mesgNum: MESG.monitoring, fields });
    }

    for (const [i, value] of (day.stress ?? []).entries()) {
      messages.push({
        mesgNum: MESG.stressLevel,
        fields: [
          { num: 0, baseType: BT.sint16, value },
          { num: 1, baseType: BT.uint32, value: rawValue(MESG.stressLevel, 1, day.dayStart + (8 + i) * 3600_000) as number },
        ],
      });
    }

    if (day.sleepHours) {
      const sleepStart = day.dayStart - 1.5 * 3600_000;
      const stages: [string, number][] = [
        ['light', 0.5],
        ['deep', 0.2],
        ['light', 0.15],
        ['rem', 0.1],
        ['awake', 0.05],
      ];
      let cursor = sleepStart;
      for (const [level, share] of stages) {
        messages.push({
          mesgNum: MESG.sleepLevel,
          fields: [
            { num: 253, baseType: BT.uint32, value: rawValue(MESG.sleepLevel, 253, cursor) as number },
            { num: 0, baseType: BT.enum, value: enumRaw('sleep_level', level) },
          ],
        });
        cursor += day.sleepHours * 3600_000 * share;
      }
      messages.push({
        mesgNum: MESG.sleepLevel,
        fields: [
          { num: 253, baseType: BT.uint32, value: rawValue(MESG.sleepLevel, 253, cursor) as number },
          { num: 0, baseType: BT.enum, value: enumRaw('sleep_level', 'awake') },
        ],
      });
    }

    if (day.weightKg) {
      messages.push({
        mesgNum: MESG.weightScale,
        fields: [
          { num: 253, baseType: BT.uint32, value: rawValue(MESG.weightScale, 253, day.dayStart + 7 * 3600_000) as number },
          { num: 0, baseType: BT.uint16, value: rawValue(MESG.weightScale, 0, day.weightKg) as number },
          { num: 1, baseType: BT.uint16, value: rawValue(MESG.weightScale, 1, 18.5) as number },
        ],
      });
    }

    if (day.hrvMs) {
      messages.push({
        mesgNum: MESG.hrvStatus,
        fields: [
          { num: 253, baseType: BT.uint32, value: rawValue(MESG.hrvStatus, 253, day.dayStart + 7 * 3600_000) as number },
          { num: 0, baseType: BT.uint16, value: rawValue(MESG.hrvStatus, 0, day.hrvMs) as number },
          { num: 1, baseType: BT.uint16, value: rawValue(MESG.hrvStatus, 1, day.hrvMs) as number },
          { num: 6, baseType: BT.enum, value: enumRaw('hrv_status', 'balanced') },
        ],
      });
    }

    if (day.vo2max) {
      messages.push({
        mesgNum: MESG.maxMetData,
        fields: [
          { num: 0, baseType: BT.uint32, value: rawValue(MESG.maxMetData, 0, day.dayStart + 12 * 3600_000) as number },
          { num: 2, baseType: BT.uint16, value: rawValue(MESG.maxMetData, 2, day.vo2max) as number },
          { num: 5, baseType: BT.enum, value: enumRaw('sport', 'running') },
        ],
      });
    }
  }

  return encodeFit(messages);
}

/** A FIT file containing only a user profile — exercises "wellness, no activity". */
export function buildFitUserProfile(name: string, weightKg: number, restingHr: number): Uint8Array {
  return encodeFit([
    {
      mesgNum: MESG.userProfile,
      fields: [
        { num: 0, baseType: BT.string, value: name },
        { num: 1, baseType: BT.enum, value: 1 },
        { num: 2, baseType: BT.uint8, value: 38 },
        { num: 3, baseType: BT.uint8, value: rawValue(MESG.userProfile, 3, 1.82) as number },
        { num: 4, baseType: BT.uint16, value: rawValue(MESG.userProfile, 4, weightKg) as number },
        { num: 8, baseType: BT.uint8, value: restingHr },
      ],
    },
  ]);
}
