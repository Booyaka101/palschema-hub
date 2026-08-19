#!/usr/bin/env node
/**
 * check-buildings.mjs — the buildings.json gate (npm run check:buildings).
 *
 * Asserts the shipped file is schema-valid and still looks like current-game
 * data: every routed field validates against the table schema that declares it
 * (ajv, same strict config as the CLI), the row count is plausible, and the
 * spot-checks verified live on 2026-08-19 hold (HatchingPalEgg Hp 2000,
 * DeteriorationDamage 0.04, both build tables populated, materials mapped).
 *
 * Optional file argument validates a fixture instead (used by the test suite).
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = process.argv[2] ?? join(ROOT, 'buildings.json');

const require = createRequire(join(ROOT, 'cli', 'node_modules', 'x.js'));
const Ajv = require('ajv');
const ajv = new Ajv({ strict: true, allErrors: true, allowUnionTypes: true, strictTypes: false });

const fail = (m) => {
  console.error('FAIL: ' + m);
  process.exit(1);
};

let data;
try {
  data = JSON.parse(readFileSync(FILE, 'utf8'));
} catch (e) {
  fail(`${FILE} is not valid JSON — ${e.message}`);
}

const TABLES = ['DT_MapObjectMasterDataTable', 'DT_BuildObjectDataTable'];
const validators = {};
const schemaFields = {};
for (const t of TABLES) {
  const schema = JSON.parse(readFileSync(join(ROOT, 'schemas', 'v1.0', `${t}.schema.json`), 'utf8'));
  schemaFields[t] = new Set(Object.keys(schema.properties));
  validators[t] = ajv.compile(schema);
}

const rows = Object.entries(data.buildings ?? {});
if (data._provenance?.valuesCurrent !== true) fail('_provenance.valuesCurrent is not true');
if (!/^\d+(\.\d+)+$/.test(data._provenance?.gameVersion ?? '')) fail('_provenance.gameVersion missing/malformed');

const errors = [];
let populatedBoth = 0;
let mappedMaterials = 0;
let totalMaterials = 0;
for (const [code, b] of rows) {
  for (const t of TABLES) {
    const fields = b.tables?.[t] ?? {};
    for (const f of Object.keys(fields)) {
      if (!schemaFields[t].has(f)) errors.push(`${code}: field "${f}" routed to ${t} but the schema does not declare it`);
    }
    if (!validators[t](fields)) {
      for (const e of validators[t].errors) errors.push(`${code} ${t}${e.instancePath}: ${e.message}`);
    }
  }
  if (Object.keys(b.tables?.[TABLES[0]] ?? {}).length && Object.keys(b.tables?.[TABLES[1]] ?? {}).length) populatedBoth++;
  for (const m of b.materials ?? []) {
    totalMaterials++;
    if (m.code) mappedMaterials++;
  }
}
if (errors.length) fail(`${errors.length} schema violation(s):\n  ` + errors.slice(0, 15).join('\n  '));
if (rows.length < 150) fail(`only ${rows.length} buildings (need >= 150)`);
if (populatedBoth / rows.length < 0.8) {
  fail(`only ${populatedBoth}/${rows.length} buildings have BOTH build tables populated — parse likely broke`);
}

// Spot checks pinned to values read off the live page on 2026-08-19.
const egg = data.buildings.HatchingPalEgg;
if (!egg) fail('HatchingPalEgg (Egg Incubator) missing');
if (egg.tables.DT_MapObjectMasterDataTable.Hp !== 2000) fail(`HatchingPalEgg Hp = ${egg.tables.DT_MapObjectMasterDataTable.Hp}, expected 2000`);
if (egg.tables.DT_MapObjectMasterDataTable.DeteriorationDamage !== 0.04)
  fail(`HatchingPalEgg DeteriorationDamage = ${egg.tables.DT_MapObjectMasterDataTable.DeteriorationDamage}, expected 0.04`);
if (egg.tables.DT_BuildObjectDataTable.TypeB !== 'EPalBuildObjectTypeB::Pal_Breed')
  fail(`HatchingPalEgg TypeB = ${egg.tables.DT_BuildObjectDataTable.TypeB}`);
if (!(egg.materials ?? []).length) fail('HatchingPalEgg has no materials');

console.log(
  `OK: ${rows.length} buildings (Palworld ${data._provenance.gameVersion}) · all routed fields schema-valid · ` +
    `${populatedBoth} with both tables · materials: ${mappedMaterials}/${totalMaterials} mapped to item Codes`
);
