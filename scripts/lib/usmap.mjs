/**
 * usmap.mjs — parse an Unreal ".usmap" mappings file (v4).
 *
 * Cooked UE5 packages serialize properties *unversioned*: the stream carries no
 * names or types, only an index into the class's property schema. The usmap is
 * that schema, so it is what makes reading a cooked DataTable possible at all.
 *
 * Two layout details cost real time and both parse plausibly before desyncing,
 * so they are called out here: `bHasVersioning` is an int32 (not a byte), and
 * the per-enum value COUNT is a uint16 (LargeEnums, v>=3) while each value entry
 * stays 12 bytes — an int64 value followed by an int32 name index.
 */
import { readFileSync } from 'node:fs';

const USMAP_MAGIC = 0x30c4;

const PROPERTY_TYPES = [
  'ByteProperty', 'BoolProperty', 'IntProperty', 'FloatProperty', 'ObjectProperty', 'NameProperty',
  'DelegateProperty', 'DoubleProperty', 'ArrayProperty', 'StructProperty', 'StrProperty', 'TextProperty',
  'InterfaceProperty', 'MulticastDelegateProperty', 'WeakObjectProperty', 'LazyObjectProperty',
  'AssetObjectProperty', 'SoftObjectProperty', 'UInt64Property', 'UInt32Property', 'UInt16Property',
  'Int64Property', 'Int16Property', 'Int8Property', 'MapProperty', 'SetProperty', 'EnumProperty',
  'FieldPathProperty', 'OptionalProperty', 'Utf8StrProperty', 'AnsiStrProperty',
];

export function parseUsmap(path) {
  const b = readFileSync(path);
  if (b.readUInt16LE(0) !== USMAP_MAGIC) throw new Error('not a .usmap file');
  const version = b[2];
  let o = 3;
  const hasVersioning = b.readInt32LE(o); o += 4; // int32, not a byte
  if (hasVersioning) throw new Error('versioned .usmap is not supported');
  const compression = b[o]; o += 1;
  o += 8; // compressed + decompressed size
  if (compression !== 0) throw new Error(`compressed .usmap (method ${compression}) is not supported`);

  const longName = version >= 2;   // UsmapVersion::LongFName
  const largeEnums = version >= 3; // UsmapVersion::LargeEnums
  const rdLen = () => { const v = longName ? b.readUInt16LE(o) : b[o]; o += longName ? 2 : 1; return v; };
  const rdStr = (n) => { const s = b.toString('utf8', o, o + n); o += n; return s; };
  const rdI32 = () => { const v = b.readInt32LE(o); o += 4; return v; };
  const rdU16 = () => { const v = b.readUInt16LE(o); o += 2; return v; };

  const names = [];
  for (let i = 0, n = b.readUInt32LE(o), _ = (o += 4); i < n; i++) names.push(rdStr(rdLen()));
  const rdName = () => { const i = rdI32(); return i === -1 ? null : names[i]; };

  const enums = new Map();
  for (let i = 0, n = b.readUInt32LE(o), _ = (o += 4); i < n; i++) {
    const enumName = rdName();
    const count = largeEnums ? rdU16() : b[o++];
    const values = new Map();
    for (let v = 0; v < count; v++) {
      const value = Number(b.readBigInt64LE(o)); o += 8;
      values.set(value, rdName());
    }
    enums.set(enumName, values);
  }

  const rdType = () => {
    const type = PROPERTY_TYPES[b[o++]];
    const node = { type };
    if (type === 'EnumProperty') { node.inner = rdType(); node.enum = rdName(); }
    else if (type === 'StructProperty') node.struct = rdName();
    else if (type === 'SetProperty' || type === 'ArrayProperty' || type === 'OptionalProperty') node.inner = rdType();
    else if (type === 'MapProperty') { node.inner = rdType(); node.value = rdType(); }
    return node;
  };

  const structs = new Map();
  for (let i = 0, n = b.readUInt32LE(o), _ = (o += 4); i < n; i++) {
    const name = rdName();
    const superName = rdName();
    const propCount = rdU16();
    const serializable = rdU16();
    const props = new Map();
    for (let p = 0; p < serializable; p++) {
      const index = rdU16();
      const arraySize = b[o++];
      const propName = rdName();
      const type = rdType();
      for (let k = 0; k < arraySize; k++) props.set(index + k, { name: propName, arrayIndex: k, arraySize, ...type });
    }
    structs.set(name, { super: superName, propCount, props });
  }
  return { version, names, enums, structs };
}

/** Flattened schema for a struct, base class first, keyed by serialization index. */
export function structSchema(usmap, name) {
  const chain = [];
  for (let n = name; n; ) {
    const s = usmap.structs.get(n);
    if (!s) break;
    chain.push([n, s]);
    n = s.super;
  }
  chain.reverse();
  const out = new Map();
  let base = 0;
  for (const [owner, s] of chain) {
    for (const [idx, p] of s.props) out.set(base + idx, { ...p, owner });
    base += s.propCount;
  }
  return out;
}
