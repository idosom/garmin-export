/** Synthetic GPX / TCX / CSV documents for tests and the sample export. */

export interface TrackOptions {
  start: number;
  points?: number;
  intervalSec?: number;
  name?: string;
  type?: string;
  withHeartRate?: boolean;
  withCadence?: boolean;
  withTemperature?: boolean;
  withPower?: boolean;
  baseLat?: number;
  baseLon?: number;
}

function trackPoints(opts: TrackOptions) {
  const { start, points = 60, intervalSec = 10, baseLat = 51.5074, baseLon = -0.1278 } = opts;
  return Array.from({ length: points }, (_, i) => {
    const progress = i / Math.max(1, points - 1);
    return {
      t: new Date(start + i * intervalSec * 1000).toISOString(),
      lat: baseLat + Math.sin(progress * Math.PI * 2) * 0.008,
      lon: baseLon + Math.cos(progress * Math.PI * 2) * 0.011,
      ele: 22 + 18 * Math.sin(progress * Math.PI),
      hr: Math.round(126 + 30 * progress),
      cad: Math.round(82 + 4 * Math.sin(progress * 9)),
      temp: Math.round(12 + 5 * progress),
      power: Math.round(190 + 50 * Math.sin(progress * 5)),
      distance: progress * 8000,
      speed: 3.1 + 0.6 * Math.sin(progress * 4),
    };
  });
}

export function buildGpx(opts: TrackOptions): string {
  const pts = trackPoints(opts);
  const body = pts
    .map((p) => {
      const ext: string[] = [];
      if (opts.withHeartRate !== false) ext.push(`<gpxtpx:hr>${p.hr}</gpxtpx:hr>`);
      if (opts.withCadence !== false) ext.push(`<gpxtpx:cad>${p.cad}</gpxtpx:cad>`);
      if (opts.withTemperature !== false) ext.push(`<gpxtpx:atemp>${p.temp}</gpxtpx:atemp>`);
      const extensions = ext.length
        ? `<extensions><gpxtpx:TrackPointExtension>${ext.join('')}</gpxtpx:TrackPointExtension>${
            opts.withPower ? `<power>${p.power}</power>` : ''
          }</extensions>`
        : '';
      return `      <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}"><ele>${p.ele.toFixed(1)}</ele><time>${p.t}</time>${extensions}</trkpt>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx creator="Garmin Connect" version="1.1"
  xmlns="http://www.topografix.com/GPX/1/1"
  xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
  <metadata><time>${new Date(opts.start).toISOString()}</time></metadata>
  <trk>
    <name>${opts.name ?? 'Morning Run'}</name>
    <type>${opts.type ?? 'running'}</type>
    <trkseg>
${body}
    </trkseg>
  </trk>
</gpx>`;
}

export function buildTcx(opts: TrackOptions & { sport?: string; laps?: number }): string {
  const pts = trackPoints(opts);
  const lapCount = opts.laps ?? 2;
  const perLap = Math.ceil(pts.length / lapCount);
  const intervalSec = opts.intervalSec ?? 10;

  const laps = Array.from({ length: lapCount }, (_, lapIndex) => {
    const slice = pts.slice(lapIndex * perLap, (lapIndex + 1) * perLap);
    if (!slice.length) return '';
    const trackpoints = slice
      .map(
        (p) => `          <Trackpoint>
            <Time>${p.t}</Time>
            <Position><LatitudeDegrees>${p.lat.toFixed(6)}</LatitudeDegrees><LongitudeDegrees>${p.lon.toFixed(6)}</LongitudeDegrees></Position>
            <AltitudeMeters>${p.ele.toFixed(1)}</AltitudeMeters>
            <DistanceMeters>${p.distance.toFixed(1)}</DistanceMeters>
            <HeartRateBpm><Value>${p.hr}</Value></HeartRateBpm>
            <Cadence>${p.cad}</Cadence>
            <Extensions><ns3:TPX><ns3:Speed>${p.speed.toFixed(2)}</ns3:Speed><ns3:Watts>${p.power}</ns3:Watts></ns3:TPX></Extensions>
          </Trackpoint>`,
      )
      .join('\n');
    const lapSeconds = slice.length * intervalSec;
    const lapDistance = (slice[slice.length - 1].distance - slice[0].distance).toFixed(1);
    return `      <Lap StartTime="${slice[0].t}">
        <TotalTimeSeconds>${lapSeconds}</TotalTimeSeconds>
        <DistanceMeters>${lapDistance}</DistanceMeters>
        <MaximumSpeed>3.9</MaximumSpeed>
        <Calories>${Math.round(lapSeconds * 0.18)}</Calories>
        <AverageHeartRateBpm><Value>${Math.round(slice.reduce((a, p) => a + p.hr, 0) / slice.length)}</Value></AverageHeartRateBpm>
        <MaximumHeartRateBpm><Value>${Math.max(...slice.map((p) => p.hr))}</Value></MaximumHeartRateBpm>
        <Intensity>Active</Intensity>
        <TriggerMethod>Distance</TriggerMethod>
        <Track>
${trackpoints}
        </Track>
      </Lap>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"
  xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2">
  <Activities>
    <Activity Sport="${opts.sport ?? 'Biking'}">
      <Id>${new Date(opts.start).toISOString()}</Id>
${laps}
      <Creator xsi:type="Device_t" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
        <Name>Garmin Edge 840</Name>
      </Creator>
    </Activity>
  </Activities>
</TrainingCenterDatabase>`;
}

export interface CsvActivityRow {
  date: string;
  type: string;
  title: string;
  distanceKm: number;
  timeSeconds: number;
  calories?: number;
  avgHr?: number;
  maxHr?: number;
  ascentM?: number;
  cadence?: number;
  strideM?: number;
  aerobicTe?: number;
}

/** Mirrors the column set of Garmin Connect's "Export CSV" activity list. */
export function buildActivitiesCsv(rows: CsvActivityRow[]): string {
  const headers = [
    'Activity Type', 'Date', 'Favorite', 'Title', 'Distance', 'Calories', 'Time', 'Avg HR', 'Max HR',
    'Aerobic TE', 'Avg Run Cadence', 'Avg Pace', 'Best Pace', 'Total Ascent', 'Total Descent',
    'Avg Stride Length', 'Min Temp', 'Number of Laps', 'Max Temp', 'Moving Time', 'Elapsed Time',
    'Min Elevation', 'Max Elevation',
  ];
  const fmtClock = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.round(s % 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  };
  const fmtPace = (s: number) => `${Math.floor(s / 60)}:${Math.round(s % 60).toString().padStart(2, '0')}`;

  const lines = [headers.map(quote).join(',')];
  for (const row of rows) {
    const paceSec = row.timeSeconds / row.distanceKm;
    lines.push(
      [
        row.type,
        row.date,
        'false',
        row.title,
        row.distanceKm.toFixed(2),
        row.calories?.toLocaleString('en-US') ?? '--',
        fmtClock(row.timeSeconds),
        row.avgHr ?? '--',
        row.maxHr ?? '--',
        row.aerobicTe?.toFixed(1) ?? '--',
        row.cadence ?? '--',
        fmtPace(paceSec),
        fmtPace(paceSec * 0.92),
        row.ascentM ?? '--',
        row.ascentM ?? '--',
        row.strideM?.toFixed(2) ?? '--',
        '9',
        '4',
        '17',
        fmtClock(row.timeSeconds * 0.98),
        fmtClock(row.timeSeconds),
        '12',
        '84',
      ]
        .map((v) => quote(String(v)))
        .join(','),
    );
  }
  return lines.join('\n');
}

export function buildWellnessCsv(rows: { date: string; restingHr?: number; steps?: number; sleepSeconds?: number; stress?: number; weightKg?: number }[]): string {
  const headers = ['Date', 'Resting Heart Rate', 'Steps', 'Sleep Time', 'Average Stress', 'Weight'];
  const lines = [headers.map(quote).join(',')];
  for (const row of rows) {
    const sleep = row.sleepSeconds
      ? `${Math.floor(row.sleepSeconds / 3600)}h ${Math.round((row.sleepSeconds % 3600) / 60)}m`
      : '--';
    lines.push(
      [row.date, row.restingHr ?? '--', row.steps?.toLocaleString('en-US') ?? '--', sleep, row.stress ?? '--', row.weightKg?.toFixed(1) ?? '--']
        .map((v) => quote(String(v)))
        .join(','),
    );
  }
  return lines.join('\n');
}

function quote(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}
