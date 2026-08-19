import { linePath, linearScale, padDomain, type PathPoint } from './chartUtils.ts';

export interface SparklineProps {
  points: PathPoint[];
  width?: number;
  height?: number;
  color?: string;
  fill?: boolean;
}

/** A tiny trend line for stat tiles — no axes, no interaction. */
export function Sparkline({ points, width = 120, height = 30, color = 'var(--series-1)', fill = true }: SparklineProps) {
  const valid = points.filter((p) => p.y !== undefined && Number.isFinite(p.y));
  if (valid.length < 2) return null;

  const xs = linearScale([valid[0].x, valid[valid.length - 1].x], [1, width - 1]);
  const [lo, hi] = padDomain(
    Math.min(...valid.map((p) => p.y as number)),
    Math.max(...valid.map((p) => p.y as number)),
    0.15,
  );
  const ys = linearScale([lo, hi], [height - 1, 1]);
  const d = linePath(valid, xs, ys);
  const last = valid[valid.length - 1];

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" style={{ display: 'block' }}>
      {fill && <path d={`${d}L${xs(last.x)} ${height}L${xs(valid[0].x)} ${height}Z`} fill={color} opacity={0.12} />}
      <path d={d} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={xs(last.x)} cy={ys(last.y as number)} r={2.2} fill={color} />
    </svg>
  );
}
