#!/usr/bin/env node
/**
 * check-items.mjs — the gate that keeps items.json honest.
 *
 * Validates every row against schemas/v1.0/DT_ItemDataTable.schema.json
 * (ajv strict, additionalProperties:false — same config as the CLI) and
 * asserts the freshness invariants that would have caught the Jan-2024
 * staleness the day the game moved:
 *
 *   - count >= 2400 (paldb.cc listed 2466 rows for Palworld 1.0.3)
 *   - NO row carries `SortID` — the current game renamed it to `SortId`
 *   - at least one /^SFHelmet/ row — Hexolite Helmet's internal Code, a
 *     1.0-only item absent from the old 947-row file (freshness proof;
 *     row names are internal Codes, never display names)
 *   - >= 200 rows with a real ItemActorClass (not 'None')
 *   - `fieldSources` covers every row
 *
 * Usage: node scripts/check-items.mjs [path/to/items.json]
 * Exit 0 with a one-line summary; exit 1 listing every failed invariant
 * (schema failures capped at the first 20).
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2] ?? join(ROOT, 'items.json');

// ajv lives in cli/node_modules (zero root runtime deps) — resolve from there.
const requireFromCli = createRequire(pathToFileURL(join(ROOT, 'cli', 'package.json')));
let Ajv;
try {
  const mod = requireFromCli('ajv');
  Ajv = mod.default ?? mod;
} catch {
  console.error("FAIL: the 'ajv' package is required — run `npm install` in cli/ first (npm run cli:build).");
  process.exit(1);
}

let data;
try {
  data = JSON.parse(readFileSync(target, 'utf8'));
} catch (e) {
  console.error(`FAIL: could not read ${target} — ${e.message}`);
  process.exit(1);
}
if (!data.items || typeof data.items !== 'object') {
  console.error(`FAIL: ${target} has no items object`);
  process.exit(1);
}

const schema = JSON.parse(readFileSync(join(ROOT, 'schemas', 'v1.0', 'DT_ItemDataTable.schema.json'), 'utf8'));
const ajv = new Ajv({ strict: true, allErrors: true, allowUnionTypes: true, strictTypes: false });
const validate = ajv.compile(schema);

const failures = [];
const rows = Object.entries(data.items);

// 1. every row validates
let schemaFailures = 0;
for (const [rowName, row] of rows) {
  if (!validate(row)) {
    for (const err of validate.errors) {
      schemaFailures++;
      if (schemaFailures <= 20) {
        const extra = err.params?.additionalProperty ? ` ("${err.params.additionalProperty}")` : '';
        failures.push(`schema: ${rowName}${err.instancePath} ${err.message}${extra}`);
      }
    }
  }
}
if (schemaFailures > 20) failures.push(`schema: … ${schemaFailures - 20} more failure(s) suppressed`);

// 2. row count — 2466 in the live game at 1.0.3; under 2400 means stale/truncated
const count = rows.length;
if (count < 2400) failures.push(`count: only ${count} rows (need >= 2400 — paldb.cc listed 2466 at Palworld 1.0.3)`);
if (data.count !== count) failures.push(`count: declared count ${data.count} != actual ${count}`);

// 3. the dead field — SortID was renamed SortId; its presence means Jan-2024 data
const sortIDRows = rows.filter(([, row]) => 'SortID' in row).map(([n]) => n);
if (sortIDRows.length)
  failures.push(
    `SortID: ${sortIDRows.length} row(s) carry the dead field SortID (renamed SortId in the current game): ` +
      sortIDRows.slice(0, 5).join(', ')
  );

// 4. freshness marker — Hexolite Helmet (Code SFHelmet, SortId 1325) is 1.0-only
if (!rows.some(([n]) => /^SFHelmet/.test(n)))
  failures.push('freshness: no /^SFHelmet/ row (Hexolite Helmet, a 1.0-only item) — data predates Palworld 1.0');

// 5. asset-reference usefulness — the whole point of items.json
const actorRows = rows.filter(([, row]) => row.ItemActorClass && row.ItemActorClass !== 'None').length;
if (actorRows < 200) failures.push(`ItemActorClass: only ${actorRows} rows with a real actor class (need >= 200)`);

// 6. provenance completeness
const noSource = rows.filter(([n]) => !data.fieldSources?.[n]).map(([n]) => n);
if (noSource.length)
  failures.push(`fieldSources: ${noSource.length} row(s) uncovered: ${noSource.slice(0, 5).join(', ')}`);

if (failures.length) {
  console.error(`FAIL: ${target}`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log(
  `OK: ${count} rows, all schema-valid (ajv strict) · no SortID · SFHelmet present (1.0-fresh) · ` +
    `${actorRows} real ItemActorClass rows · fieldSources complete`
);
