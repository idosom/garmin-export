/**
 * The ingestion pipeline: sources → discovery → parsers → normalization →
 * `Dataset`. Deliberately free of DOM and worker APIs so it runs unchanged in
 * a Web Worker, in tests, and on the main thread as a fallback.
 */
import type { Activity, DailyRecord, Dataset, FileReport, IngestReport, SourceRef, UserProfile } from '../core/types.ts';
import { detectFormat } from './discovery.ts';
import { batchEntries, extractEntries, gunzip, isInterestingEntry, listZipEntries } from './archive.ts';
import { parseFile } from '../parsers/index.ts';
import { normalizeActivity } from '../normalize/activity.ts';
import { dedupeActivities, mergeDaily } from '../normalize/dedupe.ts';

export interface IngestSource {
  /** Display path, e.g. `export.zip!/DI_CONNECT/…/activity.fit`. */
  path: string;
  size: number;
  read(): Promise<Uint8Array>;
  archive?: string;
}

export interface IngestProgress {
  phase: 'reading' | 'expanding' | 'parsing' | 'normalizing' | 'done';
  processed: number;
  total: number;
  currentFile?: string;
  message?: string;
}

export interface IngestOptions {
  onProgress?: (progress: IngestProgress) => void;
  /** Guards against a pathological archive filling memory. */
  maxFiles?: number;
  maxFileBytes?: number;
  maxArchiveDepth?: number;
  label?: string;
}

export function sourceFromBytes(path: string, bytes: Uint8Array, archive?: string): IngestSource {
  return { path, size: bytes.byteLength, read: async () => bytes, archive };
}

export async function ingest(inputs: IngestSource[], options: IngestOptions = {}): Promise<Dataset> {
  const maxFiles = options.maxFiles ?? 60000;
  const maxFileBytes = options.maxFileBytes ?? 512 * 1024 * 1024;
  const maxDepth = options.maxArchiveDepth ?? 4;
  const startedAt = Date.now();

  const reports: FileReport[] = [];
  const activities: Activity[] = [];
  const daily: DailyRecord[] = [];
  const warnings: string[] = [];
  let user: UserProfile | undefined;

  const queue: (IngestSource & { depth: number })[] = inputs.map((s) => ({ ...s, depth: 0 }));
  let processed = 0;
  let totalBytes = 0;
  let fileCounter = 0;

  const report = (phase: IngestProgress['phase'], currentFile?: string, message?: string) => {
    options.onProgress?.({
      phase,
      processed,
      total: processed + queue.length,
      currentFile,
      message,
    });
  };

  report('reading');

  while (queue.length) {
    if (reports.length >= maxFiles) {
      warnings.push(`Stopped after ${maxFiles} files — the export is larger than this app handles in one pass`);
      break;
    }
    const source = queue.shift()!;
    processed++;
    const id = `f${(fileCounter++).toString(36)}`;
    const name = source.path.split('/').pop() ?? source.path;
    const started = Date.now();
    report('parsing', source.path);

    if (source.size > maxFileBytes) {
      reports.push(baseReport(id, source, name, 'skipped', started, ['File is too large to parse in the browser']));
      continue;
    }

    let bytes: Uint8Array;
    try {
      bytes = await source.read();
    } catch (err) {
      reports.push(baseReport(id, source, name, 'error', started, [], [`Could not read file: ${errText(err)}`]));
      continue;
    }
    totalBytes += bytes.byteLength;

    const detection = detectFormat(source.path, bytes);

    if (detection.format === 'zip') {
      const fileReport = baseReport(id, source, name, 'parsed', started);
      fileReport.format = 'zip';
      fileReport.detectedAs = detection.variant === 'gzip' ? 'gzip archive' : 'ZIP archive';
      try {
        if (source.depth >= maxDepth) {
          fileReport.status = 'skipped';
          fileReport.warnings.push('Nested archive depth limit reached');
        } else if (detection.variant === 'gzip') {
          const inner = gunzip(bytes);
          const innerName = source.path.replace(/\.gz$/i, '');
          queue.push({
            path: `${innerName}`,
            size: inner.byteLength,
            read: async () => inner,
            archive: source.path,
            depth: source.depth + 1,
          });
          fileReport.messageCounts = { entries: 1 };
        } else {
          const all = listZipEntries(bytes);
          const entries = all.filter((e) => isInterestingEntry(e.name));
          const ignored = all.filter((e) => !isInterestingEntry(e.name));
          fileReport.messageCounts = { entries: all.length, parsable: entries.length };
          report('expanding', source.path, `${entries.length} files inside`);
          // Listed but never inflated — the explorer should still show them.
          for (const entry of ignored.slice(0, 250)) {
            const skipped = baseReport(`f${(fileCounter++).toString(36)}`, { ...source, path: `${source.path}!/${entry.name}` }, entry.name.split('/').pop() ?? entry.name, 'skipped', Date.now());
            skipped.size = entry.size;
            skipped.detectedAs = 'Not a Garmin data file';
            skipped.warnings.push('Skipped without reading: unsupported file type');
            reports.push(skipped);
          }
          if (ignored.length > 250) {
            warnings.push(`${ignored.length - 250} further unsupported files inside ${name} were skipped without listing`);
          }
          for (const batch of batchEntries(entries)) {
            const names = new Set(batch.map((e) => e.name));
            const extracted = extractEntries(bytes, names);
            for (const [entryName, data] of Object.entries(extracted)) {
              queue.push({
                path: `${source.path}!/${entryName}`,
                size: data.byteLength,
                read: async () => data,
                archive: source.path,
                depth: source.depth + 1,
              });
            }
          }
        }
      } catch (err) {
        fileReport.status = 'error';
        fileReport.errors.push(`Could not expand archive: ${errText(err)}`);
      }
      fileReport.durationMs = Date.now() - started;
      reports.push(fileReport);
      continue;
    }

    const fileReport = baseReport(id, source, name, 'parsed', started);
    fileReport.format = detection.format;
    fileReport.detectedAs = detection.reason;

    if (detection.format === 'unknown') {
      fileReport.status = 'skipped';
      fileReport.warnings.push(detection.reason);
      fileReport.durationMs = Date.now() - started;
      reports.push(fileReport);
      continue;
    }

    try {
      const parsed = parseFile(source.path, bytes, detection.format);
      fileReport.parser = parsed.parser;
      fileReport.detectedAs = parsed.detectedAs ?? detection.reason;
      fileReport.messageCounts = parsed.messageCounts;
      fileReport.fields = parsed.fields;
      fileReport.unknownFields = parsed.unknownFields;
      fileReport.developerFields = parsed.developerFields;
      fileReport.warnings.push(...parsed.warnings);

      const ref: SourceRef = { fileId: id, path: source.path, format: detection.format };
      let samples = 0;
      for (const raw of parsed.activities) {
        const activity = normalizeActivity(raw, ref);
        if (!activity) {
          fileReport.warnings.push('An activity was dropped because it had no usable start time');
          continue;
        }
        samples += activity.streams?.n ?? 0;
        activities.push(activity);
      }
      for (const day of parsed.daily) {
        daily.push({ date: day.date, values: day.values, sources: [ref] });
      }
      if (parsed.user && !user) user = parsed.user;

      fileReport.produced = {
        activities: parsed.activities.length,
        dailyRecords: parsed.daily.length,
        samples,
      };
      if (!parsed.activities.length && !parsed.daily.length && !parsed.user) {
        fileReport.status = 'empty';
      }
    } catch (err) {
      fileReport.status = 'error';
      fileReport.errors.push(errText(err));
    }
    fileReport.durationMs = Date.now() - started;
    reports.push(fileReport);
  }

  report('normalizing', undefined, `${activities.length} activities`);
  const deduped = dedupeActivities(activities);
  const mergedDaily = mergeDaily(daily) as DailyRecord[];

  const ingestReport: IngestReport = {
    files: reports,
    startedAt,
    finishedAt: Date.now(),
    totalBytes,
    duplicateActivitiesMerged: deduped.merged,
    warnings,
  };

  const dataset: Dataset = {
    id: `ds-${startedAt.toString(36)}`,
    createdAt: startedAt,
    label: options.label ?? defaultLabel(inputs),
    activities: deduped.activities,
    daily: mergedDaily,
    user,
    report: ingestReport,
  };

  options.onProgress?.({ phase: 'done', processed, total: processed, message: `${deduped.activities.length} activities` });
  return dataset;
}

function defaultLabel(inputs: IngestSource[]): string {
  if (inputs.length === 1) return inputs[0].path.split('/').pop() ?? 'Garmin export';
  return `${inputs.length} files`;
}

function baseReport(
  id: string,
  source: IngestSource & { depth: number },
  name: string,
  status: FileReport['status'],
  started: number,
  warnings: string[] = [],
  errors: string[] = [],
): FileReport {
  return {
    id,
    path: source.path,
    name,
    size: source.size,
    format: 'unknown',
    status,
    durationMs: Date.now() - started,
    messageCounts: {},
    fields: [],
    unknownFields: [],
    developerFields: [],
    warnings,
    errors,
    produced: { activities: 0, dailyRecords: 0, samples: 0 },
    archive: source.archive,
  };
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
