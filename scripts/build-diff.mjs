#!/usr/bin/env node
/**
 * build-diff.mjs — diff two pinned Palworld versions' row structs.
 *
 * Reads structs/<from>.json and structs/<to>.json (written by snapshot-structs.mjs)
 * and emits diffs/<from>..<to>.json + diffs/<from>..<to>.md with, per struct:
 *   added[]   — fields new in <to>            [{ field, type }]
 *   removed[] — fields gone in <to>           [{ field, type }]
 *   retyped[] — same field, new C++ type      [{ field, from, to }]
 *   renames[] — CONSERVATIVE rename heuristic, always labelled with confidence:
 *     "high"   — a removed and an added field have the identical C++ type AND
 *                identical names after lowercasing and stripping "_"/" "
 *                (catches HP→Hp, PalID→PalId);
 *     "medium" — same C++ type and one name is derivable from the other by
 *                deleting one contiguous substring — strict prefixes included
 *                (catches OverridePartnerSkillTextID → OverridePartnerSkillNameTextID);
 *     anything else is reported plainly as removed + added, with NO rename claim.
 * Changes roll up to the DT_* tables that use each struct (tableToStruct).
 *
 * Aliases resolve through versions.json: if <from> and <to> resolve to the same
 * SDK commit, a valid EMPTY diff is emitted whose summary is "no row-struct changes".
 *
 * Run: node scripts/build-diff.mjs <from> <to>     (e.g. 0.7.2 1.0)
 *      node scripts/build-diff.mjs all             (every ascending pair)
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_DIR = join(ROOT, 'diffs');

const versionsInfo = JSON.parse(readFileSync(join(ROOT, 'versions.json'), 'utf8'));

/** Resolve a version label (possibly an alias like 0.7.3) to its pinned version. */
function resolveVersion(label) {
  if (versionsInfo.versions[label]) return { version: label, aliasOf: null };
  const alias = versionsInfo.aliases[label];
  if (alias) return { version: alias.of, aliasOf: alias };
  return null;
}

function loadStructs(version) {
  const p = join(ROOT, 'structs', `${version}.json`);
  if (!existsSync(p)) {
    throw new Error(`structs/${version}.json not found — run: node scripts/snapshot-structs.mjs ${version}`);
  }
  return JSON.parse(readFileSync(p, 'utf8'));
}

const normName = (n) => n.toLowerCase().replace(/[_ ]/g, '');

/** True when one name is derivable from the other by deleting ONE contiguous
 *  substring (common prefix + common suffix fully cover the shorter name).
 *  Strict prefixes are the delete-at-the-end special case. */
function oneDeletionApart(a, b) {
  if (a === b) return false;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  let p = 0;
  while (p < short.length && short[p] === long[p]) p++;
  let s = 0;
  while (s < short.length - p && short[short.length - 1 - s] === long[long.length - 1 - s]) s++;
  return p + s >= short.length;
}

/** Diff one struct's ordered {field: cppType} maps. */
function diffStruct(fromFields, toFields) {
  const removed = [];
  const added = [];
  const retyped = [];
  for (const [field, type] of Object.entries(fromFields)) {
    if (!(field in toFields)) removed.push({ field, type });
    else if (toFields[field] !== type) retyped.push({ field, from: type, to: toFields[field] });
  }
  for (const [field, type] of Object.entries(toFields)) {
    if (!(field in fromFields)) added.push({ field, type });
  }

  // Rename heuristic — conservative, always labelled. Candidates keep the new
  // struct's field order, so the primary suggestion is deterministic.
  const renames = [];
  for (const r of removed) {
    const high = added.filter((a) => a.type === r.type && normName(a.field) === normName(r.field));
    const medium = high.length
      ? []
      : added.filter((a) => a.type === r.type && oneDeletionApart(a.field, r.field));
    const candidates = high.length ? high : medium;
    if (!candidates.length) continue; // no claim — plain removed + added
    renames.push({
      from: r.field,
      to: candidates[0].field,
      type: r.type,
      confidence: high.length ? 'high' : 'medium',
      ...(candidates.length > 1 ? { altCandidates: candidates.slice(1).map((c) => c.field) } : {}),
    });
  }
  return { added, removed, retyped, renames };
}

function buildDiff(fromLabel, toLabel) {
  const from = resolveVersion(fromLabel);
  const to = resolveVersion(toLabel);
  for (const [label, r] of [[fromLabel, from], [toLabel, to]]) {
    if (!r) {
      throw new Error(`unknown Palworld version "${label}" — known: ${versionsInfo.order.join(', ')}, aliases: ${Object.keys(versionsInfo.aliases).join(', ')}`);
    }
  }
  const fromPin = versionsInfo.versions[from.version];
  const toPin = versionsInfo.versions[to.version];
  const aliasNotes = [from.aliasOf?.note, to.aliasOf?.note].filter(Boolean);

  const out = {
    from: { requested: fromLabel, palworldVersion: from.version, ...fromPin },
    to: { requested: toLabel, palworldVersion: to.version, ...toPin },
    ...(aliasNotes.length ? { aliasNotes } : {}),
    summary: '',
    structs: {},
    structsAdded: [],
    structsRemoved: [],
    affectedTables: {},
    unchangedTables: [],
    tableToStruct: {},
  };

  if (fromPin.sdkCommit === toPin.sdkCommit) {
    const snap = loadStructs(from.version);
    out.tableToStruct = snap.tableToStruct;
    out.unchangedTables = Object.keys(snap.tableToStruct);
    out.summary =
      `no row-struct changes — ${fromLabel} and ${toLabel} share SDK commit ${toPin.sdkCommit}` +
      (aliasNotes.length ? ` (${aliasNotes.join(' ')})` : '');
    return out;
  }

  const snapFrom = loadStructs(from.version);
  const snapTo = loadStructs(to.version);
  // Table rollup uses the union of both mappings (a table maps to the same struct
  // in every snapshot; the union covers structs present on only one side).
  const tableToStruct = { ...snapFrom.tableToStruct, ...snapTo.tableToStruct };
  out.tableToStruct = tableToStruct;
  const tablesFor = (structName) =>
    Object.keys(tableToStruct).filter((t) => tableToStruct[t] === structName).sort();

  out.structsAdded = Object.keys(snapTo.structs).filter((s) => !(s in snapFrom.structs)).sort();
  out.structsRemoved = Object.keys(snapFrom.structs).filter((s) => !(s in snapTo.structs)).sort();

  let changedStructs = 0;
  for (const name of Object.keys(snapFrom.structs).sort()) {
    if (!(name in snapTo.structs)) continue;
    const d = diffStruct(snapFrom.structs[name], snapTo.structs[name]);
    if (!d.added.length && !d.removed.length && !d.retyped.length) continue;
    changedStructs++;
    out.structs[name] = { ...d, tables: tablesFor(name) };
    for (const t of out.structs[name].tables) out.affectedTables[t] = name;
  }
  for (const t of Object.keys(tableToStruct).sort()) {
    if (!(t in out.affectedTables)) out.unchangedTables.push(t);
  }

  const nAdded = Object.values(out.structs).reduce((a, s) => a + s.added.length, 0);
  const nRemoved = Object.values(out.structs).reduce((a, s) => a + s.removed.length, 0);
  const nRetyped = Object.values(out.structs).reduce((a, s) => a + s.retyped.length, 0);
  out.summary = changedStructs
    ? `${changedStructs} row struct(s) changed (${nAdded} field(s) added, ${nRemoved} removed, ${nRetyped} retyped); ` +
      `${out.structsAdded.length} struct(s) new, ${out.structsRemoved.length} gone; ` +
      `${Object.keys(out.affectedTables).length} known DT_* table(s) affected`
    : 'no row-struct changes';
  return out;
}

function renderMd(d) {
  const lines = [];
  lines.push(`# Palworld ${d.from.requested} → ${d.to.requested} — row-struct changes`);
  lines.push('');
  lines.push(`Source: [localcc/PalworldModdingKit](https://github.com/localcc/PalworldModdingKit) headers, ` +
    `\`${d.from.sdkCommit}\` (${d.from.sdkDate}) → \`${d.to.sdkCommit}\` (${d.to.sdkDate}).`);
  if (d.aliasNotes) for (const n of d.aliasNotes) lines.push(`\n> **Alias:** ${n}`);
  lines.push('');
  lines.push(`**Summary:** ${d.summary}`);
  const structNames = Object.keys(d.structs);
  if (structNames.length) {
    for (const name of structNames) {
      const s = d.structs[name];
      lines.push('');
      lines.push(`## ${name}`);
      if (s.tables.length) lines.push(`Used by: ${s.tables.map((t) => `\`${t}\``).join(', ')}`);
      for (const r of s.removed) lines.push(`- ❌ removed \`${r.field}\` (${r.type})`);
      for (const a of s.added) lines.push(`- ✅ added \`${a.field}\` (${a.type})`);
      for (const r of s.retyped) lines.push(`- ⚠️ retyped \`${r.field}\`: ${r.from} → ${r.to}`);
      for (const r of s.renames) {
        lines.push(`- 🔀 possible rename (${r.confidence} confidence): \`${r.from}\` → \`${r.to}\`` +
          (r.altCandidates ? ` (alternate candidate${r.altCandidates.length > 1 ? 's' : ''}: ${r.altCandidates.map((c) => `\`${c}\``).join(', ')})` : ''));
      }
    }
    if (d.structsAdded.length) {
      lines.push('');
      lines.push(`## New row structs in ${d.to.requested}`);
      lines.push(d.structsAdded.map((s) => `\`${s}\``).join(', '));
    }
    if (d.structsRemoved.length) {
      lines.push('');
      lines.push(`## Row structs removed in ${d.to.requested}`);
      lines.push(d.structsRemoved.map((s) => `\`${s}\``).join(', '));
    }
    if (d.unchangedTables.length) {
      lines.push('');
      lines.push(`## Unchanged registry tables`);
      lines.push(d.unchangedTables.map((t) => `\`${t}\``).join(', '));
    }
  }
  lines.push('');
  return lines.join('\n');
}

function writeDiff(fromLabel, toLabel, verbose = true) {
  const d = buildDiff(fromLabel, toLabel);
  mkdirSync(OUT_DIR, { recursive: true });
  const base = `${fromLabel}..${toLabel}`;
  writeFileSync(join(OUT_DIR, `${base}.json`), JSON.stringify(d, null, 2) + '\n');
  writeFileSync(join(OUT_DIR, `${base}.md`), renderMd(d));
  console.log(`  ✓ diffs/${base}.json + .md — ${d.summary}`);
  if (!verbose) return;
  for (const [name, s] of Object.entries(d.structs)) {
    console.log(`    ${name}${s.tables.length ? ` (${s.tables.join(', ')})` : ''}`);
    for (const r of s.removed) console.log(`      - removed ${r.field} (${r.type})`);
    for (const a of s.added) console.log(`      + added ${a.field} (${a.type})`);
    for (const r of s.retyped) console.log(`      ~ retyped ${r.field}: ${r.from} -> ${r.to}`);
    for (const r of s.renames) {
      console.log(`      > possible rename (${r.confidence} confidence): ${r.from} -> ${r.to}` +
        (r.altCandidates ? ` (alternate: ${r.altCandidates.join(', ')})` : ''));
    }
  }
}

const [a, b] = process.argv.slice(2);
try {
  if (a === 'all') {
    const order = versionsInfo.order;
    for (let i = 0; i < order.length; i++) {
      for (let j = i + 1; j < order.length; j++) writeDiff(order[i], order[j], false);
    }
    // Alias pairs ship as first-class empty diffs so nothing 404s.
    for (const alias of Object.keys(versionsInfo.aliases)) {
      writeDiff(versionsInfo.aliases[alias].of, alias, false);
    }
  } else if (a && b) {
    writeDiff(a, b);
  } else {
    console.error('Usage: node scripts/build-diff.mjs <from> <to> | all');
    process.exit(1);
  }
} catch (e) {
  console.error(`Error: ${e.message}`);
  process.exit(1);
}
