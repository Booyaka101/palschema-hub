#!/usr/bin/env node
/**
 * build-nexus-zip.mjs — rebuild nexus/palschema-hub-registry.zip from the repo.
 *
 * The archive is the offline copy published on Nexus Mods: the whole registry
 * plus the CLI's built dist, runnable with zero dependencies (`--migrate` needs
 * none; validation asks for ajv and says so if it is missing). It used to be
 * assembled by hand, which is exactly why its README drifted a game version
 * behind the registry it ships.
 *
 * Contents mirror what the published v1.4 archive carried, so the layout modders
 * already downloaded does not move: everything lives under one
 * palschema-hub-registry/ root.
 *
 * Run: node scripts/build-nexus-zip.mjs [--check]
 *   --check  build to a temp file and report whether the committed zip matches
 *            the current repo contents (byte comparison of the entry list +
 *            each entry's bytes; zip timestamps are normalised either way).
 *
 * Requires cli/dist to be built (npm run cli:build).
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, posix, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'nexus', 'palschema-hub-registry.zip');
const PREFIX = 'palschema-hub-registry';

const FILES = ['index.html', 'items.html', 'diff.html', 'index.json', 'items.json', 'versions.json', 'LICENSE'];
const DIRS = ['schemas', 'structs', 'diffs'];
const CLI_FILES = [
  ['cli/package.json', 'cli/package.json'],
  ['cli/README.md', 'cli/README.md'],
  ['cli/dist/index.js', 'cli/dist/index.js'],
  ['cli/dist/core.js', 'cli/dist/core.js'],
];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(join(ROOT, dir)).sort()) {
    const rel = posix.join(dir, name);
    const abs = join(ROOT, rel);
    if (statSync(abs).isDirectory()) out.push(...walk(rel));
    else out.push(rel);
  }
  return out;
}

// Every file here is text, and a Windows checkout can hold CRLF where a Linux one
// holds LF (.gitattributes declares LF). Normalising means the archive built on a
// dev machine and the one CI verifies are the same bytes — without it, --check
// fails on Linux for a build that looked fine locally.
const TEXT_RE = /\.(json|md|txt|html|js|mjs|bbcode)$|LICENSE$/;

const entries = [];
const add = (repoPath, archivePath = repoPath) => {
  const abs = join(ROOT, repoPath.split('/').join(sep));
  if (!existsSync(abs)) throw new Error(`missing: ${repoPath}`);
  let data = readFileSync(abs);
  if (TEXT_RE.test(repoPath)) data = Buffer.from(data.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
  entries.push({ name: posix.join(PREFIX, archivePath), data });
};

add('nexus/REGISTRY_README.txt', 'README.txt');
for (const f of FILES) add(f);
for (const d of DIRS) for (const f of walk(d)) add(f);
for (const [src, dst] of CLI_FILES) add(src, dst);

// ---- minimal zip writer (deflate, fixed timestamp so builds are comparable) --
const DOS_TIME = 0x0000; // 00:00:00
const DOS_DATE = 0x2821; // 2020-01-01: constant, so two builds of the same content match
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const locals = [];
const central = [];
let offset = 0;
for (const e of entries) {
  const nameBuf = Buffer.from(e.name, 'utf8');
  const comp = deflateRawSync(e.data, { level: 9 });
  const crc = crc32(e.data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4); // version needed
  local.writeUInt16LE(0, 6); // flags
  local.writeUInt16LE(8, 8); // deflate
  local.writeUInt16LE(DOS_TIME, 10);
  local.writeUInt16LE(DOS_DATE, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(comp.length, 18);
  local.writeUInt32LE(e.data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  local.writeUInt16LE(0, 28);
  locals.push(local, nameBuf, comp);

  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0);
  cd.writeUInt16LE(20, 4);
  cd.writeUInt16LE(20, 6);
  cd.writeUInt16LE(0, 8);
  cd.writeUInt16LE(8, 10);
  cd.writeUInt16LE(DOS_TIME, 12);
  cd.writeUInt16LE(DOS_DATE, 14);
  cd.writeUInt32LE(crc, 16);
  cd.writeUInt32LE(comp.length, 20);
  cd.writeUInt32LE(e.data.length, 24);
  cd.writeUInt16LE(nameBuf.length, 28);
  cd.writeUInt32LE(0, 38); // external attrs
  cd.writeUInt32LE(offset, 42);
  central.push(cd, nameBuf);
  offset += local.length + nameBuf.length + comp.length;
}
const centralBuf = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(entries.length, 8);
end.writeUInt16LE(entries.length, 10);
end.writeUInt32LE(centralBuf.length, 12);
end.writeUInt32LE(offset, 16);
const zip = Buffer.concat([...locals, centralBuf, end]);

if (process.argv.includes('--check')) {
  const same = existsSync(OUT) && readFileSync(OUT).equals(zip);
  console.log(
    same
      ? `nexus archive is current (${entries.length} entries)`
      : `nexus archive is STALE — run: node scripts/build-nexus-zip.mjs (${entries.length} entries in a fresh build)`,
  );
  process.exit(same ? 0 : 1);
}

writeFileSync(OUT, zip);
console.log(`nexus/palschema-hub-registry.zip written: ${entries.length} entries, ${(zip.length / 1024).toFixed(0)} KB`);
