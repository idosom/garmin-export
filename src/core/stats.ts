/** Small numeric helpers shared by parsers, normalization and analytics. */

export function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export function mean(values: ArrayLike<number>): number | undefined {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (Number.isFinite(v)) {
      sum += v;
      n++;
    }
  }
  return n ? sum / n : undefined;
}

export function minOf(values: ArrayLike<number>): number | undefined {
  let m: number | undefined;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (Number.isFinite(v) && (m === undefined || v < m)) m = v;
  }
  return m;
}

export function maxOf(values: ArrayLike<number>): number | undefined {
  let m: number | undefined;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (Number.isFinite(v) && (m === undefined || v > m)) m = v;
  }
  return m;
}

export function sum(values: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < values.length; i++) if (Number.isFinite(values[i])) s += values[i];
  return s;
}

export function countFinite(values: ArrayLike<number>): number {
  let n = 0;
  for (let i = 0; i < values.length; i++) if (Number.isFinite(values[i])) n++;
  return n;
}

export function quantile(sorted: number[], q: number): number | undefined {
  if (!sorted.length) return undefined;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Centred rolling mean over an array that may contain gaps (`NaN`). */
export function rollingMean(values: (number | undefined)[], window: number): (number | undefined)[] {
  const out: (number | undefined)[] = new Array(values.length);
  const half = Math.floor(window / 2);
  for (let i = 0; i < values.length; i++) {
    let s = 0;
    let n = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(values.length - 1, i + half); j++) {
      const v = values[j];
      if (v !== undefined && Number.isFinite(v)) {
        s += v;
        n++;
      }
    }
    out[i] = n ? s / n : undefined;
  }
  return out;
}

/** Exponentially weighted moving average — the basis of CTL/ATL. */
export function ewma(values: number[], timeConstantDays: number): number[] {
  const alpha = 1 - Math.exp(-1 / timeConstantDays);
  const out = new Array<number>(values.length);
  let prev = 0;
  for (let i = 0; i < values.length; i++) {
    prev = prev + alpha * ((values[i] ?? 0) - prev);
    out[i] = prev;
  }
  return out;
}

/** Least-squares slope per x-unit; `undefined` with fewer than 2 points. */
export function linearTrend(points: { x: number; y: number }[]): number | undefined {
  const pts = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (pts.length < 2) return undefined;
  const n = pts.length;
  let sx = 0;
  let sy = 0;
  let sxy = 0;
  let sxx = 0;
  for (const p of pts) {
    sx += p.x;
    sy += p.y;
    sxy += p.x * p.y;
    sxx += p.x * p.x;
  }
  const denom = n * sxx - sx * sx;
  if (denom === 0) return undefined;
  return (n * sxy - sx * sy) / denom;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Great-circle distance in metres. */
export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371008.8;
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Largest-triangle-three-buckets downsampling: keeps the visual shape of a
 * series far better than naive striding, which matters for 30 000-point
 * elevation traces rendered into 800 px.
 */
export function lttb(xs: ArrayLike<number>, ys: ArrayLike<number>, threshold: number): number[] {
  const n = xs.length;
  if (threshold >= n || threshold < 3) {
    const all: number[] = [];
    for (let i = 0; i < n; i++) all.push(i);
    return all;
  }
  const sampled: number[] = [0];
  const every = (n - 2) / (threshold - 2);
  let a = 0;
  for (let i = 0; i < threshold - 2; i++) {
    const rangeStart = Math.floor((i + 1) * every) + 1;
    const rangeEnd = Math.min(Math.floor((i + 2) * every) + 1, n);
    let avgX = 0;
    let avgY = 0;
    let count = 0;
    for (let j = rangeStart; j < rangeEnd; j++) {
      if (!Number.isFinite(ys[j])) continue;
      avgX += xs[j];
      avgY += ys[j];
      count++;
    }
    if (count) {
      avgX /= count;
      avgY /= count;
    }
    const bucketStart = Math.floor(i * every) + 1;
    const bucketEnd = Math.floor((i + 1) * every) + 1;
    const pointAX = xs[a];
    const pointAY = Number.isFinite(ys[a]) ? ys[a] : 0;
    let maxArea = -1;
    let nextA = bucketStart;
    for (let j = bucketStart; j < Math.min(bucketEnd, n); j++) {
      const y = Number.isFinite(ys[j]) ? ys[j] : 0;
      const area = Math.abs((pointAX - avgX) * (y - pointAY) - (pointAX - xs[j]) * (avgY - pointAY));
      if (area > maxArea) {
        maxArea = area;
        nextA = j;
      }
    }
    sampled.push(nextA);
    a = nextA;
  }
  sampled.push(n - 1);
  return sampled;
}
