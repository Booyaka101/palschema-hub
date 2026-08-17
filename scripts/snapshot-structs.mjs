#!/usr/bin/env node
/**
 * snapshot-structs.mjs — pin one Palworld version's row structs from its SDK commit.
 *
 * For a version listed in versions.json (which maps Palworld versions to the
 * localcc/PalworldModdingKit commits that regenerated Source/Pal/Public), this:
 *   1. Downloads the SDK tarball for that commit (public, unauthenticated:
 *      https://api.github.com/repos/localcc/PalworldModdingKit/tarball/<sha>,
 *      which redirects to codeload) into .cache/sdk-<version>.tar.gz.
 *   2. Extracts it with `tar -xzf` into .cache/sdk-<version>/ (skipped when the
 *      extracted SDK is already present).
 *   3. Parses every Source/Pal/Public/*.h that declares a
 *      `struct F<Name> : public FTableRowBase` — plus every rowStruct referenced
 *      by schemas/v1.0/_manifest.json (some rows inherit via intermediate bases) —
 *      using the same UPROPERTY parser the schema augmenter uses (lib/sdk-parse.mjs),
 *      so inherited fields are included and field ORDER is the struct order.
 *   4. Writes structs/<version>.json:
 *      { palworldVersion, sdkCommit, sdkDate, structs: { Name: { Field: "C++ type", ... } },
 *        tableToStruct: { DT_Table: Name, ... } }
 *
 * Run: node scripts/snapshot-structs.mjs <version>|all      (e.g. 0.7.2, 1.0, all)
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSdkParser } from './lib/sdk-parse.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CACHE = join(ROOT, '.cache');
const OUT_DIR = join(ROOT, 'structs');

const versionsInfo = JSON.parse(readFileSync(join(ROOT, 'versions.json'), 'utf8'));

const arg = process.argv[2];
if (!arg) {
  console.error('Usage: node scripts/snapshot-structs.mjs <version>|all');
  console.error(`Known versions: ${versionsInfo.order.join(', ')}`);
  process.exit(1);
}
if (arg !== 'all' && versionsInfo.aliases[arg]) {
  const a = versionsInfo.aliases[arg];
  console.error(`"${arg}" is an alias of ${a.of}: ${a.note}`);
  console.error(`Snapshot ${a.of} instead — the headers are identical.`);
  process.exit(1);
}
if (arg !== 'all' && !versionsInfo.versions[arg]) {
  console.error(`Unknown Palworld version "${arg}".`);
  console.error(`Known versions: ${versionsInfo.order.join(', ')}`);
  process.exit(1);
}

/** Locate the extracted SDK's Source/Pal/Public for a version, downloading if needed. */
async function ensureSdk(version, sdkCommit) {
  const extractDir = join(CACHE, `sdk-${version}`);
  // Tarball root is <owner>-<repo>-<sha>/ — its presence is the "extracted OK" marker
  // (a bare dir left by an interrupted run must not skip extraction).
  const findRoot = () =>
    existsSync(extractDir)
      ? readdirSync(extractDir).find((n) => existsSync(join(extractDir, n, 'Source', 'Pal', 'Public')))
      : undefined;
  let rootEntry = findRoot();
  if (!rootEntry) {
    mkdirSync(extractDir, { recursive: true });
    const tarball = join(CACHE, `sdk-${version}.tar.gz`);
    if (!existsSync(tarball)) {
      const url = `https://api.github.com/repos/${versionsInfo.repo}/tarball/${sdkCommit}`;
      console.log(`  downloading ${url} ...`);
      // Unauthenticated api.github.com is 60/hr per IP and this loop spends 12 of
      // them; GITHUB_TOKEN (when present, e.g. the auto-bump job) raises it to 5000.
      const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
      let res;
      try {
        res = await fetch(url, {
          redirect: 'follow',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
      } catch (e) {
        throw new Error(`network failure fetching SDK tarball for ${version}: ${e.message}`);
      }
      if (res.status === 403 || res.status === 429) {
        throw new Error(`GitHub rate limit hit (HTTP ${res.status}) fetching the ${version} tarball — wait a bit and rerun; already-downloaded versions are cached in .cache/.`);
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} fetching SDK tarball for ${version} (${url})`);
      writeFileSync(tarball, Buffer.from(await res.arrayBuffer()));
    }
    // Relative paths + cwd: GNU tar on Windows parses "D:\..." as a remote host.
    const tar = spawnSync('tar', ['-xzf', `sdk-${version}.tar.gz`, '-C', `sdk-${version}`], {
      cwd: CACHE,
      encoding: 'utf8',
    });
    if (tar.error || tar.status !== 0) {
      throw new Error(`tar -xzf failed for ${tarball}: ${tar.error?.message || tar.stderr}`);
    }
    rootEntry = findRoot();
    if (!rootEntry) throw new Error(`extracted SDK for ${version} has no Source/Pal/Public under ${extractDir}`);
  }
  return join(extractDir, rootEntry, 'Source', 'Pal', 'Public');
}

async function snapshot(version) {
  const { sdkCommit, sdkDate } = versionsInfo.versions[version];
  console.log(`Snapshotting Palworld ${version} (SDK ${versionsInfo.repo}@${sdkCommit}, ${sdkDate})`);
  const hdrDir = await ensureSdk(version, sdkCommit);
  const { parseStructFields, headerFor } = createSdkParser(hdrDir);

  // Struct set: every direct FTableRowBase row struct in the headers, plus every
  // rowStruct the v1.0 registry references (covers rows inheriting via a base).
  const structNames = new Set();
  for (const name of readdirSync(hdrDir)) {
    if (!name.endsWith('.h')) continue;
    const txt = readFileSync(join(hdrDir, name), 'utf8');
    const m = txt.match(/struct\s+F(\w+)\s*:\s*public\s+FTableRowBase/);
    if (m) structNames.add(m[1]);
  }
  const manifest = JSON.parse(readFileSync(join(ROOT, 'schemas', 'v1.0', '_manifest.json'), 'utf8'));
  for (const { rowStruct } of manifest.generatedTables) {
    if (headerFor(rowStruct)) structNames.add(rowStruct.replace(/^F/, ''));
  }

  const structs = {};
  for (const name of [...structNames].sort()) {
    const hp = headerFor(name);
    if (!hp) continue;
    const fields = parseStructFields(readFileSync(hp, 'utf8'));
    if (!fields.length) continue; // e.g. bare marker structs with no UPROPERTYs
    const obj = {};
    for (const f of fields) obj[f.name] = f.type; // insertion order = struct order
    structs[name] = obj;
  }

  const tableToStruct = {};
  for (const { table, rowStruct } of manifest.generatedTables) {
    const key = rowStruct.replace(/^F/, '');
    if (structs[key]) tableToStruct[table] = key;
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const out = { palworldVersion: version, sdkCommit, sdkDate, structs, tableToStruct };
  const outPath = join(OUT_DIR, `${version}.json`);
  writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');
  console.log(`  ✓ structs/${version}.json — ${Object.keys(structs).length} structs, ${Object.keys(tableToStruct).length} table mappings`);
}

const versions = arg === 'all' ? versionsInfo.order : [arg];
let failed = 0;
for (const v of versions) {
  try {
    await snapshot(v);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${v}: ${e.message}`);
  }
}
// Aliases get a struct file too (a copy of their pinned version's, marked aliasOf)
// so structs/<alias>.json never 404s on the Pages site.
if (arg === 'all') {
  for (const [alias, a] of Object.entries(versionsInfo.aliases)) {
    const srcPath = join(OUT_DIR, `${a.of}.json`);
    if (!existsSync(srcPath)) continue; // pinned snapshot failed above — already reported
    const snap = JSON.parse(readFileSync(srcPath, 'utf8'));
    const out = { palworldVersion: alias, aliasOf: a.of, aliasNote: a.note, ...snap };
    out.palworldVersion = alias;
    writeFileSync(join(OUT_DIR, `${alias}.json`), JSON.stringify(out, null, 2) + '\n');
    console.log(`  ✓ structs/${alias}.json — alias of ${a.of} (identical structs)`);
  }
}
if (failed) {
  console.error(`\n${failed} snapshot(s) failed.`);
  process.exit(1);
}
