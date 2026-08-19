import { useEffect, useMemo, useState } from 'react';
import type { Activity } from '../../core/types.ts';
import { channelMeta, humanize, sportMeta, PLOTTABLE_CHANNELS } from '../../core/metrics.ts';
import { formatByKind, formatDuration, formatDateTime, joinFormatted } from '../../core/units.ts';
import { lttb } from '../../core/stats.ts';
import { useFormatters, activityTitle, activityDuration } from '../format.ts';
import { useSettings } from '../../state/settings.tsx';
import { Card, Badge, EmptyState, Segmented, Alert } from '../components/primitives.tsx';
import { LineChart } from '../charts/LineChart.tsx';
import { RouteMap } from '../components/RouteMap.tsx';
import { SportIcon, IconClose, IconMap } from '../components/icons.tsx';
import { seriesColor } from '../charts/chartUtils.ts';

type XAxis = 'time' | 'distance';

export function ActivityDetail({ activity, onClose }: { activity: Activity; onClose: () => void }) {
  const fmt = useFormatters();
  const settings = useSettings();
  const [xAxis, setXAxis] = useState<XAxis>('time');
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [colorBy, setColorBy] = useState<string>('none');
  const meta = sportMeta(activity.sport);

  // The sheet owns the viewport while it is open.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const streams = activity.streams;

  const chart = useMemo(() => {
    if (!streams || streams.n < 2) return undefined;
    const hasDistance = !!streams.channels.distance;
    const useDistance = xAxis === 'distance' && hasDistance;
    const xs = new Float64Array(streams.n);
    for (let i = 0; i < streams.n; i++) {
      xs[i] = useDistance ? streams.channels.distance![i] : (streams.time[i] - streams.time[0]) / 1000;
    }
    const guide = streams.channels.elevation ?? streams.channels.heartRate ?? streams.channels.speed ?? xs;
    const indices = lttb(xs, guide, 1400);

    const channels = Object.keys(streams.channels)
      .filter((key) => key !== 'distance')
      .sort((a, b) => {
        const ai = PLOTTABLE_CHANNELS.indexOf(a);
        const bi = PLOTTABLE_CHANNELS.indexOf(b);
        return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
      })
      .map((key) => {
        const column = streams.channels[key];
        const points = indices.map((i) => ({ x: xs[i], y: Number.isFinite(column[i]) ? column[i] : undefined }));
        const values = points.map((p) => p.y).filter((v): v is number => v !== undefined);
        return {
          key,
          meta: channelMeta(key),
          points,
          samples: values.length,
          // The header must name the unit the axis is actually drawn in, which
          // is the display unit, not the SI unit the model stores.
          typical: values.length ? values[Math.floor(values.length / 2)] : 0,
        };
      })
      .filter((series) => series.samples > 1);

    return { xs, indices, channels, useDistance, hasDistance };
  }, [streams, xAxis]);

  const hoverIndex = useMemo(() => {
    if (!chart || hoverX === null) return null;
    let best = 0;
    let bestDelta = Infinity;
    for (const i of chart.indices) {
      const delta = Math.abs(chart.xs[i] - hoverX);
      if (delta < bestDelta) {
        bestDelta = delta;
        best = i;
      }
    }
    return best;
  }, [chart, hoverX]);

  const formatX = (value: number) =>
    chart?.useDistance ? joinFormatted({ ...fmt.distanceParts(value) }) : formatDuration(value);

  const summary = buildSummary(activity, fmt);
  const missing = MISSING_CANDIDATES.filter((m) => m.applies(activity) && m.value(activity) === undefined);

  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-label={activityTitle(activity)} onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <header className="sheet-head">
          <span style={{ color: seriesColor(meta.slot), display: 'flex' }}>
            <SportIcon icon={meta.icon} size={20} />
          </span>
          <div style={{ minWidth: 0 }}>
            <h1 style={{ fontSize: 17 }}>{activityTitle(activity)}</h1>
            <span className="muted" style={{ fontSize: 12.5 }}>
              {formatDateTime(activity.startTime)} · {meta.label}
              {activity.subSport ? ` · ${humanize(activity.subSport)}` : ''}
              {activity.device ? ` · ${activity.device}` : ''}
            </span>
          </div>
          <button type="button" className="btn ghost" style={{ marginLeft: 'auto' }} onClick={onClose} aria-label="Close activity">
            <IconClose size={16} />
          </button>
        </header>

        <div className="sheet-body">
          <Card title="Summary" note={`${activity.sources.length} source file${activity.sources.length === 1 ? '' : 's'}`} padded={false}>
            <div className="metric-grid">
              {summary.map((item) => (
                <div key={item.label} className="metric-cell">
                  <span className="k">{item.label}</span>
                  <span className="v">{item.value}</span>
                </div>
              ))}
            </div>
            {missing.length > 0 && (
              <div style={{ padding: '10px 14px 14px' }}>
                <details>
                  <summary className="muted" style={{ fontSize: 12, cursor: 'pointer' }}>
                    {missing.length} metric{missing.length === 1 ? '' : 's'} not recorded for this activity
                  </summary>
                  <div className="chip-list" style={{ marginTop: 8 }}>
                    {missing.map((m) => (
                      <span className="badge" key={m.label}>
                        {m.label} — not recorded
                      </span>
                    ))}
                  </div>
                </details>
              </div>
            )}
          </Card>

          {activity.hasGps && streams?.lat && streams.lon ? (
            <Card
              title="Route"
              actions={
                <>
                  <select
                    className="input"
                    style={{ padding: '3px 24px 3px 8px', fontSize: 12 }}
                    value={colorBy}
                    onChange={(e) => setColorBy(e.target.value)}
                    aria-label="Colour the route by"
                  >
                    <option value="none">Single colour</option>
                    {chart?.channels.map((c) => (
                      <option key={c.key} value={c.key}>
                        Colour by {c.meta.label.toLowerCase()}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn small ghost"
                    onClick={() => settings.set('mapTiles', !settings.mapTiles)}
                    aria-pressed={settings.mapTiles}
                    title={
                      settings.mapTiles
                        ? 'Turn off the OpenStreetMap basemap'
                        : 'Load a basemap from OpenStreetMap. This is the only request this app makes to a server.'
                    }
                  >
                    <IconMap size={14} /> {settings.mapTiles ? 'Map on' : 'Map off'}
                  </button>
                </>
              }
            >
              <RouteMap
                lat={streams.lat}
                lon={streams.lon}
                values={colorBy === 'none' ? undefined : streams.channels[colorBy]}
                valueLabel={colorBy === 'none' ? undefined : channelMeta(colorBy).label}
                formatValue={(v) =>
                  colorBy === 'none' ? String(v) : formatByKind(v, channelMeta(colorBy).kind, fmt.units).value
                }
                height={340}
                hoverIndex={hoverIndex}
                onHoverIndex={(index) => setHoverX(index === null || !chart ? null : chart.xs[index])}
                showTiles={settings.mapTiles}
              />
              {!settings.mapTiles && (
                <p className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
                  Drawn from your GPS track alone. Turn the basemap on to load map tiles from OpenStreetMap — the only time this app
                  contacts a server.
                </p>
              )}
            </Card>
          ) : (
            <Card title="Route">
              <EmptyState
                icon={<IconMap size={20} />}
                title="No GPS track"
                description="This activity was recorded without position data — indoor sessions and some devices do not store it."
              />
            </Card>
          )}

          {chart && chart.channels.length > 0 ? (
            <Card
              title="Data streams"
              note={`${streams!.n.toLocaleString()} samples`}
              actions={
                chart.hasDistance ? (
                  <Segmented
                    ariaLabel="Chart x axis"
                    value={xAxis}
                    onChange={setXAxis}
                    options={[
                      { value: 'time', label: 'Time' },
                      { value: 'distance', label: 'Distance' },
                    ]}
                  />
                ) : undefined
              }
            >
              <div style={{ display: 'grid', gap: 18 }}>
                {chart.channels.map((series, i) => (
                  <div key={series.key}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 2 }}>
                      <h3 style={{ fontSize: 12.5 }}>{series.meta.label}</h3>
                      <span className="muted" style={{ fontSize: 11.5 }}>
                        {formatByKind(series.typical, series.meta.kind, fmt.units).unit || series.meta.unit}
                      </span>
                    </div>
                    <LineChart
                      height={140}
                      xType="linear"
                      showLegend={false}
                      formatX={formatX}
                      hoverX={hoverX}
                      onHoverX={setHoverX}
                      formatY={(v) => formatByKind(v, series.meta.kind, fmt.units).value}
                      series={[
                        {
                          key: series.key,
                          label: series.meta.label,
                          points: series.points,
                          color: seriesColor(series.meta.slot ?? i),
                          area: series.key === 'elevation',
                          format: (v) => joinFormatted(formatByKind(v, series.meta.kind, fmt.units)),
                        },
                      ]}
                      ariaLabel={`${series.meta.label} over ${chart.useDistance ? 'distance' : 'time'}`}
                    />
                  </div>
                ))}
              </div>
            </Card>
          ) : (
            <Card title="Data streams">
              <EmptyState
                title="No per-sample data"
                description="This activity came from a summary source (a CSV row, or a JSON summary) rather than a recorded file, so there are no streams to chart."
              />
            </Card>
          )}

          {activity.hrZoneTimes && activity.hrZoneTimes.some((v) => v > 0) && (
            <Card title="Time in heart-rate zones" note="as reported by the device">
              <div style={{ display: 'grid', gap: 6 }}>
                {activity.hrZoneTimes.map((seconds, zone) => {
                  const total = activity.hrZoneTimes!.reduce((a, b) => a + b, 0) || 1;
                  return (
                    <div key={zone} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5 }}>
                      <span style={{ width: 54, color: 'var(--text-secondary)' }}>Zone {zone}</span>
                      <span style={{ flex: 1, background: 'var(--surface-sunken)', borderRadius: 4, height: 10 }}>
                        <span
                          style={{
                            display: 'block',
                            width: `${(seconds / total) * 100}%`,
                            height: '100%',
                            borderRadius: 4,
                            background: seriesColor(zone),
                          }}
                        />
                      </span>
                      <span className="num" style={{ width: 64, textAlign: 'right' }}>
                        {formatDuration(seconds)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {activity.laps.length > 1 && <LapsTable activity={activity} />}

          <ExtraFields activity={activity} />

          <Card title="Where this came from">
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: 'var(--text-secondary)' }}>
              {activity.sources.map((source) => (
                <li key={`${source.fileId}-${source.path}`}>
                  <span className="mono">{source.path}</span> <Badge>{source.format.toUpperCase()}</Badge>
                </li>
              ))}
            </ul>
            {activity.sources.length > 1 && (
              <div style={{ marginTop: 10 }}>
                <Alert>
                  This activity appeared in more than one file. The richest copy is shown, with any extra fields from the others merged
                  in.
                </Alert>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function LapsTable({ activity }: { activity: Activity }) {
  const fmt = useFormatters();
  const columns = useMemo(() => {
    const laps = activity.laps;
    return {
      distance: laps.some((l) => l.distance !== undefined),
      speed: laps.some((l) => l.avgSpeed !== undefined),
      hr: laps.some((l) => l.avgHr !== undefined),
      maxHr: laps.some((l) => l.maxHr !== undefined),
      cadence: laps.some((l) => l.avgCadence !== undefined),
      power: laps.some((l) => l.avgPower !== undefined),
      ascent: laps.some((l) => l.ascent !== undefined),
      calories: laps.some((l) => l.calories !== undefined),
    };
  }, [activity.laps]);

  const fastest = activity.laps.reduce<number | undefined>((best, lap) => {
    if (lap.avgSpeed === undefined) return best;
    return best === undefined || lap.avgSpeed > best ? lap.avgSpeed : best;
  }, undefined);

  return (
    <Card title="Laps" note={`${activity.laps.length} laps`} padded={false}>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th className="no-sort">Lap</th>
              <th className="no-sort right">Time</th>
              {columns.distance && <th className="no-sort right">Distance</th>}
              {columns.speed && <th className="no-sort right">Pace / speed</th>}
              {columns.hr && <th className="no-sort right">Avg HR</th>}
              {columns.maxHr && <th className="no-sort right">Max HR</th>}
              {columns.cadence && <th className="no-sort right">Cadence</th>}
              {columns.power && <th className="no-sort right">Power</th>}
              {columns.ascent && <th className="no-sort right">Ascent</th>}
              {columns.calories && <th className="no-sort right">Calories</th>}
            </tr>
          </thead>
          <tbody>
            {activity.laps.map((lap, i) => (
              <tr key={`${lap.index}-${i}`} style={{ cursor: 'default' }}>
                <td className="primary">
                  {i + 1}
                  {lap.avgSpeed !== undefined && lap.avgSpeed === fastest && (
                    <span className="badge accent" style={{ marginLeft: 6 }}>
                      fastest
                    </span>
                  )}
                  {lap.intensity && lap.intensity !== 'active' && (
                    <span className="badge" style={{ marginLeft: 6 }}>
                      {lap.intensity}
                    </span>
                  )}
                </td>
                <td className="right num">{formatDuration(lap.timerTime ?? lap.elapsedTime)}</td>
                {columns.distance && <td className="right num">{lap.distance === undefined ? '—' : fmt.distance(lap.distance)}</td>}
                {columns.speed && <td className="right num">{fmt.rate(lap.sport ?? activity.sport, lap.avgSpeed)}</td>}
                {columns.hr && <td className="right num">{lap.avgHr === undefined ? '—' : Math.round(lap.avgHr)}</td>}
                {columns.maxHr && <td className="right num">{lap.maxHr === undefined ? '—' : Math.round(lap.maxHr)}</td>}
                {columns.cadence && <td className="right num">{lap.avgCadence === undefined ? '—' : Math.round(lap.avgCadence)}</td>}
                {columns.power && <td className="right num">{lap.avgPower === undefined ? '—' : `${Math.round(lap.avgPower)} W`}</td>}
                {columns.ascent && <td className="right num">{lap.ascent === undefined ? '—' : fmt.elevation(lap.ascent)}</td>}
                {columns.calories && <td className="right num">{lap.calories === undefined ? '—' : Math.round(lap.calories)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function ExtraFields({ activity }: { activity: Activity }) {
  const entries = Object.entries(activity.extra).filter(([, value]) => value !== null && value !== '');
  const lapExtras = new Set<string>();
  for (const lap of activity.laps) for (const key of Object.keys(lap.extra)) lapExtras.add(key);
  if (!entries.length && !lapExtras.size) return null;

  return (
    <Card
      title="Other fields in the source file"
      note="preserved exactly as recorded, including device-specific and developer fields"
    >
      {entries.length > 0 && (
        <dl className="kv-list">
          {entries.map(([key, value]) => (
            <div key={key} style={{ display: 'contents' }}>
              <dt>{humanize(key)}</dt>
              <dd>{typeof value === 'number' ? Math.round(value * 1000) / 1000 : String(value)}</dd>
            </div>
          ))}
        </dl>
      )}
      {lapExtras.size > 0 && (
        <div style={{ marginTop: entries.length ? 12 : 0 }}>
          <span className="muted" style={{ fontSize: 12 }}>
            Additional lap fields:{' '}
          </span>
          <span className="chip-list" style={{ display: 'inline-flex', marginLeft: 4 }}>
            {[...lapExtras].map((key) => (
              <span className="badge" key={key}>
                {humanize(key)}
              </span>
            ))}
          </span>
        </div>
      )}
    </Card>
  );
}

interface SummaryItem {
  label: string;
  value: string;
}

function buildSummary(activity: Activity, fmt: ReturnType<typeof useFormatters>): SummaryItem[] {
  const items: SummaryItem[] = [];
  const add = (label: string, value: string | undefined) => {
    if (value && value !== '—') items.push({ label, value });
  };

  add('Duration', fmt.duration(activityDuration(activity)));
  if (activity.elapsedTime !== undefined && activity.elapsedTime !== activityDuration(activity)) {
    add('Elapsed', fmt.duration(activity.elapsedTime));
  }
  add('Distance', activity.distance === undefined ? undefined : fmt.distance(activity.distance));
  add(fmt.rateLabel(activity.sport), activity.avgSpeed === undefined ? undefined : fmt.rate(activity.sport, activity.avgSpeed));
  add('Best pace / speed', activity.maxSpeed === undefined ? undefined : fmt.rate(activity.sport, activity.maxSpeed));
  add('Avg heart rate', activity.avgHr === undefined ? undefined : `${Math.round(activity.avgHr)} bpm`);
  add('Max heart rate', activity.maxHr === undefined ? undefined : `${Math.round(activity.maxHr)} bpm`);
  add('Calories', activity.calories === undefined ? undefined : `${Math.round(activity.calories)} kcal`);
  add('Ascent', activity.ascent === undefined ? undefined : fmt.elevation(activity.ascent));
  add('Descent', activity.descent === undefined ? undefined : fmt.elevation(activity.descent));
  add('Min elevation', activity.minElevation === undefined ? undefined : fmt.elevation(activity.minElevation));
  add('Max elevation', activity.maxElevation === undefined ? undefined : fmt.elevation(activity.maxElevation));
  add('Avg cadence', activity.avgCadence === undefined ? undefined : `${Math.round(activity.avgCadence)}`);
  add('Max cadence', activity.maxCadence === undefined ? undefined : `${Math.round(activity.maxCadence)}`);
  add('Avg power', activity.avgPower === undefined ? undefined : `${Math.round(activity.avgPower)} W`);
  add('Max power', activity.maxPower === undefined ? undefined : `${Math.round(activity.maxPower)} W`);
  add('Normalized power', activity.normalizedPower === undefined ? undefined : `${Math.round(activity.normalizedPower)} W`);
  add('Aerobic TE', activity.trainingEffectAerobic === undefined ? undefined : activity.trainingEffectAerobic.toFixed(1));
  add('Anaerobic TE', activity.trainingEffectAnaerobic === undefined ? undefined : activity.trainingEffectAnaerobic.toFixed(1));
  add('Training load', activity.trainingLoad === undefined ? undefined : Math.round(activity.trainingLoad).toString());
  add('Training stress score', activity.tss === undefined ? undefined : activity.tss.toFixed(0));
  add('Intensity factor', activity.intensityFactor === undefined ? undefined : activity.intensityFactor.toFixed(2));
  add('VO₂ max', activity.vo2max === undefined ? undefined : activity.vo2max.toFixed(1));
  add('Steps', activity.steps === undefined ? undefined : Math.round(activity.steps).toLocaleString());
  add('Strokes', activity.strokes === undefined ? undefined : Math.round(activity.strokes).toLocaleString());
  add('Pool length', activity.poolLength === undefined ? undefined : fmt.distance(activity.poolLength));
  add('Avg temperature', activity.avgTemperature === undefined ? undefined : fmt.temperature(activity.avgTemperature));
  add('Max temperature', activity.maxTemperature === undefined ? undefined : fmt.temperature(activity.maxTemperature));
  add(
    'Vertical oscillation',
    activity.avgVerticalOscillation === undefined ? undefined : `${activity.avgVerticalOscillation.toFixed(1)} mm`,
  );
  add(
    'Ground contact time',
    activity.avgGroundContactTime === undefined ? undefined : `${Math.round(activity.avgGroundContactTime)} ms`,
  );
  add('Stride length', activity.avgStrideLength === undefined ? undefined : `${Math.round(activity.avgStrideLength)} mm`);
  return items;
}

const MISSING_CANDIDATES: { label: string; applies(a: Activity): boolean; value(a: Activity): number | undefined }[] = [
  { label: 'Heart rate', applies: () => true, value: (a) => a.avgHr },
  { label: 'Distance', applies: (a) => sportMeta(a.sport).distanceBased, value: (a) => a.distance },
  { label: 'Elevation', applies: (a) => sportMeta(a.sport).distanceBased, value: (a) => a.ascent },
  { label: 'Power', applies: (a) => a.sport === 'cycling' || a.sport === 'running', value: (a) => a.avgPower },
  { label: 'Cadence', applies: (a) => sportMeta(a.sport).distanceBased, value: (a) => a.avgCadence },
  { label: 'Calories', applies: () => true, value: (a) => a.calories },
  { label: 'Training effect', applies: () => true, value: (a) => a.trainingEffectAerobic },
  { label: 'Temperature', applies: () => true, value: (a) => a.avgTemperature },
];
