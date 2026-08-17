#!/usr/bin/env node
/**
 * build-index.mjs — scans schemas/v<ver>/<table>.schema.json and writes /index.json:
 *   { versions: string[], schemas: { [version]: string[] }, tables: {...}, generatedAt }
 * The `versions` + `schemas` shape is the catalog contract the browser & CLI use.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMAS = join(ROOT, 'schemas');

const versions = existsSync(SCHEMAS)
  ? readdirSync(SCHEMAS, { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^v/.test(d.name))
      .map((d) => d.name.replace(/^v/, ''))
      .sort()
  : [];

const schemas = {};
const tables = {};
for (const v of versions) {
  const dir = join(SCHEMAS, `v${v}`);
  const files = readdirSync(dir).filter((f) => f.endsWith('.schema.json'));
  schemas[v] = files.map((f) => f.replace(/\.schema\.json$/, '')).sort();
  tables[v] = {};
  for (const f of files) {
    const table = f.replace(/\.schema\.json$/, '');
    try {
      const s = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      const meta = Object.fromEntries(
        String(s.$comment || '')
          .split('|')
          .map((p) => p.trim().split('='))
          .filter((kv) => kv.length === 2)
      );
      tables[v][table] = {
        rowStruct: meta.rowStruct || '',
        fields: Object.keys(s.properties || {}).length,
        rows: Number(meta.rows) || 0,
        source: meta.source || '',
      };
    } catch {
      tables[v][table] = { rowStruct: '', fields: 0, rows: 0, source: '' };
    }
  }
}

/**
 * Keep the previous timestamp when nothing else changed. A fresh stamp on every
 * run makes this file dirty on any rebuild — CI regenerates it before testing,
 * which was enough to fail the offline-archive byte check for a no-op rebuild.
 */
function stamp(path, next) {
  try {
    const prev = JSON.parse(readFileSync(path, 'utf8'));
    const same = JSON.stringify({ ...prev, generatedAt: null }) === JSON.stringify({ ...next, generatedAt: null });
    if (same && prev.generatedAt) return prev.generatedAt;
  } catch {
    /* no previous file — fall through to a new stamp */
  }
  return new Date().toISOString();
}

const indexPath = join(ROOT, 'index.json');
const index = { versions, schemas, tables, generatedAt: null };
index.generatedAt = stamp(indexPath, index);
writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n');
console.log(`index.json written: versions=[${versions.join(', ')}], tables=${versions.map((v) => `${v}:${schemas[v].length}`).join(' ')}`);

// schemas/index.json — flat table-name -> schema-path listing (per version), for
// consumers that fetch the registry directly (e.g. GitHub Pages).
const schemasIndex = {
  description: 'palschema-hub schema registry index. Paths are relative to the repo/Pages root.',
  versions,
  tables: Object.fromEntries(
    versions.map((v) => [v, Object.fromEntries(schemas[v].map((t) => [t, `schemas/v${v}/${t}.schema.json`]))])
  ),
  generatedAt: null,
};
const schemasIndexPath = join(SCHEMAS, 'index.json');
schemasIndex.generatedAt = stamp(schemasIndexPath, schemasIndex);
writeFileSync(schemasIndexPath, JSON.stringify(schemasIndex, null, 2) + '\n');
console.log(`schemas/index.json written: ${versions.map((v) => `${v}:${schemas[v].length} tables`).join(' ')}`);
