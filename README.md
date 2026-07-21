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
**Accessory Condenser** is flagged for one genuinely stale field (`RedialIndex`,
removed from the game) — the same thing PalSchema logs as
`Property 'RedialIndex' not found in Row ...` at load time, caught here before
you ever launch the game.

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
table's schema from the registry, validates every row with **ajv (strict mode)**, prints
field-level errors (path + message), and exits **1** on any error, **0** if all pass.

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
| `--version <v>` | Palworld version to validate against (required, e.g. `1.0`) |
| `--registry <r>` | schema source: a base URL, **or** a local repo-root path (`.`). Default: `https://raw.githubusercontent.com/<owner>/palschema-hub/main` |
| `--owner <o>` | GitHub owner for the default registry URL (default `Booyaka101`, or `$PALSCHEMA_OWNER`) |
| `-h, --help` | usage |

---

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
cli/                           palschema-validate (TypeScript -> dist/*.js), ajv strict
tests/                         valid-mod.json, invalid-mod.json, example .jsonc, wrapper-typo
tests/real-mods/               4 real published PalSchema mods (see SOURCES.md)
tests/real-mods-broken/        deliberately-broken real mods (typed-error tests)
scripts/                       derive-schemas, augment-from-sdk, derive-sdk-tables, build-index, check-index, serve
.github/workflows/
  pages.yml                    deploys browser + schemas to GitHub Pages (tests gate it)
  palschema-ci.yml.example     CI template for MOD repos
  self-test.yml                this repo's own CI (build + acceptance checks)
```

---

## 🚀 Live deployments

- **Schema browser:** https://booyaka101.github.io/palschema-hub/ (GitHub Pages, deploy gated on the acceptance tests)
- **CLI on npm:** [`palschema-validate`](https://www.npmjs.com/package/palschema-validate) — `npx palschema-validate --version 1.0 <files>`
- **Announcement:** [PalSchema issue #53](https://github.com/Okaetsu/PalSchema/issues/53#issuecomment-5022177544)
- **Nexus Mods page:** [PalSchema Hub - Community Schema Registry](https://www.nexusmods.com/palworld/mods/4084) (Utilities)
- **Launch post:** [x.com/KillKenny101](https://x.com/KillKenny101/status/2079193124719759775)

## License

MIT (code). See provenance note above for the derived data.
