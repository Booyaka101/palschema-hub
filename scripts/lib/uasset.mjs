/**
 * uasset.mjs — read the rows of a cooked UE5 DataTable (.uasset + .uexp).
 *
 * The package header (in .uasset) carries the name table; the export data (in
 * .uexp) carries the DataTable's own properties, then an int32 row count, then
 * one `FName + unversioned properties` per row.
 *
 * The row map is located by constraint rather than by a hard-coded offset: the
 * only accepted position is one where the declared row count and a clean parse
 * that lands EXACTLY on the trailing package tag agree. That double check is
 * what makes a mis-parse loud instead of silent — a wrong property layout drifts
 * and then fails to land, rather than quietly returning plausible garbage.
 */
import { readFileSync } from 'node:fs';

const PACKAGE_MAGIC = 0x9e2a83c1;

/** Value that cannot be represented as data; the field is omitted from the row. */
const UNRESOLVED = Symbol('unresolved');

class Reader {
  constructor(b, o = 0) { this.b = b; this.o = o; }
  u8() { return this.b[this.o++]; }
  u16() { const v = this.b.readUInt16LE(this.o); this.o += 2; return v; }
  u32() { const v = this.b.readUInt32LE(this.o); this.o += 4; return v; }
  i32() { const v = this.b.readInt32LE(this.o); this.o += 4; return v; }
  i64() { const v = Number(this.b.readBigInt64LE(this.o)); this.o += 8; return v; }
  f32() { const v = this.b.readFloatLE(this.o); this.o += 4; return v; }
  f64() { const v = this.b.readDoubleLE(this.o); this.o += 8; return v; }
  raw(n) { const v = this.b.subarray(this.o, this.o + n); this.o += n; return v; }
  fstring() {
    const n = this.i32();
    if (n === 0) return '';
    if (n < 0) return this.raw(-n * 2).toString('utf16le').replace(/\0+$/, '');
    return this.raw(n).toString('utf8').replace(/\0+$/, '');
  }
}

/** Package summary, far enough to reach the name table. */
export function readPackageNames(uassetPath) {
  const b = readFileSync(uassetPath);
  const r = new Reader(b);
  if (r.u32() !== PACKAGE_MAGIC) throw new Error('not a .uasset package');
  const legacy = r.i32();
  if (legacy !== -4) r.i32();
  r.i32(); // file version UE4
  if (legacy <= -8) r.i32(); // file version UE5
  r.i32(); // licensee version
  r.raw(r.i32() * 20); // custom versions (FGuid + int32 each)
  const totalHeaderSize = r.i32();
  const packageName = r.fstring();
  r.u32(); // package flags
  const nameCount = r.i32();
  const nameOffset = r.i32();

  const names = [];
  const nr = new Reader(b, nameOffset);
  for (let i = 0; i < nameCount; i++) {
    names.push(nr.fstring());
    nr.raw(4); // name hashes
  }
  return { names, packageName, totalHeaderSize };
}

/**
 * FUnversionedHeader. Fragments describe runs of present properties; the zero
 * mask marks the ones serialized as "default" with no bytes.
 *
 * Bit layout is the part worth guarding: SkipNum is the low 7 bits, HasZeroes is
 * 0x80, but ValueNum is `packed >> 9` and IsLast is `packed & 0x100`.
 */
function readUnversionedHeader(r) {
  const fragments = [];
  let zeroCount = 0;
  for (;;) {
    const packed = r.u16();
    const f = {
      skip: packed & 0x7f,
      hasZeroes: (packed & 0x80) !== 0,
      values: packed >> 9,
      isLast: (packed & 0x100) !== 0,
    };
    fragments.push(f);
    if (f.hasZeroes) zeroCount += f.values;
    if (f.isLast) break;
  }

  let zeroMask = [];
  if (zeroCount > 0) {
    let bits = 0n;
    let width;
    if (zeroCount <= 8) { bits = BigInt(r.u8()); width = 8; }
    else if (zeroCount <= 16) { bits = BigInt(r.u16()); width = 16; }
    else {
      const words = Math.ceil(zeroCount / 32);
      width = words * 32;
      for (let w = 0; w < words; w++) bits |= BigInt(r.u32()) << BigInt(32 * w);
    }
    zeroMask = Array.from({ length: width }, (_, i) => Number((bits >> BigInt(i)) & 1n));
  }

  const out = [];
  let index = 0;
  let zi = 0;
  for (const f of fragments) {
    index += f.skip;
    for (let i = 0; i < f.values; i++) {
      out.push({ index, isZero: f.hasZeroes ? !!zeroMask[zi++] : false });
      index++;
    }
  }
  return out;
}

const INT_TYPES = new Set(['IntProperty', 'Int64Property', 'Int16Property', 'Int8Property',
  'UInt32Property', 'UInt64Property', 'UInt16Property', 'ByteProperty']);

/**
 * Structs the engine serializes with a fixed binary layout instead of tagged or
 * unversioned properties. They appear in the mappings with X/Y/Z-style members
 * that are never written, so the member list cannot be trusted for these — the
 * list has to be explicit. UE5 vectors are doubles (large world coordinates).
 */
const NATIVE_STRUCTS = {
  Vector: (r) => ({ X: r.f64(), Y: r.f64(), Z: r.f64() }),
  Vector2D: (r) => ({ X: r.f64(), Y: r.f64() }),
  Rotator: (r) => ({ Pitch: r.f64(), Yaw: r.f64(), Roll: r.f64() }),
  Quat: (r) => ({ X: r.f64(), Y: r.f64(), Z: r.f64(), W: r.f64() }),
  IntPoint: (r) => ({ X: r.i32(), Y: r.i32() }),
  IntVector: (r) => ({ X: r.i32(), Y: r.i32(), Z: r.i32() }),
  Color: (r) => ({ B: r.u8(), G: r.u8(), R: r.u8(), A: r.u8() }),
  LinearColor: (r) => ({ R: r.f32(), G: r.f32(), B: r.f32(), A: r.f32() }),
  Guid: (r) => r.raw(16).toString('hex'),
  DateTime: (r) => r.i64(),
  Timespan: (r) => r.i64(),
};

function defaultValue(node, ctx) {
  if (INT_TYPES.has(node.type)) return 0;
  if (node.type === 'FloatProperty' || node.type === 'DoubleProperty') return 0;
  if (node.type === 'BoolProperty') return false;
  if (node.type === 'EnumProperty') return ctx.usmap.enums.get(node.enum)?.get(0) ?? null;
  if (node.type === 'NameProperty' || node.type === 'StrProperty' || node.type === 'SoftObjectProperty') return '';
  if (node.type === 'ArrayProperty' || node.type === 'SetProperty') return [];
  if (node.type === 'MapProperty') return {};
  if (node.type === 'StructProperty') {
    // A zeroed struct is still a struct — emitting null here would make the row
    // fail the published schema for a field the game simply left at default.
    const native = NATIVE_STRUCTS[node.struct];
    if (native) return native(new Reader(Buffer.alloc(64)));
    return {};
  }
  if (node.type === 'ObjectProperty') return UNRESOLVED;
  return null;
}

/** FName: name-table index plus an instance number (Foo_2 is stored as number 3). */
function readName(r, ctx) {
  const i = r.i32();
  const number = r.i32();
  const base = ctx.names[i] ?? `<name ${i}>`;
  return number === 0 ? base : `${base}_${number - 1}`;
}

function readValue(r, node, ctx) {
  switch (node.type) {
    case 'IntProperty': return r.i32();
    case 'UInt32Property': return r.u32();
    case 'FloatProperty': return Math.round(r.f32() * 1e6) / 1e6;
    case 'DoubleProperty': return r.f64();
    case 'BoolProperty': return r.u8() !== 0;
    case 'ByteProperty': case 'Int8Property': return r.u8();
    case 'Int16Property': case 'UInt16Property': return r.u16();
    case 'Int64Property': case 'UInt64Property': return r.i64();
    case 'StrProperty': return r.fstring();
    case 'NameProperty': return readName(r, ctx);
    case 'EnumProperty': {
      // Width comes from the underlying integer property, NOT always a byte:
      // EPalWazaID (392 values) and EPalTribeID (338) are UInt16.
      const raw = readValue(r, node.inner ?? { type: 'ByteProperty' }, ctx);
      return ctx.usmap.enums.get(node.enum)?.get(raw) ?? `${node.enum}::__${raw}`;
    }
    case 'ObjectProperty': {
      // A hard object reference is a package index, meaningless without the
      // import table. Consume it and report it as unresolved rather than
      // publishing a number that looks like data.
      r.i32();
      return UNRESOLVED;
    }
    case 'SoftObjectProperty': {
      // FSoftObjectPath = FTopLevelAssetPath (package + asset FNames) + subpath.
      const pkg = readName(r, ctx);
      const asset = readName(r, ctx);
      const sub = r.fstring();
      if (!pkg && !asset) return '';
      return (asset ? `${pkg}.${asset}` : pkg) + (sub ? `:${sub}` : '');
    }
    case 'ArrayProperty': case 'SetProperty': {
      const n = r.i32();
      const out = [];
      for (let i = 0; i < n; i++) out.push(readValue(r, node.inner, ctx));
      return out;
    }
    case 'StructProperty': {
      const native = NATIVE_STRUCTS[node.struct];
      if (native) return native(r);
      return readStructBody(r, node.struct, ctx);
    }
    default:
      throw new Error(`unhandled property type ${node.type}`);
  }
}

/** One struct serialized with unversioned properties (a row, or a nested struct). */
function readStructBody(r, structName, ctx) {
  const schema = ctx.schemaFor(structName);
  if (!schema.size) throw new Error(`struct ${structName} absent from the mappings`);
  const out = {};
  for (const { index, isZero } of readUnversionedHeader(r)) {
    const node = schema.get(index);
    if (!node) throw new Error(`property index ${index} absent from ${structName}`);
    const value = isZero ? defaultValue(node, ctx) : readValue(r, node, ctx);
    if (value !== UNRESOLVED) out[node.name] = value;
  }
  return out;
}

function readRows(buf, at, count, schema, ctx) {
  const r = new Reader(buf, at);
  const rows = {};
  for (let i = 0; i < count; i++) {
    const nameIndex = r.i32();
    const number = r.i32();
    if (nameIndex < 0 || nameIndex >= ctx.names.length) throw new Error('bad row name index');
    const base = ctx.names[nameIndex];
    const rowName = number === 0 ? base : `${base}_${number - 1}`;
    const row = {};
    for (const { index, isZero } of readUnversionedHeader(r)) {
      const node = schema.get(index);
      if (!node) throw new Error(`property index ${index} absent from schema`);
      const value = isZero ? defaultValue(node, ctx) : readValue(r, node, ctx);
      if (value !== UNRESOLVED) row[node.name] = value;
    }
    rows[rowName] = row;
  }
  return { rows, end: r.o };
}

/**
 * Read every row of a cooked DataTable. Throws unless the parse lands exactly on
 * the trailing package tag with the declared number of rows — a wrong property
 * layout drifts and fails that check rather than returning plausible garbage.
 */
export function readDataTable(uassetPath, uexpPath, schema, usmap, schemaFor) {
  const { names } = readPackageNames(uassetPath);
  const uexp = readFileSync(uexpPath);
  const targetEnd = uexp.length - 4; // trailing package tag
  const ctx = { names, usmap, schemaFor };

  const limit = Math.min(uexp.length - 8, 4096);
  let lastError = null;
  for (let start = 0; start < limit; start++) {
    const count = uexp.readInt32LE(start);
    if (count < 1 || count > 200000) continue;
    let parsed;
    try {
      parsed = readRows(uexp, start + 4, count, schema, ctx);
    } catch (e) {
      if (start < 64) lastError = e;
      continue;
    }
    if (parsed.end === targetEnd && Object.keys(parsed.rows).length === count) {
      return { rows: parsed.rows, count, rowMapOffset: start };
    }
  }
  throw new Error(`row map not found${lastError ? ` (${lastError.message})` : ''}`);
}
