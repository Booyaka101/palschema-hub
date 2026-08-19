#!/usr/bin/env node
/**
 * derive-loader-schemas.mjs — emit schemas for PalSchema loaders that validate
 * against UE CLASSES instead of DataTable row structs.
 *
 * The item loader (src/Loader/PalItemModLoader.cpp) matches mod keys against
 * UPalStaticItemDataBase and its Armor/Weapon/Consume subclasses via
 * GetPropertyByNameInChain, plus its own custom keys (Type, Name, Description,
 * Recipe, SortID, bLegalInGame — merged from structs/loader-overlay.json).
 * Since 0.6.3 it warns in game about keys outside that set (PR #138); this
 * schema lets the validator report the same set pre-flight, typed.
 *
 * Emits: schemas/v<ver>/PalStaticItemData.schema.json
 * Run:   node scripts/derive-loader-schemas.mjs [palworldVersion]
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSdkParser } from './lib/sdk-parse.mjs';
import { loadOverlay, overlayFrag } from './lib/loader-overlay.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VER = process.argv[2] || '1.0';
const SCHEMA_DIR = join(ROOT, 'schemas', `v${VER}`);

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

const { parseStructFields, fragForType } = createSdkParser(HDR_DIR);

/** UPROPERTY members of a UCLASS header chain (base first), by class name. */
function parseClassChain(className, depth = 0) {
  const p = join(HDR_DIR, `${className.replace(/^U/, '')}.h`);
  if (!existsSync(p)) {
    console.error(`  ! header not found for class ${className}: ${p}`);
    return [];
  }
  const text = readFileSync(p, 'utf8');
  const fields = [];
  const base = text.match(new RegExp(`class\\s+(?:\\w+_API\\s+)?${className}\\s*:\\s*public\\s+(U\\w+)`));
  if (base && base[1] !== 'UObject' && depth < 4) fields.push(...parseClassChain(base[1], depth + 1));
  // The UPROPERTY member regex is class/struct-agnostic; the struct-inheritance
  // prefix inside parseStructFields never matches a class header.
  fields.push(...parseStructFields(text));
  return fields;
}

const BASE = 'UPalStaticItemDataBase';
const SUBCLASSES = ['UPalStaticArmorItemData', 'UPalStaticWeaponItemData', 'UPalStaticConsumeItemData'];

const baseFields = parseClassChain(BASE);
if (!baseFields.length) {
  console.error(`FAIL: parsed zero UPROPERTY members from ${BASE}.h — refusing to write an empty schema`);
  process.exit(1);
}
const fields = [...baseFields];
const seen = new Set(baseFields.map((f) => f.name));
const perSub = {};
for (const sub of SUBCLASSES) {
  const subOnly = parseClassChain(sub).filter((f) => !seen.has(f.name));
  perSub[sub] = subOnly.map((f) => f.name);
  for (const f of subOnly) {
    if (!fields.some((x) => x.name === f.name)) fields.push(f);
  }
}

const properties = {};
for (const f of fields) {
  const frag = fragForType(f.type);
  const owners = [BASE, ...SUBCLASSES].filter(
    (c) => (c === BASE ? baseFields : perSub[c].map((n) => ({ name: n }))).some((x) => x.name === f.name)
  );
  frag.description = `${frag.description ?? f.type} — ${f.name === 'ID' ? 'set from the mod key when adding, ignored when editing. ' : ''}${
    owners.length === 1 && owners[0] !== BASE ? `${owners[0].replace(/^UPalStatic|ItemData$/g, '')} items only. ` : ''
  }Class property (${owners.join(', ')}).`.replace(/\s+/g, ' ').trim();
  properties[f.name] = frag;
}

// Loader custom keys from the overlay, merged after the class properties.
const overlay = loadOverlay(ROOT);
const itemEntries = overlay.entries.filter((e) => e.loader === 'items');
for (const entry of itemEntries) properties[entry.key] = overlayFrag(entry);

const schema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: `https://raw.githubusercontent.com/Booyaka101/palschema-hub/main/schemas/v${VER}/PalStaticItemData.schema.json`,
  title: 'PalSchema item-loader entry (UPalStaticItemData)',
  description:
    `One entry of a PalSchema items-folder mod file ({ "<ItemId>": { ...these fields } }; a null value deletes the item). ` +
    `The item loader matches keys against UPalStaticItemDataBase and its Armor/Weapon/Consume subclasses ` +
    `(GetPropertyByNameInChain) plus its own keys (Type, Name, Description, Recipe, SortID, bLegalInGame); ` +
    `anything else is ignored, with an in-game warning since PalSchema 0.6.3 (Okaetsu/PalSchema#138). ` +
    `Fields are optional (partial patches edit existing items; only NEW items need Type). Palworld ${VER}, ` +
    `class members verified against ${SDK_TAG}.`,
  $comment:
    `palschema-hub | loader=items | rowStruct=UPalStaticItemDataBase(+Armor/Weapon/Consume) | palworldVersion=${VER} | ` +
    `fields=${fields.length} | source=sdk-headers+loader-overlay | sdk=${SDK_TAG} | ` +
    `loaderKeys=${itemEntries.map((e) => e.key).join(',')}`,
  type: 'object',
  properties,
  additionalProperties: false,
};

const outPath = join(SCHEMA_DIR, 'PalStaticItemData.schema.json');
writeFileSync(outPath, JSON.stringify(schema, null, 2) + '\n');
console.log(
  `  ✓ PalStaticItemData.schema.json: ${fields.length} class fields ` +
    `(${baseFields.length} base${SUBCLASSES.map((s) => ` +${perSub[s].length} ${s.replace(/^UPalStatic|ItemData$/g, '')}`).join('')}) ` +
    `+ ${itemEntries.length} loader keys (${SDK_TAG})`
);
