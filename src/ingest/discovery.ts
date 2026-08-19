/**
 * Works out what each uploaded file actually is.
 *
 * Extensions in Garmin exports are unreliable (`.fit` files inside `.zip`
 * inside `.zip`, JSON with no extension, `.csv` that is really TSV), so the
 * content is sniffed first and the extension is only a tiebreaker.
 */
import type { FileFormat } from '../core/types.ts';
import { looksLikeFit } from '../parsers/fit/decoder.ts';
import { xmlRootName } from '../parsers/xml/sax.ts';

export interface Detection {
  format: FileFormat;
  /** Sub-kind for the report, e.g. `gpx`, `tcx`, `gzip`. */
  variant?: string;
  reason: string;
  /** True for files we deliberately do not parse (images, PDFs, …). */
  ignore?: boolean;
}

const IGNORED_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp', 'heic',
  'pdf', 'mp3', 'mp4', 'mov', 'wav', 'm4a', 'zip.md5', 'txt.md5',
  'ttf', 'woff', 'woff2', 'exe', 'dmg', 'db', 'sqlite',
]);

export function extensionOf(name: string): string {
  const base = name.split('/').pop() ?? name;
  const idx = base.lastIndexOf('.');
  return idx <= 0 ? '' : base.slice(idx + 1).toLowerCase();
}

/** True for file types we never attempt to parse (images, media, binaries). */
export function isIgnoredExtension(name: string): boolean {
  return IGNORED_EXTENSIONS.has(extensionOf(name));
}

export function detectFormat(name: string, data: Uint8Array): Detection {
  const ext = extensionOf(name);
  if (IGNORED_EXTENSIONS.has(ext)) return { format: 'unknown', reason: `Ignored ${ext} file`, ignore: true };
  if (data.length === 0) return { format: 'unknown', reason: 'Empty file', ignore: true };

  // Binary signatures first — these are unambiguous.
  if (data.length >= 4 && data[0] === 0x50 && data[1] === 0x4b && (data[2] === 3 || data[2] === 5 || data[2] === 7)) {
    return { format: 'zip', reason: 'ZIP signature' };
  }
  if (data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b) {
    return { format: 'zip', variant: 'gzip', reason: 'gzip signature' };
  }
  if (looksLikeFit(data)) return { format: 'fit', reason: 'FIT header signature' };

  const head = decodeHead(data, 4096);
  const trimmed = head.replace(/^﻿/, '').trimStart();

  if (trimmed.startsWith('<')) {
    const root = xmlRootName(trimmed);
    if (root === 'gpx') return { format: 'gpx', reason: '<gpx> root element' };
    if (root === 'TrainingCenterDatabase') return { format: 'tcx', reason: '<TrainingCenterDatabase> root element' };
    if (ext === 'gpx') return { format: 'gpx', reason: 'XML with .gpx extension' };
    if (ext === 'tcx') return { format: 'tcx', reason: 'XML with .tcx extension' };
    return { format: 'unknown', variant: root, reason: `Unsupported XML root <${root ?? '?'}>` };
  }
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return { format: 'json', reason: 'JSON document' };
  }
  if (ext === 'csv' || ext === 'tsv' || looksLikeCsv(trimmed)) {
    return { format: 'csv', reason: ext ? `.${ext} file` : 'delimiter-separated text' };
  }
  if (ext === 'fit') return { format: 'unknown', reason: 'Named .fit but missing the FIT header' };
  return { format: 'unknown', reason: 'Unrecognised file type', ignore: !isProbablyText(trimmed) };
}

function decodeHead(data: Uint8Array, bytes: number): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(data.subarray(0, Math.min(bytes, data.length)));
}

function looksLikeCsv(head: string): boolean {
  const lines = head.split(/\r?\n/).filter((l) => l.trim()).slice(0, 5);
  if (lines.length < 2) return false;
  for (const delimiter of [',', ';', '\t']) {
    const counts = lines.map((l) => l.split(delimiter).length - 1);
    if (counts[0] >= 1 && counts.every((c) => c === counts[0])) return true;
  }
  return false;
}

function isProbablyText(head: string): boolean {
  if (!head) return false;
  let printable = 0;
  for (const ch of head.slice(0, 512)) {
    const code = ch.codePointAt(0)!;
    if (code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 0xfffd)) printable++;
  }
  return printable / Math.min(head.length, 512) > 0.9;
}
