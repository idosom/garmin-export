/**
 * A minimal FIT *encoder*.
 *
 * The app never writes FIT files for users, but building real binaries is the
 * only honest way to test the decoder (and to generate the built-in sample
 * export), so this lives in `src/` next to the decoder rather than in tests.
 */
import { BASE_TYPES } from './baseTypes.ts';
import { fitCrc } from './crc.ts';
import { fieldDef, FIT_ENUMS } from './profile.ts';
import { msToFitTimestamp } from '../../core/time.ts';

export interface EncodeField {
  num: number;
  baseType: number;
  value: number | number[] | string;
}

export interface EncodeDevField extends EncodeField {
  devIndex: number;
}

export interface EncodeMessage {
  mesgNum: number;
  fields: EncodeField[];
  devFields?: EncodeDevField[];
}

export interface EncodeOptions {
  headerSize?: 12 | 14;
  protocolVersion?: number;
  profileVersion?: number;
  /** Emit a deliberately wrong CRC — used to test defensive decoding. */
  corruptCrc?: boolean;
}

const utf8 = new TextEncoder();

function fieldSize(field: EncodeField): number {
  if (typeof field.value === 'string') return utf8.encode(field.value).length + 1;
  const base = BASE_TYPES[field.baseType & 0x1f] ?? BASE_TYPES[13];
  const count = Array.isArray(field.value) ? field.value.length : 1;
  return base.size * count;
}

function writeField(out: number[], field: EncodeField) {
  if (typeof field.value === 'string') {
    for (const b of utf8.encode(field.value)) out.push(b);
    out.push(0);
    return;
  }
  const base = BASE_TYPES[field.baseType & 0x1f] ?? BASE_TYPES[13];
  const values = Array.isArray(field.value) ? field.value : [field.value];
  const buf = new ArrayBuffer(base.size);
  const view = new DataView(buf);
  for (const v of values) {
    switch (base.name) {
      case 'enum':
      case 'uint8':
      case 'uint8z':
      case 'byte':
        view.setUint8(0, v & 0xff);
        break;
      case 'sint8':
        view.setInt8(0, v);
        break;
      case 'uint16':
      case 'uint16z':
        view.setUint16(0, v & 0xffff, true);
        break;
      case 'sint16':
        view.setInt16(0, v, true);
        break;
      case 'uint32':
      case 'uint32z':
        view.setUint32(0, v >>> 0, true);
        break;
      case 'sint32':
        view.setInt32(0, v, true);
        break;
      case 'float32':
        view.setFloat32(0, v, true);
        break;
      case 'float64':
        view.setFloat64(0, v, true);
        break;
      case 'sint64':
        view.setBigInt64(0, BigInt(Math.round(v)), true);
        break;
      case 'uint64':
      case 'uint64z':
        view.setBigUint64(0, BigInt(Math.round(v)), true);
        break;
      default:
        view.setUint8(0, v & 0xff);
    }
    for (let i = 0; i < base.size; i++) out.push(view.getUint8(i));
  }
}

function signature(msg: EncodeMessage): string {
  const fields = msg.fields.map((f) => `${f.num}:${f.baseType}:${fieldSize(f)}`).join(',');
  const dev = (msg.devFields ?? []).map((f) => `${f.devIndex}:${f.num}:${fieldSize(f)}`).join(',');
  return `${msg.mesgNum}|${fields}|${dev}`;
}

export function encodeFit(messages: EncodeMessage[], opts: EncodeOptions = {}): Uint8Array {
  const body: number[] = [];
  let currentSignature = '';

  for (const msg of messages) {
    const sig = signature(msg);
    if (sig !== currentSignature) {
      currentSignature = sig;
      const hasDev = !!msg.devFields?.length;
      body.push(0x40 | (hasDev ? 0x20 : 0)); // definition, local type 0
      body.push(0); // reserved
      body.push(0); // architecture: little endian
      body.push(msg.mesgNum & 0xff, (msg.mesgNum >> 8) & 0xff);
      body.push(msg.fields.length);
      for (const f of msg.fields) body.push(f.num, fieldSize(f), f.baseType);
      if (hasDev) {
        body.push(msg.devFields!.length);
        for (const f of msg.devFields!) body.push(f.num, fieldSize(f), f.devIndex);
      }
    }
    body.push(0x00); // data message, local type 0
    for (const f of msg.fields) writeField(body, f);
    for (const f of msg.devFields ?? []) writeField(body, f);
  }

  const headerSize = opts.headerSize ?? 14;
  const out = new Uint8Array(headerSize + body.length + 2);
  const view = new DataView(out.buffer);
  out[0] = headerSize;
  out[1] = opts.protocolVersion ?? 0x20;
  view.setUint16(2, opts.profileVersion ?? 2178, true);
  view.setUint32(4, body.length, true);
  out.set([0x2e, 0x46, 0x49, 0x54], 8);
  if (headerSize === 14) view.setUint16(12, fitCrc(out, 0, 12), true);
  out.set(body, headerSize);
  const crc = opts.corruptCrc ? 0x1234 : fitCrc(out, 0, headerSize + body.length);
  view.setUint16(headerSize + body.length, crc, true);
  return out;
}

/* ------------------------------------------------------- friendly builders */

/** Inverse of the decoder's profile transform, so fixtures can use real units. */
export function rawValue(mesgNum: number, fieldNum: number, value: number | string): number | string {
  if (typeof value === 'string') return value;
  const def = fieldDef(mesgNum, fieldNum);
  if (!def) return Math.round(value);
  if (def.semicircles) return Math.round(value / (180 / 2 ** 31));
  if (def.dateTime) return msToFitTimestamp(value);
  if (def.enum) {
    const table = FIT_ENUMS[def.enum];
    if (table) {
      for (const [k, v] of Object.entries(table)) if (v === String(value)) return Number(k);
    }
    return Math.round(value);
  }
  let out = value;
  if (def.offset) out += def.offset;
  if (def.scale) out *= def.scale;
  return Math.round(out);
}

/** Looks up an enum's numeric value by name, e.g. `enumRaw('sport','running')`. */
export function enumRaw(enumName: string, name: string): number {
  const table = FIT_ENUMS[enumName] ?? {};
  for (const [k, v] of Object.entries(table)) if (v === name) return Number(k);
  return 0;
}

export const BT = {
  enum: 0x00,
  sint8: 0x01,
  uint8: 0x02,
  sint16: 0x83,
  uint16: 0x84,
  sint32: 0x85,
  uint32: 0x86,
  string: 0x07,
  float32: 0x88,
  float64: 0x89,
  uint8z: 0x0a,
  uint16z: 0x8b,
  uint32z: 0x8c,
  byte: 0x0d,
} as const;
