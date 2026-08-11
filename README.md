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

**Compatible with PalSchema 0.6.1 + the [experimental-palworld UE4SS](https://github.com/Okaetsu/RE-UE4SS/releases/tag/experimental-palworld)
build it requires (UE4SS commit `c838a8a`, release updated July 19 2026).** PalSchema
0.6.1's release notes contain no DataTable field-name, path, or validation changes vs
0.6.0 (fixes only: ranch spawn item actions + item-handler signatures), so these
schemas apply to both. Validated against real published PalSchema mods — see
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

- ints → `integer`, floats → `number`, `FName`/`FString`/`FText` → `string`.
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

The CLI detects the target table(s) from **top-level `DT_*` keys** (the real PalSchema
format), or falls back to a `$schema` field / `DT_*`-prefixed filename. It fetches each
table's schema from the registry, validates every row with **ajv**, and prints
field-level errors (path + message). Since CLI 0.4.0, a key the registry's row struct
doesn't declare is a **warning with a did-you-mean suggestion, not a rejection** —
the semantics PalSchema itself is adopting
([Okaetsu/PalSchema#134](https://github.com/Okaetsu/PalSchema/issues/134)) — so a
legitimately-new game field can never turn into a build-breaking false positive.
PalSchema's pseudo-keys (`$Filters`, the `{"Action":"Clear","Items":[…]}` array
wrapper) never warn:

```
WARN mods/pals.json:Lamball unknown field "rarity" — did you mean "Rarity"?
1 file validated, 0 errors, 1 unknown-key warning
```

**Exit codes:** 0 = all files pass (warnings alone never fail a run) · 1 = any
type/shape error, breaking `--migrate` field, or bad usage — or any unknown-key
warning when `--strict` (the CI mode) is given.

```bash
# Once published to npm + the registry is on GitHub, from any mod repo:
npx palschema-validate --version 1.0 ./mods/
npx palschema-validate --version 1.0 mod.json

# Right now, against the schemas in THIS checkout (no publish needed):
node cli/dist/index.js --version 1.0 --registry . tests/valid-mod.json    # exit 0
node cli/dist/index.js --version 1.0 --registry . tests/invalid-mod.json  # exit 1
```

**Options**

| flag | meaning |
|---|---|
| `--version <v>` | Palworld version to validate against (e.g. `1.0`) — validate mode |
| `--migrate <a>..<b>` | scan mods for fields removed/retyped between two game versions (e.g. `0.7.2..1.0`) — exactly one of `--version` / `--migrate` |
| `--registry <r>` | schema source: a base URL, **or** a local repo-root path (`.`). Default: `https://raw.githubusercontent.com/<owner>/palschema-hub/main` |
| `--owner <o>` | GitHub owner for the default registry URL (default `Booyaka101`, or `$PALSCHEMA_OWNER`) |
| `--strict` | CI mode: promote unknown-key warnings to errors (exit 1) |
| `-h, --help` | usage |

---

## Item asset reference (values, not just schemas)

[`items.html`](https://booyaka101.github.io/palschema-hub/items.html) is a searchable per-item
**value** reference for `DT_ItemDataTable` — **2,445 rows, current-game (Palworld 1.0.2,
2026-07-29)**: row name → `ItemActorClass` / `ItemStaticClass` / `ItemDynamicClass` / visual
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
`Allow: /`; the site tracks the live game — 2,466 listed rows for 1.0.2), one cached page per
item, one row per rarity variant. **Merge rule:** fields paldb.cc doesn't render
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

> **Alias caveat:** Palworld **0.7.3**, **1.0.1** and the **1.0.2** patch line (v1.0.2 ·
> v1.0.2.100993 "Mod Support Improvement" · v1.0.2.101103) shipped **no** row-struct
> (header) changes, so they alias `0.7.2` / `1.0` / `1.0` respectively — the CLI and diff
> page say so explicitly (`--migrate 1.0.1..1.0.2` → "no row-struct changes … both alias
> Palworld 1.0, SDK 62fad41") instead of pretending a diff exists. The 1.0.2 claim is not
> assumed: the SDK repo's head (`62fad41`, 2026-07-11) predates the whole 1.0.2 patch line
> and has not been regenerated since (recorded in `versions.json` `aliases["1.0.2"].aliasReason`).
> Note also that 0.7.0→0.7.2 changed no row structs (those SDK updates touched other classes).

**Staleness detection:** `npm run versions:check` compares `versions.json` against the live
world — the Steam news API's patch titles (newest game version) and the PalworldModdingKit
commit list (SDK head). Exit 0 in sync (`registry current: game 1.0.2, SDK 62fad41`),
exit 1 stale with one line naming exactly what moved (`game 1.0.3 released, registry newest
is 1.0.2`), exit 2 on network failure — never conflated. It runs as an informational CI step
and in the weekly cron, which opens an issue when something actually moved.

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
index.html                     schema browser (vanilla HTML/CSS/JS, no build step)
items.html + items.json        per-item value reference for DT_ItemDataTable (asset reuse)
diff.html                      version-diff viewer (what changed between game versions)
versions.json                  Palworld version -> pinned SDK commit (plus 0.7.3/1.0.1/1.0.2 aliases + sdkHead)
structs/<ver>.json             12 committed row-struct snapshots (field -> C++ type, ordered) + alias copies
diffs/<a>..<b>.json + .md      pairwise struct deltas (added/removed/retyped + rename notes)
cli/                           palschema-validate (TypeScript -> dist/*.js), ajv strict
tests/                         valid-mod.json, invalid-mod.json, example .jsonc, wrapper-typo
tests/real-mods/               4 real published PalSchema mods (see SOURCES.md)
tests/real-mods-broken/        deliberately-broken real mods (typed-error tests)
tests/migrate-fixtures/        --migrate scan fixtures (partner-skill rename case)
tests/currency-fixtures/       saved Steam-news/commit-list responses for check-currency tests
scripts/                       derive-schemas, augment-from-sdk, derive-sdk-tables, snapshot-structs, build-diff, build-index, build-items, check-currency, check-index, serve (+ lib/sdk-parse.mjs)
.github/workflows/
  pages.yml                    deploys browser + schemas to GitHub Pages (tests gate it)
  palschema-ci.yml.example     CI template for MOD repos
  self-test.yml                this repo's own CI (build + acceptance checks + currency info step)
  refresh-items.yml            weekly cron: upstream-dump SHA watch + registry currency check
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
