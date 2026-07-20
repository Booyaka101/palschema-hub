#!/usr/bin/env node
/**
 * derive-schemas.mjs — Seed generator for palschema-hub.
 *
 * Fetches real Palworld DataTable dumps from the public `blaynem/paldex` repo
 * and derives one JSON Schema (draft-07) per DataTable, describing the *row
 * struct* (the shape of a single row / mod patch entry).
 *
 * Provenance: field NAMES and nesting are authoritative (taken straight from
 * the game's exported DataTable rows). Field TYPES are INFERRED from observed
 * values (numbers collapse to "number" so a validator never wrongly rejects an
 * int-vs-float; enum-like strings stay "string" with examples). These schemas
 * are a community-derived seed and can be superseded by PalSchema 0.6.1's
 * official Schema Generator output when available (drop files into schemas/<ver>/).
 *
 * Usage: node scripts/derive-schemas.mjs [palworldVersion]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const PALWORLD_VERSION = process.argv[2] || '1.0';
const OWNER = process.env.PALSCHEMA_OWNER || 'Booyaka101';
const PALDEX_RAW = 'https://raw.githubusercontent.com/blaynem/paldex/main/';

// The 30 real gameplay DataTables present in paldex — the surface modders edit.
const TABLE_PATHS = [
  'data-provider/palworld-assets/DataTable/Character/DT_CapturedCagePal.json',
  'data-provider/palworld-assets/DataTable/Character/DT_CharacterUpgradeMasterDataTable.json',
  'data-provider/palworld-assets/DataTable/Character/DT_PalBPClass.json',
  'data-provider/palworld-assets/DataTable/Character/DT_PalCharacterIconDataTable.json',
  'data-provider/palworld-assets/DataTable/Character/DT_PalCombiUnique.json',
  'data-provider/palworld-assets/DataTable/Character/DT_PalDropItem.json',
  'data-provider/palworld-assets/DataTable/Character/DT_PalHumanParameter.json',
  'data-provider/palworld-assets/DataTable/Character/DT_PalMonsterParameter.json',
  'data-provider/palworld-assets/DataTable/Character/DT_PalPlayerParameter.json',
  'data-provider/palworld-assets/DataTable/Character/DT_PalSizeParameter.json',
  'data-provider/palworld-assets/DataTable/Character/DT_UniqueNPC.json',
  'data-provider/palworld-assets/DataTable/Exp/DT_PalCaptureBonusExpTable.json',
  'data-provider/palworld-assets/DataTable/Exp/DT_PalExpTable.json',
  'data-provider/palworld-assets/DataTable/Item/DT_ItemDataTable.json',
  'data-provider/palworld-assets/DataTable/Item/DT_ItemIconDataTable.json',
  'data-provider/palworld-assets/DataTable/Item/DT_ItemLotteryDataTable.json',
  'data-provider/palworld-assets/DataTable/Item/DT_ItemRecipeDataTable.json',
  'data-provider/palworld-assets/DataTable/Item/DT_StatusEffectFood.json',
  'data-provider/palworld-assets/DataTable/MapObject/Building/DT_BuildObjectDataTable.json',
  'data-provider/palworld-assets/DataTable/MapObject/Building/DT_BuildObjectIconDataTable.json',
  'data-provider/palworld-assets/DataTable/MapObject/DT_MapObjectAssignData.json',
  'data-provider/palworld-assets/DataTable/MapObject/DT_MapObjectFarmCrop.json',
  'data-provider/palworld-assets/DataTable/MapObject/DT_MapObjectItemProductDataTable.json',
  'data-provider/palworld-assets/DataTable/MapObject/DT_MapObjectMasterDataTable.json',
  'data-provider/palworld-assets/DataTable/PassiveSkill/DT_PassiveSkill_Main.json',
  'data-provider/palworld-assets/DataTable/Technology/DT_TechnologyIconData.json',
  'data-provider/palworld-assets/DataTable/Technology/DT_TechnologyRecipeUnlock.json',
  'data-provider/palworld-assets/DataTable/Waza/DT_WazaDataTable.json',
  'data-provider/palworld-assets/DataTable/Waza/DT_WazaMasterLevel.json',
  'data-provider/palworld-assets/DataTable/Waza/DT_WazaMasterTamago.json',
];

const jsonType = (v) => {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v; // 'string' | 'number' | 'boolean' | 'object'
};
// Numbers collapse to JSON-Schema "number" (superset of int/float) so the
// validator never rejects a legitimate int-vs-float difference in a mod.
const toSchemaType = (t) => (t === 'number' ? 'number' : t);

const isEnumLike = (s) => typeof s === 'string' && s.includes('::');

function uniq(arr) {
  return [...new Set(arr)];
}

/** Derive a schema fragment for a set of observed values of one field/element. */
function deriveField(values) {
  const present = values.filter((v) => v !== undefined);
  const types = uniq(present.map(jsonType));
  const schemaTypes = uniq(types.map(toSchemaType));
  const frag = {};

  // type
  if (schemaTypes.length === 1) frag.type = schemaTypes[0];
  else frag.type = schemaTypes.sort();

  // nested object → derive its properties from the union of keys
  if (types.includes('object')) {
    const objs = present.filter((v) => jsonType(v) === 'object');
    const keys = uniq(objs.flatMap((o) => Object.keys(o)));
    if (keys.length) {
      frag.properties = {};
      for (const k of keys) frag.properties[k] = deriveField(objs.map((o) => o[k]));
      // structs are fixed-shape → catch typo'd sub-fields, but only when the
      // field is *always* an object (mixed string|object stays permissive).
      frag.additionalProperties = types.length === 1;
    }
  }

  // array → infer item schema from all elements
  if (types.includes('array')) {
    const elems = present.filter((v) => jsonType(v) === 'array').flatMap((a) => a);
    frag.items = elems.length ? deriveField(elems) : {};
  }

  // examples / description (help modders; the official generator omits these too)
  const scalars = present.filter((v) => ['string', 'number', 'boolean'].includes(jsonType(v)));
  const examples = uniq(scalars.map((v) => JSON.stringify(v))).slice(0, 3).map((s) => JSON.parse(s));
  if (examples.length) frag.examples = examples;
  const enumy = present.some(isEnumLike);
  if (enumy) {
    const vals = uniq(present.filter(isEnumLike)).slice(0, 4);
    frag.description = `Enum-like value. Examples: ${vals.join(', ')}`;
  } else if (examples.length) {
    frag.description = `Example: ${JSON.stringify(examples[0])}`;
  }
  return frag;
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

function buildRowSchema(table, rowStruct, rows) {
  const rowObjs = Object.values(rows).filter((r) => r && typeof r === 'object');
  const fieldNames = uniq(rowObjs.flatMap((r) => Object.keys(r)));
  const properties = {};
  for (const f of fieldNames) properties[f] = deriveField(rowObjs.map((r) => r[f]));
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    $id: `https://raw.githubusercontent.com/${OWNER}/palschema-hub/main/schemas/v${PALWORLD_VERSION}/${table}.schema.json`,
    title: table,
    description:
      `Palworld DataTable ${table} (row struct: ${rowStruct}). ` +
      `Each PalSchema mod patch targeting "${table}" is an object of rowName -> partial row; ` +
      `this schema validates one such row. Palworld ${PALWORLD_VERSION}. ` +
      `Field names authoritative (from game data via paldex); types inferred. Fields are optional (partial patches).`,
    $comment: `palschema-hub | table=${table} | rowStruct=${rowStruct} | palworldVersion=${PALWORLD_VERSION} | rows=${rowObjs.length} | fields=${fieldNames.length} | source=derived-from-paldex`,
    type: 'object',
    properties,
    additionalProperties: false, // catch misspelled field names — the core validation value
  };
}

async function main() {
  const outDir = join(ROOT, 'schemas', `v${PALWORLD_VERSION}`);
  mkdirSync(outDir, { recursive: true });
  const summary = [];
  let ok = 0;
  for (const path of TABLE_PATHS) {
    const table = path.split('/').pop().replace(/\.json$/, '');
    try {
      const data = await fetchJson(PALDEX_RAW + path);
      const entry = Array.isArray(data)
        ? data.find((e) => e && e.Rows) || data[0]
        : data;
      if (!entry || !entry.Rows) throw new Error('no Rows in export');
      const rowStructRaw = entry?.Properties?.RowStruct?.ObjectName || '';
      const rowStruct = (rowStructRaw.match(/'([^']+)'/)?.[1]) || rowStructRaw || 'Unknown';
      const schema = buildRowSchema(table, rowStruct, entry.Rows);
      writeFileSync(join(outDir, `${table}.schema.json`), JSON.stringify(schema, null, 2) + '\n');
      const nFields = Object.keys(schema.properties).length;
      summary.push({ table, rowStruct, rows: Object.keys(entry.Rows).length, fields: nFields });
      console.log(`  ✓ ${table.padEnd(38)} struct=${rowStruct.padEnd(34)} fields=${nFields}`);
      ok++;
    } catch (e) {
      console.error(`  ✗ ${table}: ${e.message}`);
    }
  }
  console.log(`\nDerived ${ok}/${TABLE_PATHS.length} schemas into schemas/v${PALWORLD_VERSION}/`);
  writeFileSync(join(outDir, '_manifest.json'), JSON.stringify({ palworldVersion: PALWORLD_VERSION, source: 'derived-from-paldex', generatedTables: summary }, null, 2) + '\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
