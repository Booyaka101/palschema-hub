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

/* ---------------- C++ header parsing ---------------- */

/** Parse `UPROPERTY(...) <Type> <Name>;` members of the FIRST struct in a header,
 *  prepending inherited fields from `struct FX : public FPalBase` chains
 *  (e.g. FPalTechnologyRecipeUnlockDataTableRow extends FPalTechnologyDataTableRowBase). */
function parseStructFields(headerText, depth = 0) {
  const fields = [];
  const base = headerText.match(/struct\s+F\w+\s*:\s*public\s+F(\w+)\s*\{/);
  if (base && base[1] !== 'TableRowBase' && depth < 4) {
    const bh = headerFor(base[1]);
    if (bh) fields.push(...parseStructFields(readFileSync(bh, 'utf8'), depth + 1));
  }
  const re = /UPROPERTY\((?:[^()]|\([^()]*\))*\)\s*\n\s*([A-Za-z0-9_<>,:\s*&]+?)\s+(\w+)\s*(?::\s*\d+)?;/g;
  let m;
  while ((m = re.exec(headerText))) {
    fields.push({ type: m[1].replace(/\s+/g, ' ').trim(), name: m[2] });
  }
  return fields;
}

function headerFor(structName) {
  const candidates = [structName, structName.replace(/^F/, '')];
  for (const c of candidates) {
    const p = join(HDR_DIR, `${c}.h`);
    if (existsSync(p)) return p;
  }
  return null;
}

const enumCache = new Map();
/** Values of `enum class EName : uint8 { ... }` from EName.h (null if not found). */
function enumValues(enumName) {
  if (enumCache.has(enumName)) return enumCache.get(enumName);
  const p = join(HDR_DIR, `${enumName}.h`);
  let vals = null;
  if (existsSync(p)) {
    const txt = readFileSync(p, 'utf8');
    const body = txt.match(new RegExp(`enum\\s+class\\s+${enumName}[^{]*\\{([\\s\\S]*?)\\}`));
    if (body) {
      vals = body[1]
        .split(',')
        .map((s) => s.replace(/\/\/.*$/gm, '').replace(/=.*$/s, '').trim())
        .filter((s) => /^\w+$/.test(s) && !/_MAX$/i.test(s));
    }
  }
  enumCache.set(enumName, vals);
  return vals;
}

/* ---------------- C++ type -> JSON Schema fragment ---------------- */
/* Conventions follow PalSchema's own src/Generator/JsonSchema/JsonSchemaGenerator.cpp */

const INT_RE = /^(u?int(8|16|32|64)(_t)?|long|short|char)$/;

function fragForType(cppType, depth = 0) {
  const t = cppType.trim();

  const arr = t.match(/^TArray<\s*(.+)\s*>$/);
  if (arr) return arrayFrag(fragForType(arr[1], depth));

  const map = t.match(/^TMap<\s*(.+?)\s*,\s*(.+)\s*>$/);
  if (map) {
    // Official form: array of {Key, Value}; FModel dumps sometimes use a plain object.
    return {
      anyOf: [
        {
          type: 'array',
          items: {
            type: 'object',
            properties: { Key: fragForType(map[1], depth + 1), Value: fragForType(map[2], depth + 1) },
          },
        },
        { type: 'object' },
      ],
      description: `MapProperty (${t})`,
    };
  }

  if (t === 'bool') return { type: 'boolean', description: 'BoolProperty' };
  if (INT_RE.test(t)) return { type: 'integer', description: 'IntProperty' };
  if (t === 'float' || t === 'double') return { type: 'number', description: 'FloatProperty' };
  if (t === 'FName' || t === 'FString' || t === 'FText') return { type: 'string', description: t };
  if (t === 'FGuid' || t === 'FSoftObjectPath' || t === 'FSoftClassPath') {
    return { type: 'string', description: t };
  }

  // Asset / class references — PalSchema (0.6.0+) accepts string asset paths;
  // FModel dumps serialize them as objects, so accept both.
  if (/^TSoftObjectPtr</.test(t) || /^TSoftClassPtr</.test(t) || /^TSubclassOf</.test(t) || /\*$/.test(t)) {
    return { type: ['object', 'string'], description: `Asset/class reference (${t}) — string asset path or exported object form` };
  }

  // Enum
  if (/^E[A-Z]/.test(t)) {
    const vals = enumValues(t);
    const frag = { type: 'string', description: `EnumProperty ${t}` };
    if (vals && vals.length) {
      // PalSchema accepts both qualified (EX::Value) and short (Value) names —
      // its generator emits both into enums.schema.json. Keep as examples (not a
      // hard enum) so game/BP additions never cause false rejections.
      frag.description = `EnumProperty ${t}. Values: ${vals.map((v) => `${t}::${v}`).join(', ')}`;
      frag.examples = vals.slice(0, 3).map((v) => `${t}::${v}`);
    }
    return frag;
  }

  // Nested struct — recurse into its header when available (depth-limited).
  if (/^F[A-Z]\w*$/.test(t)) {
    const hp = depth < 3 ? headerFor(t) : null;
    if (hp) {
      const sub = parseStructFields(readFileSync(hp, 'utf8'));
      if (sub.length) {
        const properties = {};
        for (const f of sub) properties[f.name] = fragForType(f.type, depth + 1);
        return { type: 'object', description: `StructProperty (${t})`, properties, additionalProperties: false };
      }
    }
    return { type: 'object', description: `StructProperty (${t})` };
  }

  return { description: `Unmapped C++ type: ${t}` }; // permissive
}

/** Wrapper-tolerant array form, mirroring PalSchema's ParseArrayPropertyInfo and
 *  SetArrayPropertyValueFromJsonValue (src/SDK/Helper/PropertyHelper.cpp): a plain
 *  array REPLACES the game array; the object form optionally takes "Action": "Clear"
 *  (the only recognized action — empties the array) and "Items" (elements to APPEND). */
function arrayFrag(itemsFrag, existingDescription) {
  const arrayForm = { type: 'array', items: itemsFrag ?? {} };
  return {
    oneOf: [
      arrayForm,
      {
        type: 'object',
        properties: {
          Action: {
            type: 'string',
            enum: ['Clear'],
            description: '"Clear" empties the existing array (runs before Items are appended). Only recognized value.',
          },
          Items: arrayForm,
        },
        // No minProperties: real mods ship `{}` as a no-op (e.g. Accessory
        // Condenser's "UnlockBuildObjects": {}), and the loader accepts it.
        additionalProperties: false,
      },
    ],
    description:
      (existingDescription ? existingDescription + ' — ' : '') +
      'ArrayProperty: a plain array REPLACES the game array; {"Items": [...]} APPENDS (optional "Action": "Clear" first empties it) — both are valid PalSchema',
  };
}

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
