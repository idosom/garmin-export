import { useEffect, useRef, useState } from 'react';

/** Categorical palette slots, in the fixed order the design system defines. */
export const SERIES_COLORS = [
  'var(--series-1)',
  'var(--series-2)',
  'var(--series-3)',
  'var(--series-4)',
  'var(--series-5)',
  'var(--series-6)',
  'var(--series-7)',
  'var(--series-8)',
];

export function seriesColor(slot: number): string {
  return SERIES_COLORS[((slot % SERIES_COLORS.length) + SERIES_COLORS.length) % SERIES_COLORS.length];
}

export interface Size {
  width: number;
  height: number;
}

/** Measures an element so charts can be drawn at real pixel widths. */
export function useMeasure<T extends HTMLElement>(): [React.RefObject<T | null>, Size] {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const update = () => setSize({ width: node.clientWidth, height: node.clientHeight });
    update();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return [ref, size];
}

export interface Scale {
  (value: number): number;
  invert(pixel: number): number;
  domain: [number, number];
  range: [number, number];
}

export function linearScale(domain: [number, number], range: [number, number]): Scale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;
  const fn = ((value: number) => r0 + ((value - d0) / span) * (r1 - r0)) as Scale;
  fn.invert = (pixel: number) => d0 + ((pixel - r0) / (r1 - r0 || 1)) * span;
  fn.domain = domain;
  fn.range = range;
  return fn;
}

/** Human-friendly tick values (1, 2, 2.5, 5 × 10ⁿ). */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) return [min];
  const span = max - min;
  const rawStep = span / Math.max(1, count);
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const step = (normalized > 5 ? 10 : normalized > 2.5 ? 5 : normalized > 1.5 ? 2.5 : normalized > 1.2 ? 2 : 1) * magnitude;
  const first = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let v = first; v <= max + step * 1e-6 && ticks.length < 24; v += step) {
    ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  }
  return ticks;
}

/** Pads a numeric domain so marks never touch the frame. */
export function padDomain(min: number, max: number, factor = 0.06): [number, number] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min === max) return [min - Math.abs(min || 1) * 0.1, max + Math.abs(max || 1) * 0.1];
  const pad = (max - min) * factor;
  return [min - pad, max + pad];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Time ticks whose granularity follows the span being shown. */
export function timeTicks(min: number, max: number, targetCount = 6): { value: number; label: string }[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return [];
  const span = max - min;
  const day = 86400000;
  const out: { value: number; label: string }[] = [];

  if (span <= 6 * 3600_000) {
    const stepOptions = [60_000, 300_000, 600_000, 900_000, 1800_000, 3600_000];
    const step = stepOptions.find((s) => span / s <= targetCount) ?? 3600_000;
    for (let t = Math.ceil(min / step) * step; t <= max; t += step) {
      const d = new Date(t);
      out.push({ value: t, label: `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}` });
    }
    return out;
  }
  if (span <= 90 * day) {
    const step = span <= 10 * day ? day : span <= 35 * day ? 7 * day : 14 * day;
    const start = new Date(min);
    start.setHours(0, 0, 0, 0);
    for (let t = start.getTime(); t <= max; t += step) {
      if (t < min) continue;
      const d = new Date(t);
      out.push({ value: t, label: `${d.getDate()} ${MONTHS[d.getMonth()]}` });
    }
    return out;
  }
  const months = span / (30 * day);
  const stepMonths = months <= 14 ? 1 : months <= 30 ? 3 : months <= 80 ? 6 : 12;
  const cursor = new Date(min);
  cursor.setDate(1);
  cursor.setHours(0, 0, 0, 0);
  while (cursor.getMonth() % stepMonths !== 0) cursor.setMonth(cursor.getMonth() + 1);
  for (let guard = 0; cursor.getTime() <= max && guard < 200; guard++) {
    if (cursor.getTime() >= min) {
      out.push({
        value: cursor.getTime(),
        label: stepMonths >= 12 ? String(cursor.getFullYear()) : `${MONTHS[cursor.getMonth()]}${cursor.getMonth() === 0 ? ` ’${String(cursor.getFullYear()).slice(2)}` : ''}`,
      });
    }
    cursor.setMonth(cursor.getMonth() + stepMonths);
  }
  return out;
}

export interface PathPoint {
  x: number;
  y: number | undefined;
}

/** Builds an SVG path, breaking the line wherever the series has a gap. */
export function linePath(points: PathPoint[], xs: Scale, ys: Scale): string {
  let path = '';
  let pen = false;
  for (const point of points) {
    if (point.y === undefined || !Number.isFinite(point.y)) {
      pen = false;
      continue;
    }
    const x = xs(point.x).toFixed(2);
    const y = ys(point.y).toFixed(2);
    path += `${pen ? 'L' : 'M'}${x} ${y}`;
    pen = true;
  }
  return path;
}

/** Filled area under a line, closed onto the baseline. */
export function areaPath(points: PathPoint[], xs: Scale, ys: Scale, baseline: number): string {
  let path = '';
  let run: PathPoint[] = [];
  const flush = () => {
    if (run.length < 2) {
      run = [];
      return;
    }
    path += `M${xs(run[0].x).toFixed(2)} ${ys(baseline).toFixed(2)}`;
    for (const p of run) path += `L${xs(p.x).toFixed(2)} ${ys(p.y as number).toFixed(2)}`;
    path += `L${xs(run[run.length - 1].x).toFixed(2)} ${ys(baseline).toFixed(2)}Z`;
    run = [];
  };
  for (const point of points) {
    if (point.y === undefined || !Number.isFinite(point.y)) flush();
    else run.push(point);
  }
  flush();
  return path;
}

/** Index of the point nearest an x value (assumes ascending xs). */
export function nearestIndex(xs: ArrayLike<number>, value: number): number {
  let lo = 0;
  let hi = xs.length - 1;
  if (hi < 0) return -1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(xs[lo - 1] - value) <= Math.abs(xs[lo] - value)) return lo - 1;
  return lo;
}

/** Keeps a tooltip inside its chart container. */
export function clampTooltipX(x: number, width: number, tooltipWidth = 150): number {
  const half = tooltipWidth / 2;
  return Math.max(half, Math.min(width - half, x));
}

/**
 * Pointer handlers for a chart surface. Deliberately a plain function, not a
 * hook, so charts can bail out early when they have nothing to draw.
 */
export function pointerHandlers(onMove: (x: number, y: number) => void, onLeave: () => void) {
  return {
    onPointerMove(event: React.PointerEvent<SVGSVGElement>) {
      const rect = event.currentTarget.getBoundingClientRect();
      onMove(event.clientX - rect.left, event.clientY - rect.top);
    },
    onPointerLeave: onLeave,
    onPointerCancel: onLeave,
  };
}
