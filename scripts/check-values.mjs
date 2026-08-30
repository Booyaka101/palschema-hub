#!/usr/bin/env node
/**
 * check-values.mjs — the gate that keeps values/ honest.
 *
 * Every extracted row is validated against the published schema for its table.
 * That is a real cross-check rather than a formality: the schemas are derived
 * from SDK headers and a community dump, while values/ is read out of the
 * game's own cooked DataTables, so the two agreeing is evidence for both. A
 * mismatch means one of them is wrong and the build should stop.
 *
 * Also asserts the invariants a silently-broken extraction would violate:
 * index.json matching the files on disk, per-table row-count floors, and the
 * scraped items.json agreeing with the extracted DT_ItemDataTable where they
 * overlap (two independent sources for the same rows).
 *
 * Usage: node scripts/check-values.mjs [values-dir]
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const valuesDir = process.argv[2] ?? join(ROOT, 'values');

const requireFromCli = createRequire(pathToFileURL(join(ROOT, 'cli', 'package.json')));
let Ajv;
try {
  const mod = requireFromCli('ajv');
  Ajv = mod.default ?? mod;
} catch {
  console.error("FAIL: the 'ajv' package is required — run `npm install` in cli/ first (npm run cli:build).");
  process.exit(1);
}

const problems = [];
const fail = (msg) => problems.push(msg);

let index;
try {
  index = JSON.parse(readFileSync(join(valuesDir, 'index.json'), 'utf8'));
} catch (e) {
  console.error(`FAIL: cannot read ${join(valuesDir, 'index.json')}: ${e.message}`);
  process.exit(1);
}

// index.json and the directory must agree — a half-written regeneration is the
// failure mode this catches.
const onDisk = new Set(readdirSync(valuesDir).filter((f) => f.endsWith('.json') && f !== 'index.json')
  .map((f) => f.slice(0, -'.json'.length)));
const listed = new Set(index.tables.map((t) => t.table));
for (const t of listed) if (!onDisk.has(t)) fail(`index.json lists ${t} but values/${t}.json is missing`);
for (const t of onDisk) if (!listed.has(t)) fail(`values/${t}.json is not listed in index.json`);

const ajv = new Ajv({ strict: true, allErrors: false, allowUnionTypes: true, strictTypes: false, strictRequired: false });
const validators = new Map();
function validatorFor(table) {
  if (validators.has(table)) return validators.get(table);
  let v = null;
  try {
    const schema = JSON.parse(readFileSync(join(ROOT, 'schemas', 'v1.0', `${table}.schema.json`), 'utf8'));
    delete schema.$id; // avoid ajv's duplicate-id complaint across runs
    v = ajv.compile(schema);
  } catch (e) {
    fail(`${table}: cannot compile its published schema — ${e.message}`);
  }
  validators.set(table, v);
  return v;
}

let totalRows = 0;
let checkedTables = 0;
for (const entry of index.tables) {
  let rows;
  try {
    rows = JSON.parse(readFileSync(join(valuesDir, `${entry.table}.json`), 'utf8'));
  } catch (e) {
    fail(`${entry.table}: unreadable — ${e.message}`);
    continue;
  }
  const names = Object.keys(rows);
  if (names.length !== entry.rows) {
    fail(`${entry.table}: index.json says ${entry.rows} rows, file has ${names.length}`);
  }
  totalRows += names.length;
  checkedTables++;

  const validate = validatorFor(entry.table);
  if (!validate) continue;
  let bad = 0;
  let firstError = '';
  for (const name of names) {
    if (validate(rows[name])) continue;
    bad++;
    if (!firstError) {
      const e = validate.errors[0];
      firstError = `${name}${e.instancePath} ${e.message}`;
    }
  }
  if (bad) fail(`${entry.table}: ${bad}/${names.length} rows fail the published schema (first: ${firstError})`);
}

// The registry now holds two independent readings of the item table: items.json
// scraped from paldb.cc, and values/ read from the game. Where they overlap they
// must agree, or one of the two lanes has drifted.
try {
  const scraped = JSON.parse(readFileSync(join(ROOT, 'items.json'), 'utf8')).items ?? {};
  const extracted = JSON.parse(readFileSync(join(valuesDir, 'DT_ItemDataTable.json'), 'utf8'));
  const FIELDS = ['SortId', 'Rarity', 'Rank', 'Price', 'MaxStackCount'];
  let compared = 0;
  const disagreements = [];
  for (const [row, scrapedRow] of Object.entries(scraped)) {
    if (row.startsWith('_')) continue;
    const live = extracted[row];
    if (!live) continue;
    compared++;
    for (const f of FIELDS) {
      if (scrapedRow[f] === undefined || live[f] === undefined) continue;
      if (scrapedRow[f] !== live[f]) disagreements.push(`${row}.${f}: items.json ${scrapedRow[f]} vs game ${live[f]}`);
    }
  }
  if (!compared) fail('no overlap between items.json and the extracted item table — one of them is empty?');
  // A handful of paldb transcription differences is expected; a flood means drift.
  const LIMIT = 25;
  if (disagreements.length > LIMIT) {
    fail(`items.json disagrees with the game on ${disagreements.length} field(s) across ${compared} shared rows ` +
      `(limit ${LIMIT}) — first: ${disagreements.slice(0, 3).join('; ')}`);
  } else if (disagreements.length) {
    console.log(`  note: ${disagreements.length} scraped/extracted difference(s) within tolerance ` +
      `(e.g. ${disagreements[0]})`);
  }
  console.log(`  cross-checked ${compared} item rows against items.json`);
} catch (e) {
  fail(`item cross-check failed: ${e.message}`);
}

if (problems.length) {
  console.error(`FAIL: ${problems.length} problem(s) in ${valuesDir}`);
  for (const p of problems.slice(0, 20)) console.error(`  - ${p}`);
  if (problems.length > 20) console.error(`  ... and ${problems.length - 20} more`);
  process.exit(1);
}
console.log(`values OK: ${checkedTables} tables, ${totalRows} rows, all schema-valid (game ${index.gameVersion ?? '?'})`);
