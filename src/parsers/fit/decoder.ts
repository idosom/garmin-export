/**
 * A streaming FIT decoder.
 *
 * Implements the FIT protocol properly — file header(s), definition messages,
 * normal + compressed-timestamp data records, arrays, endianness, invalid
 * sentinels, chained FIT files and developer data — rather than pattern-matching
 * on bytes. Messages are handed to a callback as they are decoded so a 200 MB
 * monitoring file never has to exist as JS objects all at once.
 */
import { baseTypeOf, BASE_TYPES, STRING_BASE_TYPE } from './baseTypes.ts';
import { fitCrc } from './crc.ts';
import { fieldDef, mesgName, enumValue, type FitFieldDef } from './profile.ts';
import { fitTimestampToMs } from '../../core/time.ts';
import type { DeveloperFieldInfo } from '../../core/types.ts';

const SEMICIRCLE_TO_DEG = 180 / 2 ** 31;

export type FitValue = number | string | (number | string)[];

export interface DecodedMessage {
  mesgNum: number;
  name: string;
  /** False when the message number is not in our profile subset. */
  known: boolean;
  fields: Record<string, FitValue>;
  /** Field names that the profile could not name. */
  unknown: string[];
  /** Developer field names present on this message. */
  developer: string[];
  /** Epoch ms, when the message carried a timestamp. */
  timestamp?: number;
}

export interface FitDecodeSummary {
  ok: boolean;
  filesDecoded: number;
  protocolVersion?: number;
  profileVersion?: number;
  messageCounts: Record<string, number>;
  /** `mesg.field` names encountered. */
  fields: string[];
  unknownFields: string[];
  developerFields: DeveloperFieldInfo[];
  warnings: string[];
  bytesRead: number;
}

export interface FitDecodeOptions {
  onMessage(msg: DecodedMessage): void;
  /** Stop after this many warnings to keep pathological files cheap. */
  maxWarnings?: number;
}

interface FieldDefinition {
  num: number;
  size: number;
  baseTypeByte: number;
}

interface DevFieldDefinition {
  num: number;
  size: number;
  devIndex: number;
}

interface MessageDefinition {
  globalNum: number;
  littleEndian: boolean;
  fields: FieldDefinition[];
  devFields: DevFieldDefinition[];
  totalSize: number;
}

interface DevFieldMeta {
  name: string;
  units?: string;
  baseTypeByte: number;
  scale?: number;
  offset?: number;
  nativeMesgNum?: number;
  devIndex: number;
  fieldNum: number;
  count: number;
}

/** Quick sniff used by file discovery: `.FIT` at bytes 8..11. */
export function looksLikeFit(data: Uint8Array): boolean {
  if (data.length < 12) return false;
  const headerSize = data[0];
  if (headerSize !== 12 && headerSize !== 14) return false;
  return data[8] === 0x2e && data[9] === 0x46 && data[10] === 0x49 && data[11] === 0x54;
}

export function decodeFit(data: Uint8Array, opts: FitDecodeOptions): FitDecodeSummary {
  const maxWarnings = opts.maxWarnings ?? 50;
  const summary: FitDecodeSummary = {
    ok: false,
    filesDecoded: 0,
    messageCounts: {},
    fields: [],
    unknownFields: [],
    developerFields: [],
    warnings: [],
    bytesRead: 0,
  };
  const fieldsSeen = new Set<string>();
  const unknownSeen = new Set<string>();
  const devFields = new Map<string, DevFieldMeta>();

  const warn = (message: string) => {
    if (summary.warnings.length < maxWarnings) summary.warnings.push(message);
  };

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let pos = 0;

  while (pos + 12 <= data.length) {
    const headerSize = data[pos];
    if (headerSize !== 12 && headerSize !== 14) {
      if (summary.filesDecoded === 0) {
        warn(`Unexpected FIT header size ${headerSize} at byte ${pos}`);
      }
      break;
    }
    if (!(data[pos + 8] === 0x2e && data[pos + 9] === 0x46 && data[pos + 10] === 0x49 && data[pos + 11] === 0x54)) {
      if (summary.filesDecoded === 0) warn('Missing ".FIT" signature in file header');
      break;
    }
    const protocolVersion = data[pos + 1];
    const profileVersion = view.getUint16(pos + 2, true);
    let dataSize = view.getUint32(pos + 4, true);
    if (summary.filesDecoded === 0) {
      summary.protocolVersion = protocolVersion;
      summary.profileVersion = profileVersion;
    }

    if (headerSize === 14) {
      const headerCrc = view.getUint16(pos + 12, true);
      if (headerCrc !== 0 && headerCrc !== fitCrc(data, pos, pos + 12)) {
        warn('FIT header CRC mismatch — decoding anyway');
      }
    }

    const dataStart = pos + headerSize;
    if (dataSize === 0 || dataStart + dataSize > data.length) {
      const available = data.length - dataStart - 2;
      if (dataSize > 0) {
        warn(`Declared data size ${dataSize} exceeds file (truncated export?) — reading ${Math.max(0, available)} bytes`);
      }
      dataSize = Math.max(0, available);
      if (dataSize === 0) break;
    }
    const dataEnd = dataStart + dataSize;

    if (dataEnd + 2 <= data.length) {
      const fileCrc = view.getUint16(dataEnd, true);
      if (fileCrc !== 0 && fileCrc !== fitCrc(data, pos, dataEnd)) {
        warn('FIT file CRC mismatch — data may be corrupt, decoding anyway');
      }
    }

    decodeRecords(dataStart, dataEnd);
    summary.filesDecoded++;
    summary.bytesRead = dataEnd + 2;
    pos = dataEnd + 2;

    // Chained FIT files are allowed; anything else that follows is padding.
    if (pos + 12 > data.length) break;
  }

  summary.ok = summary.filesDecoded > 0;
  if (!summary.ok && !summary.warnings.length) warn('Not a FIT file');
  summary.fields = [...fieldsSeen].sort();
  summary.unknownFields = [...unknownSeen].sort();
  summary.developerFields = [...devFields.values()].map((d) => ({
    name: d.name,
    units: d.units,
    developerDataIndex: d.devIndex,
    fieldDefinitionNumber: d.fieldNum,
    nativeMesgNum: d.nativeMesgNum,
    count: d.count,
  }));
  return summary;

  function decodeRecords(start: number, end: number) {
    const defs = new Map<number, MessageDefinition>();
    let lastTimestampRaw: number | undefined;
    let p = start;

    while (p < end) {
      const header = data[p];
      p += 1;
      let localType: number;
      let compressedTimestamp: number | undefined;

      if (header & 0x80) {
        // Compressed timestamp header: 5-bit rolling offset from the last
        // absolute timestamp seen on this stream.
        localType = (header >> 5) & 0x03;
        const offset = header & 0x1f;
        if (lastTimestampRaw !== undefined) {
          const prevOffset = lastTimestampRaw & 0x1f;
          lastTimestampRaw += (offset - prevOffset) & 0x1f;
          compressedTimestamp = lastTimestampRaw;
        }
      } else if (header & 0x40) {
        localType = header & 0x0f;
        const hasDev = (header & 0x20) !== 0;
        const def = readDefinition(p, hasDev);
        if (!def) return;
        defs.set(localType, def.definition);
        p = def.next;
        continue;
      } else {
        localType = header & 0x0f;
      }

      const def = defs.get(localType);
      if (!def) {
        warn(`Data message for undefined local type ${localType} at byte ${p - 1} — stopping this file`);
        return;
      }
      if (p + def.totalSize > end) {
        warn('Truncated data message at end of file');
        return;
      }
      p = readDataMessage(def, p, compressedTimestamp);
    }

    function readDefinition(at: number, hasDev: boolean): { definition: MessageDefinition; next: number } | undefined {
      if (at + 5 > end) {
        warn('Truncated definition message');
        return undefined;
      }
      const littleEndian = data[at + 1] === 0;
      const globalNum = littleEndian ? view.getUint16(at + 2, true) : view.getUint16(at + 2, false);
      const numFields = data[at + 4];
      let q = at + 5;
      const fields: FieldDefinition[] = [];
      let totalSize = 0;
      for (let i = 0; i < numFields; i++) {
        if (q + 3 > end) {
          warn('Truncated field definitions');
          return undefined;
        }
        const fd = { num: data[q], size: data[q + 1], baseTypeByte: data[q + 2] };
        fields.push(fd);
        totalSize += fd.size;
        q += 3;
      }
      const devFieldDefs: DevFieldDefinition[] = [];
      if (hasDev) {
        if (q >= end) {
          warn('Truncated developer field header');
          return undefined;
        }
        const numDev = data[q];
        q += 1;
        for (let i = 0; i < numDev; i++) {
          if (q + 3 > end) {
            warn('Truncated developer field definitions');
            return undefined;
          }
          const dfd = { num: data[q], size: data[q + 1], devIndex: data[q + 2] };
          devFieldDefs.push(dfd);
          totalSize += dfd.size;
          q += 3;
        }
      }
      return {
        definition: { globalNum, littleEndian, fields, devFields: devFieldDefs, totalSize },
        next: q,
      };
    }

    function readDataMessage(def: MessageDefinition, at: number, compressedTs: number | undefined): number {
      const name = mesgName(def.globalNum);
      const known = name !== `mesg_${def.globalNum}`;
      const out: Record<string, FitValue> = {};
      const unknown: string[] = [];
      const developer: string[] = [];
      let timestamp: number | undefined;
      let p2 = at;

      for (const fd of def.fields) {
        const raw = readValue(fd.baseTypeByte, p2, fd.size, def.littleEndian);
        p2 += fd.size;
        if (raw === undefined) continue;

        if (fd.num === 253 && typeof raw === 'number') {
          lastTimestampRaw = raw;
        }
        const profile = fieldDef(def.globalNum, fd.num);
        const fieldName = profile?.name ?? `field_${fd.num}`;
        if (!profile) unknown.push(fieldName);
        const value = applyProfile(raw, profile);
        // A message may legitimately repeat a field number for array chunks;
        // last write wins, which matches the FIT SDK behaviour.
        out[fieldName] = value;
        fieldsSeen.add(`${name}.${fieldName}`);
        if (!profile) unknownSeen.add(`${name}.${fieldName}`);
        if (profile?.dateTime && fieldName === 'timestamp' && typeof value === 'number') timestamp = value;
      }

      for (const dfd of def.devFields) {
        const key = `${dfd.devIndex}-${dfd.num}`;
        const meta = devFields.get(key);
        const raw = readValue(meta?.baseTypeByte ?? 13, p2, dfd.size, def.littleEndian);
        p2 += dfd.size;
        if (raw === undefined) continue;
        const fieldName = meta?.name ?? `dev_${dfd.devIndex}_${dfd.num}`;
        const value = meta ? applyDevScale(raw, meta) : raw;
        const outName = fieldName in out ? `${fieldName}_dev` : fieldName;
        out[outName] = value;
        developer.push(outName);
        fieldsSeen.add(`${name}.${outName}`);
        if (meta) meta.count++;
        else {
          devFields.set(key, {
            name: fieldName,
            baseTypeByte: 13,
            devIndex: dfd.devIndex,
            fieldNum: dfd.num,
            count: 1,
          });
        }
      }

      if (timestamp === undefined && compressedTs !== undefined) {
        timestamp = fitTimestampToMs(compressedTs);
        out.timestamp = timestamp;
      }
      if (timestamp === undefined && typeof out.timestamp === 'number') timestamp = out.timestamp;

      if (def.globalNum === 206) registerDeveloperField(out);

      summary.messageCounts[name] = (summary.messageCounts[name] ?? 0) + 1;
      opts.onMessage({ mesgNum: def.globalNum, name, known, fields: out, unknown, developer, timestamp });
      return p2;
    }
  }

  function registerDeveloperField(fields: Record<string, FitValue>) {
    const devIndex = num(fields.developer_data_index);
    const fieldNum = num(fields.field_definition_number);
    if (devIndex === undefined || fieldNum === undefined) return;
    const key = `${devIndex}-${fieldNum}`;
    const existing = devFields.get(key);
    devFields.set(key, {
      name: typeof fields.field_name === 'string' && fields.field_name ? fields.field_name : `dev_${devIndex}_${fieldNum}`,
      units: typeof fields.units === 'string' ? fields.units : undefined,
      baseTypeByte: num(fields.fit_base_type_id) ?? 13,
      scale: num(fields.scale),
      offset: num(fields.offset),
      nativeMesgNum: num(fields.native_mesg_num),
      devIndex,
      fieldNum,
      count: existing?.count ?? 0,
    });
  }

  function readValue(baseTypeByte: number, at: number, size: number, le: boolean): FitValue | undefined {
    const typeNum = baseTypeByte & 0x1f;
    if (typeNum === STRING_BASE_TYPE) {
      let end = at;
      const limit = Math.min(at + size, data.length);
      while (end < limit && data[end] !== 0) end++;
      if (end === at) return undefined;
      const text = decoder.decode(data.subarray(at, end)).replace(/\0+$/, '').trim();
      return text === '' ? undefined : text;
    }
    const base = BASE_TYPES[typeNum] ?? BASE_TYPES[13];
    const count = Math.max(1, Math.floor(size / base.size));
    if (at + base.size > data.length) return undefined;
    if (count === 1) return base.read(view, at, le);
    const values: number[] = [];
    for (let i = 0; i < count; i++) {
      const o = at + i * base.size;
      if (o + base.size > data.length) break;
      const v = base.read(view, o, le);
      if (v !== undefined) values.push(v);
    }
    if (!values.length) return undefined;
    return values.length === 1 ? values[0] : values;
  }
}

function applyProfile(raw: FitValue, def: FitFieldDef | undefined): FitValue {
  if (typeof raw === 'string') return raw;
  const convert = (v: number): number | string => {
    if (!def) return v;
    if (def.semicircles) return v * SEMICIRCLE_TO_DEG;
    if (def.dateTime) return fitTimestampToMs(v);
    if (def.enum) return enumValue(def.enum, v);
    let out = v;
    if (def.scale) out /= def.scale;
    if (def.offset) out -= def.offset;
    return out;
  };
  if (Array.isArray(raw)) return raw.map((v) => (typeof v === 'number' ? convert(v) : v));
  return convert(raw);
}

function applyDevScale(raw: FitValue, meta: DevFieldMeta): FitValue {
  if (typeof raw === 'string') return raw;
  const convert = (v: number) => {
    let out = v;
    if (meta.scale) out /= meta.scale;
    if (meta.offset) out -= meta.offset;
    return out;
  };
  if (Array.isArray(raw)) return raw.map((v) => (typeof v === 'number' ? convert(v) : v));
  return convert(raw);
}

function num(v: FitValue | undefined): number | undefined {
  return typeof v === 'number' ? v : undefined;
}

export { baseTypeOf };
