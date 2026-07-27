/**
 * sdk-parse.mjs — shared C++ SDK-header parsing for palschema-hub scripts.
 *
 * Extracted verbatim from augment-from-sdk.mjs so snapshot-structs.mjs /
 * build-diff.mjs can parse ANY version's headers: the functions close over a
 * headers directory, so `createSdkParser(hdrDir)` returns a parser bound to one
 * extracted SDK (e.g. .cache/localcc-PalworldModdingKit-<sha>/Source/Pal/Public).
 *
 * Conventions follow PalSchema's own src/Generator/JsonSchema/JsonSchemaGenerator.cpp.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const INT_RE = /^(u?int(8|16|32|64)(_t)?|long|short|char)$/;

/** Wrapper-tolerant array form, mirroring PalSchema's ParseArrayPropertyInfo and
 *  SetArrayPropertyValueFromJsonValue (src/SDK/Helper/PropertyHelper.cpp): a plain
 *  array REPLACES the game array; the object form optionally takes "Action": "Clear"
 *  (the only recognized action — empties the array) and "Items" (elements to APPEND). */
export function arrayFrag(itemsFrag, existingDescription) {
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

/** Parser bound to one extracted SDK's Source/Pal/Public directory. */
export function createSdkParser(hdrDir) {
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
      const p = join(hdrDir, `${c}.h`);
      if (existsSync(p)) return p;
    }
    return null;
  }

  const enumCache = new Map();
  /** Values of `enum class EName : uint8 { ... }` from EName.h (null if not found). */
  function enumValues(enumName) {
    if (enumCache.has(enumName)) return enumCache.get(enumName);
    const p = join(hdrDir, `${enumName}.h`);
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

  return { parseStructFields, headerFor, enumValues, fragForType, arrayFrag };
}
