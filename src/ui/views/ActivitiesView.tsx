import { useMemo, useState } from 'react';
import { useDataset } from '../../state/dataset.tsx';
import { activityDuration, activityTitle, useFormatters, type Formatters } from '../format.ts';
import { Card, EmptyState, Segmented, Badge } from '../components/primitives.tsx';
import { IconSearch } from '../components/icons.tsx';
import { SportIcon } from '../components/icons.tsx';
import { sportMeta } from '../../core/metrics.ts';
import { seriesColor } from '../charts/chartUtils.ts';
import type { Activity } from '../../core/types.ts';

type RangeKey = 'all' | '30' | '90' | '365';

interface Column {
  key: string;
  label: string;
  align?: 'right';
  /** Only shown when at least one activity in the dataset has the value. */
  available(activities: Activity[]): boolean;
  sortValue(activity: Activity): number | string | undefined;
  render(activity: Activity, fmt: Formatters): React.ReactNode;
}

const COLUMNS: Column[] = [
  {
    key: 'date',
    label: 'Date',
    available: () => true,
    sortValue: (a) => a.startTime,
    render: (a) => (
      <span className="num">
        {new Date(a.startTime).toLocaleDateString(undefined, { year: '2-digit', month: 'short', day: 'numeric' })}
      </span>
    ),
  },
  {
    key: 'name',
    label: 'Activity',
    available: () => true,
    sortValue: (a) => activityTitle(a).toLowerCase(),
    render: (a) => {
      const meta = sportMeta(a.sport);
      return (
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: seriesColor(meta.slot), display: 'flex' }}>
            <SportIcon icon={meta.icon} size={15} />
          </span>
          <span style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}>{activityTitle(a)}</span>
        </span>
      );
    },
  },
  {
    key: 'sport',
    label: 'Type',
    available: () => true,
    sortValue: (a) => a.sport,
    render: (a) => sportMeta(a.sport).label,
  },
  {
    key: 'duration',
    label: 'Time',
    align: 'right',
    available: () => true,
    sortValue: (a) => activityDuration(a),
    render: (a, fmt) => fmt.duration(activityDuration(a)),
  },
  {
    key: 'distance',
    label: 'Distance',
    align: 'right',
    available: (list) => list.some((a) => a.distance !== undefined),
    sortValue: (a) => a.distance,
    render: (a, fmt) => (a.distance === undefined ? <span className="dash">—</span> : fmt.distance(a.distance)),
  },
  {
    key: 'rate',
    label: 'Pace / speed',
    align: 'right',
    available: (list) => list.some((a) => a.avgSpeed !== undefined),
    sortValue: (a) => a.avgSpeed,
    render: (a, fmt) => (a.avgSpeed === undefined ? <span className="dash">—</span> : fmt.rate(a.sport, a.avgSpeed)),
  },
  {
    key: 'avgHr',
    label: 'Avg HR',
    align: 'right',
    available: (list) => list.some((a) => a.avgHr !== undefined),
    sortValue: (a) => a.avgHr,
    render: (a, fmt) => (a.avgHr === undefined ? <span className="dash">—</span> : `${fmt.number(a.avgHr)}`),
  },
  {
    key: 'maxHr',
    label: 'Max HR',
    align: 'right',
    available: (list) => list.some((a) => a.maxHr !== undefined),
    sortValue: (a) => a.maxHr,
    render: (a, fmt) => (a.maxHr === undefined ? <span className="dash">—</span> : `${fmt.number(a.maxHr)}`),
  },
  {
    key: 'power',
    label: 'Avg power',
    align: 'right',
    available: (list) => list.some((a) => a.avgPower !== undefined),
    sortValue: (a) => a.avgPower,
    render: (a, fmt) => (a.avgPower === undefined ? <span className="dash">—</span> : `${fmt.number(a.avgPower)} W`),
  },
  {
    key: 'ascent',
    label: 'Ascent',
    align: 'right',
    available: (list) => list.some((a) => a.ascent !== undefined),
    sortValue: (a) => a.ascent,
    render: (a, fmt) => (a.ascent === undefined ? <span className="dash">—</span> : fmt.elevation(a.ascent)),
  },
  {
    key: 'calories',
    label: 'Calories',
    align: 'right',
    available: (list) => list.some((a) => a.calories !== undefined),
    sortValue: (a) => a.calories,
    render: (a, fmt) => (a.calories === undefined ? <span className="dash">—</span> : fmt.number(a.calories)),
  },
  {
    key: 'te',
    label: 'Aerobic TE',
    align: 'right',
    available: (list) => list.some((a) => a.trainingEffectAerobic !== undefined),
    sortValue: (a) => a.trainingEffectAerobic,
    render: (a, fmt) =>
      a.trainingEffectAerobic === undefined ? <span className="dash">—</span> : fmt.number(a.trainingEffectAerobic, 1),
  },
];

const PAGE = 100;

export function ActivitiesView({ onOpenActivity }: { onOpenActivity: (activity: Activity) => void }) {
  const { dataset, overview } = useDataset();
  const fmt = useFormatters();
  const [query, setQuery] = useState('');
  const [sport, setSport] = useState('all');
  const [range, setRange] = useState<RangeKey>('all');
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'date', dir: 'desc' });
  const [limit, setLimit] = useState(PAGE);

  const columns = useMemo(() => COLUMNS.filter((c) => c.available(dataset.activities)), [dataset.activities]);

  const filtered = useMemo(() => {
    const now = Date.now();
    const cutoff = range === 'all' ? 0 : now - Number(range) * 86400000;
    const needle = query.trim().toLowerCase();
    const result = dataset.activities.filter((activity) => {
      if (activity.startTime < cutoff) return false;
      if (sport !== 'all' && activity.sport !== sport) return false;
      if (!needle) return true;
      const haystack = `${activityTitle(activity)} ${sportMeta(activity.sport).label} ${activity.subSport ?? ''} ${
        activity.device ?? ''
      } ${new Date(activity.startTime).toDateString()}`.toLowerCase();
      return haystack.includes(needle);
    });

    const column = COLUMNS.find((c) => c.key === sort.key);
    if (column) {
      result.sort((a, b) => {
        const va = column.sortValue(a);
        const vb = column.sortValue(b);
        if (va === undefined && vb === undefined) return 0;
        if (va === undefined) return 1;
        if (vb === undefined) return -1;
        const cmp = typeof va === 'string' || typeof vb === 'string' ? String(va).localeCompare(String(vb)) : va - vb;
        return sort.dir === 'asc' ? cmp : -cmp;
      });
    }
    return result;
  }, [dataset.activities, query, sport, range, sort]);

  const totals = useMemo(() => {
    let duration = 0;
    let distance = 0;
    for (const a of filtered) {
      duration += activityDuration(a) ?? 0;
      distance += a.distance ?? 0;
    }
    return { duration, distance };
  }, [filtered]);

  if (!dataset.activities.length) {
    return (
      <Card>
        <EmptyState
          title="No activities found"
          description="This export did not contain any activity files. FIT, TCX, GPX and Garmin's Activities.csv all work — drop them in and they will appear here."
        />
      </Card>
    );
  }

  const toggleSort = (key: string) =>
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'name' || key === 'sport' ? 'asc' : 'desc' }));

  return (
    <>
      <div className="toolbar">
        <label style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <span className="visually-hidden">Search activities</span>
          <IconSearch size={15} style={{ position: 'absolute', left: 9, color: 'var(--text-muted)' }} />
          <input
            className="input"
            style={{ paddingLeft: 30, width: 240 }}
            placeholder="Search activities…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(PAGE);
            }}
          />
        </label>

        <select
          className="input"
          value={sport}
          onChange={(e) => {
            setSport(e.target.value);
            setLimit(PAGE);
          }}
          aria-label="Filter by sport"
        >
          <option value="all">All sports</option>
          {overview.sports.map((s) => (
            <option key={s.sport} value={s.sport}>
              {s.label} ({s.count})
            </option>
          ))}
        </select>

        <Segmented
          ariaLabel="Date range"
          value={range}
          onChange={(value) => {
            setRange(value);
            setLimit(PAGE);
          }}
          options={[
            { value: 'all', label: 'All time' },
            { value: '365', label: '1 year' },
            { value: '90', label: '90 days' },
            { value: '30', label: '30 days' },
          ]}
        />

        <span className="spacer" />
        <Badge>
          {filtered.length} of {dataset.activities.length}
        </Badge>
        <Badge>{fmt.hours(totals.duration)}</Badge>
        {totals.distance > 0 && <Badge>{fmt.distance(totals.distance)}</Badge>}
      </div>

      <Card padded={false}>
        {filtered.length === 0 ? (
          <EmptyState title="No activities match" description="Try a different search term, sport or date range." />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  {columns.map((column) => (
                    <th
                      key={column.key}
                      className={column.align === 'right' ? 'right' : undefined}
                      onClick={() => toggleSort(column.key)}
                      aria-sort={sort.key === column.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                    >
                      {column.label}
                      {sort.key === column.key ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, limit).map((activity) => (
                  <tr key={activity.id} onClick={() => onOpenActivity(activity)} tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onOpenActivity(activity);
                      }
                    }}
                  >
                    {columns.map((column) => (
                      <td key={column.key} className={`${column.align === 'right' ? 'right ' : ''}${column.key === 'name' ? 'primary' : ''}`}>
                        {column.render(activity, fmt)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {filtered.length > limit && (
          <div style={{ padding: 12, textAlign: 'center' }}>
            <button type="button" className="btn" onClick={() => setLimit((l) => l + PAGE * 4)}>
              Show more ({filtered.length - limit} remaining)
            </button>
          </div>
        )}
      </Card>
    </>
  );
}
