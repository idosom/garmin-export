import { describe, expect, it } from 'vitest';
import { parseFit } from './index.ts';
import { buildFitWellness } from '../../demo/fixtures.ts';

const DAY = Date.UTC(2024, 4, 12, 0, 0, 0);

describe('FIT wellness / monitoring files', () => {
  const bytes = buildFitWellness([
    {
      dayStart: DAY,
      steps: 11480,
      distanceM: 8600,
      calories: 2650,
      activeCalories: 780,
      restingHr: 52,
      stress: [18, 22, 41, 63, 12],
      sleepHours: 7.5,
      weightKg: 74.2,
      hrvMs: 62,
      vo2max: 52.4,
    },
    { dayStart: DAY + 86400000, steps: 6200, distanceM: 4400, calories: 2200, stress: [30, 44] },
  ]);

  const result = parseFit(bytes);
  const byDate = Object.fromEntries(result.daily.map((d) => [d.date, d.values]));

  it('produces daily records instead of activities', () => {
    expect(result.activities).toHaveLength(0);
    expect(result.daily.length).toBeGreaterThanOrEqual(2);
    expect(result.detectedAs).toMatch(/wellness/i);
  });

  it('sums cumulative monitoring counters into daily totals', () => {
    expect(byDate['2024-05-12'].steps).toBe(11480);
    expect(byDate['2024-05-12'].walkingDistance).toBeCloseTo(8600, -1);
    expect(byDate['2024-05-13'].steps).toBe(6200);
    expect(byDate['2024-05-12'].totalCalories).toBe(2650);
    expect(byDate['2024-05-12'].activeCalories).toBe(780);
  });

  it('averages stress and keeps the peak', () => {
    expect(byDate['2024-05-12'].stressAvg).toBeCloseTo((18 + 22 + 41 + 63 + 12) / 5, 5);
    expect(byDate['2024-05-12'].stressMax).toBe(63);
  });

  it('reconstructs sleep stages from sleep_level events', () => {
    const day = byDate['2024-05-12'];
    expect(day.sleepDuration).toBeCloseTo(7.5 * 3600 * 0.95, 0);
    expect(day.sleepDeep).toBeCloseTo(7.5 * 3600 * 0.2, 0);
    expect(day.sleepRem).toBeCloseTo(7.5 * 3600 * 0.1, 0);
    expect(day.sleepAwake).toBeCloseTo(7.5 * 3600 * 0.05, 0);
    expect(day.sleepStart).toBeLessThan(day.sleepEnd);
  });

  it('reads weight, HRV and VO2 max messages', () => {
    expect(byDate['2024-05-12'].weight).toBeCloseTo(74.2, 1);
    expect(byDate['2024-05-12'].bodyFat).toBeCloseTo(18.5, 1);
    expect(byDate['2024-05-12'].hrv).toBeCloseTo(62, 0);
    expect(byDate['2024-05-12'].hrvWeekly).toBeCloseTo(62, 0);
    expect(byDate['2024-05-12'].vo2max).toBeCloseTo(52.4, 1);
  });

  it('records heart-rate range from monitoring samples', () => {
    expect(byDate['2024-05-12'].minHr).toBeGreaterThan(0);
    expect(byDate['2024-05-12'].maxHr).toBeGreaterThanOrEqual(byDate['2024-05-12'].minHr);
  });

  it('reports which message types it saw', () => {
    expect(result.messageCounts.monitoring).toBeGreaterThan(0);
    expect(result.messageCounts.stress_level).toBe(7);
    expect(result.messageCounts.sleep_level).toBe(6);
    expect(result.messageCounts.weight_scale).toBe(1);
  });

  it('shifts days by the local offset carried in monitoring_info', () => {
    const shifted = parseFit(buildFitWellness([{ dayStart: Date.UTC(2024, 4, 12, 23, 0, 0), steps: 500 }], 120));
    // 23:00 UTC + 2 h is the following local day.
    expect(shifted.daily.some((d) => d.date === '2024-05-13')).toBe(true);
  });
});
