#!/usr/bin/env node
/**
 * check-index.mjs — asserts the acceptance criteria for index.json:
 *   valid JSON, lists version 1.0, with >= 10 table names, every listed
 *   schema file actually exists on disk, and the hand-written table notes
 *   match what index.json carries. Exit 1 on any failure.
 *
 * Run: node scripts/check-index.mjs [tableNotesPath]   (path for fixture tests)
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NOTES_PATH = process.argv[2] || join(ROOT, 'table-notes.json');
const fail = (m) => { console.error('FAIL: ' + m); process.exit(1); };

let index;
try {
  index = JSON.parse(readFileSync(join(ROOT, 'index.json'), 'utf8'));
} catch (e) {
  fail('index.json is not valid JSON — ' + e.message);
}

if (!Array.isArray(index.versions) || !index.versions.length) fail('index.versions missing/empty');
if (!index.versions.includes('1.0')) fail('version 1.0 not listed');
if (typeof index.schemas !== 'object') fail('index.schemas missing');

let total = 0;
for (const v of index.versions) {
  const list = index.schemas[v];
  if (!Array.isArray(list)) fail(`schemas[${v}] is not an array`);
  for (const table of list) {
    const p = join(ROOT, 'schemas', `v${v}`, `${table}.schema.json`);
    if (!existsSync(p)) fail(`listed schema missing on disk: ${p}`);
    total++;
  }
  console.log(`  v${v}: ${list.length} tables`);
}

const v152 = index.schemas['1.0'] || [];
if (v152.length < 10) fail(`version 1.0 has only ${v152.length} tables (need >= 10)`);

// table-notes.json is hand-edited; index.json is built. Editing one and forgetting
// `npm run index` would ship a note nobody can see, so compare them here.
let notes = {};
try {
  notes = JSON.parse(readFileSync(NOTES_PATH, 'utf8')).notes || {};
} catch (e) {
  fail(`${NOTES_PATH} is not valid JSON — ` + e.message);
}
for (const [table, note] of Object.entries(notes)) {
  if (!note.text || !note.source) fail(`table-notes.json: ${table} needs both "text" and "source"`);
  const carried = index.versions.filter((v) => (index.tables[v] || {})[table]);
  if (!carried.length) fail(`table-notes.json names ${table}, which no schema version has`);
  for (const v of carried) {
    const got = index.tables[v][table].note;
    if (JSON.stringify(got) !== JSON.stringify(note)) {
      fail(`index.json note for ${table} (v${v}) is stale — re-run \`npm run index\``);
    }
  }
}

console.log(`OK: index.json valid · ${index.versions.length} version(s) · ${total} schema file(s) · 1.0 has ${v152.length} tables · ${Object.keys(notes).length} table note(s)`);
