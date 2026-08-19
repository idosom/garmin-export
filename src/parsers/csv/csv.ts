/** A defensive CSV reader: quoted fields, embedded newlines, BOM, `,`/`;`/tab. */

export interface CsvTable {
  headers: string[];
  rows: string[][];
  delimiter: string;
}

export function parseCsv(text: string): CsvTable {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const delimiter = sniffDelimiter(source);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let started = false;

  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (inQuotes) {
      if (c === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"' && !started) {
      inQuotes = true;
      started = true;
      continue;
    }
    if (c === delimiter) {
      row.push(field);
      field = '';
      started = false;
      continue;
    }
    if (c === '\n' || c === '\r') {
      if (c === '\r' && source[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      started = false;
      if (row.length > 1 || row[0].trim() !== '') rows.push(row);
      row = [];
      continue;
    }
    field += c;
    started = true;
  }
  if (field !== '' || row.length) {
    row.push(field);
    if (row.length > 1 || row[0].trim() !== '') rows.push(row);
  }

  const headers = (rows.shift() ?? []).map((h) => h.trim());
  return { headers, rows, delimiter };
}

function sniffDelimiter(text: string): string {
  const sample = text.slice(0, 8192).split(/\r?\n/).slice(0, 5).join('\n');
  const candidates = [',', ';', '\t', '|'];
  let best = ',';
  let bestScore = -1;
  for (const d of candidates) {
    let count = 0;
    let inQuotes = false;
    for (const c of sample) {
      if (c === '"') inQuotes = !inQuotes;
      else if (c === d && !inQuotes) count++;
    }
    if (count > bestScore) {
      bestScore = count;
      best = d;
    }
  }
  return best;
}

/** `Avg HR (bpm)` → `avghr`; used for tolerant header matching. */
export function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[®™]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

const MISSING = new Set(['', '--', '-', 'n/a', 'na', 'null', 'undefined', '...', '—']);

export function isMissing(value: string | undefined): boolean {
  return value === undefined || MISSING.has(value.trim().toLowerCase());
}

/**
 * Parses numbers written with either thousands separators (`1,234.5`) or a
 * decimal comma (`1234,5`) — Garmin CSVs follow the account locale.
 */
export function parseNumberLoose(value: string | undefined): number | undefined {
  if (isMissing(value)) return undefined;
  let s = value!.trim().replace(/[^\d.,+-]/g, '');
  if (!s) return undefined;
  const commas = (s.match(/,/g) ?? []).length;
  const dots = (s.match(/\./g) ?? []).length;
  if (commas && dots) {
    // Whichever appears last is the decimal separator.
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (commas === 1 && /,\d{1,2}$/.test(s)) {
    s = s.replace(',', '.');
  } else if (commas) {
    s = s.replace(/,/g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}
