#!/usr/bin/env node
/**
 * Generates buildings.json — per-building row VALUES for the two build tables
 * (issue #21: someone on the Nexus page wanted every value for one specific
 * building and the hub had nowhere to get it).
 *
 * A building spans two DataTables sharing one row name (e.g. HatchingPalEgg):
 *   DT_MapObjectMasterDataTable — world-object side (Hp, Defense, DeteriorationDamage…)
 *   DT_BuildObjectDataTable     — build side (TypeA/TypeB, Rank, SortId, BuildExpRate…)
 *
 * SOURCE: paldb.cc construction category pages + per-building detail pages
 * (robots.txt is `Allow: /`). Building pages render RAW field names, so each
 * scraped field is routed to whichever schema declares it — the two schemas
 * share no field, so routing is unambiguous; unrouted labels (Worker Max,
 * Workload, …) are display-side derivations and land under `display`.
 * paldb does not render BlueprintClassName, RequiredBuildWorkAmount,
 * Material1..4_Id codes, or DT_TechnologyRecipeUnlock rows — materials are
 * captured by item display name and mapped back to item Codes through the
 * item index (unique-name mappings only).
 *
 * Pages are cached under .cache/paldb-buildings/<game-version>/; --refresh
 * re-fetches. The paldb footer version is asserted against GAME_VERSION so a
 * scrape can never mislabel which build the values belong to.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { parseDetailPage, parseIndex, detailUrlFor, parseFooterVersion, decodeEntities } from './lib/paldb-parse.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const USER_AGENT = 'palschema-hub build-buildings (github.com/Booyaka101/palschema-hub)';
const GAME_VERSION = '1.0.3'; // paldb.cc footer: "v1.0.3 2026/8/12" — asserted below
const CACHE_DIR = join(ROOT, '.cache', 'paldb-buildings', GAME_VERSION);
const CONCURRENCY = 4;
const SPACING_MS = 150;
const RETRIES = 2;
const MAX_404_RATIO = 0.02;

// The Construction dropdown on every paldb page lists exactly these indexes.
const CATEGORIES = [
  'Production', 'Pal', 'Storage', 'Food', 'Infrastructure',
  'Lighting', 'Foundations', 'Defenses', 'Furniture', 'Other',
];

const args = process.argv.slice(2);
const REFRESH = args.includes('--refresh');
const LIMIT = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : Infinity;
if (args.includes('--limit') && !Number.isFinite(LIMIT)) {
  console.error('Usage: node scripts/build-buildings.mjs [--refresh] [--limit <n-pages>]  (--limit is for smoke tests only)');
  process.exit(1);
}

mkdirSync(CACHE_DIR, { recursive: true });
const cachePath = (key) =>
  join(CACHE_DIR, key.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80) + '_' + createHash('sha1').update(key).digest('hex').slice(0, 8) + '.html');

let lastRequestStart = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(url) {
  const file = cachePath(url);
  if (!REFRESH && existsSync(file)) return { html: readFileSync(file, 'utf8') };
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

// ---- schemas: routing + coercion --------------------------------------------
const TABLES = ['DT_MapObjectMasterDataTable', 'DT_BuildObjectDataTable'];
const schemas = Object.fromEntries(
  TABLES.map((t) => [t, JSON.parse(readFileSync(join(ROOT, 'schemas', 'v1.0', `${t}.schema.json`), 'utf8'))])
);
const routeFor = new Map(); // field -> table (the two schemas share no real field)
for (const t of TABLES) {
  for (const f of Object.keys(schemas[t].properties)) {
    if (f === '$Filters') continue;
    if (routeFor.has(f)) {
      console.error(`FATAL: field "${f}" is declared by both build schemas — routing is ambiguous. Nothing written.`);
      process.exit(1);
    }
    routeFor.set(f, t);
  }
}

function coerce(table, field, value) {
  const prop = schemas[table].properties[field];
  const types = Array.isArray(prop.type) ? prop.type : [prop.type];
  if (typeof value !== 'string') return { ok: true, value };
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

// Bare enum tokens expand to the long form the raw tables carry
// (paldb prints TypeA "Pal" — the row value is "EPalBuildObjectTypeA::Pal").
const ENUM_PREFIX = { TypeA: 'EPalBuildObjectTypeA::', TypeB: 'EPalBuildObjectTypeB::' };

// ---- 1. category indexes ----------------------------------------------------
// Each category page lists its buildings as
//   <a data-hover="?s=MapObjects%2F<RowName>" href="<DisplaySlug>">,
// grouped under productUiDisplayTitle subheadings.
const ENTRY_RE = /(?:<div class="productUiDisplayTitle[^"]*">([^<]+)<\/div>)|<a data-hover="\?s=MapObjects%2F([^"]+)" href="([^"]+)">/g;

const pagesByName = new Map(); // display slug -> { slug, mapObjectIds:[], categories:[], group }
let footer = null;
for (const cat of CATEGORIES) {
  const res = await fetchPage(`https://paldb.cc/en/${cat}`).catch((e) => {
    console.error(`FATAL: could not fetch category index ${cat} — ${e.message}. Nothing written.`);
    process.exit(1);
  });
  if (res.notFound) {
    console.error(`FATAL: category index /en/${cat} returned 404 — paldb layout changed. Nothing written.`);
    process.exit(1);
  }
  footer ??= parseFooterVersion(res.html);
  let group = '';
  let found = 0;
  for (const m of res.html.matchAll(ENTRY_RE)) {
    if (m[1] !== undefined) {
      group = m[1].trim();
      continue;
    }
    const id = decodeEntities(decodeURIComponent(m[2]));
    const slug = decodeEntities(m[3]);
    if (!pagesByName.has(slug)) pagesByName.set(slug, { slug, mapObjectIds: [], categories: [], group });
    const e = pagesByName.get(slug);
    if (!e.mapObjectIds.includes(id)) e.mapObjectIds.push(id);
    if (!e.categories.includes(cat)) e.categories.push(cat);
    found++;
  }
  console.log(`  ${cat}: ${found} entries`);
}
if (pagesByName.size < 150) {
  console.error(`FATAL: only ${pagesByName.size} buildings across ${CATEGORIES.length} category pages — layout changed. Nothing written.`);
  process.exit(1);
}
if (!footer) {
  console.error('FATAL: could not read the paldb.cc version footer. Nothing written.');
  process.exit(1);
}
if (footer.version !== GAME_VERSION) {
  console.error(
    `FATAL: paldb.cc is serving Palworld ${footer.version} (${footer.date}) but GAME_VERSION says ${GAME_VERSION}. ` +
      'Update the constant (and re-scrape with --refresh) rather than mislabelling the values. Nothing written.'
  );
  process.exit(1);
}
console.log(`index: ${pagesByName.size} buildings; paldb.cc footer: Palworld ${footer.version} (${footer.date})`);

// ---- item display-name -> Code map (for materials) --------------------------
// The item index is what build-items.mjs scrapes; only UNIQUE display names map
// (a name shared by several Codes stays unmapped rather than guessing).
const itemCodeByName = new Map();
{
  const res = await fetchPage('https://paldb.cc/en/Items_Table').catch(() => null);
  if (res?.html) {
    const counts = new Map();
    for (const it of parseIndex(res.html).items) {
      counts.set(it.name, (counts.get(it.name) ?? 0) + 1);
      itemCodeByName.set(it.name, it.code);
    }
    for (const [name, n] of counts) if (n > 1) itemCodeByName.delete(name);
  } else {
    console.log('note: item index unavailable — material item Codes omitted this run');
  }
}

// ---- 2. detail pages --------------------------------------------------------
const MATERIAL_RE =
  /<div class="d-flex justify-content-between p-1 align-items-center border-top">\s*<div><a class="itemname"[^>]*href="([^"]+)"[^>]*>(?:<img[^>]*\/?>)?\s*([^<]+)<\/a><\/div>\s*<div>([^<]*)<\/div>/g;
const DESC_RE = /<div class="card-body py-2">\s*<div>([\s\S]*?)<\/div>/;

const buildings = {};
const skipped404 = [];
const parseWarnings = [];
const droppedLabels = new Map();
const badValues = [];
let done = 0;

async function worker(queue) {
  for (;;) {
    const entry = queue.shift();
    if (!entry) return;
    let res;
    try {
      res = await fetchPage('https://paldb.cc/en/' + entry.slug);
      if (res.notFound) res = await fetchPage(detailUrlFor(entry.slug.replace(/_/g, ' ')));
    } catch (e) {
      skipped404.push(`${entry.slug} (${e.message})`);
      continue;
    }
    if (res.notFound) {
      skipped404.push(entry.slug);
      continue;
    }
    // No label map, no rarity words, and the BUILDING enum prefixes — the item
    // mappings would misroute raw building fields (Defense, TypeA, ...).
    const { entries, warnings } = parseDetailPage(res.html, { enumPrefixes: ENUM_PREFIX });
    for (const w of warnings) parseWarnings.push(`${entry.slug}: ${w}`);
    // Building pages carry ONE Stats block for the building itself; any extra
    // blocks belong to entities paldb renders alongside (produced items etc.) —
    // keep only Codes the category index announced for this page.
    const own = entries.filter((e) => entry.mapObjectIds.includes(e.rowName));
    const chosen = own.length ? own : entries.slice(0, 1);
    if (!chosen.length) {
      parseWarnings.push(`${entry.slug}: no parsable Stats block`);
      continue;
    }
    for (const { rowName, fields } of chosen) {
      if (buildings[rowName]) continue; // one page per building; first parse wins
      const tables = Object.fromEntries(TABLES.map((t) => [t, {}]));
      const display = {};
      for (const [label, raw] of Object.entries(fields)) {
        const table = routeFor.get(label);
        if (!table) {
          display[label] = raw;
          droppedLabels.set(label, (droppedLabels.get(label) ?? 0) + 1);
          continue;
        }
        const c = coerce(table, label, raw); // enum prefixing already done by parseDetailPage
        if (!c.ok) {
          badValues.push(`${rowName}.${label} = ${JSON.stringify(raw)} — skipped`);
          continue;
        }
        tables[table][label] = c.value;
      }
      const materials = [];
      for (const m of res.html.matchAll(MATERIAL_RE)) {
        const name = decodeEntities(m[2]).trim();
        const count = Number(m[3].trim().replace(/,/g, ''));
        if (!name || !Number.isFinite(count)) continue;
        materials.push({ item: name, code: itemCodeByName.get(name) ?? null, count });
      }
      const desc = res.html.match(DESC_RE);
      buildings[rowName] = {
        name: decodeEntities(entry.slug.replace(/_/g, ' ')),
        categories: entry.categories,
        ...(entry.group ? { group: entry.group } : {}),
        ...(desc ? { description: decodeEntities(desc[1].replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim() } : {}),
        tables,
        ...(Object.keys(display).length ? { display } : {}),
        ...(materials.length ? { materials } : {}),
      };
    }
    if (++done % 50 === 0) console.log(`  ${done} pages…`);
  }
}
const queue = [...pagesByName.values()].slice(0, LIMIT);
const total = queue.length;
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)));
console.log(`detail pages: ${done} fetched/cached, ${skipped404.length} skipped, ${Object.keys(buildings).length} buildings parsed`);

if (skipped404.length / total > MAX_404_RATIO) {
  console.error(
    `FATAL: ${skipped404.length}/${total} detail pages failed (> ${MAX_404_RATIO * 100}%) — ` +
      'paldb layout/URL scheme likely changed. Nothing written.\nFailed: ' + skipped404.slice(0, 20).join(', ')
  );
  process.exit(1);
}

// ---- 3. write ---------------------------------------------------------------
const sorted = Object.fromEntries(Object.keys(buildings).sort().map((k) => [k, buildings[k]]));
const out = {
  generatedAt: new Date().toISOString(),
  tables: TABLES,
  source: `paldb.cc construction category pages (Palworld ${GAME_VERSION})`,
  note:
    `Per-building row VALUES for the two build tables, which share one row name per building ` +
    `(e.g. HatchingPalEgg in both DT_MapObjectMasterDataTable and DT_BuildObjectDataTable; the unlocking ` +
    `DT_TechnologyRecipeUnlock row prefixes it, e.g. Special_HatchingPalEgg — not rendered by paldb, so not here). ` +
    `Fields are routed to a table by which schema declares them; labels neither schema declares are ` +
    `display-side derivations kept under "display". Materials are captured by display name and mapped to item ` +
    `Codes via the item index where the name is unique; the raw Material1..4_Id/_Count columns are not rendered ` +
    `by paldb. Field names/types: schemas/ and index.html.`,
  _provenance: {
    source: `paldb.cc /en/{${CATEGORIES.join(',')}} + per-building detail pages`,
    gameVersion: GAME_VERSION,
    gameVersionDate: footer.date,
    valuesCurrent: true,
    rowCount: Object.keys(sorted).length,
  },
  count: Object.keys(sorted).length,
  buildings: sorted,
};

if (Number.isFinite(LIMIT)) {
  console.log(`--limit ${LIMIT}: smoke run only — NOT writing buildings.json (${out.count} rows parsed)`);
} else {
  writeFileSync(join(ROOT, 'buildings.json'), JSON.stringify(out, null, 1) + '\n');
}

// ---- 4. report --------------------------------------------------------------
if (skipped404.length) console.log(`\nskipped pages (${skipped404.length}): ${skipped404.join(', ')}`);
if (parseWarnings.length) console.log(`\nWARN parse (${parseWarnings.length}): ${parseWarnings.slice(0, 10).join('; ')}`);
if (badValues.length) console.log(`\nWARN uncoercible values (${badValues.length}): ${badValues.slice(0, 10).join('; ')}`);
if (droppedLabels.size)
  console.log(
    `\ndisplay-only labels (kept under "display", new-game-field radar):\n  ` +
      [...droppedLabels.entries()].sort((a, b) => b[1] - a[1]).map(([f, c]) => `${f} (${c})`).join('\n  ')
  );
console.log(`\nbuildings.json ${Number.isFinite(LIMIT) ? 'smoke-parsed' : 'written'}: ${out.count} buildings (Palworld ${GAME_VERSION})`);
