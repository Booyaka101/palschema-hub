#!/usr/bin/env node
/**
 * extract-tables.mjs — read current row VALUES for every registry table
 * straight out of the game's own cooked DataTables.
 *
 * Maintainer tooling, not something an installer of palschema-validate needs:
 * the registry ships the extracted JSON. It needs a local Palworld install and
 * a Rust toolchain (once, to build tools/ooz-decompress — Palworld statically
 * links Oodle and ships no redistributable oo2core, so decompression uses the
 * pure-Rust oozextract crate).
 *
 * Values are DERIVED DATA: field names/types come from the published schemas,
 * and only numbers and identifiers are written out. No game asset is copied.
 *
 * Run: node scripts/extract-tables.mjs [--game <dir>] [--usmap <file>]
 *                                      [--out values] [--only DT_Foo,DT_Bar]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPak } from './lib/pak.mjs';
import { parseUsmap, structSchema } from './lib/usmap.mjs';
import { readDataTable } from './lib/uasset.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};

const DEFAULT_GAMES = [
  'D:/SteamLibrary/steamapps/common/Palworld',
  'C:/Program Files (x86)/Steam/steamapps/common/Palworld',
];
const gameDir = flag('--game', DEFAULT_GAMES.find((d) => existsSync(join(d, 'Pal/Content/Paks/Pal-Windows.pak'))));
const usmapPath = flag('--usmap', 'D:/tmp/palworld-export/Mappings.usmap');
const outDir = join(ROOT, flag('--out', 'values'));
const only = flag('--only') ? new Set(flag('--only').split(',')) : null;

function fail(message, hint) {
  console.error(`extract-tables: ${message}`);
  if (hint) console.error(`  ${hint}`);
  process.exit(1);
}

if (!gameDir) fail('no Palworld install found', 'pass --game <dir> pointing at the folder containing Pal/Content/Paks');
const pakPath = join(gameDir, 'Pal/Content/Paks/Pal-Windows.pak');
if (!existsSync(pakPath)) fail(`no pak at ${pakPath}`, 'pass --game <dir>');
if (!existsSync(usmapPath)) {
  fail(`no mappings file at ${usmapPath}`,
    'cooked packages carry no property names; pass --usmap <Mappings.usmap>');
}

// The Oodle helper is built on demand so a clone does not need Rust until it
// actually extracts.
const toolDir = join(ROOT, 'tools', 'ooz-decompress');
const exeName = process.platform === 'win32' ? 'ooz-decompress.exe' : 'ooz-decompress';
const exePath = join(toolDir, 'target', 'release', exeName);
if (!existsSync(exePath)) {
  console.log('  building tools/ooz-decompress (one time)...');
  try {
    execFileSync('cargo', ['build', '--release'], { cwd: toolDir, stdio: 'inherit', shell: process.platform === 'win32' });
  } catch {
    fail('could not build tools/ooz-decompress', 'install Rust (https://rustup.rs) — it is only needed to extract, not to use the registry');
  }
}

const usmap = parseUsmap(usmapPath);
// Schemas are looked up by struct name, tolerating the leading F the SDK headers
// use (FPalFieldLotteryName) which the mappings drop.
const schemaCache = new Map();
const schemaFor = (name) => {
  if (schemaCache.has(name)) return schemaCache.get(name);
  let s = structSchema(usmap, name);
  if (!s.size && name.startsWith('F')) s = structSchema(usmap, name.slice(1));
  schemaCache.set(name, s);
  return s;
};
const pak = openPak(pakPath);
console.log(`pak v${pak.footer.version}: ${pak.numEntries} entries · usmap v${usmap.version}: ${usmap.structs.size} structs`);

// Every published schema records the UE row struct it was derived from, so the
// registry itself says which struct to read each table with.
const schemaDir = join(ROOT, 'schemas', 'v1.0');
const tables = [];
for (const file of readdirSync(schemaDir)) {
  if (!file.startsWith('DT_') || !file.endsWith('.schema.json')) continue;
  const table = file.slice(0, -'.schema.json'.length);
  if (only && !only.has(table)) continue;
  const schema = JSON.parse(readFileSync(join(schemaDir, file), 'utf8'));
  const rowStruct = /rowStruct=([A-Za-z0-9_]+)/.exec(schema.$comment ?? '')?.[1];
  if (!rowStruct) { console.warn(`  ! ${table}: schema records no rowStruct — skipped`); continue; }
  tables.push({ table, rowStruct });
}

// Locate each table's asset in the pak by name.
const byName = new Map();
for (const p of pak.paths()) {
  const file = p.slice(p.lastIndexOf('/') + 1);
  if (file.endsWith('.uasset')) byName.set(file.slice(0, -'.uasset'.length), p.slice(0, -'.uasset'.length));
}

const staging = mkdtempSync(join(tmpdir(), 'psh-extract-'));
const jobs = [];
const planned = [];
for (const t of tables) {
  const base = byName.get(t.table);
  if (!base) { console.warn(`  ! ${t.table}: not present in the pak — skipped`); continue; }
  const uasset = pak.entry(`${base}.uasset`);
  const uexp = pak.entry(`${base}.uexp`);
  if (!uasset || !uexp) { console.warn(`  ! ${t.table}: missing .uasset/.uexp entry — skipped`); continue; }
  const paths = { uasset: join(staging, `${t.table}.uasset`), uexp: join(staging, `${t.table}.uexp`) };
  for (const [kind, entry] of [['uasset', uasset], ['uexp', uexp]]) {
    if (entry.method === 0) writeFileSync(paths[kind], pak.readStored(entry));
    else jobs.push(`FILE ${paths[kind]}`, ...pak.blocksFor(entry).map((b) => b.join(' ')));
  }
  planned.push({ ...t, paths, assetPath: base });
}

if (jobs.length) {
  const jobFile = join(staging, 'jobs.txt');
  writeFileSync(jobFile, jobs.join('\n') + '\n');
  execFileSync(exePath, [pakPath, jobFile], { stdio: ['ignore', 'ignore', 'inherit'] });
}

/**
 * Tables that do not extract today, with the reason. Kept as a ratchet rather
 * than a silent skip: anything failing OUTSIDE this list is a regression and
 * exits non-zero, and a table listed here that starts working should be removed.
 */
const KNOWN_UNSUPPORTED = {
  DT_TechnologyIconData: 'row struct FPalTechnologyIconData is absent from the mappings file',
  DT_TechnologyRecipeUnlock: 'row layout does not match the mapped struct (4 unaccounted bytes before the first value)',
  DT_MapObjectAssignData: 'row layout does not match the mapped struct',
};

mkdirSync(outDir, { recursive: true });
const index = [];
const failures = [];
const expected = [];
function record(table, message) {
  if (table in KNOWN_UNSUPPORTED) {
    expected.push(`${table}: ${KNOWN_UNSUPPORTED[table]}`);
    console.warn(`  - ${table.padEnd(38)} not supported (${KNOWN_UNSUPPORTED[table]})`);
  } else {
    failures.push(`${table}: ${message}`);
    console.error(`  ✗ ${table.padEnd(38)} ${message}`);
  }
}
for (const t of planned) {
  const schema = schemaFor(t.rowStruct);
  if (!schema.size) { record(t.table, `struct ${t.rowStruct} absent from the mappings`); continue; }
  try {
    const { rows, count } = readDataTable(t.paths.uasset, t.paths.uexp, schema, usmap, schemaFor);
    writeFileSync(join(outDir, `${t.table}.json`), JSON.stringify(rows, null, 1) + '\n');
    index.push({ table: t.table, rowStruct: t.rowStruct, rows: count, assetPath: `${t.assetPath}.uasset` });
    console.log(`  ✓ ${t.table.padEnd(38)} ${String(count).padStart(5)} rows`);
  } catch (e) {
    record(t.table, e.message);
  }
}

index.sort((a, b) => a.table.localeCompare(b.table));
writeFileSync(join(outDir, 'index.json'), JSON.stringify({
  $comment:
    'Current row VALUES for every registry table, read from the game\'s own cooked DataTables by ' +
    'scripts/extract-tables.mjs. Derived data only (numbers and identifiers); no game asset is redistributed. ' +
    'Field names and types are the published schemas in schemas/v1.0.',
  gameVersion: JSON.parse(readFileSync(join(ROOT, 'items.json'), 'utf8'))._provenance?.gameVersion ?? null,
  usmapVersion: usmap.version,
  pakVersion: pak.footer.version,
  generatedAt: new Date().toISOString().slice(0, 10),
  unsupported: Object.fromEntries(Object.entries(KNOWN_UNSUPPORTED).map(([t, why]) => [t, why])),
  tables: index,
}, null, 1) + '\n');

rmSync(staging, { recursive: true, force: true });
console.log(`\n${index.length} table(s) written to ${outDir}, ${index.reduce((n, t) => n + t.rows, 0)} rows total`);
if (failures.length) {
  console.error(`\n${failures.length} table(s) failed:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
