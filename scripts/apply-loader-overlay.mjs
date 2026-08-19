#!/usr/bin/env node
/**
 * apply-loader-overlay.mjs — merge PalSchema loader-implemented keys into the
 * published table schemas.
 *
 * PalSchema's pal loader (src/Loader/PalMonsterModLoader.cpp) accepts keys that
 * are not DT_PalMonsterParameter struct members — RanchActionData (0.6.4, PR
 * #143), IconAssetPath, Loot, Name, ... — so the SDK-header pipeline can never
 * derive them and a schema built from headers alone flags legal mods. The keys
 * live in structs/loader-overlay.json (read off PalSchema's source, with
 * provenance per entry); this script merges each loader's entries into that
 * loader's schema file.
 *
 * Idempotent: overlay-merged properties carry a "$comment" starting with the
 * shared MARKER; a re-run strips them and re-merges, so two runs are
 * byte-identical. augment-from-sdk.mjs preserves marked properties too.
 *
 * Run: node scripts/apply-loader-overlay.mjs [palworldVersion]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadOverlay, overlayFrag, isOverlayProp } from './lib/loader-overlay.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VER = process.argv[2] || '1.0';
const SCHEMA_DIR = join(ROOT, 'schemas', `v${VER}`);

const overlay = loadOverlay(ROOT);

// Group entries by the schema file their loader merges into. Only loaders that
// declare a schema participate (the raw loader has no loader-only keys).
const bySchema = new Map();
for (const entry of overlay.entries) {
  const target = overlay.loaders[entry.loader]?.schema;
  if (!target) {
    console.error(`  ! entry "${entry.key}" names loader "${entry.loader}" which has no schema mapping — skipped`);
    continue;
  }
  if (!bySchema.has(target)) bySchema.set(target, []);
  bySchema.get(target).push(entry);
}

for (const [schemaName, entries] of bySchema) {
  const schemaPath = join(SCHEMA_DIR, `${schemaName}.schema.json`);
  if (!existsSync(schemaPath)) {
    // PalStaticItemData.schema.json is emitted (overlay included) by
    // derive-loader-schemas.mjs; only pre-existing table schemas merge here.
    console.log(`  - ${schemaName}: no schema file — owned by derive-loader-schemas.mjs`);
    continue;
  }
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
  const props = schema.properties || {};

  // Rebuild: struct fields (minus previously merged overlay keys), overlay
  // entries in overlay-file order, then $Filters last (matching the augmenter).
  const rebuilt = {};
  for (const [k, v] of Object.entries(props)) {
    if (k === '$Filters' || isOverlayProp(v)) continue;
    rebuilt[k] = v;
  }
  for (const entry of entries) rebuilt[entry.key] = overlayFrag(entry);
  if (props.$Filters) rebuilt.$Filters = props.$Filters;
  schema.properties = rebuilt;

  const keys = entries.map((e) => e.key).join(',');
  const comment = String(schema.$comment || '').replace(/ \| loaderKeys=[^|]+$/, '').trimEnd();
  schema.$comment = `${comment} | loaderKeys=${keys}`;

  writeFileSync(schemaPath, JSON.stringify(schema, null, 2) + '\n');
  console.log(`  ✓ ${schemaName.padEnd(38)} +${entries.length} loader key(s): ${keys}`);
}
