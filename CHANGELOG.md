# Changelog — palschema-hub / palschema-validate

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
