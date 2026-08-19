import { useMemo, useState } from 'react';
import {
  areaPath,
  clampTooltipX,
  linePath,
  linearScale,
  nearestIndex,
  niceTicks,
  padDomain,
  seriesColor,
  timeTicks,
  useMeasure,
  pointerHandlers,
  type PathPoint,
} from './chartUtils.ts';

export interface LineSeries {
  key: string;
  label: string;
  color?: string;
  points: PathPoint[];
  area?: boolean;
  dashed?: boolean;
  width?: number;
  format?: (value: number) => string;
}

export interface LineChartProps {
  series: LineSeries[];
  height?: number;
  xType?: 'time' | 'linear';
  formatX?: (value: number) => string;
  formatY?: (value: number) => string;
  yDomain?: [number, number];
  zeroBaseline?: boolean;
  showLegend?: boolean;
  /** Hover position shared with sibling charts (activity detail). */
  hoverX?: number | null;
  onHoverX?: (x: number | null) => void;
  emptyMessage?: string;
  ariaLabel?: string;
}

const MARGIN = { top: 10, right: 14, bottom: 22, left: 48 };

export function LineChart({
  series,
  height = 220,
  xType = 'time',
  formatX,
  formatY,
  yDomain,
  zeroBaseline = false,
  showLegend = true,
  hoverX,
  onHoverX,
  emptyMessage = 'No data',
  ariaLabel,
}: LineChartProps) {
  const [ref, size] = useMeasure<HTMLDivElement>();
  const [internalHover, setInternalHover] = useState<number | null>(null);
  const hover = hoverX !== undefined ? hoverX : internalHover;

  const width = Math.max(size.width, 0);
  const plotWidth = Math.max(10, width - MARGIN.left - MARGIN.right);
  const plotHeight = Math.max(10, height - MARGIN.top - MARGIN.bottom);

  const model = useMemo(() => {
    let xMin = Infinity;
    let xMax = -Infinity;
    let yMin = Infinity;
    let yMax = -Infinity;
    let count = 0;
    for (const s of series) {
      for (const p of s.points) {
        if (!Number.isFinite(p.x)) continue;
        if (p.x < xMin) xMin = p.x;
        if (p.x > xMax) xMax = p.x;
        if (p.y === undefined || !Number.isFinite(p.y)) continue;
        count++;
        if (p.y < yMin) yMin = p.y;
        if (p.y > yMax) yMax = p.y;
      }
    }
    return { xMin, xMax, yMin, yMax, count };
  }, [series]);

  if (!model.count) {
    return (
      <div className="chart-root" ref={ref} style={{ height }}>
        <div className="empty" style={{ padding: '24px 0' }}>
          <p className="muted">{emptyMessage}</p>
        </div>
      </div>
    );
  }

  const domainY: [number, number] =
    yDomain ??
    (zeroBaseline ? [Math.min(0, model.yMin), padDomain(model.yMin, model.yMax)[1]] : padDomain(model.yMin, model.yMax, 0.08));
  const xs = linearScale([model.xMin, model.xMax === model.xMin ? model.xMin + 1 : model.xMax], [0, plotWidth]);
  const ys = linearScale(domainY, [plotHeight, 0]);

  const yTicks = niceTicks(domainY[0], domainY[1], Math.max(3, Math.round(plotHeight / 46)));
  const xTicks =
    xType === 'time'
      ? timeTicks(model.xMin, model.xMax, Math.max(2, Math.round(plotWidth / 96)))
      : niceTicks(model.xMin, model.xMax, Math.max(2, Math.round(plotWidth / 88))).map((v) => ({
          value: v,
          label: formatX ? formatX(v) : String(Math.round(v * 100) / 100),
        }));

  const pointer = pointerHandlers(
    (px) => {
      const value = xs.invert(px - MARGIN.left);
      const clamped = Math.max(model.xMin, Math.min(model.xMax, value));
      if (onHoverX) onHoverX(clamped);
      else setInternalHover(clamped);
    },
    () => {
      if (onHoverX) onHoverX(null);
      else setInternalHover(null);
    },
  );

  const hoverRows =
    hover === null || hover === undefined
      ? []
      : series
          .map((s) => {
            const idx = nearestIndex(
              s.points.map((p) => p.x),
              hover,
            );
            const point = s.points[idx];
            if (!point || point.y === undefined || !Number.isFinite(point.y)) return null;
            return { series: s, point };
          })
          .filter((r): r is { series: LineSeries; point: PathPoint } => !!r);

  const hoverPixel = hover === null || hover === undefined ? null : xs(hover);
  const tooltipX = hoverPixel === null ? 0 : clampTooltipX(hoverPixel + MARGIN.left, width);
  const tooltipTitle =
    hoverRows.length && formatX
      ? formatX(hoverRows[0].point.x)
      : hoverRows.length
        ? new Date(hoverRows[0].point.x).toLocaleString(undefined, { dateStyle: 'medium' })
        : '';

  return (
    <div className="chart-root" ref={ref}>
      <svg width="100%" height={height} role="img" aria-label={ariaLabel ?? `Chart of ${series.map((s) => s.label).join(', ')}`} {...pointer}>
        <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
          <g className="chart-grid">
            {yTicks.map((tick) => (
              <line key={tick} x1={0} x2={plotWidth} y1={ys(tick)} y2={ys(tick)} />
            ))}
          </g>

          <g className="chart-series">
            {series.map((s, i) => {
              const color = s.color ?? seriesColor(i);
              return (
                <g key={s.key}>
                  {s.area && (
                    <path d={areaPath(s.points, xs, ys, Math.max(domainY[0], Math.min(0, domainY[1])))} fill={color} opacity={0.12} stroke="none" />
                  )}
                  <path
                    d={linePath(s.points, xs, ys)}
                    stroke={color}
                    strokeWidth={s.width ?? 2}
                    strokeDasharray={s.dashed ? '5 4' : undefined}
                  />
                </g>
              );
            })}
          </g>

          {hoverPixel !== null && (
            <g>
              <line className="chart-crosshair" x1={hoverPixel} x2={hoverPixel} y1={0} y2={plotHeight} />
              {hoverRows.map(({ series: s, point }, i) => (
                <circle
                  key={s.key}
                  cx={xs(point.x)}
                  cy={ys(point.y as number)}
                  r={4}
                  fill={s.color ?? seriesColor(series.indexOf(s) >= 0 ? series.indexOf(s) : i)}
                  stroke="var(--surface-1)"
                  strokeWidth={2}
                />
              ))}
            </g>
          )}

          <g className="chart-axis">
            <line x1={0} x2={plotWidth} y1={plotHeight} y2={plotHeight} />
            {yTicks.map((tick) => (
              <text key={tick} x={-8} y={ys(tick)} textAnchor="end" dominantBaseline="middle">
                {formatY ? formatY(tick) : formatTickNumber(tick)}
              </text>
            ))}
            {xTicks.map((tick) => (
              <text key={tick.value} x={xs(tick.value)} y={plotHeight + 15} textAnchor="middle">
                {tick.label}
              </text>
            ))}
          </g>
        </g>
      </svg>

      {hoverPixel !== null && hoverRows.length > 0 && (
        <div className="chart-tooltip" style={{ left: tooltipX, top: MARGIN.top + 6 }}>
          <div className="tt-title">{tooltipTitle}</div>
          {hoverRows.map(({ series: s, point }) => (
            <div className="tt-row" key={s.key}>
              <span className="swatch" style={{ background: s.color ?? seriesColor(series.indexOf(s)) }} />
              <span>{s.label}</span>
              <span className="tt-value">{s.format ? s.format(point.y as number) : formatTickNumber(point.y as number)}</span>
            </div>
          ))}
        </div>
      )}

      {showLegend && series.length > 1 && (
        <div className="legend">
          {series.map((s, i) => (
            <span className="legend-item" key={s.key}>
              <span className="swatch" style={{ background: s.color ?? seriesColor(i) }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function formatTickNumber(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 10_000) return `${(value / 1000).toFixed(0)}k`;
  if (abs >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (abs >= 10) return value.toFixed(0);
  if (abs >= 1) return value.toFixed(1);
  if (abs === 0) return '0';
  return value.toFixed(2);
}
