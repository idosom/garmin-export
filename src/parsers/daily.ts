/** Accumulates per-day wellness values with per-metric aggregation rules. */
import type { RawDaily } from '../core/types.ts';

type Acc = { sum: number; count: number; min: number; max: number; last: number };

export class DailyBuilder {
  private days = new Map<string, Map<string, Acc>>();

  private acc(date: string, key: string): Acc {
    let day = this.days.get(date);
    if (!day) {
      day = new Map();
      this.days.set(date, day);
    }
    let a = day.get(key);
    if (!a) {
      a = { sum: 0, count: 0, min: Infinity, max: -Infinity, last: NaN };
      day.set(key, a);
    }
    return a;
  }

  observe(date: string, key: string, value: number | undefined) {
    if (value === undefined || !Number.isFinite(value)) return;
    const a = this.acc(date, key);
    a.sum += value;
    a.count += 1;
    if (value < a.min) a.min = value;
    if (value > a.max) a.max = value;
    a.last = value;
  }

  observeMany(date: string, values: Record<string, number | undefined>) {
    for (const [k, v] of Object.entries(values)) this.observe(date, k, v);
  }

  get size(): number {
    return this.days.size;
  }

  has(date: string, key: string): boolean {
    return !!this.days.get(date)?.has(key);
  }

  /**
   * @param how per-key aggregation; defaults to `last`, which is right for
   *   values that are already daily totals (JSON exports) and harmless for
   *   single-sample metrics.
   */
  build(how: Record<string, 'sum' | 'avg' | 'min' | 'max' | 'last'> = {}): RawDaily[] {
    const out: RawDaily[] = [];
    for (const [date, day] of this.days) {
      const values: Record<string, number> = {};
      for (const [key, a] of day) {
        if (!a.count) continue;
        switch (how[key] ?? 'last') {
          case 'sum':
            values[key] = a.sum;
            break;
          case 'avg':
            values[key] = a.sum / a.count;
            break;
          case 'min':
            values[key] = a.min;
            break;
          case 'max':
            values[key] = a.max;
            break;
          default:
            values[key] = a.last;
        }
      }
      if (Object.keys(values).length) out.push({ date, values });
    }
    out.sort((a, b) => (a.date < b.date ? -1 : 1));
    return out;
  }
}
