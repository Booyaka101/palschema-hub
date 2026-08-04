#!/usr/bin/env node
/**
 * Generates items.json — a per-item VALUE reference for DT_ItemDataTable.
 *
 * The schemas in schemas/ describe field names/types; this file carries the
 * actual row values (ItemActorClass, ItemStaticClass, …) so modders can look
 * up what to copy when reusing in-game assets (see items.html).
 *
 * SOURCE (since 0.4.0): paldb.cc — current-game (Palworld 1.0.2) raw rows,
 * scraped from /en/Items_Table + the per-item detail pages (robots.txt is
 * `Allow: /`). Fields paldb.cc does not render (VisualBlueprintClassSoft,
 * Restore*, GrantEffect*, DropItemType, …) are FILLED from the previous
 * paldex-derived items.json where a row existed in Jan-2024; paldb wins every
 * conflict, and the per-row split is recorded in the top-level `fieldSources`.
 * Rows only in the old file are kept (marked by fieldSources.paldb = []).
 *
 * Parsed fields not present in schemas/v1.0/DT_ItemDataTable.schema.json are
 * DROPPED and the dropped names printed once at the end — that log is how new
 * game fields get discovered. `node scripts/check-items.mjs` is the gate.
 *
 * Detail pages are cached under .cache/paldb/ so re-runs are free.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { parseIndex, parseItemPage, detailUrlFor } from './lib/paldb-parse.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = join(ROOT, '.cache', 'paldb');
const INDEX_URL = 'https://paldb.cc/en/Items_Table';
const USER_AGENT = 'palschema-hub build-items (github.com/Booyaka101/palschema-hub)';
const GAME_VERSION = '1.0.2'; // paldb.cc footer: "v1.0.2 2026/7/29" (matches Steam news)
const CONCURRENCY = 4;
const SPACING_MS = 150; // min gap between network request starts
const RETRIES = 2;
const MAX_404_RATIO = 0.02;

const args = process.argv.slice(2);
const LIMIT = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : Infinity;
if (args.includes('--limit') && !Number.isFinite(LIMIT)) {
  console.error('Usage: node scripts/build-items.mjs [--limit <n-pages>]  (--limit is for smoke tests only)');
  process.exit(1);
}

mkdirSync(CACHE_DIR, { recursive: true });
const cachePath = (key) =>
  join(CACHE_DIR, key.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80) + '_' + createHash('sha1').update(key).digest('hex').slice(0, 8) + '.html');

let lastRequestStart = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Fetch with cache, spacing, and retry/backoff. Returns { html } | { notFound } */
async function fetchPage(url) {
  const file = cachePath(url);
  if (existsSync(file)) return { html: readFileSync(file, 'utf8') };
  for (let attempt = 0; ; attempt++) {
    const wait = Math.max(0, lastRequestStart + SPACING_MS - Date.now());
    if (wait) await sleep(wait);
    lastRequestStart = Date.now();
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
      if (res.status === 404) return { notFound: true };
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      writeFileSync(file, html);
      return { html };
    } catch (e) {
      if (attempt >= RETRIES) throw new Error(`${url}: ${e.message} (after ${RETRIES + 1} attempts)`);
      await sleep(500 * 2 ** attempt);
    }
  }
}

// ---- schema allow-list ------------------------------------------------------
const schema = JSON.parse(readFileSync(join(ROOT, 'schemas', 'v1.0', 'DT_ItemDataTable.schema.json'), 'utf8'));
const SCHEMA_FIELDS = Object.keys(schema.properties);
const fieldOrder = new Map(SCHEMA_FIELDS.map((f, i) => [f, i]));

function coerce(field, value) {
  // paldb renders everything as text; coerce to the schema's type.
  const prop = schema.properties[field];
  const types = Array.isArray(prop.type) ? prop.type : [prop.type];
  if (typeof value !== 'string') return { ok: true, value }; // already typed (Rarity words)
  if (types.includes('boolean')) {
    if (value === '1' || value === 'true') return { ok: true, value: true };
    if (value === '0' || value === 'false' || value === '') return { ok: true, value: false };
    return { ok: false };
  }
  if (types.includes('number') || types.includes('integer')) {
    const n = Number(value.replace(/,/g, ''));
    return Number.isFinite(n) ? { ok: true, value: n } : { ok: false };
  }
  return { ok: true, value };
}

const sortRow = (fields) =>
  Object.fromEntries(Object.entries(fields).sort((a, b) => (fieldOrder.get(a[0]) ?? 999) - (fieldOrder.get(b[0]) ?? 999)));

// ---- 1. index ---------------------------------------------------------------
console.log(`fetching index ${INDEX_URL} …`);
const indexRes = await fetchPage(INDEX_URL).catch((e) => {
  console.error(`FATAL: could not fetch the item index — ${e.message}. Nothing written.`);
  process.exit(1);
});
if (indexRes.notFound) {
  console.error('FATAL: item index returned 404. Nothing written.');
  process.exit(1);
}
const index = parseIndex(indexRes.html);
if (index.items.length < 2000) {
  console.error(
    `FATAL: index parsed only ${index.items.length} items (header says ${index.declaredCount ?? '?'}) — ` +
      'page layout changed or response truncated. Nothing written.'
  );
  process.exit(1);
}
console.log(`index: ${index.items.length} codes (header declares ${index.declaredCount})`);

// One detail page serves every item sharing a display name (variants AND
// distinct same-named items — verified: /en/Gunpowder carries both Codes).
const byName = new Map();
for (const it of index.items) {
  if (!byName.has(it.name)) byName.set(it.name, { name: it.name, url: detailUrlFor(it.name), codes: [] });
  byName.get(it.name).codes.push(it.code);
}
const pages = [...byName.values()].slice(0, LIMIT);
const expectedCodes = new Set(index.items.map((it) => it.code));

// ---- 2. detail pages (concurrency 4) ---------------------------------------
const paldbRows = new Map(); // rowName -> fields (raw strings)
const skipped404 = [];
const parseWarnings = [];
const duplicateCodes = [];
const foreignCodes = new Map(); // non-item entities paldb renders on item pages (rocks, trees…)
let done = 0;

async function worker(queue) {
  for (;;) {
    const page = queue.shift();
    if (!page) return;
    let res;
    try {
      res = await fetchPage(page.url);
      // Some display names have no page (untranslated "en text" TEST items,
      // <characterName> template names) — the internal Code sometimes works as
      // a URL instead (verified: /en/Glider_Legendary). Try each before skipping.
      if (res.notFound) {
        for (const code of page.codes) {
          res = await fetchPage('https://paldb.cc/en/' + encodeURIComponent(code));
          if (!res.notFound) break;
        }
      }
    } catch (e) {
      skipped404.push(`${page.name} (${e.message})`);
      continue;
    }
    if (res.notFound) {
      skipped404.push(page.name);
      continue;
    }
    const { entries, warnings } = parseItemPage(res.html);
    for (const w of warnings) parseWarnings.push(`${page.name}: ${w}`);
    if (!entries.length) parseWarnings.push(`${page.name}: page parsed to zero variant blocks`);
    for (const { rowName, fields } of entries) {
      // Item pages also render OTHER DataTables' entities as variant-shaped blocks
      // (e.g. /en/Coal carries the mineable rock "DamagableRock0004" with Hp/Defense
      // pal-object stats). Only Codes the item index lists are DT_ItemDataTable rows.
      if (!expectedCodes.has(rowName)) {
        foreignCodes.set(rowName, page.name);
        continue;
      }
      if (paldbRows.has(rowName)) {
        duplicateCodes.push(`${rowName} (again on ${page.name} — first occurrence kept)`);
        continue;
      }
      paldbRows.set(rowName, fields);
    }
    if (++done % 200 === 0) console.log(`  ${done}/${pages.length} pages…`);
  }
}
const queue = [...pages];
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)));
console.log(`detail pages: ${done} fetched/cached, ${skipped404.length} skipped, ${paldbRows.size} rows parsed`);

if (skipped404.length / pages.length > MAX_404_RATIO) {
  console.error(
    `FATAL: ${skipped404.length}/${pages.length} detail pages failed (> ${MAX_404_RATIO * 100}%) — ` +
      'paldb.cc layout/URL scheme likely changed. Nothing written.\nFailed: ' +
      skipped404.slice(0, 20).join(', ')
  );
  process.exit(1);
}

// ---- 3. schema filter + coercion --------------------------------------------
const droppedFields = new Map(); // field -> count
const badValues = [];
const items = {};
for (const [rowName, raw] of paldbRows) {
  const fields = {};
  for (const [f, v] of Object.entries(raw)) {
    if (!SCHEMA_FIELDS.includes(f)) {
      droppedFields.set(f, (droppedFields.get(f) ?? 0) + 1);
      continue;
    }
    const c = coerce(f, v);
    if (!c.ok) {
      badValues.push(`${rowName}.${f} = ${JSON.stringify(v)} (expected ${schema.properties[f].type}) — field skipped`);
      continue;
    }
    fields[f] = c.value;
  }
  items[rowName] = fields;
}

// ---- 4. merge with the previous paldex-derived items.json -------------------
// paldb wins every conflict; the old file only FILLS fields paldb cannot see.
// Idempotent across re-runs: once items.json carries fieldSources, only the
// fields recorded as paldex-sourced are treated as paldex baseline.
const fieldSources = {};
let prev = null;
const prevPath = join(ROOT, 'items.json');
try {
  prev = JSON.parse(readFileSync(prevPath, 'utf8'));
} catch {
  console.log('note: no previous items.json to merge — paldb.cc data only');
}
const paldexBaseline = new Map(); // rowName -> {field: value} (schema-filtered)
if (prev?.items) {
  for (const [rowName, row] of Object.entries(prev.items)) {
    const paldexFields = prev.fieldSources
      ? (prev.fieldSources[rowName]?.paldex ?? [])
      : Object.keys(row); // pre-0.4.0 file: everything in it is paldex-derived
    const base = {};
    for (const f of paldexFields) {
      if (SCHEMA_FIELDS.includes(f) && f in row) base[f] = row[f]; // drops dead SortID
    }
    paldexBaseline.set(rowName, base);
  }
}

const paldexOnlyRows = [];
for (const [rowName, base] of paldexBaseline) {
  if (!Object.keys(base).length && !(rowName in items)) continue; // nothing real to keep
  if (rowName in items) {
    const fill = Object.fromEntries(Object.entries(base).filter(([f]) => !(f in items[rowName])));
    fieldSources[rowName] = { paldb: Object.keys(items[rowName]).sort(), paldex: Object.keys(fill).sort() };
    items[rowName] = { ...items[rowName], ...fill };
  } else {
    paldexOnlyRows.push(rowName);
    items[rowName] = base;
    fieldSources[rowName] = { paldb: [], paldex: Object.keys(base).sort() };
  }
}
for (const rowName of Object.keys(items)) {
  if (!fieldSources[rowName]) fieldSources[rowName] = { paldb: Object.keys(items[rowName]).sort(), paldex: [] };
  items[rowName] = sortRow(items[rowName]);
}

const missingCodes = [...expectedCodes].filter((c) => !(c in items));

// ---- 5. write ---------------------------------------------------------------
// _provenance.sourceCommit stays the paldex dump file's sha — the weekly cron
// still compares it to detect a fresh paldex dump worth re-merging.
let paldexSourceCommit = prev?._provenance?.sourceCommit;
if (!paldexSourceCommit) {
  try {
    const res = await fetch(
      'https://api.github.com/repos/blaynem/paldex/commits?path=' +
        encodeURIComponent('data-provider/palworld-assets/DataTable/Item/DT_ItemDataTable.json') +
        '&per_page=1',
      { headers: { 'User-Agent': USER_AGENT } }
    );
    if (res.ok) paldexSourceCommit = (await res.json())[0]?.sha;
  } catch {
    /* offline — omit */
  }
}

const out = {
  generatedAt: new Date().toISOString(),
  table: 'DT_ItemDataTable',
  source: `paldb.cc (Palworld ${GAME_VERSION}) + blaynem/paldex Jan-2024 dump for paldb-invisible fields`,
  note:
    `Per-item row VALUES (ItemActorClass etc.) for asset reuse in PalSchema mods. ` +
    `Scraped from paldb.cc per-item pages (current game, Palworld ${GAME_VERSION}, 2026-07-29); ` +
    `fields paldb.cc does not render are filled from the Jan-2024 paldex dump where the row existed then — ` +
    `paldb wins every conflict; see fieldSources for the per-row split. ` +
    `Rows are internal Codes (e.g. SFHelmet = Hexolite Helmet). Field names/types: schemas/ and index.html.`,
  _provenance: {
    source: 'paldb.cc/en/Items_Table + per-item detail pages',
    gameVersion: GAME_VERSION,
    gameVersionDate: '2026-07-29',
    valuesCurrent: true,
    mergeSource: 'github.com/blaynem/paldex (Jan-2024) — fill-only, never overrides paldb',
    rowCount: Object.keys(items).length,
    paldbRowCount: paldbRows.size,
    paldexOnlyRows,
    ...(paldexSourceCommit ? { sourceCommit: paldexSourceCommit } : {}),
  },
  count: Object.keys(items).length,
  items,
  // same key order as items — keeps regeneration diffs clean
  fieldSources: Object.fromEntries(Object.keys(items).map((k) => [k, fieldSources[k]])),
};

if (Number.isFinite(LIMIT)) {
  console.log(`--limit ${LIMIT}: smoke run only — NOT writing items.json (${out.count} rows parsed)`);
} else {
  writeFileSync(join(ROOT, 'items.json'), JSON.stringify(out, null, 1) + '\n');
}

// ---- 6. report --------------------------------------------------------------
if (skipped404.length) console.log(`\nskipped pages (${skipped404.length}): ${skipped404.join(', ')}`);
if (foreignCodes.size)
  console.log(
    `\nnon-item entities ignored (${foreignCodes.size}): ` +
      [...foreignCodes.entries()].slice(0, 10).map(([c, p]) => `${c} (on ${p})`).join(', ') +
      (foreignCodes.size > 10 ? ', …' : '')
  );
if (duplicateCodes.length)
  console.log(`\nWARN duplicate Codes across pages (${duplicateCodes.length}): ${duplicateCodes.slice(0, 10).join('; ')}`);
if (parseWarnings.length) console.log(`\nWARN parse (${parseWarnings.length}): ${parseWarnings.slice(0, 10).join('; ')}`);
if (badValues.length) console.log(`\nWARN non-numeric values skipped (${badValues.length}): ${badValues.slice(0, 10).join('; ')}`);
if (missingCodes.length)
  console.log(`\nWARN index codes with no parsed row (${missingCodes.length}): ${missingCodes.slice(0, 20).join(', ')}`);
if (droppedFields.size)
  console.log(
    `\ndropped fields not in the schema (new-game-field radar):\n  ` +
      [...droppedFields.entries()].map(([f, c]) => `${f} (${c} rows)`).join('\n  ')
  );
console.log(
  `\nitems.json ${Number.isFinite(LIMIT) ? 'smoke-parsed' : 'written'}: ${out.count} items ` +
    `(${paldbRows.size} live from paldb.cc/Palworld ${GAME_VERSION}, ${paldexOnlyRows.length} legacy paldex-only)`
);
