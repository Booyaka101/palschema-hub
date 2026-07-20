#!/usr/bin/env node
/**
 * derive-sdk-tables.mjs — add schemas for moddable tables the paldex dump LACKS,
 * derived purely from the current-game SDK row-struct headers.
 *
 * The paldex FModel dump (the seed for the 30 base tables) predates several tables
 * that real mods patch today — e.g. DT_FieldLotteryNameDataTable, used by "Old
 * School Loot" to reweight chest/oil-rig drops. There is no public row-data source
 * for these, but the decompiled SDK `localcc/PalworldModdingKit` has their exact
 * row structs, so we can emit authoritative field schemas from the headers alone.
 *
 * Each mapping below is VERIFIED (not guessed): the DataTable name is confirmed to
 * use the given row struct either by a real published mod that patches that table
 * with exactly those fields, or by an explicit reference in the SDK. Do not add a
 * table here on naming resemblance alone.
 *
 * Runs AFTER augment-from-sdk.mjs in `npm run seed` (derive -> augment ->
 * derive-sdk-tables -> index). Self-contained (its own small type mapper) so it
 * never has to touch the primary augment script.
 *
 * Run: node scripts/derive-sdk-tables.mjs [palworldVersion]
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const VER = process.argv[2] || '1.0';
const OWNER = process.env.PALSCHEMA_OWNER || 'Booyaka101';
const SCHEMA_DIR = join(ROOT, 'schemas', `v${VER}`);

// table name -> { struct, why } — see "VERIFIED" note above.
const SDK_ONLY_TABLES = {
  DT_FieldLotteryNameDataTable: {
    struct: 'FPalFieldLotteryName',
    why: 'Real mod "Old School Loot" patches this table with ItemSlotN_ProbabilityPercent fields that match FPalFieldLotteryName exactly.',
  },
};

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

function headerFor(structName) {
  for (const c of [structName, structName.replace(/^F/, '')]) {
    const p = join(HDR_DIR, `${c}.h`);
    if (existsSync(p)) return p;
  }
  return null;
}

/** UPROPERTY members of the first struct, incl. FPal* base-struct inheritance. */
function parseStructFields(headerText, depth = 0) {
  const fields = [];
  const base = headerText.match(/struct\s+F\w+\s*:\s*public\s+F(\w+)\s*\{/);
  if (base && base[1] !== 'TableRowBase' && depth < 4) {
    const bh = headerFor(base[1]);
    if (bh) fields.push(...parseStructFields(readFileSync(bh, 'utf8'), depth + 1));
  }
  const re = /UPROPERTY\((?:[^()]|\([^()]*\))*\)\s*\n\s*([A-Za-z0-9_<>,:\s*&]+?)\s+(\w+)\s*(?::\s*\d+)?;/g;
  let m;
  while ((m = re.exec(headerText))) fields.push({ type: m[1].replace(/\s+/g, ' ').trim(), name: m[2] });
  return fields;
}

const enumCache = new Map();
function enumValues(enumName) {
  if (enumCache.has(enumName)) return enumCache.get(enumName);
  const p = join(HDR_DIR, `${enumName}.h`);
  let vals = null;
  if (existsSync(p)) {
    const body = readFileSync(p, 'utf8').match(new RegExp(`enum\\s+class\\s+${enumName}[^{]*\\{([\\s\\S]*?)\\}`));
    if (body) vals = body[1].split(',').map((s) => s.replace(/\/\/.*$/gm, '').replace(/=.*$/s, '').trim()).filter((s) => /^\w+$/.test(s) && !/_MAX$/i.test(s));
  }
  enumCache.set(enumName, vals);
  return vals;
}

// Compact C++ -> JSON Schema mapper (PalSchema conventions; same output shape as
// augment-from-sdk.mjs for the simple types these SDK-only tables use).
const INT_RE = /^(u?int(8|16|32|64)(_t)?|long|short|char)$/;
function arrayFrag(items) {
  const arrayForm = { type: 'array', items: items ?? {} };
  return {
    oneOf: [
      arrayForm,
      { type: 'object', properties: { Action: { type: 'string', enum: ['Clear'], description: '"Clear" empties the existing array before Items are appended.' }, Items: arrayForm }, additionalProperties: false },
    ],
    description: 'ArrayProperty: a plain array REPLACES the game array; {"Items": [...]} APPENDS (optional "Action": "Clear" first empties it).',
  };
}
function fragForType(t) {
  t = t.trim();
  const arr = t.match(/^TArray<\s*(.+)\s*>$/);
  if (arr) return arrayFrag(fragForType(arr[1]));
  if (t === 'bool') return { type: 'boolean', description: 'BoolProperty' };
  if (INT_RE.test(t)) return { type: 'integer', description: 'IntProperty' };
  if (t === 'float' || t === 'double') return { type: 'number', description: 'FloatProperty' };
  if (['FName', 'FString', 'FText', 'FGuid'].includes(t)) return { type: 'string', description: t };
  if (/^E[A-Z]/.test(t)) {
    const vals = enumValues(t);
    const frag = { type: 'string', description: `EnumProperty ${t}` };
    if (vals && vals.length) { frag.description = `EnumProperty ${t}. Values: ${vals.map((v) => `${t}::${v}`).join(', ')}`; frag.examples = vals.slice(0, 3).map((v) => `${t}::${v}`); }
    return frag;
  }
  if (/^F[A-Z]\w*$/.test(t)) return { type: 'object', description: `StructProperty (${t})` };
  return { description: `Unmapped C++ type: ${t}` };
}

const manifest = JSON.parse(readFileSync(join(SCHEMA_DIR, '_manifest.json'), 'utf8'));
let added = 0;
for (const [table, { struct, why }] of Object.entries(SDK_ONLY_TABLES)) {
  const hp = headerFor(struct);
  if (!hp) { console.log(`  ! ${table}: no SDK header for ${struct} — skipped`); continue; }
  const fields = parseStructFields(readFileSync(hp, 'utf8'));
  if (!fields.length) { console.log(`  ! ${table}: ${struct} parsed empty — skipped`); continue; }
  const properties = {};
  for (const f of fields) properties[f.name] = fragForType(f.type);
  properties['$Filters'] = { description: 'PalSchema row-filter metadata (used with wildcard row keys); ignored as a row field by the loader.' };
  const schema = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    $id: `https://raw.githubusercontent.com/${OWNER}/palschema-hub/main/schemas/v${VER}/${table}.schema.json`,
    title: table,
    description: `Palworld DataTable ${table} (row struct: ${struct}). Each PalSchema mod patch targeting "${table}" is an object of rowName -> partial row; this schema validates one such row. Palworld ${VER}. Field names + types derived from the current game's row struct (${SDK_TAG}, pushed 2026-07-11) — this table postdates the paldex dump, so it has no observed-value examples. Fields are optional (partial patches).`,
    $comment: `palschema-hub | table=${table} | rowStruct=${struct} | palworldVersion=${VER} | fields=${fields.length} | source=sdk-headers-only | sdk=${SDK_TAG}`,
    type: 'object',
    properties,
    additionalProperties: false,
  };
  writeFileSync(join(SCHEMA_DIR, `${table}.schema.json`), JSON.stringify(schema, null, 2) + '\n');
  // upsert into manifest (idempotent across re-runs)
  const entry = { table, rowStruct: struct, rows: 0, fields: fields.length, source: 'sdk-headers-only', note: why };
  const i = manifest.generatedTables.findIndex((e) => e.table === table);
  if (i >= 0) manifest.generatedTables[i] = entry; else manifest.generatedTables.push(entry);
  console.log(`  ✓ ${table.padEnd(34)} struct=${struct.padEnd(24)} fields=${fields.length}`);
  added++;
}
writeFileSync(join(SCHEMA_DIR, '_manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`\nDerived ${added} SDK-only table schema(s) into schemas/v${VER}/ (SDK ${SDK_TAG}).`);
