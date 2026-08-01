PalSchema Hub — Community Schema Registry (offline archive)
============================================================

A complete, self-contained copy of the PalSchema Hub schema registry:
31 Palworld gameplay DataTables (DT_PalMonsterParameter, DT_ItemDataTable,
DT_ItemRecipeDataTable, DT_BuildObjectDataTable, DT_PalDropItem,
DT_WazaDataTable, ...) with every raw-table field name, type, example values
and enum value lists — verified against the current game's row structs
(July 2026 SDK headers) and cross-checked with real dumped row data.

Plus a per-item VALUE reference and a VERSION DIFF showing what changed in
the game's row structs between Palworld versions.

NEW IN THIS VERSION (registry v0.3.0, 2026-08-01)
  * Palworld 1.0.2 covered. The whole 1.0.2 patch line (v1.0.2,
    v1.0.2.100993 "Mod Support Improvement", v1.0.2.101103) changed NO
    DataTable row structs, so if your mod worked on 1.0 it needs no field
    migration. Verified, not assumed: the decompiled SDK has not been
    regenerated since 1.0 (head 62fad41, 2026-07-11).
  * items.json / items.html now state their data age up front (see below).

WHAT'S IN THIS ARCHIVE
----------------------
  schemas/v1.0/*.schema.json   31 JSON Schemas, one per DataTable (+ manifest)
  schemas/index.json           machine-readable table listing
  index.json                   registry catalog
  index.html                   the searchable schema browser (see below)
  items.html / items.json      per-item value reference for DT_ItemDataTable
                               (947 items: ItemActorClass / ItemStaticClass /
                               ItemDynamicClass + full row JSON to copy)
  diff.html                    version-diff viewer (what changed between
                               Palworld versions)
  versions.json                Palworld version -> pinned SDK commit
  structs/<version>.json       12 row-struct snapshots, 0.3.1 through 1.0
  diffs/<a>..<b>.json + .md    field-level deltas for every version pair
  cli/                         the palschema-validate CLI (MIT)
  LICENSE                      MIT

LOOK UP A FIELD (no tools needed)
---------------------------------
Open any schemas/v1.0/DT_*.schema.json in a text editor. Every field lists
its type, an example value from real game data, and enum values where known.

WHAT CHANGED BETWEEN GAME VERSIONS
----------------------------------
Open diffs/0.7.2..1.0.md in any text editor to see exactly which row-struct
fields 1.0 added, removed or retyped, and which DT_* tables each change hits.
Across the 30 covered registry tables, 1.0 removed exactly ONE field:
OverridePartnerSkillTextID on PalCharacterParameterDatabaseRow (used by both
DT_PalMonsterParameter and DT_PalHumanParameter), replaced by the split pair
OverridePartnerSkillNameTextID + OverridePartnerSkillDescTextID.

Scan your own mod for fields a patch broke:
    npx palschema-validate --migrate 0.7.2..1.0 my-mod/

It prints one line per affected field (with a labelled possible-rename note)
and exits 1 if anything broke, so it drops straight into CI.

Note: Palworld 0.7.3, 1.0.1 and the 1.0.2 line shipped no row-struct changes,
so they are recorded as aliases of 0.7.2 / 1.0 / 1.0 — those pairs report
"no row-struct changes" rather than inventing a diff. For example:

    npx palschema-validate --migrate 1.0.1..1.0.2 my-mod/
    -> no row-struct changes between 1.0.1 and 1.0.2
       (both alias Palworld 1.0, SDK 62fad41)   [exit 0]

HOW CURRENT IS EACH PART? (read this before trusting a value)
-------------------------------------------------------------
Field NAMES and TYPES — the schemas, the version diffs, the --migrate scan —
are verified against the CURRENT game's row structs (PalworldModdingKit SDK
headers @62fad41). That part is 1.0.2-current.

Row VALUES in items.json / items.html are NOT. They come from the only public
DataTable dump that exists, frozen at Jan 2024 (Palworld 0.1.x): 947 item rows
versus the 2466 in today's DT_ItemDataTable (paldb.cc, checked 2026-08-01), so
items added after Jan 2024 — AncientHelmet among them — are simply absent.
If you search items.html and an item is not there, that means the data is old,
NOT that the item does not exist. The page says so on every row. The moment a
current row-value dump is published the table re-points to it with one command
(scripts/build-items.mjs --src <dump>).

BROWSE WITH THE UI
------------------
index.html, items.html and diff.html need to be served over HTTP (browsers
block file:// data loads). From this folder run either:
    npx serve .
    python -m http.server 8080
then open http://localhost:8080. Or just use the always-current hosted copy:
    https://booyaka101.github.io/palschema-hub/

VALIDATE YOUR MOD'S JSON
------------------------
Online (simplest, always latest schemas):
    npx palschema-validate --version 1.0 my-mod/DT_PalMonsterParameter.json

Fully offline against this archive (one-time npm install for the CLI's deps):
    cd cli
    npm install
    node dist/index.js --version 1.0 --registry .. ..\my-mod\DT_PalMonsterParameter.json

It reports typed errors — unknown/renamed fields, wrong value types — before
you ever launch the game (the same mistakes PalSchema logs as "Property not
found in Row" at load time).

LINKS
-----
  Live browser   :  https://booyaka101.github.io/palschema-hub/
  Version diff   :  https://booyaka101.github.io/palschema-hub/diff.html
  Source (MIT)   :  https://github.com/Booyaka101/palschema-hub
  CLI on npm     :  https://www.npmjs.com/package/palschema-validate
  Pal Schema     :  https://www.nexusmods.com/palworld/mods/2361  (by Okaetsu)

This archive contains no game assets. Schema data derived from the public
paldex game-data dump (blaynem) and PalworldModdingKit SDK headers (localcc),
verified July 2026. License: MIT.
