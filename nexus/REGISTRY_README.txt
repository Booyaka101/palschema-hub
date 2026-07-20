PalSchema Hub — Community Schema Registry (offline archive)
============================================================

A complete, self-contained copy of the PalSchema Hub schema registry:
31 Palworld gameplay DataTables (DT_PalMonsterParameter, DT_ItemDataTable,
DT_ItemRecipeDataTable, DT_BuildObjectDataTable, DT_PalDropItem,
DT_WazaDataTable, ...) with every raw-table field name, type, example values
and enum value lists — verified against the current game's row structs
(July 2026 SDK headers) and cross-checked with real dumped row data.

WHAT'S IN THIS ARCHIVE
----------------------
  schemas/v1.0/*.schema.json   31 JSON Schemas, one per DataTable (+ manifest)
  schemas/index.json           machine-readable table listing
  index.json                   registry catalog
  index.html                   the searchable schema browser (see below)
  cli/                         the palschema-validate CLI (MIT)
  LICENSE                      MIT

LOOK UP A FIELD (no tools needed)
---------------------------------
Open any schemas/v1.0/DT_*.schema.json in a text editor. Every field lists
its type, an example value from real game data, and enum values where known.

BROWSE WITH THE UI
------------------
index.html needs to be served over HTTP (browsers block file:// data loads).
From this folder run either:
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
  Source (MIT)   :  https://github.com/Booyaka101/palschema-hub
  CLI on npm     :  https://www.npmjs.com/package/palschema-validate
  Pal Schema     :  https://www.nexusmods.com/palworld/mods/2361  (by Okaetsu)

This archive contains no game assets. Schema data derived from the public
paldex game-data dump (blaynem) and PalworldModdingKit SDK headers (localcc),
verified July 2026. License: MIT.
