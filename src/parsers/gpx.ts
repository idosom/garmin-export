/**
 * GPX → `ParseResult`.
 *
 * Handles plain tracks plus the two extension namespaces Garmin actually
 * writes: `TrackPointExtension` (hr / cad / atemp / speed) and the power
 * extension. Routes and waypoints are counted but not turned into activities.
 */
import { scanXml } from './xml/sax.ts';
import { SampleBuilder } from './streams.ts';
import { emptyParseResult, type ParseResult, type RawActivity } from '../core/types.ts';
import { parseTimestamp } from '../core/time.ts';
import { normalizeSport } from '../core/metrics.ts';

const POINT_CHANNELS: Record<string, string> = {
  hr: 'heartRate',
  heartrate: 'heartRate',
  cad: 'cadence',
  cadence: 'cadence',
  atemp: 'temperature',
  temp: 'temperature',
  temperature: 'temperature',
  power: 'power',
  watts: 'power',
  speed: 'speed',
  course: 'course',
  distance: 'distance',
  depth: 'depth',
  seaLevelPressure: 'seaLevelPressure',
};

export function parseGpx(text: string): ParseResult {
  const result = emptyParseResult('gpx');
  const counts: Record<string, number> = {};
  const fields = new Set<string>();
  const unknown = new Set<string>();

  let trackName: string | undefined;
  let trackType: string | undefined;
  let samples = new SampleBuilder();
  let tracks = 0;

  let inTrkpt = false;
  let ptTime: number | undefined;
  let ptLat: number | undefined;
  let ptLon: number | undefined;
  let ptValues: Record<string, number | undefined> = {};
  const stack: string[] = [];

  const finishTrack = () => {
    if (!samples.length) return;
    tracks++;
    const stream = samples.build();
    if (!stream) return;
    const act: RawActivity = {
      name: trackName,
      sport: normalizeSport(trackType),
      startTime: stream.time[0],
      endTime: stream.time[stream.n - 1],
      elapsedTime: (stream.time[stream.n - 1] - stream.time[0]) / 1000,
      laps: [],
      extra: {},
      streams: stream,
    };
    result.activities.push(act);
    samples = new SampleBuilder();
    trackName = undefined;
    trackType = undefined;
  };

  scanXml(text, {
    onOpen(name, attrs, selfClosing) {
      stack.push(name);
      counts[name] = (counts[name] ?? 0) + 1;
      if (name === 'trkpt' || name === 'rtept' || name === 'wpt') {
        inTrkpt = name === 'trkpt';
        ptLat = numOrUndef(attrs.lat);
        ptLon = numOrUndef(attrs.lon);
        ptTime = undefined;
        ptValues = {};
        if (name !== 'trkpt') counts[`${name}_skipped`] = (counts[`${name}_skipped`] ?? 0) + 1;
      }
      if (selfClosing) stack.pop();
    },
    onText(raw) {
      const value = raw.trim();
      if (!value) return;
      const current = stack[stack.length - 1];
      if (!current) return;

      if (inTrkpt) {
        if (current === 'time') {
          ptTime = parseTimestamp(value);
          fields.add('trkpt.time');
          return;
        }
        if (current === 'ele') {
          ptValues.elevation = Number(value);
          fields.add('trkpt.ele');
          return;
        }
        const channel = POINT_CHANNELS[current] ?? POINT_CHANNELS[current.toLowerCase()];
        if (channel) {
          const n = Number(value);
          if (Number.isFinite(n)) ptValues[channel] = n;
          fields.add(`trkpt.${current}`);
          return;
        }
        // Unknown extension element inside a trackpoint: keep it as a channel
        // when it is numeric so it still shows up in charts and the explorer.
        const n = Number(value);
        if (Number.isFinite(n) && current !== 'trkpt') {
          ptValues[current] = n;
          unknown.add(`trkpt.${current}`);
          fields.add(`trkpt.${current}`);
        }
        return;
      }

      if (current === 'name' && stack.includes('trk')) {
        trackName ??= value;
        fields.add('trk.name');
      } else if (current === 'type' && stack.includes('trk')) {
        trackType ??= value;
        fields.add('trk.type');
      }
    },
    onClose(name) {
      if (name === 'trkpt') {
        if (ptTime !== undefined) samples.push(ptTime, ptValues, ptLat, ptLon);
        else if (ptLat !== undefined && ptLon !== undefined) {
          // Time-less tracks (routes exported as tracks) still give a shape.
          samples.push(samples.length, ptValues, ptLat, ptLon);
        }
        inTrkpt = false;
      } else if (name === 'trk') {
        finishTrack();
      }
      if (stack[stack.length - 1] === name) stack.pop();
      else {
        const idx = stack.lastIndexOf(name);
        if (idx >= 0) stack.length = idx;
      }
    },
  });

  finishTrack();

  result.messageCounts = counts;
  result.fields = [...fields].sort();
  result.unknownFields = [...unknown].sort();
  if (!result.activities.length) result.warnings.push('No track points with coordinates found');
  result.detectedAs = tracks > 1 ? `GPX (${tracks} tracks)` : 'GPX track';
  return result;
}

function numOrUndef(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
