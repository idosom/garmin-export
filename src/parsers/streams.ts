/**
 * Columnar sample accumulation shared by every parser.
 *
 * Channels are discovered as they appear (a device that only starts reporting
 * power halfway through a ride still gets a correctly aligned column, padded
 * with `NaN`), and the result is typed arrays rather than millions of objects.
 */
import type { ActivityStreams } from '../core/types.ts';

export class SampleBuilder {
  private times: number[] = [];
  private lats: number[] = [];
  private lons: number[] = [];
  private hasPosition = false;
  private channels = new Map<string, number[]>();

  get length(): number {
    return this.times.length;
  }

  push(timeMs: number, values: Record<string, number | undefined>, lat?: number, lon?: number) {
    const i = this.times.length;
    this.times.push(timeMs);
    if (lat !== undefined && lon !== undefined && Number.isFinite(lat) && Number.isFinite(lon)) {
      this.lats.push(lat);
      this.lons.push(lon);
      this.hasPosition = true;
    } else {
      this.lats.push(NaN);
      this.lons.push(NaN);
    }
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined || value === null || !Number.isFinite(value)) continue;
      let col = this.channels.get(key);
      if (!col) {
        col = new Array(i).fill(NaN);
        this.channels.set(key, col);
      }
      while (col.length < i) col.push(NaN);
      col.push(value);
    }
    for (const col of this.channels.values()) {
      while (col.length <= i) col.push(NaN);
    }
  }

  /** Applies a transform to every value of one channel (in place). */
  mapChannel(key: string, fn: (v: number) => number) {
    const col = this.channels.get(key);
    if (!col) return;
    for (let i = 0; i < col.length; i++) if (Number.isFinite(col[i])) col[i] = fn(col[i]);
  }

  renameChannel(from: string, to: string) {
    const col = this.channels.get(from);
    if (!col || this.channels.has(to)) return;
    this.channels.delete(from);
    this.channels.set(to, col);
  }

  hasChannel(key: string): boolean {
    return this.channels.has(key);
  }

  channelKeys(): string[] {
    return [...this.channels.keys()];
  }

  /** Builds the immutable stream object, dropping all-empty channels. */
  build(range?: { start: number; end: number }): ActivityStreams | undefined {
    let from = 0;
    let to = this.times.length;
    if (range) {
      from = lowerBound(this.times, range.start);
      to = upperBound(this.times, range.end);
    }
    const n = to - from;
    if (n <= 0) return undefined;

    const time = new Float64Array(n);
    for (let i = 0; i < n; i++) time[i] = this.times[from + i];

    let lat: Float64Array | undefined;
    let lon: Float64Array | undefined;
    if (this.hasPosition) {
      const la = new Float64Array(n);
      const lo = new Float64Array(n);
      let any = false;
      for (let i = 0; i < n; i++) {
        la[i] = this.lats[from + i];
        lo[i] = this.lons[from + i];
        if (Number.isFinite(la[i])) any = true;
      }
      if (any) {
        lat = la;
        lon = lo;
      }
    }

    const channels: Record<string, Float32Array> = {};
    for (const [key, col] of this.channels) {
      const arr = new Float32Array(n);
      let any = false;
      for (let i = 0; i < n; i++) {
        const v = col[from + i];
        arr[i] = v === undefined ? NaN : v;
        if (Number.isFinite(arr[i])) any = true;
      }
      if (any) channels[key] = arr;
    }

    return { n, time, lat, lon, channels };
  }
}

function lowerBound(arr: number[], value: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function upperBound(arr: number[], value: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
