import { describe, expect, it } from 'vitest';
import { zipSync } from 'fflate';
import { ingest, sourceFromBytes } from './pipeline.ts';
import { buildFitActivity, buildFitWellness } from '../demo/fixtures.ts';

describe('large exports', () => {
  it('handles a multi-year export without falling over', async () => {
    const files: Record<string, Uint8Array> = {};
    const start = Date.UTC(2021, 0, 4, 7, 0, 0);
    const day = 86400000;
    for (let i = 0; i < 900; i++) {
      files[`fitness/${i}.fit`] = buildFitActivity({
        start: start + i * day * 1.2,
        sport: i % 3 === 0 ? 'cycling' : 'running',
        durationSec: 2400,
        distanceM: 9000,
        sampleIntervalSec: 3,
      });
    }
    for (let block = 0; block < 12; block++) {
      files[`wellness/${block}.fit`] = buildFitWellness(
        Array.from({ length: 90 }, (_, d) => ({
          dayStart: start + (block * 90 + d) * day,
          steps: 9000 + d,
          sleepHours: 7,
          restingHr: 50,
        })),
      );
    }
    const zip = zipSync(files);

    const began = Date.now();
    const dataset = await ingest([sourceFromBytes('big-export.zip', zip)]);
    const elapsed = Date.now() - began;

    expect(dataset.activities).toHaveLength(900);
    expect(dataset.daily.length).toBeGreaterThan(1000);
    expect(dataset.report.files.length).toBe(913);
    const samples = dataset.activities.reduce((sum, a) => sum + (a.streams?.n ?? 0), 0);
    expect(samples).toBeGreaterThan(700000);
    // Not a hard performance contract, just a guard against accidental O(n²).
    expect(elapsed).toBeLessThan(120000);
    console.log(`ingested ${dataset.activities.length} activities / ${samples} samples in ${elapsed} ms`);
  }, 180000);
});
