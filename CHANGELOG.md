# Changelog — palschema-hub / palschema-validate

## 0.3.0 — 2026-08-01

**Currency + honesty release: Palworld 1.0.2, staleness detection, item-data provenance.**

- **Palworld 1.0.2 in the registry.** The 1.0.2 patch line (v1.0.2 · v1.0.2.100993
  "Mod Support Improvement" · v1.0.2.101103, per the Steam news API for appid 1623730)
  shipped **no** `Source/Pal/Public` header change — the PalworldModdingKit head is still
  `62fad41` (2026-07-11), verified live 2026-08-01 — so `1.0.2` is recorded as an **alias
  of 1.0** (with a machine-readable `aliasReason` naming that sha), exactly like 1.0.1.
  `--migrate 1.0.1..1.0.2` now alias-resolves and prints
  `no row-struct changes between 1.0.1 and 1.0.2 (both alias Palworld 1.0, SDK 62fad41)`
  (exit 0) instead of an unknown-version error; when target files are given, the alias
  fast path now also prints the `N file(s) scanned · 0 breaking field(s)` summary.
  Empty-delta diffs ship for `1.0..1.0.2` **and** `1.0.1..1.0.2` (sibling-alias pairs are
  now first-class), alias struct snapshots ship as `structs/<alias>.json` (so
  `structs/1.0.2.json` never 404s), both diff.html pickers list 1.0.2, and the alias
  banner renders for `?from=1.0&to=1.0.2`.
- **Staleness detection** (`npm run versions:check`, `scripts/check-currency.mjs`):
  compares versions.json against the live Steam news patch titles (sorted by the raw unix
  `date` field — the feed interleaves sources out of order) and the SDK commit list.
  Exit 0 in sync (`registry current: game 1.0.2, SDK 62fad41`); exit 1 stale, one line
  naming exactly what moved (`game 1.0.3 released, registry newest is 1.0.2` /
  `SDK regenerated at <sha>, registry pins <sha>`); exit 2 network failure — never
  conflated. Runs as an informational self-test step and in the weekly cron.
- **The weekly cron no longer hides staleness.** `refresh-items.yml` used to re-derive
  the identical Jan-2024 paldex data every week (guaranteed no-op — the dump is frozen).
  It now does a SHA check of the upstream dump file (vs the new
  `items.json._provenance.sourceCommit`) plus `versions:check`, and only opens an issue
  when something actually moved.
- **Provenance honesty on the 947-row item reference.** `items.json` gains a top-level
  `_provenance` object (`valuesCurrent: false`, `gameEra: "0.1.x (Jan 2024)"`,
  `rowCount: 947`, `upstreamRowCountToday: 2466` per paldb.cc/en/Items_Table checked
  2026-08-01, `knownMissingRows: ["AncientHelmet"]`, …). items.html renders it as a
  persistent amber banner (~60% of today's rows are missing; a search miss means old
  data, **not** a nonexistent item) plus a per-row footnote. `build-items.mjs` gains a
  `--src` override so the day a public 1.0-era row-value dump appears the table is
  re-pointed with one command (none exists as of 2026-08-01 — verified sweep).
- Tests 20 → **27** (1.0.2 alias present/resolving, both 1.0.2 diffs empty, `_provenance`
  shape, check-currency in-sync exit 0 / stale exit 1). diff.html picker ordering fix:
  sibling aliases list after each other (1.0 → 1.0.1 → 1.0.2), not canonical-adjacent.

## 0.2.2 — 2026-07-28

- CLI rebuilt with TypeScript 7.0.2 (nodenext resolution + explicit `types: [node]`) and
  `@types/node` 26. No API change.

## 0.2.1 — 2026-07-27

- **`--migrate` now runs with zero dependencies installed.** `ajv` is loaded lazily and is
  only needed for schema validation; a migration scan reads `versions.json` + the diff JSON
  and nothing else. The offline archive (which ships `cli/dist` without `node_modules`) can
  therefore run a full breaking-change scan with no `npm install` at all.
- If `ajv` is genuinely missing when you *do* validate, the CLI now explains that in one
  sentence (and points out `--migrate` needs no deps) instead of throwing `MODULE_NOT_FOUND`.
- Tests: 20 assertions (2 new — migrate from a directory with no `node_modules` above it,
  and the graceful missing-`ajv` message).

## 0.2.0 — 2026-07-27

**Version-diff engine: see (and scan for) what each Palworld patch changed.**

- **CLI `--migrate <from>..<to>`** (npm package `palschema-validate` 0.2.0): scans PalSchema
  mod files for fields that were **removed or retyped** between two game versions and prints
  one precise line per hit, e.g.
  `mod.json > DT_PalMonsterParameter > ChickenPal000 > OverridePartnerSkillTextID: removed in 1.0 (was FName) — possible rename to OverridePartnerSkillNameTextID (medium confidence)`.
  Exit 1 on any breaking field. Mutually exclusive with `--version`; works with the same
  `--registry` URL/local-path resolution as validation. Downgrade scans (`1.0..0.7.2`)
  invert the published diff.
- **12 pinned row-struct snapshots** (`structs/<version>.json` + `versions.json`): every
  Palworld version from 0.3.1 to 1.0 pinned to the localcc/PalworldModdingKit commit that
  regenerated `Source/Pal/Public` for it (0.3.1=`5e2ce8f`, 0.3.7=`42e4865`, 0.3.8=`8532ae7`,
  0.3.9=`2592597`, 0.4.11=`41acdeb`, 0.5.0=`4a2e161`, 0.6.0=`cac6969`, 0.6.4=`10354a8`,
  0.7.0=`b08d51a`, 0.7.1=`e66b515`, 0.7.2=`4dcdc78`, 1.0=`98ee60d`), parsed with the same
  UPROPERTY parser the schema augmenter uses (field order = struct order, inheritance
  included). **0.7.3 and 1.0.1 shipped no header changes** and are recorded as aliases of
  0.7.2 / 1.0 — the CLI and UI say "no row-struct changes" for those pairs.
- **Pairwise diffs** (`diffs/<a>..<b>.json` + `.md`, all 66 version pairs + alias pairs):
  per struct `added[] / removed[] / retyped[]`, rolled up to the `DT_*` tables that use each
  struct, plus a conservative, always-labelled **rename heuristic** (high = identical C++
  type + same name up to case/`_`; medium = same type + one-substring insertion/deletion;
  otherwise reported plainly with no rename claim).
- **`diff.html`**: version-diff viewer on the Pages site (two version pickers, red/green/amber
  change lists, rename confidence chips, alias banner, deep-linkable `?from=&to=`).
- New scripts: `scripts/snapshot-structs.mjs` (+`npm run snapshot:all`),
  `scripts/build-diff.mjs` (+`npm run diff:all`); shared header parser extracted to
  `scripts/lib/sdk-parse.mjs` (verified byte-identical augment output).
- Tests: 18 acceptance assertions (13 existing + 5 new: worked-example delta reproduction,
  DT_PalDropItem negative control, migrate hit/clean/alias cases).
- npm package metadata: repository/author/homepage/bugs + a real README for the npm page.

Credit: struct data derived from [localcc/PalworldModdingKit](https://github.com/localcc/PalworldModdingKit)
(decompiled SDK headers, maintained by PalSchema's author). Only derived field names/types
ship here — never game assets.

## 0.1.1 — 2026-07-20

- First public release: 31 per-table JSON Schemas (paldex dump seed, field-verified against
  current-game SDK headers), schema browser + GitHub Pages registry, `palschema-validate`
  CLI (ajv strict, JSONC, PalSchema array-wrapper + `$Filters` semantics), 13 acceptance
  tests incl. 4 real published mods. (0.1.0 was deprecated on npm — broken by a stray
  `file:..` dependency.)
- 2026-07-24: `items.html`/`items.json` per-item value reference for `DT_ItemDataTable`.
