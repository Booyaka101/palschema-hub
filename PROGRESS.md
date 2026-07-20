# PROGRESS — palschema-hub

**Last updated:** 2026-07-20 (publish session — owner authorized go-live)
**Status:** PUBLISHED. Repo pushed to https://github.com/Booyaka101/palschema-hub,
Pages live at https://booyaka101.github.io/palschema-hub/ (deploy gated on `npm test`,
passed on CI), comment posted on PalSchema issue #53
(https://github.com/Okaetsu/PalSchema/issues/53#issuecomment-5022177544).
**Remaining:** npm publish of the CLI (skipped — no npm login; the issue comment uses
the git-clone fallback) and the Nexus Mods page (manual, needs owner's Nexus login —
see PUBLISHING.md step 4).

## Phase 0 re-verification (2026-07-20)
- **PalSchema 0.6.1 exists** (released 2026-07-19): fixes only (ranch spawn item
  actions + item-handler signatures). **No DataTable field, schema-generator, or
  validation changes vs 0.6.0** → no schema changes required *for 0.6.1 itself*.
- **experimental-palworld UE4SS release exists**, last updated 2026-07-19, based on
  upstream commit **`c838a8a`** — the brief's "commit b50986bd, July 14" was wrong;
  README states the verified commit.
- Cost model: everything local/free. GitHub Pages is free; no keys/accounts needed.

## The big finding this session (and its fix)
Validating **real published PalSchema mods** exposed false positives: the paldex
FModel dump (the schema seed) is **Jan-2024 (Palworld 0.1.x-era)**, but today's game
has added/renamed fields (`InstallMaxNumInBaseCamp`, `CraftExpRate`, `TypeUIDisplay`,
drop slots 6–10, `RedialIndex`→`SortId`, `RequireBossDefeatNum`→`RequireDefeatTowerBoss`,
`HP`→`Hp`…).

**Fix:** `scripts/augment-from-sdk.mjs` — verifies every schema's field list against
the current-game row-struct headers in `localcc/PalworldModdingKit` (Okaetsu, PalSchema's
author, is its top contributor; commit `62fad41`, pushed 2026-07-11; auto-downloaded
tarball in `.cache/`). Adds missing fields (typed from C++), drops removed ones,
handles base-struct inheritance. Wired into `npm run seed`
(derive → augment → sdk-tables → index).

Also encoded PalSchema's exact loader syntax (verified in its source):
- **Arrays**: plain `[...]` = replace; `{"Action": "Clear", "Items": [...]}` =
  clear/append (`PropertyHelper.cpp`). All array fields are now `oneOf` both forms.
- **`$Filters`** row key allowed everywhere (`PalRawTableLoader.cpp` skips it).
- CLI prunes `oneOf` error noise → one precise finding per mistake.

## VERIFIED WORKING (all run against REAL data, 2026-07-20)
- `npm test` → **13/13 PASS**, including:
  - 4 original acceptance tests (index valid, valid-mod 0, invalid-mod 1, JSONC 0).
  - **4 real Nexus-published mods** (`tests/real-mods/`, provenance in `SOURCES.md`):
    Palvolve, Unlimited Buildings, Old School Loot (8 files, **now with 0 unresolved
    tables** — see FieldLottery note below) validate **clean**; Accessory Condenser
    correctly flagged for a genuinely stale `RedialIndex` (true positive — PalSchema
    itself error-logs that field at load).
  - Deliberately-broken real mod → typed errors (`unknown field
    "InstallMaxNumInBaseCampp"`, `must be integer`), exit 1.
  - SDK-only table broken row → `unknown field "ItemSlot16_ProbabilityPercent"`.
- All **31 schemas compile** under the CLI's ajv strict config.
- Array-wrapper cases (now IN the suite via `tests/wrapper-typo.json`):
  `{"Items":[...]}`/`{"Action":"Clear"}`/`{}` pass; typo'd `Itemss`/bad `Action`
  value → single precise errors.

> **Note on the final run:** the FieldLottery addition (31st table + 2 new tests)
> was verified piece-by-piece with direct CLI calls (schema derived w/ 15 fields;
> Old School Loot → 8/8 clean, `grep "No schema"` = 0; broken slot → typed error).
> The single combined `npm test` green banner is pending — the autonomous session's
> phone-approval prompt timed out mid-run. Re-run `npm test` to reproduce 13/13.
- Served site (`npm run serve`): `/`, `/index.json`, `/schemas/index.json`, and
  schema URLs all **200** — the exact layout `pages.yml` deploys.

## Staged for the owner (NOT executed — see PUBLISHING.md)
1. Push repo + enable Pages (`pages.yml` deploys with `npm test` as a gate) →
   `https://booyaka101.github.io/palschema-hub/`.
2. Optional: `cd cli && npm publish` (makes the `npx palschema-validate` line true).
3. Comment on PalSchema issue #53 — final text in `PUBLISH_COMMENT.md`
   (`gh issue comment 53 -R Okaetsu/PalSchema --body-file PUBLISH_COMMENT.md`).
4. Nexus Mods page — title/category/description/zip all prepared in `nexus/`
   (Nexus 403s anonymous/automated access; needs the owner's login).

## Coverage extension this session — SDK-only tables (31st schema)
`DT_FieldLotteryNameDataTable` (used by Old School Loot to reweight chest/oil-rig
drops) has **no paldex row-data source**, so it was the last unresolved table in the
corpus. Its row struct `FPalFieldLotteryName` IS in the SDK, and the mod patches it
with `ItemSlotN_ProbabilityPercent` fields that match the struct exactly — so
`scripts/derive-sdk-tables.mjs` now emits it from headers alone (15 fields, verified
mapping). Wired into `npm run seed` after augment. Registry is now **31 tables**;
Old School Loot validates with **zero** warnings. Add more SDK-only tables by
extending that script's `SDK_ONLY_TABLES` map — but only with a mapping verified by
real mod data or an explicit SDK reference (never on name resemblance).

## Not done / future
- Official Schema Generator output (in-game GUI only) can supersede these schemas
  in place at any time — drop files into `schemas/v<ver>/`, `npm run index`.
- `DT_ItemShopCreateData` (used by some shop mods) is still outside the registry —
  no public row-data source and not in this session's real-mod corpus; add it to
  `derive-sdk-tables.mjs` once its struct mapping is verified. CLI warns-and-skips
  unknown tables by design.
- Version folders for future Palworld patches: `schemas/v<newver>/` + `npm run index`.

## How to resume / rebuild from clean
```
npm run seed        # derive (paldex) -> augment (SDK) -> sdk-tables -> index  (internet)
npm run cli:build   # compile the CLI
npm test            # 13/13 acceptance incl. real-mod corpus
npm run serve       # browser + registry at http://localhost:8080
```
