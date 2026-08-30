# 🧩 palschema-hub

A public **schema registry + browser + validator CLI** for [Palworld](https://store.steampowered.com/app/1623730/Palworld/) **[PalSchema](https://github.com/Okaetsu/PalSchema)** mods.

PalSchema lets modders patch Palworld's DataTables with JSON. But there has been no
browsable list of *what fields each table actually has* — the community has literally
been asking for this ([PalSchema issue #53](https://github.com/Okaetsu/PalSchema/issues/53),
open since Aug 2025). `palschema-hub` fills that gap:

- **`/schemas/v1.0/*.schema.json`** — 31 JSON Schemas, one per moddable DataTable.
- **`/schemas/index.json`** — machine-readable table-name → schema-path listing.
- **`/index.html`** — a zero-build schema browser (GitHub Pages), searchable.
- **`/cli/`** — `palschema-validate`, a CLI (ajv) that validates mod JSON/JSONC in CI or locally.
- **`/.github/workflows/palschema-ci.yml.example`** — drop-in CI for mod repos.

**Compatible with PalSchema 0.6.5 + the [experimental-palworld UE4SS](https://github.com/Okaetsu/RE-UE4SS/releases/tag/experimental-palworld)
build it requires (UE4SS commit `ba2efd55`, release updated August 28 2026).** No
DataTable field, path, or row-validation behavior changed in 0.6.1 → 0.6.5 (checked
against the diffs, not just the release notes). What did change: 0.6.4's
**loader** lets new pals carry ranch suitability through `RanchActionData` in
pals json ([#143](https://github.com/Okaetsu/PalSchema/pull/143)) — a key that
exists only in PalSchema's loader, never on a UE row struct, so this registry
tracks it (and every other loader-implemented key) in
[`structs/loader-overlay.json`](structs/loader-overlay.json), read off the loader
source with per-entry provenance. 0.6.5 rewrote the constraints in PalSchema's own
`assets/schemas/items.schema.json` ([#145](https://github.com/Okaetsu/PalSchema/pull/145)) —
those are now **ported into this registry's item-loader schema** (see
[`structs/upstream-constraints.json`](structs/upstream-constraints.json)), so the
validator catches bad icon paths, out-of-range values and missing new-item fields
it used to wave through. 0.6.3 also fixed `.jsonc` schema application
([#139](https://github.com/Okaetsu/PalSchema/pull/139)) and added unknown-property
warnings to the item loader ([#138](https://github.com/Okaetsu/PalSchema/pull/138)) —
the same warn-don't-reject semantics `palschema-validate` adopted in 0.4.0.
Validated against real published PalSchema mods — see
[`tests/real-mods/SOURCES.md`](tests/real-mods/SOURCES.md).

---

## ⚠️ About the schema data (provenance — read this)

The schemas are built from **two real game-data sources**, cross-checked:

1. **Observed row data** from the public FModel DataTable dump in
   [`blaynem/paldex`](https://github.com/blaynem/paldex) (Jan 2024) — provides real
   example values and observed serialization shapes.
2. **Current-game row structs** from the decompiled SDK
   [`localcc/PalworldModdingKit`](https://github.com/localcc/PalworldModdingKit)
   (commit `62fad41`, pushed 2026-07-11) — authoritative field **names and C++ types**
   for today's Palworld 1.x. Every schema's field list is verified against its row
   struct header (`scripts/augment-from-sdk.mjs`): fields the game added since the
   dump are included (e.g. `InstallMaxNumInBaseCamp`, `CraftExpRate`, drop slots
   6–10), and fields the game removed/renamed are dropped (e.g. `RedialIndex`→`SortId`,
   `PalID`→`PalId`, `HP`→`Hp`). A few moddable tables that postdate the dump entirely
   (e.g. `DT_FieldLotteryNameDataTable`, used by drop-rate mods) are emitted from the
   SDK headers alone via `scripts/derive-sdk-tables.mjs`, with each table→struct
   mapping confirmed by a real mod that patches it.

Typing conventions match PalSchema's own generator and loader (verified in its
`JsonSchemaGenerator.cpp` / `PropertyHelper.cpp` / `PalRawTableLoader.cpp`):

- ints → `integer`, floats → `number`, `FName`/`FString`/`FText` → `string`. Integer-ness
  comes from the SDK header, not from the dump: JSON has no integer type, so 158 `int32`
  columns were typed `number` (and accepted `1.5`) until 0.7.0 aligned them.
- **Arrays accept both PalSchema forms**: a plain `[...]` (replaces the game array) or
  `{"Action": "Clear", "Items": [...]}` (optionally clear, then append).
- Enum fields are `string` and list the current game's enum values in their
  description (both `EEnum::Value` and short `Value` spellings are accepted in-game).
- `$Filters` (PalSchema's wildcard-row filter metadata) is allowed in any row.

This is a **community-derived registry**, *not* the output of PalSchema's own Schema
Generator (UE4SS Debugging Tools → *Pal Schema* tab → *Generate JSON Schema Files* —
a local-only artifact that is not published anywhere). If you run the official
generator, its output can **supersede** these files with zero code changes: drop the
`*.schema.json` files into `schemas/v<palworld_version>/` and run `npm run index`.

> Data credit: DataTable dumps © their extractors ([`blaynem/paldex`](https://github.com/blaynem/paldex));
> SDK headers via [`localcc/PalworldModdingKit`](https://github.com/localcc/PalworldModdingKit).
> PalSchema © [Okaetsu](https://github.com/Okaetsu/PalSchema). This repo only redistributes
> *derived structure* (field names/types), not game assets.

### Proven against real published mods

`npm test` validates four real PalSchema mods from Nexus (provenance:
[`tests/real-mods/SOURCES.md`](tests/real-mods/SOURCES.md)): **Palvolve**,
**Unlimited Buildings**, and **Old School Loot** validate clean (10/10 files);
**Accessory Condenser** gets a warning for one genuinely stale field (`RedialIndex`,
removed from the game) — the same thing PalSchema logs as
`Property 'RedialIndex' not found in Row ...` at load time, caught here before
you ever launch the game (and promoted to a failing error with `--strict`).

---

## The validator CLI: `palschema-validate`

Validates PalSchema mod files. A mod file targets one or more DataTables by name:

```jsonc
{
  "DT_PalDropItem": {
    "ChickenPal000": { "ItemId3": "Pizza", "Rate3": 100.0, "min3": 1, "Max3": 1 }
  }
}
```

The CLI recognizes all three PalSchema mod-file shapes: **raw table files**
(top-level `DT_*` keys, or a `$schema` field / `DT_*`-prefixed filename),
**pal-loader files** (`{ "<CharacterId>": {...} }`, from a `pals/` folder or by
their fields), and **item-loader files** (`{ "<ItemId>": {...} }`, `items/` folder
or fields; a `null` entry is the delete syntax). It fetches the right schema from
the registry — `DT_PalMonsterParameter` plus the loader overlay for pals,
`PalStaticItemData` (derived from the `UPalStaticItemData*` class headers, the set
the item loader actually matches against) for items — validates every row with
**ajv**, and prints field-level errors. `.json` and `.jsonc` behave identically.

Item-loader files also get the **value constraints from PalSchema's own
`items.schema.json` (0.6.5)**, ported field by field in
[`structs/upstream-constraints.json`](structs/upstream-constraints.json):
`IconTexture` must be a `/Game` path whose asset name repeats after the dot
(`T_icon_X.T_icon_X` — a mismatch is reported naming both parts) or a
`$resource/<Mod>/<Image>` import; `VisualBlueprintClassSoft` needs the `_C`
class suffix; `Rarity` is 0–4, `Rank`/`Price` ≥ 0, `MaxStackCount` ≥ 1 (above
9999 warns — the game duplicates items past that); and `Weight`,
`CorruptionFactor`, `Durability`, `SneakAttackRate` and `Recipe.WorkAmount`
must be **float literals** (`1.0`, not `1`) — checked on the raw file text,
because `JSON.parse` erases the difference. The upstream required list
(`Type, IconTexture, TypeA, TypeB, Rank, Rarity, MaxStackCount`, plus
`Product_Count/WorkAmount/Material1_Id/Material1_Count` inside `Recipe`) applies
**only when the entry has a `Type` key**: `Type` is required when adding and
ignored when editing, so a partial patch of an existing item stays valid. A field
used outside its item class — `WazaID` on a Weapon, `HPValue` on a Consumable —
warns with the class that declares it (the loader ignores it; the game also warns
since 0.6.3). The scoping is keyed on `Type` with `if`/`then`, derived from the
SDK class headers — upstream's own per-Type `anyOf` branches don't actually
enforce scope, and its Weapon branch's `AttackPower` is a typo for `AttackValue`
(this registry scopes the real name and doesn't add the typo).

A key the schema doesn't declare is a **warning with a did-you-mean suggestion,
not a rejection** — the semantics PalSchema itself is adopting
([Okaetsu/PalSchema#134](https://github.com/Okaetsu/PalSchema/issues/134)) — so a
legitimately-new game field can never turn into a build-breaking false positive.
Each warning also says whether the game would catch it:

- **Item-loader files:** since 0.6.3 PalSchema itself warns about unknown
  properties at load time ([#138](https://github.com/Okaetsu/PalSchema/pull/138)),
  so there this scan duplicates the in-game warning — its value is catching the
  typo in CI, before anyone launches the game.
- **Pal-loader files:** the pal loader has **no warning branch at all** — an
  unknown key is silently dropped in game ([#134](https://github.com/Okaetsu/PalSchema/issues/134),
  still open). A typo'd pal field is caught by this scan and by nothing else.
- **Raw table files:** the raw loader has always warned in game; behavior here is
  unchanged.

PalSchema's pseudo-keys (`$Filters`, the `{"Action":"Clear","Items":[…]}` array
wrapper) and its loader-implemented keys (`RanchActionData`, `Loot`,
`AbilitiesByLevel`, `Recipe`, `Type`, ... — see
[`structs/loader-overlay.json`](structs/loader-overlay.json)) never warn:

```
WARN mods/pals/mypal.json:Lamball unknown field "rarity" — did you mean "Rarity"? (not caught in game: PalSchema's pal loader silently ignores unknown fields — Okaetsu/PalSchema#134)
1 file validated, 0 errors, 1 unknown-key warning
```

`--palschema-version <v>` targets a specific PalSchema release: loader keys newer
than the target are flagged with the release they need, not a generic
unknown-field message —

```
$ palschema-validate --palschema-version 0.6.3 pals/mynewpal.json
WARN pals/mynewpal.json:MyNewPal "RanchActionData" requires PalSchema >= 0.6.4 when adding new pals; edits to existing pals are unaffected (you targeted 0.6.3) — https://github.com/Okaetsu/PalSchema/pull/143
```

**Exit codes:** 0 = all files pass (warnings alone never fail a run) · 1 = any
type/shape error, breaking `--migrate` field, or bad usage — or any warning when
`--strict` (the CI mode) is given.

```bash
# From any mod repo (schemas fetched from this registry):
npx palschema-validate ./mods/                       # newest known game version
npx palschema-validate --palschema-version 0.6.3 mod.json

# Against the schemas in THIS checkout (no publish needed):
node cli/dist/index.js --registry . tests/valid-mod.json    # exit 0
node cli/dist/index.js --registry . tests/invalid-mod.json  # exit 1
```

**Options**

| flag | meaning |
|---|---|
| `--version <v>` | Palworld version to validate against (default: the newest the registry knows) |
| `--palschema-version <v>` | PalSchema release to target (e.g. `0.6.3`); loader keys newer than it are flagged. Unknown values fail loudly |
| `--migrate <a>..<b>` | scan mods for fields removed/retyped between two game versions (e.g. `0.7.2..1.0`) — mutually exclusive with `--version` |
| `--registry <r>` | schema source: a base URL, **or** a local repo-root path (`.`). Default: `https://raw.githubusercontent.com/<owner>/palschema-hub/main` |
| `--owner <o>` | GitHub owner for the default registry URL (default `Booyaka101`, or `$PALSCHEMA_OWNER`) |
| `--strict` | CI mode: promote warnings to errors (exit 1) |
| `-h, --help` | usage |

---

## Item asset reference (values, not just schemas)

[`items.html`](https://booyaka101.github.io/palschema-hub/items.html) is a searchable per-item
**value** reference for `DT_ItemDataTable` — **2,445 rows, current-game (Palworld 1.0.3,
2026-08-12)**: row name → `ItemActorClass` / `ItemStaticClass` / `ItemDynamicClass` / visual
fields, plus stats (`SortId`, `Rarity`, `Durability`, Defense/Health) and the full row JSON to
copy as a base for variants. Motivated by
[PalSchema #53](https://github.com/Okaetsu/PalSchema/issues/53): cloning an equipment row
without its `ItemActorClass` silently loses the model in-game (the game ships variants by
pointing at another item's actor, e.g. LightzHelmet → `"IronHelmet"`).
Machine-readable: [`items.json`](https://booyaka101.github.io/palschema-hub/items.json).

**Where the data comes from (the 0.4.0 source change).** Until 0.4.0 the values came from the
public paldex FModel dump — frozen at Jan-2024 (947 rows, and the dead field `SortID`, which
the current game renamed to `SortId`, so the file failed our own schema). Now
`scripts/build-items.mjs` scrapes **[paldb.cc](https://paldb.cc/en/Items_Table)** (robots.txt
`Allow: /`; the site tracks the live game — 2,466 listed rows at 1.0.3), one cached page per
item, one row per rarity variant. The scrape reads paldb's own version footer and refuses to
write if it disagrees with the build the script claims to be capturing, and the page cache is
keyed by game version so a balance patch can't be rebuilt from the previous build's HTML. **Merge rule:** fields paldb.cc doesn't render
(`VisualBlueprintClassSoft`, `DropItemType`, `GrantEffect*`, `TechnologyTreeLock`, …) are
filled from the old paldex file where the row existed in Jan-2024; **paldb wins every
conflict**; the per-row split is recorded in the top-level `fieldSources` object; rows only in
the old file are kept (marked by `fieldSources[row].paldb = []`). A few TEST/untranslated
rows have no paldb page and are absent (~20 of 2,466 — reported by the build).

The data is **gated**: `npm run check:items` validates every row against
`schemas/v1.0/DT_ItemDataTable.schema.json` (ajv strict, `additionalProperties: false`) and
asserts freshness — ≥ 2,400 rows, **no `SortID` anywhere**, the 1.0-only `SFHelmet` row
(Hexolite Helmet) present, ≥ 200 real `ItemActorClass` values, `fieldSources` complete. It
runs in `npm test`, so a stale regeneration cannot ship silently. Regenerate any time with
`npm run items` (re-runs are free — pages cache under `.cache/paldb/`); parsed fields that
are **not** in the schema are printed at the end, which is how new game fields get noticed.

## Building reference (two tables, one row name)

[`buildings.html`](https://booyaka101.github.io/palschema-hub/buildings.html) is the same
idea for buildings — **460 rows, current-game (Palworld 1.0.3)** — and untangles the part
people trip on (issue #21): a building spans **two DataTables sharing one row name**.
The Egg Incubator is `HatchingPalEgg` in `DT_MapObjectMasterDataTable` (world-object
side: `Hp`, `Defense`, `DeteriorationDamage`, …) **and** in `DT_BuildObjectDataTable`
(build side: `TypeA`/`TypeB`, `Rank`, `SortId`, `BuildExpRate`, …), while the unlocking
`DT_TechnologyRecipeUnlock` row prefixes it (`Special_HatchingPalEgg`, with
`UnlockBuildObjects: ["HatchingPalEgg"]`). Each building page shows both rows, the
materials mapped back to item Codes, and copy/paste JSON for a raw-table mod.

`scripts/build-buildings.mjs` scrapes paldb.cc's ten construction category pages (which
render the raw field names), routes every field to the table whose schema declares it
(the two schemas share no field name), and refuses to write when paldb's version footer
disagrees with the build it claims to capture. Fields paldb doesn't render
(`BlueprintClassName`, `RequiredBuildWorkAmount`, the raw `Material1..4` columns) are
absent, not zero. Gate: `npm run check:buildings`, run by `npm test`.

### Lottery buildings (the Ancient Relic Recycler)

Not every producing building uses `DT_ItemRecipeDataTable`. The **Ancient Relic Recycler**
(`AncientRelicRecycler`) has no recipe rows at all, which is why searching for
`AncientRelicRecycler_WorldTreeRelic_01`…`_05` turns up nothing (asked on the Nexus posts
tab). Those names are **lottery names**, and the chain runs through three places, only two
of which PalSchema can reach:

1. **The building blueprint** holds `UPalMapObjectRecyclerParameterComponent`, whose
   `RelicItemSettings` is a `TMap<ItemId, FPalRecyclerRelicItemSetting>` mapping each input
   relic (`WorldTreeRelic_01`…`_05`) to a `LotteryName` plus a `RequiredWorkAmount`. This is
   blueprint data, **not** a DataTable, so which relic feeds which lottery (and how long it
   takes) is out of PalSchema's reach.
2. **`DT_FieldLotteryNameDataTable`** — one row per lottery name, holding only
   `ItemSlot1_ProbabilityPercent` … `ItemSlot15_ProbabilityPercent`: the chance each slot
   rolls at all.
3. **`DT_ItemLotteryDataTable`** — the contents. Row keys here are meaningless counters
   (`"1"`, `"2"`, `"3"`, …); the join back to the lottery is the **`FieldName` column**, with
   `SlotNo` / `WeightInSlot` / `StaticItemId` / `MinNum` / `MaxNum` per entry.

So a new recycler output is a new `DT_ItemLotteryDataTable` row under a key the table doesn't
already have (`PalRawTableLoader::Apply` sends unknown keys to `AddRow`):

```json
{
  "DT_ItemLotteryDataTable": {
    "90001": {
      "FieldName": "AncientRelicRecycler_WorldTreeRelic_05",
      "SlotNo": 1,
      "WeightInSlot": 10,
      "StaticItemId": "Blueprint_AncientHelmet_4",
      "MinNum": 1, "MaxNum": 1, "NumUnit": 1
    }
  }
}
```

Two traps. `SlotNo` must be a slot the matching `DT_FieldLotteryNameDataTable` row actually
rolls (`ItemSlotN_ProbabilityPercent > 0`) or the entry can never come out, and `WeightInSlot`
is relative to the other entries sharing that `FieldName` + `SlotNo`, so adding one dilutes
the existing pool rather than stacking on top of it. The same wiring drives the other lottery
consumers (treasure boxes, field drops), which is why `FieldName` values like `Grass01` sit in
the same table.

The short version of this rides on both tables in the
[schema browser](https://booyaka101.github.io/palschema-hub/) — per-table notes live in
[`table-notes.json`](table-notes.json), which `scripts/build-index.mjs` bakes into
`index.json` and `npm run check` gates against drift.

Provenance: read off `PalMapObjectRecyclerParameterComponent.h` and
`PalRecyclerRelicItemSetting.h` in the SDK headers this registry already tracks
([`localcc/PalworldModdingKit@62fad41`](https://github.com/localcc/PalworldModdingKit)). The
**structure** is verified; the recycler's own vanilla rows are not in the value set, so dump
both tables in FModel and filter on `FieldName` before picking slot numbers or weights.

## What changed between game versions

Every Palworld patch can add, remove, or rename DataTable row-struct fields — and a
PalSchema mod that sets a field the game no longer has silently does nothing (or errors
at load). [`diff.html`](https://booyaka101.github.io/palschema-hub/diff.html) shows the
field-level delta between any two game versions, and the CLI scans your mod for it:

```bash
npx palschema-validate --migrate 0.7.2..1.0 ./mods/
```

Real output (a mod setting the pre-1.0 partner-skill text field):

```
palschema-validate · migrate 0.7.2 → 1.0 · 1 file(s)

  ✗ tests/migrate-fixtures/partner-skill.json
      tests/migrate-fixtures/partner-skill.json > DT_PalMonsterParameter > ChickenPal000 > OverridePartnerSkillTextID: removed in 1.0 (was FName) — possible rename to OverridePartnerSkillNameTextID (medium confidence)

1 file(s) scanned · 1 breaking field(s) in 1 file(s)
```

That is a real, verified 1.0 change to `PalCharacterParameterDatabaseRow` (used by both
`DT_PalMonsterParameter` and `DT_PalHumanParameter`): `OverridePartnerSkillTextID` was
removed; `OverridePartnerSkillNameTextID`, `OverridePartnerSkillDescTextID`,
`EnemyWazaCoolTimeRate` (float) and `BestWorkSuitability` (EPalWorkSuitability) were added.
Rename suggestions are **heuristic and labelled**: *high* confidence means an identical C++
type and the same name up to case/underscores (`HP`→`Hp`); *medium* means the same type and
one name derivable from the other by one inserted/deleted substring (the partner-skill case
above); anything else is reported plainly as removed + added with no rename claim.

Each version is pinned to the [localcc/PalworldModdingKit](https://github.com/localcc/PalworldModdingKit)
commit that regenerated `Source/Pal/Public` for that game build (`versions.json`); the parsed
field snapshots are committed under `structs/` and the pairwise deltas under `diffs/`:

| Palworld | SDK commit | date |
|---|---|---|
| 0.3.1 | `5e2ce8f` | 2024-06-28 |
| 0.3.7 | `42e4865` | 2024-09-18 |
| 0.3.8 | `8532ae7` | 2024-09-27 |
| 0.3.9 | `2592597` | 2024-10-01 |
| 0.4.11 | `41acdeb` | 2025-01-09 |
| 0.5.0 | `4a2e161` | 2025-03-21 |
| 0.6.0 | `cac6969` | 2025-06-25 |
| 0.6.4 | `10354a8` | 2025-07-31 |
| 0.7.0 | `b08d51a` | 2025-12-17 |
| 0.7.1 | `e66b515` | 2026-01-26 |
| 0.7.2 | `4dcdc78` | 2026-02-16 |
| 1.0 | `98ee60d` | 2026-07-11 |

> **Alias caveat:** Palworld **0.7.3**, **1.0.1**, the **1.0.2** patch line (v1.0.2 ·
> v1.0.2.100993 "Mod Support Improvement" · v1.0.2.101103) and **1.0.3** ("Balance
> Adjustments & Bug Fixes") shipped **no** row-struct (header) changes, so they alias
> `0.7.2` / `1.0` / `1.0` / `1.0` respectively — the CLI and diff page say so explicitly
> (`--migrate 1.0.1..1.0.2` → "no row-struct changes … both alias Palworld 1.0,
> SDK e663245") instead of pretending a diff exists. Those claims are not assumed: the SDK's
> `Source/Pal/Public` was last regenerated at `98ee60d` (2026-07-11), the commit 1.0 pins,
> and each alias records the shas it was checked against in `versions.json`
> `aliases[...].aliasReason`. Note also that 0.7.0→0.7.2 changed no row structs (those SDK
> updates touched other classes).

**Staleness detection:** `npm run versions:check` compares this repo against the live world on
six axes: the Steam news API's patch titles (newest game version), the PalworldModdingKit
commit list (SDK head, and whether `Source/Pal/Public` regenerated), the newest
[PalSchema](https://github.com/Okaetsu/PalSchema) release vs the version this README claims
compatibility with (`versions.json` `upstream.palSchema`), the live blob sha of PalSchema's
`assets/schemas/items.schema.json` vs the sha the ported item constraints pin (an upstream
schema edit stales the port even before it reaches a release), and `items.json`'s and
`buildings.json`'s own `_provenance.gameVersion` vs the newest game label. Those last two exist
because a **balance** patch moves row VALUES while every struct and sha stays put: 1.0.3 changed
World Tree Holy Water's weight from 1 to 0.1 with an unchanged SDK, so every sha-based check
would have said "current" while the shipped values were a patch behind. Exit 0 in sync
(`registry current: game 1.0.3, SDK e663245, PalSchema 0.6.5, item values 1.0.3, building
values 1.0.3, items.schema.json blob b41a965`), exit 1 stale with one line
naming exactly what moved, exit 2 on network failure — never conflated. It runs as an
informational CI step and in the daily cron, which opens an issue when something actually
moved.

**Auto-bump:** `npm run versions:bump` (`scripts/bump-version.mjs`) handles the one case that
is fully derivable: the game shipped a patch and `Source/Pal/Public` did **not** regenerate,
so the new label is an alias. It re-verifies that against both live sources, writes the
`versions.json` alias entry (evidence in `aliasReason`), and re-runs `snapshot:all` +
`diff:all`. Exit 0 wrote it, 3 refuses because the SDK regenerated and the row structs really
changed (that needs a new pin and a human reading the delta), 4 nothing to do, 2 network.
The daily cron runs it, gates it on the acceptance suite and opens a PR; merging stays manual.
`--dry-run`, `--no-build` and `--check-format` are there for local use.

Regenerate from scratch with `npm run snapshot:all` (downloads the 12 pinned SDK tarballs
into `.cache/`) and `npm run diff:all`. Only **derived field names/types** ship here —
never game assets.

## Run it locally

```bash
# 1. (Re)generate the schema seed + catalog from real game data
#    derive (paldex dump) -> augment (verify fields vs current-game SDK headers,
#    needs the SDK tarball in .cache/ — augment-from-sdk.mjs prints the curl
#    command if missing) -> index
npm run seed          # (needs internet)

# 2. Build the CLI (TypeScript -> JS)
npm run cli:build

# 3. Run the acceptance tests (valid passes, invalid fails, index has >=10 tables)
npm test

# 4. Preview the browser (GitHub Pages serves these exact files, no build)
npm run serve         # -> http://localhost:8080
```

Requirements: Node.js ≥ 18 (uses global `fetch`). Verified on Node 22.

---

## Repo layout

```
schemas/v1.0/*.schema.json   31 per-table JSON Schemas (+ _manifest.json)
schemas/index.json             table-name -> schema-path listing (for Pages consumers)
index.json                     { versions, schemas:{ver:[tables]}, tables:{...} } catalog
table-notes.json               hand-written per-table notes (source; baked into index.json)
index.html                     schema browser (vanilla HTML/CSS/JS, no build step)
items.html + items.json        per-item value reference for DT_ItemDataTable (asset reuse)
diff.html                      version-diff viewer (what changed between game versions)
versions.json                  Palworld version -> pinned SDK commit (plus 0.7.3/1.0.1/1.0.2/1.0.3 aliases + sdkHead)
structs/<ver>.json             12 committed row-struct snapshots (field -> C++ type, ordered) + alias copies
diffs/<a>..<b>.json + .md      pairwise struct deltas (added/removed/retyped + rename notes)
cli/                           palschema-validate (TypeScript -> dist/*.js), ajv strict
tests/                         valid-mod.json, invalid-mod.json, example .jsonc, wrapper-typo
tests/real-mods/               4 real published PalSchema mods (see SOURCES.md)
tests/real-mods-broken/        deliberately-broken real mods (typed-error tests)
tests/migrate-fixtures/        --migrate scan fixtures (partner-skill rename case)
tests/currency-fixtures/       saved Steam-news/commit-list API shapes (the tests re-anchor them to versions.json)
scripts/                       derive-schemas, augment-from-sdk, derive-sdk-tables, snapshot-structs, build-diff, build-index, build-items, check-currency, bump-version, check-index, build-nexus-zip, serve (+ lib/sdk-parse.mjs, lib/version-sources.mjs, lib/paldb-parse.mjs)
nexus/                         offline archive published on Nexus Mods (zip rebuilt by npm run nexus:zip; nexus:check gates it in CI)
.github/workflows/
  pages.yml                    deploys browser + schemas to GitHub Pages (tests gate it)
  palschema-ci.yml.example     CI template for MOD repos
  self-test.yml                this repo's own CI (build + acceptance checks + currency info step)
  refresh-items.yml            daily cron: upstream-dump SHA watch, registry currency check, auto-alias PR
```

---

## 🚀 Live deployments

- **Schema browser:** https://booyaka101.github.io/palschema-hub/ (GitHub Pages, deploy gated on the acceptance tests)
- **Item asset reference:** https://booyaka101.github.io/palschema-hub/items.html (DT_ItemDataTable values)
- **Version diff:** https://booyaka101.github.io/palschema-hub/diff.html (row-struct changes between game versions)
- **CLI on npm:** [`palschema-validate`](https://www.npmjs.com/package/palschema-validate) — `npx palschema-validate --version 1.0 <files>`
- **Announcement:** [PalSchema issue #53](https://github.com/Okaetsu/PalSchema/issues/53#issuecomment-5022177544)
- **Nexus Mods page:** [PalSchema Hub - Community Schema Registry](https://www.nexusmods.com/palworld/mods/4084) (Utilities)
- **Launch post:** [x.com/KillKenny101](https://x.com/KillKenny101/status/2079193124719759775)

## License

MIT (code). See provenance note above for the derived data.
