#!/usr/bin/env node
/**
 * apply-upstream-constraints.mjs — merge the value constraints PalSchema's own
 * items authoring schema declares into schemas/v1.0/PalStaticItemData.schema.json.
 *
 * Our item-loader schema is derived from the SDK class headers, so it knows all
 * 44 property names and almost no constraints; upstream's hand-written
 * assets/schemas/items.schema.json knows the constraints. The port lives in
 * structs/upstream-constraints.json (every rule with provenance to the pinned
 * tag); this script applies it:
 *
 *   - per-field keywords (patterns, ranges, defaults) merged into properties
 *   - the required list as if:{required:[Type]}/then — Type is required when
 *     adding, ignored when editing, so partial patches stay valid
 *   - per-Type field scoping as if/then branches keyed on Type, derived from
 *     the "Class property (...)" annotations in this schema's own descriptions
 *     (upstream's anyOf branches do not scope — each requires only ["Type"])
 *   - $comment segments (upstreamConstraints=, floatLiteral=, stackSoftCap=)
 *     that palschema-validate reads for its raw-text and soft-cap checks
 *
 * Idempotent: constraint-merged material carries $comments starting with
 * "palschema-upstream-"; a re-run strips and re-merges, so two runs are
 * byte-identical (asserted in the test suite). Runs after apply-loader-overlay
 * in `seed` — derive-loader-schemas regenerates the file from headers, the
 * overlay re-adds loader keys, then this re-adds the constraints.
 *
 * Run: node scripts/apply-upstream-constraints.mjs [palworldVersion]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VER = process.argv[2] || '1.0';
const SCHEMA_PATH = join(ROOT, 'schemas', `v${VER}`, 'PalStaticItemData.schema.json');

const MARKER = 'palschema-upstream-';

const constraints = JSON.parse(readFileSync(join(ROOT, 'structs', 'upstream-constraints.json'), 'utf8'));
const { tag, blobSha, pr } = constraints.verifiedAgainst;
const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
const props = schema.properties || {};

const fail = (msg) => {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
};

// ---- per-field keywords ------------------------------------------------------
const SUFFIX_START = ` Upstream (items.schema.json@`;
for (const entry of constraints.fields) {
  const prop = props[entry.field];
  if (!prop) fail(`constraint targets "${entry.field}", which the schema does not declare`);
  const base = String(prop.description || '');
  const cut = base.indexOf(SUFFIX_START);
  prop.description = `${cut >= 0 ? base.slice(0, cut) : base}${SUFFIX_START}${tag}): ${entry.descriptionSuffix}`;
  for (const [k, v] of Object.entries(entry.set)) prop[k] = v;
  prop.$comment = `${MARKER}constraints | tag=${tag} | source=${entry.source}`;
}

// ---- required-when-new (Type present = adding, absent = editing) -------------
const req = constraints.requiredWhenNew;
const requiredBranch = {
  $comment:
    `${MARKER}required | tag=${tag} | source=${req.source} | ` +
    `note=Type is required when adding and ignored when editing (PalItemModLoader.cpp), so upstream's ` +
    `required list only applies to entries that carry a Type key — partial patches of existing items stay valid`,
  if: { required: ['Type'] },
  then: {
    $comment: `${MARKER}required-then`,
    required: [...req.fields],
    properties: { Recipe: { $comment: `${MARKER}required-then`, required: [...req.recipeRequired] } },
  },
};

// ---- per-Type scoping, derived from the SDK class annotations ----------------
// derive-loader-schemas.mjs writes "Class property (<owners>)" into every class
// field's description; fields owned only by subclasses are out of scope for the
// other Type values. Grouped by owner set so each branch names its classes.
const typeValues = constraints.classScopes.typeValues;
const typeEnum = props.Type?.enum;
if (!Array.isArray(typeEnum) || !typeEnum.length) fail('schema declares no Type enum to scope against');

const groups = new Map(); // "classA,classB" -> { classes, fields }
for (const [name, prop] of Object.entries(props)) {
  const m = String(prop.description || '').match(/Class property \(([^)]+)\)/);
  if (!m) continue; // loader keys carry no class annotation and are never scoped
  const owners = m[1].split(',').map((s) => s.trim());
  if (owners.includes('UPalStaticItemDataBase')) continue; // base-class = every item class
  for (const c of owners) {
    if (!typeValues[c]) fail(`field "${name}" names unmapped owner class "${c}" — extend classScopes.typeValues`);
  }
  const key = owners.join(',');
  if (!groups.has(key)) groups.set(key, { classes: owners, fields: [] });
  groups.get(key).fields.push(name);
}

const scopeBranches = [...groups.values()].map(({ classes, fields }) => {
  const inScope = new Set(classes.flatMap((c) => typeValues[c]));
  const outTypes = typeEnum.filter((t) => !inScope.has(t));
  return {
    $comment:
      `${MARKER}scope | classes=${classes.join(',')} | types=${[...inScope].join(',')} | ` +
      `source=${constraints.classScopes.source}`,
    if: { required: ['Type'], properties: { Type: { enum: outTypes } } },
    then: { properties: Object.fromEntries(fields.map((f) => [f, false])) },
  };
});

const kept = (schema.allOf || []).filter((b) => !String(b?.$comment || '').startsWith(MARKER));
schema.allOf = [...kept, requiredBranch, ...scopeBranches];

// ---- $comment segments palschema-validate reads ------------------------------
// Inserted BEFORE the loaderKeys segment: apply-loader-overlay strips/re-appends
// loaderKeys with a regex anchored to end-of-string, so loaderKeys must stay last.
const segs = [
  `upstreamConstraints=${tag}@${blobSha.slice(0, 7)} (${pr}; scoping is if/then keyed on Type because ` +
    `upstream's anyOf branches do not scope; upstream's AttackPower is a typo for AttackValue and is not added)`,
  `floatLiteral=${constraints.floatLiteralFields.fields.join(',')}`,
  `stackSoftCap=${Object.entries(constraints.softCaps)
    .map(([f, c]) => `${f}:${c.above}`)
    .join(',')}`,
];
const parts = String(schema.$comment || '')
  .split(' | ')
  .filter((s) => !/^(upstreamConstraints|floatLiteral|stackSoftCap)=/.test(s));
const loaderKeysAt = parts.findIndex((s) => s.startsWith('loaderKeys='));
if (loaderKeysAt >= 0) parts.splice(loaderKeysAt, 0, ...segs);
else parts.push(...segs);
schema.$comment = parts.join(' | ');

const DESC_SENTINEL = ' Value constraints ported from PalSchema';
const baseDesc = String(schema.description || '');
const descCut = baseDesc.indexOf(DESC_SENTINEL);
schema.description =
  (descCut >= 0 ? baseDesc.slice(0, descCut) : baseDesc) +
  `${DESC_SENTINEL}'s own items.schema.json (tag ${tag}, ${pr}): per-Type scoping is keyed on Type via ` +
  `if/then (upstream's anyOf branches do not scope), the required list is gated on the presence of Type so ` +
  `partial patches of existing items stay valid, float-literal rules are checked on raw text by ` +
  `palschema-validate, and upstream's AttackPower is a typo for AttackValue (not added).`;

writeFileSync(SCHEMA_PATH, JSON.stringify(schema, null, 2) + '\n');
console.log(
  `  ✓ PalStaticItemData.schema.json: ${constraints.fields.length} field constraint(s), ` +
    `required-when-new [${req.fields.join(', ')}], ${scopeBranches.length} scope branch(es) ` +
    `(${[...groups.values()].map((g) => g.fields.length).reduce((a, b) => a + b, 0)} scoped fields), ` +
    `floatLiteral + stackSoftCap segments (upstream ${tag}@${blobSha.slice(0, 7)})`
);
