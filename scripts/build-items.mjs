#!/usr/bin/env node
/**
 * Generates items.json — a per-item VALUE reference for DT_ItemDataTable.
 *
 * The schemas in schemas/ describe field names/types; this file carries the
 * actual row values (ItemActorClass, ItemStaticClass, …) so modders can look
 * up what to copy when reusing in-game assets (see items.html).
 *
 * PROVENANCE (rendered as a banner by items.html — keep it honest):
 *   - Row VALUES come from the public blaynem/paldex FModel dump, which is
 *     frozen at Jan-2024 (Palworld 0.1.x era). Rows added to the game after
 *     that (e.g. AncientHelmet) are ABSENT — 947 rows here vs 2466 in the
 *     current game's DT_ItemDataTable (paldb.cc/en/Items_Table, 2026-08-01).
 *   - Field NAMES/types are the part verified against the CURRENT game
 *     (localcc/PalworldModdingKit SDK headers) by the schema pipeline.
 *   No public 1.0-era row-value dump exists yet (paldb.cc renders one but has
 *   no JSON/CSV export). The day one lands, re-point this script at it:
 *     node scripts/build-items.mjs --src <url-or-path-to-DT_ItemDataTable.json>
 *   and update DEFAULT_PROVENANCE below.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const DEFAULT_SRC = 'https://raw.githubusercontent.com/blaynem/paldex/main/data-provider/palworld-assets/DataTable/Item/DT_ItemDataTable.json';
// The paldex repo path of the dump file — the weekly cron compares this file's
// latest commit sha against _provenance.sourceCommit to detect upstream updates.
const DEFAULT_SRC_REPO = 'blaynem/paldex';
const DEFAULT_SRC_PATH = 'data-provider/palworld-assets/DataTable/Item/DT_ItemDataTable.json';

// Everything here was live-verified on the stated dates; re-verify when bumping.
const DEFAULT_PROVENANCE = {
  source: 'github.com/blaynem/paldex',
  gameEra: '0.1.x (Jan 2024)',
  fieldNamesVerifiedAgainst: 'localcc/PalworldModdingKit@62fad41',
  valuesCurrent: false,
  upstreamRowCountToday: 2466,
  upstreamRowCountSource: 'paldb.cc/en/Items_Table, checked 2026-08-01',
  knownMissingRows: ['AncientHelmet'],
};

const args = process.argv.slice(2);
const srcIdx = args.indexOf('--src');
const customSrc = srcIdx >= 0 ? args[srcIdx + 1] : undefined;
if (srcIdx >= 0 && !customSrc) {
  console.error('Usage: node scripts/build-items.mjs [--src <url-or-path-to-DT_ItemDataTable.json>]');
  process.exit(1);
}
const SRC = customSrc ?? DEFAULT_SRC;

async function loadDump(src) {
  if (!/^https?:\/\//i.test(src)) return JSON.parse(readFileSync(src, 'utf8'));
  const res = await fetch(src);
  if (!res.ok) throw new Error(`fetch ${src}: HTTP ${res.status}`);
  return res.json();
}

const dump = await loadDump(SRC);
const rows = Array.isArray(dump) ? dump[0].Rows : dump.Rows;
if (!rows || typeof rows !== 'object') throw new Error('unexpected dump shape: no Rows');

for (const row of Object.values(rows)) delete row.Editor_RowNameHash; // editor-only noise

// Pin the upstream commit of the default dump (best-effort — provenance still
// ships without it if the API is unreachable).
let sourceCommit;
if (!customSrc) {
  try {
    const url = `https://api.github.com/repos/${DEFAULT_SRC_REPO}/commits?path=${encodeURIComponent(DEFAULT_SRC_PATH)}&per_page=1`;
    const res = await fetch(url, { headers: { 'User-Agent': 'palschema-hub build-items' } });
    if (res.ok) sourceCommit = (await res.json())[0]?.sha;
  } catch {
    /* offline — omit */
  }
}

const provenance = customSrc
  ? {
      source: customSrc,
      gameEra: 'custom dump — update DEFAULT_PROVENANCE in scripts/build-items.mjs before publishing',
      fieldNamesVerifiedAgainst: DEFAULT_PROVENANCE.fieldNamesVerifiedAgainst,
      valuesCurrent: null,
      rowCount: Object.keys(rows).length,
    }
  : {
      ...DEFAULT_PROVENANCE,
      rowCount: Object.keys(rows).length,
      ...(sourceCommit ? { sourceCommit } : {}),
    };

const out = {
  generatedAt: new Date().toISOString(),
  table: 'DT_ItemDataTable',
  source: SRC,
  note: 'Per-item row VALUES (ItemActorClass etc.) for asset reuse in PalSchema mods. ' +
    'Field NAMES are SDK-verified against the current game; row VALUES are 0.1.x-era (Jan 2024) ' +
    'and rows added after Jan 2024 are absent — see _provenance. Field names/types: schemas/ and index.html.',
  _provenance: provenance,
  count: Object.keys(rows).length,
  items: rows,
};

writeFileSync(new URL('../items.json', import.meta.url), JSON.stringify(out, null, 1) + '\n');
console.log(`items.json written: ${out.count} items (values ${provenance.valuesCurrent === false ? 'NOT current — ' + provenance.gameEra : 'from ' + SRC})`);
