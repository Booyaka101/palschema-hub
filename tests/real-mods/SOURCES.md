# Real-mod validation corpus — provenance

Four real, publicly distributed PalSchema mods (raw-DataTable JSON only; no game
assets). Fetched 2026-07-20. Nexus Mods blocks anonymous/automated downloads
(pages and API return 403 without an account), so files were obtained from the
mods' public distribution and mirrors; each is verifiable at the links below.

| folder | mod | public page |
|---|---|---|
| `unlimited-buildings/` | Unlimited Guild Chests, Expedition Stations and Summoning Altars per base (PalSchema) | https://www.nexusmods.com/palworld/mods/2065 — GitHub mirror: https://github.com/mczubaj/Palworld-Mods (`PalSchema/mods/UnlimitedBuildings`) |
| `accessory-condenser/` | Accessory Condenser — Workbench (PalSchema) | https://www.nexusmods.com/palworld/mods/2106 — GitHub mirror: https://github.com/mczubaj/Palworld-Mods (`PalSchema/mods/AccessoryCondenser`) |
| `palvolve/` | Palvolve — Evolve your Pals (PalSchema) | https://www.nexusmods.com/palworld/mods/3976 |
| `palschemafied-old-school-loot/` | Old School Loot Table ("PalSchemafied" file variant) | https://www.nexusmods.com/palworld/mods/2060 |

## Validation results (2026-07-20, schemas v1.0 after SDK-header augmentation)

- `palvolve` — 1/1 files pass, clean.
- `unlimited-buildings` — 1/1 files pass, clean.
- `palschemafied-old-school-loot` — 8/8 files pass, clean (one warning:
  `DT_FieldLotteryNameDataTable` is outside the 30-table registry — that table
  postdates the Jan-2024 dump and has no public row-data source yet).
- `accessory-condenser` — 2/3 files pass; `build_object.json` has ONE true
  positive: `RedialIndex` was removed/renamed (`SortId`) in the current game.
  PalSchema itself logs `Property 'RedialIndex' not found in Row ...` at load
  (src/Loader/PalRawTableLoader.cpp) and skips the field — the validator
  catches the same stale field before you ever launch the game.

`../real-mods-broken/unlimited-buildings-broken.json` is a deliberately broken
copy (misspelled field name + wrong type) used by the test suite to prove typed
error output.
