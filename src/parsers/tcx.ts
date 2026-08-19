/**
 * TCX (Training Center Database) → `ParseResult`.
 *
 * Covers the whole activity tree: activity sport, laps with their summary
 * fields, trackpoints, and the `TPX`/`LX` extension elements Garmin uses for
 * speed, power, run cadence and steps.
 */
import { scanXml } from './xml/sax.ts';
import { SampleBuilder } from './streams.ts';
import { emptyParseResult, type Lap, type ParseResult, type RawActivity, type Scalar } from '../core/types.ts';
import { parseTimestamp } from '../core/time.ts';
import { normalizeSport } from '../core/metrics.ts';
import { mean, maxOf } from '../core/stats.ts';

const TP_EXT_CHANNELS: Record<string, string> = {
  Speed: 'speed',
  Watts: 'power',
  RunCadence: 'cadence',
  Cadence: 'cadence',
  StepLength: 'stepLength',
  VerticalOscillation: 'verticalOscillation',
  VerticalRatio: 'verticalRatio',
  GroundContactTime: 'groundContactTime',
  GroundContactBalance: 'groundContactBalance',
  PerformanceCondition: 'performanceCondition',
  RespirationRate: 'respirationRate',
};

interface LapAccumulator {
  lap: Lap;
  extra: Record<string, Scalar>;
}

export function parseTcx(text: string): ParseResult {
  const result = emptyParseResult('tcx');
  const counts: Record<string, number> = {};
  const fields = new Set<string>();
  const unknown = new Set<string>();

  const stack: string[] = [];
  let samples = new SampleBuilder();
  let activity: { sport: string; id?: number; laps: LapAccumulator[]; device?: string; notes?: string } | undefined;
  let lapAcc: LapAccumulator | undefined;
  let point: { t?: number; lat?: number; lon?: number; values: Record<string, number | undefined> } | undefined;
  let creatorName: string | undefined;

  const has = (tag: string) => stack.includes(tag);

  const finishActivity = () => {
    if (!activity) return;
    const stream = samples.build();
    const laps = activity.laps.map((l, i) => ({ ...l.lap, index: i, extra: l.extra }));
    const act = summarize(activity.sport, activity.id, laps, stream, activity.device ?? creatorName);
    if (act) result.activities.push(act);
    samples = new SampleBuilder();
    activity = undefined;
  };

  scanXml(text, {
    onOpen(name, attrs, selfClosing) {
      stack.push(name);
      counts[name] = (counts[name] ?? 0) + 1;
      switch (name) {
        case 'Activity':
          finishActivity();
          activity = { sport: normalizeSport(attrs.Sport), laps: [] };
          if (attrs.Sport) fields.add('Activity@Sport');
          break;
        case 'Lap':
          lapAcc = { lap: { index: activity?.laps.length ?? 0, extra: {} }, extra: {} };
          if (attrs.StartTime) {
            lapAcc.lap.startTime = parseTimestamp(attrs.StartTime);
            fields.add('Lap@StartTime');
          }
          break;
        case 'Trackpoint':
          point = { values: {} };
          break;
        default:
          break;
      }
      if (selfClosing) {
        if (name === 'Trackpoint') point = undefined;
        stack.pop();
      }
    },
    onText(raw) {
      const value = raw.trim();
      if (!value) return;
      const tag = stack[stack.length - 1];
      const parent = stack[stack.length - 2];
      const num = Number(value);

      if (point && has('Trackpoint')) {
        switch (tag) {
          case 'Time':
            point.t = parseTimestamp(value);
            fields.add('Trackpoint.Time');
            return;
          case 'LatitudeDegrees':
            point.lat = num;
            fields.add('Trackpoint.Position');
            return;
          case 'LongitudeDegrees':
            point.lon = num;
            return;
          case 'AltitudeMeters':
            point.values.elevation = num;
            fields.add('Trackpoint.AltitudeMeters');
            return;
          case 'DistanceMeters':
            point.values.distance = num;
            fields.add('Trackpoint.DistanceMeters');
            return;
          case 'Value':
            if (parent === 'HeartRateBpm') {
              point.values.heartRate = num;
              fields.add('Trackpoint.HeartRateBpm');
            }
            return;
          case 'Cadence':
            point.values.cadence = num;
            fields.add('Trackpoint.Cadence');
            return;
          case 'SensorState':
            return;
          default: {
            const channel = TP_EXT_CHANNELS[tag];
            if (channel && Number.isFinite(num)) {
              point.values[channel] = num;
              fields.add(`Trackpoint.${tag}`);
            } else if (Number.isFinite(num) && has('Extensions')) {
              point.values[tag] = num;
              unknown.add(`Trackpoint.${tag}`);
              fields.add(`Trackpoint.${tag}`);
            }
            return;
          }
        }
      }

      if (lapAcc && has('Lap')) {
        const lap = lapAcc.lap;
        switch (tag) {
          case 'TotalTimeSeconds':
            lap.elapsedTime = num;
            lap.timerTime = num;
            fields.add('Lap.TotalTimeSeconds');
            return;
          case 'DistanceMeters':
            lap.distance = num;
            fields.add('Lap.DistanceMeters');
            return;
          case 'MaximumSpeed':
            lap.maxSpeed = num;
            fields.add('Lap.MaximumSpeed');
            return;
          case 'Calories':
            lap.calories = num;
            fields.add('Lap.Calories');
            return;
          case 'Value':
            if (parent === 'AverageHeartRateBpm') {
              lap.avgHr = num;
              fields.add('Lap.AverageHeartRateBpm');
            } else if (parent === 'MaximumHeartRateBpm') {
              lap.maxHr = num;
              fields.add('Lap.MaximumHeartRateBpm');
            }
            return;
          case 'Intensity':
            lap.intensity = value.toLowerCase();
            fields.add('Lap.Intensity');
            return;
          case 'TriggerMethod':
            lap.trigger = value.toLowerCase();
            fields.add('Lap.TriggerMethod');
            return;
          case 'Cadence':
            lap.avgCadence = num;
            fields.add('Lap.Cadence');
            return;
          case 'AvgSpeed':
            lap.avgSpeed = num;
            fields.add('Lap.AvgSpeed');
            return;
          case 'AvgWatts':
            lap.avgPower = num;
            fields.add('Lap.AvgWatts');
            return;
          case 'MaxWatts':
            lap.maxPower = num;
            fields.add('Lap.MaxWatts');
            return;
          case 'AvgRunCadence':
            lap.avgCadence = num;
            return;
          case 'MaxRunCadence':
            lap.maxCadence = num;
            return;
          case 'Steps':
            lapAcc.extra.steps = num;
            return;
          default:
            if (has('Extensions') && Number.isFinite(num)) {
              lapAcc.extra[tag] = num;
              unknown.add(`Lap.${tag}`);
            }
            return;
        }
      }

      if (activity) {
        if (tag === 'Id' && parent === 'Activity') {
          activity.id = parseTimestamp(value);
          fields.add('Activity.Id');
        } else if (tag === 'Name' && has('Creator')) {
          activity.device = value;
          fields.add('Creator.Name');
        } else if (tag === 'Notes') {
          activity.notes = value;
          fields.add('Activity.Notes');
        }
      }
      if (tag === 'Name' && has('Author')) creatorName ??= value;
    },
    onClose(name) {
      if (name === 'Trackpoint' && point) {
        if (point.t !== undefined) samples.push(point.t, point.values, point.lat, point.lon);
        point = undefined;
      } else if (name === 'Lap' && lapAcc && activity) {
        activity.laps.push(lapAcc);
        lapAcc = undefined;
      } else if (name === 'Activity') {
        finishActivity();
      }
      const idx = stack.lastIndexOf(name);
      if (idx >= 0) stack.length = idx;
    },
  });

  finishActivity();

  result.messageCounts = counts;
  result.fields = [...fields].sort();
  result.unknownFields = [...unknown].sort();
  if (!result.activities.length) result.warnings.push('No activities found in TCX document');
  result.detectedAs = `TCX activity${result.activities.length > 1 ? ` ×${result.activities.length}` : ''}`;
  return result;
}

function summarize(
  sport: string,
  id: number | undefined,
  laps: Lap[],
  stream: ReturnType<SampleBuilder['build']>,
  device: string | undefined,
): RawActivity | undefined {
  const startTime = id ?? laps.find((l) => l.startTime)?.startTime ?? (stream ? stream.time[0] : undefined);
  if (startTime === undefined) return undefined;

  const totalTime = sumOf(laps.map((l) => l.elapsedTime));
  const distance = sumOf(laps.map((l) => l.distance));
  const calories = sumOf(laps.map((l) => l.calories));
  const weighted = weightedMean(laps.map((l) => ({ v: l.avgHr, w: l.elapsedTime ?? 1 })));
  const elapsed = totalTime ?? (stream ? (stream.time[stream.n - 1] - stream.time[0]) / 1000 : undefined);

  const act: RawActivity = {
    sport,
    startTime,
    endTime: elapsed !== undefined ? startTime + elapsed * 1000 : undefined,
    elapsedTime: elapsed,
    timerTime: totalTime,
    distance: distance ?? (stream ? lastFinite(stream.channels.distance) : undefined),
    calories,
    avgHr: weighted,
    maxHr: maxOf(laps.map((l) => l.maxHr ?? NaN)),
    maxSpeed: maxOf(laps.map((l) => l.maxSpeed ?? NaN)),
    avgCadence: weightedMean(laps.map((l) => ({ v: l.avgCadence, w: l.elapsedTime ?? 1 }))),
    avgPower: weightedMean(laps.map((l) => ({ v: l.avgPower, w: l.elapsedTime ?? 1 }))),
    maxPower: maxOf(laps.map((l) => l.maxPower ?? NaN)),
    device,
    laps,
    extra: {},
    streams: stream,
  };

  if (act.distance && elapsed) act.avgSpeed = act.distance / elapsed;
  if (stream?.channels.elevation) {
    const { ascent, descent, min, max } = elevationStats(stream.channels.elevation);
    act.ascent = ascent;
    act.descent = descent;
    act.minElevation = min;
    act.maxElevation = max;
  }
  if (stream?.channels.heartRate && act.avgHr === undefined) act.avgHr = mean(stream.channels.heartRate);
  return act;
}

function sumOf(values: (number | undefined)[]): number | undefined {
  const present = values.filter((v): v is number => v !== undefined && Number.isFinite(v));
  return present.length ? present.reduce((a, b) => a + b, 0) : undefined;
}

function weightedMean(entries: { v: number | undefined; w: number }[]): number | undefined {
  let sw = 0;
  let s = 0;
  for (const e of entries) {
    if (e.v === undefined || !Number.isFinite(e.v)) continue;
    const w = Number.isFinite(e.w) && e.w > 0 ? e.w : 1;
    s += e.v * w;
    sw += w;
  }
  return sw ? s / sw : undefined;
}

function lastFinite(arr: Float32Array | undefined): number | undefined {
  if (!arr) return undefined;
  for (let i = arr.length - 1; i >= 0; i--) if (Number.isFinite(arr[i])) return arr[i];
  return undefined;
}

/** Ascent/descent with a small threshold so GPS noise is not counted as climb. */
export function elevationStats(elev: Float32Array): { ascent: number; descent: number; min?: number; max?: number } {
  let ascent = 0;
  let descent = 0;
  let min: number | undefined;
  let max: number | undefined;
  let reference: number | undefined;
  const threshold = 1.5;
  for (let i = 0; i < elev.length; i++) {
    const v = elev[i];
    if (!Number.isFinite(v)) continue;
    if (min === undefined || v < min) min = v;
    if (max === undefined || v > max) max = v;
    if (reference === undefined) {
      reference = v;
      continue;
    }
    const delta = v - reference;
    if (delta > threshold) {
      ascent += delta;
      reference = v;
    } else if (delta < -threshold) {
      descent -= delta;
      reference = v;
    }
  }
  return { ascent, descent, min, max };
}
