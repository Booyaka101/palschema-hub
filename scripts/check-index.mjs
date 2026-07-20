#!/usr/bin/env node
/**
 * check-index.mjs — asserts the acceptance criteria for index.json:
 *   valid JSON, lists version 1.0, with >= 10 table names, and every listed
 *   schema file actually exists on disk. Exit 1 on any failure.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
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

console.log(`OK: index.json valid · ${index.versions.length} version(s) · ${total} schema file(s) · 1.0 has ${v152.length} tables`);
