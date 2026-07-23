// CI gate for palschema-hub schema PRs (and pushes): validates every
// DT_*.schema.json under schemas/ (recursively, so versioned folders like
// schemas/v1.0/ are covered) against the registry contract:
//
//   - file parses as JSON, top level is an object
//   - top-level "$schema" is a string
//   - top-level "title" is a string, starts with "DT_", and matches the filename stem
//   - top-level "type" is exactly "object"
//   - top-level "properties" is an object
//
// No dependencies; Node >= 18. Exits 1 if any file fails (or none are found).
// Usage: node scripts/validate-schemas.js [schemasDir]   (default: ./schemas)

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const FILE_RE = /^DT_.+\.schema\.json$/;

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function validateFile(filePath) {
  const filename = path.basename(filePath);
  const errors = [];
  let json;
  try {
    let text = readFileSync(filePath, 'utf8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    json = JSON.parse(text);
  } catch (e) {
    return [`invalid JSON: ${e.message}`];
  }
  if (!isPlainObject(json)) return ['top level must be a JSON object'];

  if (typeof json.$schema !== 'string') errors.push('missing required top-level key "$schema"');
  if (typeof json.title !== 'string') {
    errors.push('missing required top-level key "title"');
  } else {
    if (!json.title.startsWith('DT_')) errors.push(`"title" must start with "DT_" (got "${json.title}")`);
    const stem = filename.replace(/\.schema\.json$/, '');
    if (json.title !== stem) errors.push(`"title" ("${json.title}") does not match the filename stem ("${stem}")`);
  }
  if (json.type !== 'object') errors.push(`top-level "type" must be "object" (got ${JSON.stringify(json.type)})`);
  if (!('properties' in json)) {
    errors.push('missing required top-level key "properties"');
  } else if (!isPlainObject(json.properties)) {
    errors.push('"properties" must be an object');
  }
  return errors;
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (FILE_RE.test(name)) out.push(p);
  }
  return out;
}

const schemasDir = path.resolve(process.argv[2] || 'schemas');
let files;
try {
  files = walk(schemasDir).sort();
} catch (e) {
  console.error(`error: cannot read schemas directory ${schemasDir}: ${e.message}`);
  process.exit(1);
}
if (files.length === 0) {
  console.error(`error: no DT_*.schema.json files found under ${schemasDir}`);
  process.exit(1);
}

let failed = 0;
for (const f of files) {
  const errors = validateFile(f);
  const rel = path.relative(process.cwd(), f).replaceAll(path.sep, '/');
  if (errors.length === 0) {
    console.log(`ok   ${rel}`);
  } else {
    failed++;
    for (const err of errors) console.error(`FAIL ${rel}: ${err}`);
  }
}

console.log(`\n${files.length - failed}/${files.length} schema files valid`);
if (failed > 0) {
  console.error(`${failed} file(s) failed validation`);
  process.exit(1);
}
