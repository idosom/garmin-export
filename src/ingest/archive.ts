/**
 * Archive expansion.
 *
 * Garmin's "Export Your Data" download is a ZIP that often contains further
 * ZIPs, so expansion is recursive (bounded). Entries are listed first and then
 * inflated in batches, which keeps peak memory near one batch rather than the
 * whole archive.
 */
import { unzipSync, gunzipSync, type Unzipped } from 'fflate';
import { isIgnoredExtension } from './discovery.ts';

export interface ArchiveEntry {
  name: string;
  size: number;
}

const SKIP_PATTERNS = [/^__MACOSX\//, /(^|\/)\.DS_Store$/, /(^|\/)Thumbs\.db$/, /\/$/];

export function listZipEntries(data: Uint8Array): ArchiveEntry[] {
  const entries: ArchiveEntry[] = [];
  unzipSync(data, {
    filter: (file) => {
      if (!SKIP_PATTERNS.some((p) => p.test(file.name))) {
        entries.push({ name: file.name, size: file.originalSize ?? 0 });
      }
      return false; // never inflate during the listing pass
    },
  });
  return entries;
}

export function extractEntries(data: Uint8Array, names: Set<string>): Unzipped {
  return unzipSync(data, { filter: (file) => names.has(file.name) });
}

export function gunzip(data: Uint8Array): Uint8Array {
  return gunzipSync(data);
}

/** Drops entries we would only discard later, before paying to inflate them. */
export function isInterestingEntry(name: string): boolean {
  if (SKIP_PATTERNS.some((p) => p.test(name))) return false;
  return !isIgnoredExtension(name);
}

/** Batches entry names so each inflate pass stays within a memory budget. */
export function batchEntries(entries: ArchiveEntry[], maxBytes = 64 * 1024 * 1024, maxCount = 64): ArchiveEntry[][] {
  const batches: ArchiveEntry[][] = [];
  let current: ArchiveEntry[] = [];
  let bytes = 0;
  for (const entry of entries) {
    if (current.length && (bytes + entry.size > maxBytes || current.length >= maxCount)) {
      batches.push(current);
      current = [];
      bytes = 0;
    }
    current.push(entry);
    bytes += entry.size;
  }
  if (current.length) batches.push(current);
  return batches;
}
