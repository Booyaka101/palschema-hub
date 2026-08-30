/**
 * pak.mjs — read a UE "pak v11" archive index (Palworld's Pal-Windows.pak).
 *
 * Only what extraction needs: the footer, the primary index, the separately
 * offset FullDirectoryIndex (which is where the real path -> entry map lives),
 * and the per-file FPakEntry that carries the authoritative compression-block
 * table. Nothing here decompresses; Oodle blocks are handed to
 * tools/ooz-decompress (see extract-tables.mjs).
 *
 * Verified against Palworld 1.0.3: pak v11, unencrypted index, 185,014 entries
 * across 9,008 directories.
 */
import { openSync, readSync, closeSync, statSync } from 'node:fs';

const PAK_MAGIC = 0x5a6f12e1;
const FOOTER_SIZE = 221; // guid16 + enc1 + magic4 + ver4 + off8 + size8 + hash20 + 5x32 method names

class Reader {
  constructor(buf, off = 0) {
    this.b = buf;
    this.o = off;
  }
  u8() { return this.b[this.o++]; }
  i32() { const v = this.b.readInt32LE(this.o); this.o += 4; return v; }
  u32() { const v = this.b.readUInt32LE(this.o); this.o += 4; return v; }
  i64() { const v = Number(this.b.readBigInt64LE(this.o)); this.o += 8; return v; }
  u64() { return this.i64(); }
  raw(n) { const v = this.b.subarray(this.o, this.o + n); this.o += n; return v; }
  /** UE FString: positive length = UTF-8, negative = UTF-16, both NUL-terminated. */
  fstring() {
    const n = this.i32();
    if (n === 0) return '';
    if (n < 0) return this.raw(-n * 2).toString('utf16le').replace(/\0+$/, '');
    return this.raw(n).toString('utf8').replace(/\0+$/, '');
  }
}

export function readAt(path, offset, size) {
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.allocUnsafe(size);
    readSync(fd, buf, 0, size, offset);
    return buf;
  } finally {
    closeSync(fd);
  }
}

export function readFooter(pakPath) {
  const size = statSync(pakPath).size;
  const r = new Reader(readAt(pakPath, size - FOOTER_SIZE, FOOTER_SIZE));
  r.raw(16); // encryption key guid
  const encryptedIndex = r.u8();
  const magic = r.u32();
  if (magic !== PAK_MAGIC) throw new Error(`not a UE pak (magic ${magic.toString(16)})`);
  const version = r.u32();
  const indexOffset = r.u64();
  const indexSize = r.u64();
  r.raw(20); // index hash
  const methods = [];
  for (let i = 0; i < 5; i++) {
    const name = r.raw(32);
    const end = name.indexOf(0);
    methods.push(name.subarray(0, end < 0 ? 32 : end).toString('utf8'));
  }
  return { size, encryptedIndex, version, indexOffset, indexSize, methods };
}

/** Primary index: mount point, entry count, and the FullDirectoryIndex location. */
function readPrimaryIndex(pakPath, footer) {
  const r = new Reader(readAt(pakPath, footer.indexOffset, footer.indexSize));
  const mountPoint = r.fstring();
  const numEntries = r.i32();
  r.u64(); // path hash seed
  if (r.i32()) { r.i64(); r.i64(); r.raw(20); } // optional PathHashIndex
  let fdi = null;
  if (r.i32()) fdi = { offset: r.i64(), size: r.i64(), hash: r.raw(20) };
  const encoded = r.raw(r.i32());
  return { mountPoint, numEntries, fdi, encoded };
}

/** FullDirectoryIndex: directory -> { filename -> offset into the encoded blob }. */
function readDirectoryIndex(pakPath, fdi) {
  const r = new Reader(readAt(pakPath, fdi.offset, fdi.size));
  const tree = new Map();
  const dirs = r.i32();
  for (let i = 0; i < dirs; i++) {
    const dir = r.fstring();
    const files = new Map();
    const n = r.i32();
    for (let j = 0; j < n; j++) files.set(r.fstring(), r.i32());
    tree.set(dir, files);
  }
  return tree;
}

/**
 * The encoded index entry only gives offset/size/method; the block table that
 * extraction needs is the FPakEntry re-serialized at the file's own offset, so
 * that is what this returns. Block offsets there are relative to the entry.
 */
function readEntryHeader(pakPath, entryOffset) {
  const r = new Reader(readAt(pakPath, entryOffset, 4096));
  const offset = r.i64();
  const size = r.i64();
  const uncompressedSize = r.i64();
  const method = r.u32();
  r.raw(20); // hash
  const blocks = [];
  if (method !== 0) {
    const n = r.i32();
    for (let i = 0; i < n; i++) blocks.push({ start: r.i64(), end: r.i64() });
  }
  const encrypted = r.u8();
  const blockSize = r.u32();
  return { offset, size, uncompressedSize, method, blocks, encrypted, blockSize, headerLength: r.o };
}

/** Decoded index entry — enough to find the file's own FPakEntry header. */
function decodeEncodedEntry(blob, at) {
  const bits = blob.readUInt32LE(at);
  let p = at + 4;
  const read = (is32) => {
    const v = is32 ? blob.readUInt32LE(p) : Number(blob.readBigUInt64LE(p));
    p += is32 ? 4 : 8;
    return v;
  };
  const offset = read(bits & (1 << 31));
  read(bits & (1 << 30)); // uncompressed size, re-read from the entry header
  return { offset };
}

export function openPak(pakPath) {
  const footer = readFooter(pakPath);
  if (footer.encryptedIndex) throw new Error('pak index is encrypted — unsupported');
  const primary = readPrimaryIndex(pakPath, footer);
  if (!primary.fdi) throw new Error('pak has no full directory index — unsupported');
  const tree = readDirectoryIndex(pakPath, primary.fdi);

  /** Every path in the pak, as `<dir><file>`. */
  const paths = () => {
    const out = [];
    for (const [dir, files] of tree) for (const f of files.keys()) out.push(dir + f);
    return out;
  };

  /** Locate a file and return its entry header (with the block table). */
  const entry = (fullPath) => {
    const cut = fullPath.lastIndexOf('/') + 1;
    const files = tree.get(fullPath.slice(0, cut));
    const at = files?.get(fullPath.slice(cut));
    if (at === undefined) return null;
    const { offset } = decodeEncodedEntry(primary.encoded, at);
    const header = readEntryHeader(pakPath, offset);
    return { ...header, entryOffset: offset };
  };

  /**
   * Blocks as [absoluteOffset, compressedSize, uncompressedSize] for the Oodle
   * helper. An uncompressed (method 0) file is read directly instead.
   */
  const blocksFor = (e) => {
    let remaining = e.uncompressedSize;
    return e.blocks.map(({ start, end }) => {
      const uncompressed = Math.min(e.blockSize, remaining);
      remaining -= uncompressed;
      return [e.entryOffset + start, end - start, uncompressed];
    });
  };

  const readStored = (e) => readAt(pakPath, e.entryOffset + e.headerLength, e.size);

  return { footer, mountPoint: primary.mountPoint, numEntries: primary.numEntries, tree, paths, entry, blocksFor, readStored };
}
