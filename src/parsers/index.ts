/** Format dispatch: raw bytes → `ParseResult`. */
import type { FileFormat, ParseResult } from '../core/types.ts';
import { emptyParseResult } from '../core/types.ts';
import { parseFit } from './fit/index.ts';
import { parseGpx } from './gpx.ts';
import { parseTcx } from './tcx.ts';
import { parseGarminCsv } from './csv/garmin.ts';
import { parseGarminJson } from './json/garminJson.ts';

export function decodeText(data: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(data);
}

export function parseFile(name: string, data: Uint8Array, format: FileFormat): ParseResult {
  switch (format) {
    case 'fit':
      return parseFit(data);
    case 'gpx':
      return parseGpx(decodeText(data));
    case 'tcx':
      return parseTcx(decodeText(data));
    case 'csv':
      return parseGarminCsv(decodeText(data));
    case 'json':
      return parseGarminJson(decodeText(data), name);
    default: {
      const result = emptyParseResult('none');
      result.warnings.push(`No parser for ${format} files`);
      return result;
    }
  }
}

export { parseFit, parseGpx, parseTcx, parseGarminCsv, parseGarminJson };
