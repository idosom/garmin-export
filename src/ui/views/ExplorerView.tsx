import { useMemo, useState } from 'react';
import { useDataset } from '../../state/dataset.tsx';
import { Card, Badge, EmptyState, Alert, Segmented } from '../components/primitives.tsx';
import { IconSearch } from '../components/icons.tsx';
import { formatBytes } from '../../core/units.ts';
import type { FileReport } from '../../core/types.ts';

type Filter = 'all' | 'parsed' | 'empty' | 'skipped' | 'error';

export function ExplorerView() {
  const { dataset } = useDataset();
  const report = dataset.report;
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const counts = useMemo(() => {
    const counts: Record<string, number> = { all: report.files.length, parsed: 0, empty: 0, skipped: 0, error: 0 };
    for (const file of report.files) counts[file.status] = (counts[file.status] ?? 0) + 1;
    return counts;
  }, [report.files]);

  const formats = useMemo(() => {
    const map = new Map<string, number>();
    for (const file of report.files) map.set(file.format, (map.get(file.format) ?? 0) + 1);
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [report.files]);

  const messageTotals = useMemo(() => {
    const map = new Map<string, number>();
    for (const file of report.files) {
      for (const [key, value] of Object.entries(file.messageCounts)) map.set(key, (map.get(key) ?? 0) + value);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [report.files]);

  const developerFields = useMemo(() => {
    const map = new Map<string, { name: string; units?: string; count: number; files: number }>();
    for (const file of report.files) {
      for (const field of file.developerFields) {
        const existing = map.get(field.name) ?? { name: field.name, units: field.units, count: 0, files: 0 };
        existing.count += field.count;
        existing.files += 1;
        map.set(field.name, existing);
      }
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  }, [report.files]);

  const unknownFields = useMemo(() => {
    const map = new Map<string, number>();
    for (const file of report.files) for (const field of file.unknownFields) map.set(field, (map.get(field) ?? 0) + 1);
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [report.files]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return report.files.filter((file) => {
      if (filter !== 'all' && file.status !== filter) return false;
      if (!needle) return true;
      return `${file.path} ${file.format} ${file.detectedAs ?? ''}`.toLowerCase().includes(needle);
    });
  }, [report.files, filter, query]);

  const problems = report.files.filter((f) => f.errors.length || f.warnings.length);

  return (
    <>
      <div className="grid grid-stats">
        <div className="card stat">
          <span className="stat-label">Files inspected</span>
          <span className="stat-value num">{report.files.length.toLocaleString()}</span>
          <span className="stat-sub">{formatBytes(report.totalBytes)} read</span>
        </div>
        <div className="card stat">
          <span className="stat-label">Parsed</span>
          <span className="stat-value num">{counts.parsed.toLocaleString()}</span>
          <span className="stat-sub">
            {counts.skipped} skipped · {counts.empty} with no data · {counts.error} failed
          </span>
        </div>
        <div className="card stat">
          <span className="stat-label">Produced</span>
          <span className="stat-value num">{dataset.activities.length.toLocaleString()}</span>
          <span className="stat-sub">
            activities · {dataset.daily.length.toLocaleString()} wellness days
            {report.duplicateActivitiesMerged > 0 ? ` · ${report.duplicateActivitiesMerged} duplicates merged` : ''}
          </span>
        </div>
        <div className="card stat">
          <span className="stat-label">Time to parse</span>
          <span className="stat-value num">{((report.finishedAt - report.startedAt) / 1000).toFixed(1)}s</span>
          <span className="stat-sub">entirely in this browser</span>
        </div>
      </div>

      {report.warnings.length > 0 && (
        <Alert kind="warn">
          {report.warnings.map((warning) => (
            <div key={warning}>{warning}</div>
          ))}
        </Alert>
      )}

      <div className="grid grid-2">
        <Card title="Formats detected">
          <div className="chip-list">
            {formats.map(([format, count]) => (
              <Badge key={format}>
                {format.toUpperCase()} · {count}
              </Badge>
            ))}
          </div>
        </Card>
        <Card title="Records parsed" note="message and row counts across every file">
          <div className="chip-list">
            {messageTotals.slice(0, 24).map(([key, value]) => (
              <Badge key={key}>
                {key} · {value.toLocaleString()}
              </Badge>
            ))}
            {messageTotals.length === 0 && <span className="muted">Nothing parsed yet</span>}
          </div>
        </Card>
      </div>

      {(developerFields.length > 0 || unknownFields.length > 0) && (
        <div className="grid grid-2">
          {developerFields.length > 0 && (
            <Card title="Developer fields" note="custom fields written by apps or sensors, kept as-is">
              <table className="data">
                <thead>
                  <tr>
                    <th className="no-sort">Field</th>
                    <th className="no-sort">Units</th>
                    <th className="no-sort right">Values</th>
                    <th className="no-sort right">Files</th>
                  </tr>
                </thead>
                <tbody>
                  {developerFields.map((field) => (
                    <tr key={field.name} style={{ cursor: 'default' }}>
                      <td className="primary">{field.name}</td>
                      <td>{field.units || '—'}</td>
                      <td className="right num">{field.count.toLocaleString()}</td>
                      <td className="right num">{field.files}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
          {unknownFields.length > 0 && (
            <Card
              title="Unrecognised fields"
              note="present in your files but not in this app's Garmin profile — the values are still kept"
            >
              <div className="scroll-box chip-list">
                {unknownFields.map(([field, count]) => (
                  <Badge key={field}>
                    <span className="mono">{field}</span> · {count}
                  </Badge>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {problems.length > 0 && (
        <Card title="Warnings and errors" note={`${problems.length} file${problems.length === 1 ? '' : 's'}`}>
          <div className="scroll-box" style={{ display: 'grid', gap: 8 }}>
            {problems.slice(0, 200).map((file) => (
              <div key={file.id} style={{ fontSize: 12.5 }}>
                <span className="mono" style={{ color: 'var(--text-primary)' }}>
                  {file.name}
                </span>
                {file.errors.map((error) => (
                  <div key={error} style={{ color: 'var(--critical)' }}>
                    • {error}
                  </div>
                ))}
                {file.warnings.map((warning) => (
                  <div key={warning} className="muted">
                    • {warning}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card
        title="Files"
        note={`${filtered.length} shown`}
        actions={
          <>
            <label style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <span className="visually-hidden">Search files</span>
              <IconSearch size={14} style={{ position: 'absolute', left: 8, color: 'var(--text-muted)' }} />
              <input
                className="input"
                style={{ paddingLeft: 27, width: 190, padding: '4px 8px 4px 27px', fontSize: 12 }}
                placeholder="Filter by path…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <Segmented
              ariaLabel="Filter by status"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: `All ${counts.all}` },
                { value: 'parsed', label: `Parsed ${counts.parsed}` },
                { value: 'skipped', label: `Skipped ${counts.skipped}` },
                { value: 'error', label: `Errors ${counts.error}` },
              ]}
            />
          </>
        }
        padded={false}
      >
        {filtered.length === 0 ? (
          <EmptyState title="No files match" description="Try a different filter." />
        ) : (
          <div>
            <div className="file-row" style={{ fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', fontSize: 11 }}>
              <span>Path</span>
              <span>Format</span>
              <span>Status</span>
              <span>Produced</span>
              <span style={{ textAlign: 'right' }}>Size</span>
            </div>
            {filtered.slice(0, 400).map((file) => (
              <FileRow key={file.id} file={file} expanded={expanded === file.id} onToggle={() => setExpanded(expanded === file.id ? null : file.id)} />
            ))}
            {filtered.length > 400 && (
              <p className="muted" style={{ padding: 12, fontSize: 12 }}>
                Showing the first 400 of {filtered.length} files.
              </p>
            )}
          </div>
        )}
      </Card>
    </>
  );
}

function FileRow({ file, expanded, onToggle }: { file: FileReport; expanded: boolean; onToggle: () => void }) {
  const tone = file.status === 'error' ? 'bad' : file.status === 'parsed' ? 'good' : undefined;
  const produced = [
    file.produced.activities ? `${file.produced.activities} activities` : '',
    file.produced.dailyRecords ? `${file.produced.dailyRecords} days` : '',
    file.produced.samples ? `${file.produced.samples.toLocaleString()} samples` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <>
      <div className="file-row" onClick={onToggle} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onToggle()}>
        <span>
          <span className="path">{file.name}</span>
          <span className="sub">{file.archive ? `${file.archive} → ` : ''}{file.detectedAs ?? file.path}</span>
        </span>
        <span>
          <Badge>{file.format.toUpperCase()}</Badge>
        </span>
        <span>
          <Badge tone={tone}>{file.status}</Badge>
        </span>
        <span className="muted">{produced || '—'}</span>
        <span className="num muted" style={{ textAlign: 'right' }}>
          {formatBytes(file.size)}
        </span>
      </div>
      {expanded && (
        <div style={{ padding: '12px 16px 18px', background: 'var(--surface-sunken)', borderBottom: '1px solid var(--border)' }}>
          <dl className="kv-list" style={{ marginBottom: 12 }}>
            <dt>Path</dt>
            <dd className="mono">{file.path}</dd>
            <dt>Parser</dt>
            <dd>{file.parser ?? '—'}</dd>
            <dt>Parse time</dt>
            <dd>{file.durationMs} ms</dd>
          </dl>

          {Object.keys(file.messageCounts).length > 0 && (
            <>
              <h3 style={{ fontSize: 12, marginBottom: 6 }}>Messages / rows</h3>
              <div className="chip-list" style={{ marginBottom: 12 }}>
                {Object.entries(file.messageCounts)
                  .sort((a, b) => b[1] - a[1])
                  .map(([key, value]) => (
                    <Badge key={key}>
                      {key} · {value.toLocaleString()}
                    </Badge>
                  ))}
              </div>
            </>
          )}

          {file.fields.length > 0 && (
            <>
              <h3 style={{ fontSize: 12, marginBottom: 6 }}>Fields present ({file.fields.length})</h3>
              <div className="scroll-box chip-list" style={{ marginBottom: 12, maxHeight: 170 }}>
                {file.fields.map((field) => (
                  <span className="badge" key={field}>
                    <span className="mono">{field}</span>
                  </span>
                ))}
              </div>
            </>
          )}

          {file.developerFields.length > 0 && (
            <>
              <h3 style={{ fontSize: 12, marginBottom: 6 }}>Developer fields</h3>
              <div className="chip-list" style={{ marginBottom: 12 }}>
                {file.developerFields.map((field) => (
                  <Badge key={`${field.developerDataIndex}-${field.fieldDefinitionNumber}`} tone="accent">
                    {field.name}
                    {field.units ? ` (${field.units})` : ''} · {field.count.toLocaleString()} values
                  </Badge>
                ))}
              </div>
            </>
          )}

          {(file.warnings.length > 0 || file.errors.length > 0) && (
            <>
              <h3 style={{ fontSize: 12, marginBottom: 6 }}>Messages</h3>
              {file.errors.map((error) => (
                <div key={error} style={{ color: 'var(--critical)', fontSize: 12.5 }}>
                  • {error}
                </div>
              ))}
              {file.warnings.map((warning) => (
                <div key={warning} className="muted" style={{ fontSize: 12.5 }}>
                  • {warning}
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </>
  );
}
