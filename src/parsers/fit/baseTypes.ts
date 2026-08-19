/**
 * FIT base types (FIT protocol §4.4). The base-type byte packs an
 * endian-ability flag in bit 7 and the type number in bits 0-4.
 */

export interface BaseType {
  num: number;
  name: string;
  size: number;
  /** Reads one element; returns `undefined` when the value is the invalid sentinel. */
  read(view: DataView, offset: number, le: boolean): number | undefined;
}

const U8: BaseType = {
  num: 2,
  name: 'uint8',
  size: 1,
  read: (v, o) => {
    const x = v.getUint8(o);
    return x === 0xff ? undefined : x;
  },
};

export const BASE_TYPES: Record<number, BaseType> = {
  0: {
    num: 0,
    name: 'enum',
    size: 1,
    read: (v, o) => {
      const x = v.getUint8(o);
      return x === 0xff ? undefined : x;
    },
  },
  1: {
    num: 1,
    name: 'sint8',
    size: 1,
    read: (v, o) => {
      const x = v.getInt8(o);
      return x === 0x7f ? undefined : x;
    },
  },
  2: U8,
  3: {
    num: 3,
    name: 'sint16',
    size: 2,
    read: (v, o, le) => {
      const x = v.getInt16(o, le);
      return x === 0x7fff ? undefined : x;
    },
  },
  4: {
    num: 4,
    name: 'uint16',
    size: 2,
    read: (v, o, le) => {
      const x = v.getUint16(o, le);
      return x === 0xffff ? undefined : x;
    },
  },
  5: {
    num: 5,
    name: 'sint32',
    size: 4,
    read: (v, o, le) => {
      const x = v.getInt32(o, le);
      return x === 0x7fffffff ? undefined : x;
    },
  },
  6: {
    num: 6,
    name: 'uint32',
    size: 4,
    read: (v, o, le) => {
      const x = v.getUint32(o, le);
      return x === 0xffffffff ? undefined : x;
    },
  },
  7: {
    num: 7,
    name: 'string',
    size: 1,
    read: (v, o) => v.getUint8(o),
  },
  8: {
    num: 8,
    name: 'float32',
    size: 4,
    read: (v, o, le) => {
      const x = v.getFloat32(o, le);
      return Number.isNaN(x) ? undefined : x;
    },
  },
  9: {
    num: 9,
    name: 'float64',
    size: 8,
    read: (v, o, le) => {
      const x = v.getFloat64(o, le);
      return Number.isNaN(x) ? undefined : x;
    },
  },
  10: {
    num: 10,
    name: 'uint8z',
    size: 1,
    read: (v, o) => {
      const x = v.getUint8(o);
      return x === 0 ? undefined : x;
    },
  },
  11: {
    num: 11,
    name: 'uint16z',
    size: 2,
    read: (v, o, le) => {
      const x = v.getUint16(o, le);
      return x === 0 ? undefined : x;
    },
  },
  12: {
    num: 12,
    name: 'uint32z',
    size: 4,
    read: (v, o, le) => {
      const x = v.getUint32(o, le);
      return x === 0 ? undefined : x;
    },
  },
  13: {
    num: 13,
    name: 'byte',
    size: 1,
    read: (v, o) => {
      const x = v.getUint8(o);
      return x === 0xff ? undefined : x;
    },
  },
  14: {
    num: 14,
    name: 'sint64',
    size: 8,
    read: (v, o, le) => {
      const x = v.getBigInt64(o, le);
      return x === 0x7fffffffffffffffn ? undefined : Number(x);
    },
  },
  15: {
    num: 15,
    name: 'uint64',
    size: 8,
    read: (v, o, le) => {
      const x = v.getBigUint64(o, le);
      return x === 0xffffffffffffffffn ? undefined : Number(x);
    },
  },
  16: {
    num: 16,
    name: 'uint64z',
    size: 8,
    read: (v, o, le) => {
      const x = v.getBigUint64(o, le);
      return x === 0n ? undefined : Number(x);
    },
  },
};

export function baseTypeOf(byte: number): BaseType {
  return BASE_TYPES[byte & 0x1f] ?? BASE_TYPES[13];
}

export const STRING_BASE_TYPE = 7;
