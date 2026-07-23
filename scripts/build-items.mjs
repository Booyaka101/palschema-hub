#!/usr/bin/env node
/**
 * Generates items.json — a per-item VALUE reference for DT_ItemDataTable.
 *
 * The schemas in schemas/ describe field names/types; this file carries the
 * actual row values (ItemActorClass, ItemStaticClass, …) so modders can look
 * up what to copy when reusing in-game assets (see items.html).
 *
 * Source: the public blaynem/paldex DataTable dump (same seed the schemas
 * were originally derived from). Values come from an earlier game build, so
 * the newest items may be absent until a fresh dump lands — the field
 * PATTERNS are stable across builds.
 */
import { writeFileSync } from 'node:fs';

const SRC = 'https://raw.githubusercontent.com/blaynem/paldex/main/data-provider/palworld-assets/DataTable/Item/DT_ItemDataTable.json';

const res = await fetch(SRC);
if (!res.ok) throw new Error(`fetch ${SRC}: HTTP ${res.status}`);
const dump = await res.json();
const rows = Array.isArray(dump) ? dump[0].Rows : dump.Rows;
if (!rows || typeof rows !== 'object') throw new Error('unexpected dump shape: no Rows');

for (const row of Object.values(rows)) delete row.Editor_RowNameHash; // editor-only noise

const out = {
  generatedAt: new Date().toISOString(),
  table: 'DT_ItemDataTable',
  source: SRC,
  note: 'Per-item row VALUES (ItemActorClass etc.) for asset reuse in PalSchema mods. ' +
    'Derived from the public paldex dump of an earlier game build; newest items may be missing. ' +
    'Field names/types: see schemas/ and index.html.',
  count: Object.keys(rows).length,
  items: rows,
};

writeFileSync(new URL('../items.json', import.meta.url), JSON.stringify(out, null, 1) + '\n');
console.log(`items.json written: ${out.count} items`);
