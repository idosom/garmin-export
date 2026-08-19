import { describe, expect, it } from 'vitest';
import { parseFit } from './index.ts';
import { decodeFit } from './decoder.ts';
import { encodeFit, BT } from './encoder.ts';
import { buildFitActivity, buildFitUserProfile } from '../../demo/fixtures.ts';
import { normalizeActivity } from '../../normalize/activity.ts';

const SOURCE = { fileId: 'f1', path: 'activity.fit', format: 'fit' as const };
const START = Date.UTC(2024, 4, 12, 6, 30, 0);

describe('FIT activity decoding', () => {
  const bytes = buildFitActivity({
    start: START,
    sport: 'running',
    subSport: 'trail',
    durationSec: 1800,
    distanceM: 6000,
    withPower: true,
    withDeveloperField: true,
    withUnknownField: true,
    laps: 3,
  });

  it('decodes the file header and message stream', () => {
    const names: string[] = [];
    const summary = decodeFit(bytes, { onMessage: (m) => names.push(m.name) });
    expect(summary.ok).toBe(true);
    expect(summary.warnings).toEqual([]);
    expect(summary.protocolVersion).toBe(0x20);
    expect(new Set(names)).toEqual(
      new Set(['file_id', 'device_info', 'developer_data_id', 'field_description', 'record', 'lap', 'session', 'activity']),
    );
    expect(summary.messageCounts.record).toBe(360);
    expect(summary.messageCounts.lap).toBe(3);
  });

  it('applies profile scale, offset and enum decoding', () => {
    const result = parseFit(bytes);
    const [activity] = result.activities;
    expect(activity.sport).toBe('running');
    expect(activity.subSport).toBe('trail');
    expect(activity.startTime).toBe(START);
    expect(activity.elapsedTime).toBe(1800);
    expect(activity.distance).toBeCloseTo(6000, 0);
    expect(activity.trainingEffectAerobic).toBeCloseTo(3.4, 1);
    expect(activity.trainingEffectAnaerobic).toBeCloseTo(1.8, 1);
    expect(activity.ascent).toBe(86);
    expect(activity.hrZoneTimes).toEqual([60, 300, 600, 500, 120]);
  });

  it('builds aligned sample streams including GPS', () => {
    const result = parseFit(bytes);
    const streams = result.activities[0].streams!;
    expect(streams.n).toBe(360);
    expect(streams.lat).toBeDefined();
    expect(streams.lat![0]).toBeCloseTo(47.6062, 3);
    expect(streams.time[1] - streams.time[0]).toBe(5000);
    for (const key of ['heartRate', 'speed', 'elevation', 'cadence', 'power', 'temperature', 'distance']) {
      expect(Object.keys(streams.channels)).toContain(key);
    }
    // Semicircles → degrees must round-trip through the encoder.
    expect(streams.lon![0]).toBeGreaterThan(-122.35);
    expect(streams.lon![0]).toBeLessThan(-122.30);
  });

  it('keeps developer fields and unknown profile fields', () => {
    const result = parseFit(bytes);
    expect(result.developerFields.map((d) => d.name)).toContain('Form Power');
    expect(result.developerFields[0].count).toBeGreaterThan(300);
    expect(result.unknownFields).toContain('record.field_90');
    const streams = result.activities[0].streams!;
    expect(Object.keys(streams.channels)).toContain('Form Power');
    expect(Object.keys(streams.channels)).toContain('field_90');
  });

  it('splits laps and preserves lap detail', () => {
    const result = parseFit(bytes);
    const laps = result.activities[0].laps!;
    expect(laps).toHaveLength(3);
    expect(laps[0].distance).toBeCloseTo(2000, 0);
    expect(laps[0].trigger).toBe('distance');
    expect(laps[0].avgHr).toBeGreaterThan(100);
  });

  it('doubles foot-sport cadence into steps per minute', () => {
    const running = parseFit(buildFitActivity({ start: START, sport: 'running' }));
    const cycling = parseFit(buildFitActivity({ start: START, sport: 'cycling' }));
    const runCadence = running.activities[0].streams!.channels.cadence[0];
    const rideCadence = cycling.activities[0].streams!.channels.cadence[0];
    expect(runCadence).toBeCloseTo(rideCadence * 2, 0);
  });
});

describe('FIT defensiveness', () => {
  it('reports a CRC mismatch but still returns data', () => {
    const bad = buildFitActivity({ start: START, corruptCrc: true, durationSec: 120 });
    const result = parseFit(bad);
    expect(result.warnings.join(' ')).toMatch(/CRC mismatch/);
    expect(result.activities).toHaveLength(1);
  });

  it('handles a file with records but no session message', () => {
    const bytes = buildFitActivity({ start: START, omitSession: true, durationSec: 300, distanceM: 1000 });
    const result = parseFit(bytes);
    expect(result.activities).toHaveLength(1);
    expect(result.warnings.join(' ')).toMatch(/no session/i);
    const activity = normalizeActivity(result.activities[0], SOURCE)!;
    expect(activity.distance).toBeGreaterThan(900);
    expect(activity.hasGps).toBe(true);
  });

  it('decodes chained FIT files', () => {
    const a = buildFitActivity({ start: START, durationSec: 300, distanceM: 1000 });
    const b = buildFitActivity({ start: START + 3600_000, durationSec: 600, distanceM: 2000, sport: 'cycling' });
    const chained = new Uint8Array(a.length + b.length);
    chained.set(a, 0);
    chained.set(b, a.length);
    const result = parseFit(chained);
    expect(result.activities).toHaveLength(2);
    expect(result.activities.map((x) => x.sport).sort()).toEqual(['cycling', 'running']);
  });

  it('survives truncated files without throwing', () => {
    const bytes = buildFitActivity({ start: START, durationSec: 600 });
    const truncated = bytes.subarray(0, Math.floor(bytes.length / 2));
    const result = parseFit(truncated);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(() => parseFit(truncated)).not.toThrow();
  });

  it('rejects non-FIT bytes cleanly', () => {
    const result = parseFit(new TextEncoder().encode('this is not a fit file at all'));
    expect(result.activities).toHaveLength(0);
    expect(result.warnings.join(' ')).toMatch(/FIT/);
  });

  it('decodes unknown message numbers as raw messages', () => {
    const bytes = encodeFit([
      { mesgNum: 0, fields: [{ num: 0, baseType: BT.enum, value: 4 }] },
      { mesgNum: 9999, fields: [{ num: 7, baseType: BT.uint16, value: 1234 }] },
    ]);
    const seen: Record<string, unknown>[] = [];
    const summary = decodeFit(bytes, { onMessage: (m) => seen.push({ name: m.name, fields: m.fields, known: m.known }) });
    expect(summary.messageCounts.mesg_9999).toBe(1);
    const unknownMsg = seen.find((m) => m.name === 'mesg_9999')!;
    expect(unknownMsg.known).toBe(false);
    expect((unknownMsg.fields as Record<string, number>).field_7).toBe(1234);
  });

  it('reads a 12-byte header as well as a 14-byte one', () => {
    const bytes = encodeFit([{ mesgNum: 0, fields: [{ num: 0, baseType: BT.enum, value: 4 }] }], { headerSize: 12 });
    const summary = decodeFit(bytes, { onMessage: () => {} });
    expect(summary.ok).toBe(true);
    expect(summary.warnings).toEqual([]);
  });

  it('reads a user profile with no activity data', () => {
    const result = parseFit(buildFitUserProfile('Sam', 71.4, 47));
    expect(result.user?.name).toBe('Sam');
    expect(result.user?.weightKg).toBeCloseTo(71.4, 1);
    expect(result.user?.restingHr).toBe(47);
    expect(result.activities).toHaveLength(0);
  });
});
