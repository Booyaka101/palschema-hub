# Changelog — palschema-hub / palschema-validate

## 0.7.1 — 2026-08-17

**The Nexus offline archive is rebuilt from the repo instead of by hand.** It was a
committed 207-entry zip with no build script, so it drifted: the copy on the mod page
still described Palworld 1.0.2 item values and PalSchema 0.6.1.

- **`scripts/build-nexus-zip.mjs`** (`npm run nexus:zip`) assembles the archive from
  the current registry, item data, structs, diffs and `cli/dist`, in the same layout
  the published v1.4 archive used so nothing moves for anyone who already downloaded
  it. Entries are written with a fixed timestamp, so two builds of the same content
  are byte-identical and `--check` (`npm run nexus:check`) can tell whether the
  committed zip matches the repo. That check is now a self-test step.
- **Archive text refreshed:** 1.0.3 coverage and the alias reasoning, 1.0.3 item
  values with the two changes a modder would actually notice, the `integer` retyping,
  and PalSchema 0.6.3.
- Content delta vs the published archive: `structs/1.0.3.json` and the three
  `..1.0.3` diffs added, nothing removed.

**Still manual:** uploading the zip and pasting `NEXUS_DESCRIPTION.bbcode` on the mod
page. `PUBLISHING.md` covers it.

## 0.7.0 — 2026-08-17

**158 int32 columns are typed `integer` instead of `number`.** The Jan-2024 paldex
dump is JSON, which has no integer type, so every numeric field it observed became
`number` — `DT_PalDropItem.Level`, `DT_PalHumanParameter.MeleeAttack` and 156 others
accepted `1.5` and only failed in-game. The SDK headers always knew which columns are
`int32`; the augmenter now uses that.

- **`augment-from-sdk.mjs` aligns integer-ness with the headers** for fields that came
  from observed data, and refuses to retype a field whose own observed examples are
  fractional (that would be a real conflict, not a fix). Zero conflicts across all 31
  tables, and all 2,445 rows of `items.json` still validate, so the live game data
  agrees with the headers.
- **Three re-run bugs fixed in the same script**, all found by running it twice:
  the provenance sentence appended a second copy instead of replacing the first;
  `sdkAdded`/`droppedRemovedFields` were erased when a later run added nothing; and
  array fields lost their observed item examples, because after the first pass those
  live at `oneOf[0].items` rather than `.items`. It also no longer touches
  `DT_FieldLotteryNameDataTable`, which `derive-sdk-tables.mjs` owns. A second run is
  now byte-identical to the first.
- Tests 43 → **46**, including a fixture proving `"Level": 1.5` is rejected with
  `must be integer` and that every offending field is named, not just the first.

## 0.6.0 — 2026-08-17

**Item values catch up to 1.0.3, PalSchema compatibility to 0.6.3, and the watcher
learns to see both.** 0.5.0 aliased 1.0.3 correctly and still left the registry a
patch behind, because a balance patch moves row VALUES while every struct and sha
stays put. Nothing was watching that axis.

- **items.json is Palworld 1.0.3** (2,445 rows; paldb.cc footer `v1.0.3 2026/8/12`).
  Three rows actually moved, and they match the patch notes: `WorldTreeHolyWater`
  `Weight` 1 → 0.1, `WaterBuildKit` `Rank` 4 → 2, `SkillCard_Psychokinesis` gains
  `bLegalInGame`.
- **The scrape can no longer mislabel itself.** `build-items.mjs` reads paldb's own
  version footer and refuses to write when it disagrees with the version the script
  claims to capture, and the page cache is keyed by game version. The old flat cache
  was the real trap: every URL is stable across a balance patch, so a re-run would
  have rebuilt 1.0.2 numbers from disk and relabelled them 1.0.3. `--refresh` forces a
  re-fetch regardless.
- **`check-currency` gained two axes.** `items.json._provenance.gameVersion` vs the
  newest game label (the 1.0.3 case, and purely local), and the newest PalSchema
  release vs the version this registry claims compatibility with, recorded in
  `versions.json` `upstream.palSchema`. In sync now prints
  `registry current: game 1.0.3, SDK 62fad41, PalSchema 0.6.3, item values 1.0.3`.
- **PalSchema compatibility is 0.6.3**, checked against the whole 0.6.0 → 0.6.3 diff
  rather than the release notes: no DataTable field is renamed, no path moves, and no
  row validation changes. The one schema-file change is PalSchema's own
  `items.schema.json` relaxing `WorkableAttribute` to `minimum: 0`
  ([#139](https://github.com/Okaetsu/PalSchema/pull/139)), a constraint this registry
  never had. 0.6.2/0.6.3 also add unknown-property warnings to the item loader
  ([#138](https://github.com/Okaetsu/PalSchema/pull/138)), the semantics
  `palschema-validate` shipped in 0.4.0.
- **The items provenance test no longer names a version.** It asserts shape (current
  values, a dated version, ≥ 2400 rows) and leaves freshness to check-currency, which
  reports it as an issue instead of a red build. Tests 41 → **43**.

## 0.5.0 — 2026-08-17

**Palworld 1.0.3 lands as an alias, and the registry now bumps itself.** The weekly
watch could only report staleness; a human then did the same mechanical edit every
time. `scripts/bump-version.mjs` (`npm run versions:bump`) does that edit.

- **Palworld 1.0.3** ("Balance Adjustments & Bug Fixes", Steam news 2026-08-12) is an
  **alias of 1.0**: `Source/Pal/Public` was last regenerated at `98ee60d` (2026-07-11),
  the commit 1.0 pins, and the SDK head is still `62fad41`. Ships
  `structs/1.0.3.json` plus the `1.0..1.0.3`, `1.0.1..1.0.3` and `1.0.2..1.0.3` empty
  deltas. Regenerating every other snapshot and diff produced byte-identical files.
- **`scripts/bump-version.mjs`:** re-verifies both live sources, writes the alias entry
  with its evidence in `aliasReason`, then re-runs `snapshot:all` + `diff:all`. Exit 0
  wrote it / 3 refuses because the SDK regenerated (real header changes need a new pin
  and a human) / 4 nothing to do / 2 network. `--dry-run`, `--no-build`, `--today`,
  `--check-format` and the same fixture flags as check-currency. It rewrites
  `versions.json` with a serializer that reproduces the file's hand-readable style
  byte-for-byte, and refuses to write if that round-trip ever stops matching, so an
  alias addition stays a 5-line diff instead of reflowing the file.
- **`refresh-items.yml` runs daily** (a patch could previously sit undetected for six
  days) and gained a `version-alias` job: run the bump, run the acceptance suite, open
  a PR that closes the stale-registry issue. Merging stays manual, and the workflow
  never pushes to main.
- **`scripts/lib/version-sources.mjs`:** the Steam-news and SDK-commit parsing that
  check-currency owned, now shared with the bump so the two cannot disagree about what
  "newest" means. GitHub API calls send `GITHUB_TOKEN` when present (unauthenticated
  api.github.com is 60/hr per IP, which shared CI egress burns through).
- **Currency tests no longer name a game version.** They rebuild the saved API shapes
  around whatever `versions.json` claims right now, so an alias bump can't rot them
  (the day 1.0.3 shipped, the "1.0.3 is hypothetical" fixture became a lie). Plus new
  tests for the alias path, the refusal path, and one asserting every alias has its
  struct snapshot and diff. Tests 35 → **41**.

## palschema-validate (CLI) 0.4.0 — 2026-08-11

**Unknown keys warn instead of rejecting — with did-you-mean suggestions and a
`--strict` CI gate.** Semantics sourced from
[Okaetsu/PalSchema#134](https://github.com/Okaetsu/PalSchema/issues/134) (gettygoop,
2026-08-05): the framework itself is moving to "validate authored keys against
reflected properties plus documented pseudo-keys, warn with file + row ID and a
case-insensitive suggestion, prefer warnings over rejection". Our published schemas
set `additionalProperties: false`, so until now any field our SDK snapshot didn't
know about — including a legitimately-NEW game field — was a build-breaking AJV
rejection: the exact staleness failure mode this project exists to avoid.

- **Schemas are `additionalProperties`-stripped before AJV compiles them** (in-memory
  clone; the published `schemas/v1.0/*.schema.json` files are byte-unchanged — they
  remain the registry contract other tools consume). AJV now reports only genuine
  type/shape errors.
- **New post-validation `unknownKeys` pass:** each row's own keys are compared
  against the schema's declared properties plus the exported `PSEUDO_KEYS` allowlist
  (`$Filters` row key; the `{"Action":"Clear","Items":[…]}` wrapper legal on any
  array field). Nested objects with their own declared properties are walked
  recursively; deliberately-open structs (`additionalProperties: true`) stay silent.
- **One suggestion per unknown key**, in order: exact case-insensitive match (always
  suggested); else Levenshtein distance ≤ 2 against declared properties, closest
  wins, ties alphabetical; else none.
  `WARN mods/pals.json:Lamball unknown field "rarity" — did you mean "Rarity"?`
- **Exit codes:** warnings alone exit 0; real schema errors still exit 1; new
  `--strict` flag (CI mode) promotes unknown-key warnings to errors and exits 1.
  The summary never claims unqualified success while warnings exist:
  `1 file validated, 0 errors, 2 unknown-key warnings` (validate mode also drops the
  old banner/per-file ✓ lines in favour of this summary).
- **Ported two acceptance tests that asserted the old rejection semantics** to the
  new truth: Accessory Condenser's stale `RedialIndex` now warns (exit 0, still
  named; `--strict` restores the failing gate), and the nonexistent
  `ItemSlot16_ProbabilityPercent` lottery slot is asserted under `--strict`.
  Known-good real mods (Palvolve, Unlimited Buildings, Old School Loot) are now also
  asserted **zero-warning** — an unknown-key false positive on a clean mod fails the
  suite. Tests 29 → **35**. `--migrate` behaviour is unchanged.
- Note: [Okaetsu/PalSchema#133](https://github.com/Okaetsu/PalSchema/issues/133)
  (recipe schema rejecting the vanilla `WorkableAttribute = 0`) does **not** apply to
  this registry — our `WorkableAttribute` has never carried a minimum/default, and
  this release adds no constraints to any schema.

## 0.4.0 — 2026-08-04

**items.json goes current: 947 → 2,445 rows, sourced from paldb.cc (Palworld 1.0.2), with a
schema gate that keeps it honest.**

(The brief for this release targeted "v0.3.0", but 0.3.0 had already shipped with the
currency/provenance work below — so the item-data regeneration ships as 0.4.0.)

- **Source change.** `items.json` was built from the blaynem/paldex FModel dump (Jan-2024,
  Palworld 0.1.x era): 947 rows vs the live game's 2,466, and it shipped the dead field
  `SortID` — which the current game renamed to `SortId`, so **every row failed our own
  `DT_ItemDataTable` schema** (`additionalProperties: false`; the schema's `$comment` records
  `sdkAdded=SortId` / `droppedRemovedFields=SortID`). `scripts/build-items.mjs` is rewritten
  to scrape **paldb.cc** (robots.txt `Allow: /`; footer pins the data to v1.0.2, 2026-07-29):
  index → per-item detail pages (concurrency 4, 150 ms spacing, 2 retries, on-disk cache
  under `.cache/paldb/` so re-runs are free), one row per rarity-variant block
  (`PlasticHelmet` … `PlasticHelmet_5` each with its own `SortId`/`Rarity`). New
  `scripts/lib/paldb-parse.mjs` does the HTML → rows parsing (pure regex/string, exported
  label map; bare enum tokens expand to the long `EPalItemTypeA::…` form the file has always
  used). Entities from OTHER DataTables that paldb renders on item pages (mineable rocks,
  pal stats) are filtered out against the item index.
- **Merge rule.** Fields paldb.cc doesn't render (`VisualBlueprintClassSoft`, `DropItemType`,
  `Restore*` beyond food stats, `GrantEffect*`, `TechnologyTreeLock`, …) are filled from the
  old paldex file where the row existed in Jan-2024; **paldb wins every conflict**; the
  per-row split ships as a top-level `fieldSources` object; 10 rows exist only in the old
  file and are kept (marked `fieldSources[row].paldb = []`). Verified label mappings:
  `Gold Coin`→`Price`, `Health`→`HPValue`, `Defense`→`PhysicalDefenseValue`,
  `Attack`→`PhysicalAttackValue`, `Shield`→`ShieldValue`, `Nutrition`→`RestoreSatiety`,
  `SAN`→`RestoreSanity` (each checked against known paldex values before adoption).
- **SortID is gone** from every row, and 1.0-only items are in — e.g. `SFHelmet` (Hexolite
  Helmet, `SortId` 1325) plus variants, absent from the old 947-row file.
- **The gate: `scripts/check-items.mjs`** (`npm run check:items`, also in `npm test`).
  Validates every row with ajv strict against the v1.0 schema and asserts: ≥ 2,400 rows, no
  `SortID` anywhere, `/^SFHelmet/` present (freshness proof), ≥ 200 rows with a real
  `ItemActorClass`, `fieldSources` covers every row. Exit 1 with rowName + instancePath +
  message (first 20) on any failure — a stale regeneration can no longer ship silently.
- items.html: provenance banner flips from the amber data-age warning to a green
  current-game banner (paldb.cc / Palworld 1.0.2); rows now show Durability / Defense /
  Health / Shield / Attack chips where present, and the per-row footnote names exactly which
  fields were paldex-filled. README's item section rewritten around the new source + gate.
- Tests 27 → **29** (gate passes on the shipped file; a stale two-row fixture carrying
  `SortID` makes the gate exit 1 naming `SortID`). The old "provenance says 947 rows and
  values-not-current" assertion now asserts the opposite — current values, ≥ 2,400 rows —
  because the staleness it guarded against is fixed.

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
