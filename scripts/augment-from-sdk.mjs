#!/usr/bin/env node
/**
 * augment-from-sdk.mjs — Bring the paldex-derived schemas up to the CURRENT game.
 *
 * The paldex FModel dump (schema seed) dates from Jan 2024 (Palworld 0.1.x).
 * The decompiled game SDK `localcc/PalworldModdingKit` (pushed 2026-07-11) has the
 * current row structs, so mods written for today's game were hitting false
 * "unknown field" errors (e.g. InstallMaxNumInBaseCamp, CraftExpRate, ItemId6).
 *
 * For every schema in schemas/v<ver>/ this script:
 *   1. Finds the row struct header  .cache/<sdk>/Source/Pal/Public/<Struct>.h
 *   2. Parses its UPROPERTY fields (names + C++ types) — authoritative for the
 *      current game build.
 *   3. ADDS fields the dump didn't have (typed per PalSchema's own
 *      JsonSchemaGenerator.cpp conventions: int→integer, float→number,
 *      FName/FString/FText→string, bool→boolean, E*→string(+observed values),
 *      object/class refs→string|object, TArray<T>→oneOf[array, {Items:array}]).
 *   4. REMOVES fields the current struct no longer has (they'd validate mods
 *      that the game now ignores).
 *   5. Upgrades ALL array-typed fields (old + new) to the wrapper-tolerant
 *      oneOf form — PalSchema officially accepts both `[..]` and `{"Items":[..]}`
 *      (see ParseArrayPropertyInfo in PalSchema's JsonSchemaGenerator.cpp).
 *
 * Run: node scripts/augment-from-sdk.mjs [palworldVersion]
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSdkParser, arrayFrag } from './lib/sdk-parse.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const VER = process.argv[2] || '1.0';
const SCHEMA_DIR = join(ROOT, 'schemas', `v${VER}`);

// Locate the extracted SDK (any localcc-PalworldModdingKit-* under .cache/)
const cacheEntries = existsSync(join(ROOT, '.cache')) ? readdirSync(join(ROOT, '.cache')) : [];
const sdkDirName = cacheEntries.find((n) => n.startsWith('localcc-PalworldModdingKit-'));
if (!sdkDirName) {
  console.error('SDK not found in .cache/. Download with:');
  console.error('  curl -sL -o .cache/sdk.tar.gz https://api.github.com/repos/localcc/PalworldModdingKit/tarball/main && tar -xzf .cache/sdk.tar.gz -C .cache/');
  process.exit(1);
}
const SDK_COMMIT = sdkDirName.split('-').pop();
const HDR_DIR = join(ROOT, '.cache', sdkDirName, 'Source', 'Pal', 'Public');
const SDK_TAG = `localcc/PalworldModdingKit@${SDK_COMMIT}`;

/* C++ header parsing + C++ type -> JSON Schema mapping live in lib/sdk-parse.mjs
 * (shared with snapshot-structs.mjs); the parser is bound to this SDK's headers. */
const { parseStructFields, headerFor, fragForType } = createSdkParser(HDR_DIR);

/* ---------------- merge ---------------- */

/** True if a derived fragment is (or unions with) an array type. */
const isArrayish = (frag) => frag.type === 'array' || (Array.isArray(frag.type) && frag.type.includes('array'));

const manifest = JSON.parse(readFileSync(join(SCHEMA_DIR, '_manifest.json'), 'utf8'));
const report = [];

for (const entry of manifest.generatedTables) {
  const { table, rowStruct } = entry;
  const schemaPath = join(SCHEMA_DIR, `${table}.schema.json`);
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
  const hp = headerFor(rowStruct);
  if (!hp) {
    report.push({ table, rowStruct, status: 'NO SDK HEADER — left untouched' });
    continue;
  }
  const sdkFields = parseStructFields(readFileSync(hp, 'utf8'));
  if (!sdkFields.length) {
    report.push({ table, rowStruct, status: 'HEADER PARSE EMPTY — left untouched' });
    continue;
  }
  const sdkNames = new Set(sdkFields.map((f) => f.name));
  const oldProps = schema.properties || {};
  const added = [];
  const removed = [];
  const newProps = {};

  // SDK field order is the authoritative struct order — rebuild in that order.
  for (const f of sdkFields) {
    const existing = oldProps[f.name];
    if (existing) {
      if (/^TArray</.test(f.type) || isArrayish(existing)) {
        // Upgrade to wrapper-tolerant form, preserving observed item schema/examples.
        const items = existing.items ?? (/^TArray<\s*(.+)\s*>$/.test(f.type) ? fragForType(f.type.match(/^TArray<\s*(.+)\s*>$/)[1], 1) : {});
        newProps[f.name] = arrayFrag(items, existing.description?.startsWith('Example') ? existing.description : undefined);
      } else {
        newProps[f.name] = existing; // observed data (with examples) beats a bare type map
      }
    } else {
      const frag = fragForType(f.type);
      frag.description = `${frag.description ?? f.type} — current-game field (absent from Jan-2024 dump), verified from SDK headers`;
      newProps[f.name] = frag;
      added.push(f.name);
    }
  }
  for (const name of Object.keys(oldProps)) {
    if (name !== '$Filters' && !sdkNames.has(name)) removed.push(name);
  }

  // PalSchema's raw loader skips a "$Filters" key inside any row (wildcard/filter
  // metadata — PalRawTableLoader.cpp: `if (key == "$Filters") continue;`), so it
  // must never be flagged as an unknown field.
  newProps['$Filters'] = {
    description:
      'PalSchema row-filter metadata (used with wildcard row keys); ignored as a row field by the loader.',
  };

  schema.properties = newProps;
  schema.description = schema.description.replace(/ Field names authoritative.*$/, '') +
    ` Field names verified against the current game's row struct (${SDK_TAG}, pushed 2026-07-11); ` +
    `types inferred from game data (Jan-2024 dump) for long-standing fields and mapped from C++ for newer ones. ` +
    `Fields are optional (partial patches).`;
  schema.$comment = `palschema-hub | table=${table} | rowStruct=${rowStruct} | palworldVersion=${VER} | fields=${sdkFields.length} | source=paldex-dump+sdk-headers | sdk=${SDK_TAG}` +
    (added.length ? ` | sdkAdded=${added.join(',')}` : '') +
    (removed.length ? ` | droppedRemovedFields=${removed.join(',')}` : '');
  writeFileSync(schemaPath, JSON.stringify(schema, null, 2) + '\n');
  entry.fields = sdkFields.length;
  report.push({ table, rowStruct, status: 'ok', fields: sdkFields.length, added: added.length, removed: removed.length, addedNames: added, removedNames: removed });
}

manifest.source = `derived-from-paldex + field-verified-against-${SDK_TAG}`;
manifest.sdk = { repo: 'localcc/PalworldModdingKit', commit: SDK_COMMIT, pushedAt: '2026-07-11' };
writeFileSync(join(SCHEMA_DIR, '_manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

for (const r of report) {
  if (r.status !== 'ok') {
    console.log(`  ! ${r.table.padEnd(38)} ${r.status}`);
  } else {
    console.log(`  ✓ ${r.table.padEnd(38)} fields=${String(r.fields).padStart(3)} +${r.added} -${r.removed}` +
      (r.added ? `  added: ${r.addedNames.join(', ')}` : '') +
      (r.removed ? `  removed: ${r.removedNames.join(', ')}` : ''));
  }
}
const ok = report.filter((r) => r.status === 'ok');
console.log(`\nAugmented ${ok.length}/${report.length} schemas (SDK ${SDK_TAG}); +${ok.reduce((a, r) => a + r.added, 0)} fields added, -${ok.reduce((a, r) => a + r.removed, 0)} removed.`);
