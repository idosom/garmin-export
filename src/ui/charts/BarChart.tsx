import { useMemo, useState } from 'react';
import { linearScale, niceTicks, seriesColor, useMeasure } from './chartUtils.ts';
import { formatTickNumber } from './LineChart.tsx';

export interface BarSegment {
  key: string;
  label: string;
  value: number;
  color?: string;
}

export interface BarDatum {
  key: string;
  label: string;
  /** Used when the bar is not segmented. */
  value?: number;
  segments?: BarSegment[];
  /** Extra rows appended to the hover tooltip. */
  detail?: { label: string; value: string }[];
}

export interface BarChartProps {
  data: BarDatum[];
  height?: number;
  formatValue?: (value: number) => string;
  formatY?: (value: number) => string;
  color?: string;
  showLegend?: boolean;
  emptyMessage?: string;
  ariaLabel?: string;
  /** Show every nth x label; auto when omitted. */
  labelEvery?: number;
}

const MARGIN = { top: 10, right: 14, bottom: 26, left: 48 };

export function BarChart({
  data,
  height = 220,
  formatValue,
  formatY,
  color,
  showLegend = true,
  emptyMessage = 'No data',
  ariaLabel,
  labelEvery,
}: BarChartProps) {
  const [ref, size] = useMeasure<HTMLDivElement>();
  const [hovered, setHovered] = useState<number | null>(null);

  const width = Math.max(size.width, 0);
  const plotWidth = Math.max(10, width - MARGIN.left - MARGIN.right);
  const plotHeight = Math.max(10, height - MARGIN.top - MARGIN.bottom);

  const { totals, max, legend } = useMemo(() => {
    const totals = data.map((d) => (d.segments ? d.segments.reduce((sum, s) => sum + (s.value || 0), 0) : (d.value ?? 0)));
    const legendMap = new Map<string, string>();
    for (const d of data) {
      for (const [i, s] of (d.segments ?? []).entries()) {
        if (!legendMap.has(s.key)) legendMap.set(s.key, s.color ?? seriesColor(i));
      }
    }
    return { totals, max: Math.max(0, ...totals), legend: [...legendMap.entries()] };
  }, [data]);

  if (!data.length || max <= 0) {
    return (
      <div className="chart-root" ref={ref} style={{ height }}>
        <div className="empty" style={{ padding: '24px 0' }}>
          <p className="muted">{emptyMessage}</p>
        </div>
      </div>
    );
  }

  const ys = linearScale([0, max * 1.08], [plotHeight, 0]);
  const step = plotWidth / data.length;
  const barWidth = Math.max(2, Math.min(38, step - Math.max(2, step * 0.22)));
  const yTicks = niceTicks(0, max * 1.08, Math.max(3, Math.round(plotHeight / 44)));
  const every = labelEvery ?? Math.max(1, Math.ceil(data.length / Math.max(2, Math.floor(plotWidth / 62))));

  const hoveredDatum = hovered === null ? null : data[hovered];
  const tooltipLeft = hovered === null ? 0 : Math.max(80, Math.min(width - 80, MARGIN.left + hovered * step + step / 2));

  return (
    <div className="chart-root" ref={ref}>
      <svg width="100%" height={height} role="img" aria-label={ariaLabel ?? 'Bar chart'} onPointerLeave={() => setHovered(null)}>
        <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
          <g className="chart-grid">
            {yTicks.map((tick) => (
              <line key={tick} x1={0} x2={plotWidth} y1={ys(tick)} y2={ys(tick)} />
            ))}
          </g>

          {data.map((datum, i) => {
            const x = i * step + (step - barWidth) / 2;
            const segments = datum.segments ?? [{ key: datum.key, label: datum.label, value: datum.value ?? 0, color }];
            let cursor = 0;
            return (
              <g key={datum.key} onPointerEnter={() => setHovered(i)}>
                <rect x={i * step} y={0} width={step} height={plotHeight} fill="transparent" />
                {segments.map((segment, si) => {
                  const value = segment.value || 0;
                  if (value <= 0) return null;
                  const y0 = ys(cursor);
                  cursor += value;
                  const y1 = ys(cursor);
                  const barHeight = Math.max(0, y0 - y1);
                  // 2 px surface gap between stacked segments.
                  const gap = si > 0 && barHeight > 4 ? 2 : 0;
                  return (
                    <rect
                      key={segment.key}
                      x={x}
                      y={y1}
                      width={barWidth}
                      height={Math.max(1, barHeight - gap)}
                      rx={si === segments.length - 1 ? Math.min(4, barWidth / 2) : 0}
                      fill={segment.color ?? color ?? seriesColor(si)}
                      opacity={hovered === null || hovered === i ? 1 : 0.45}
                    />
                  );
                })}
              </g>
            );
          })}

          <g className="chart-axis">
            <line x1={0} x2={plotWidth} y1={plotHeight} y2={plotHeight} />
            {yTicks.map((tick) => (
              <text key={tick} x={-8} y={ys(tick)} textAnchor="end" dominantBaseline="middle">
                {formatY ? formatY(tick) : formatTickNumber(tick)}
              </text>
            ))}
            {data.map((datum, i) =>
              i % every === 0 ? (
                <text key={datum.key} x={i * step + step / 2} y={plotHeight + 16} textAnchor="middle">
                  {datum.label}
                </text>
              ) : null,
            )}
          </g>
        </g>
      </svg>

      {hoveredDatum && (
        <div className="chart-tooltip" style={{ left: tooltipLeft, top: 8 }}>
          <div className="tt-title">{hoveredDatum.label}</div>
          {(hoveredDatum.segments ?? [{ key: hoveredDatum.key, label: 'Total', value: hoveredDatum.value ?? 0, color }])
            .filter((s) => s.value > 0)
            .map((segment, si) => (
              <div className="tt-row" key={segment.key}>
                <span className="swatch" style={{ background: segment.color ?? color ?? seriesColor(si) }} />
                <span>{segment.label}</span>
                <span className="tt-value">{formatValue ? formatValue(segment.value) : formatTickNumber(segment.value)}</span>
              </div>
            ))}
          {hoveredDatum.segments && hoveredDatum.segments.length > 1 && (
            <div className="tt-row" style={{ borderTop: '1px solid var(--border)', marginTop: 4, paddingTop: 4 }}>
              <span>Total</span>
              <span className="tt-value">
                {formatValue ? formatValue(totals[hovered!]) : formatTickNumber(totals[hovered!])}
              </span>
            </div>
          )}
          {hoveredDatum.detail?.map((row) => (
            <div className="tt-row" key={row.label}>
              <span>{row.label}</span>
              <span className="tt-value">{row.value}</span>
            </div>
          ))}
        </div>
      )}

      {showLegend && legend.length > 1 && (
        <div className="legend">
          {legend.map(([key, swatch]) => (
            <span className="legend-item" key={key}>
              <span className="swatch" style={{ background: swatch }} />
              {data.flatMap((d) => d.segments ?? []).find((s) => s.key === key)?.label ?? key}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
