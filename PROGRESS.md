# PROGRESS — palschema-hub

**Last updated:** 2026-08-01 (v0.3.0 currency + honesty session)

## Session 2026-08-01 — v0.3.0: 1.0.2 currency, staleness detection, provenance honesty
Phase-0 verified live (all four): Steam news (appid 1623730) lists the 1.0.2 patch line
(v1.0.2 @1785294504 · "Mod Support Improvement" @1785380721 · v1.0.2.101103 @1785413794,
unix dates from the raw `date` field) with NOTHING newer; PalworldModdingKit head is still
62fad413 (2026-07-11, merge of "Update 1.0" PR line — zero commits since), so 1.0.2 = alias
of 1.0 (not assumed); issue #53 open with Person7557 (2026-07-23) unanswered; paldb.cc
Items_Table header reads "Items /2466" (checked 2026-08-01) vs our 947 rows.
- **versions.json:** `1.0.2` alias of 1.0 with `aliasReason` naming SDK head 62fad41;
  new top-level `sdkHead` {commit, date} that check-currency compares against.
- **snapshot-structs.mjs `all`** now also writes `structs/<alias>.json` (copy of the
  pinned version's, marked aliasOf) — structs/1.0.2.json exists and never 404s.
  **build-diff.mjs `all`** now emits sibling-alias pairs → diffs/1.0.1..1.0.2.json(+md)
  as first-class empty deltas, alongside diffs/1.0..1.0.2. Ran snapshot:all + diff:all;
  regenerated output was byte-identical to committed data (determinism + no SDK drift
  re-confirmed). pages.yml needed NO change (cp -r structs/diffs covers new files).
- **CLI 0.3.0:** alias fast path prints
  "no row-struct changes between 1.0.1 and 1.0.2 (both alias Palworld 1.0, SDK 62fad41)"
  (head sha used only when the shared canonical is the newest version) and, when target
  paths are given, still enumerates them and prints the `N file(s) scanned` summary.
- **scripts/check-currency.mjs** (+`npm run versions:check`): Steam patch titles
  (regex ^v\d, ≥5-digit build components dropped, sorted by raw unix date locally) vs
  newest registry label; SDK head vs versions.json sdkHead — on head mismatch it
  path-filters Source/Pal/Public to distinguish "regenerated" (structs stale) from
  "head moved, no header change". Exit 0 in sync / 1 stale (one line naming what moved) /
  2 network — never conflated. Fixture flags --steam-json/--commits-json/
  --public-commits-json (fixtures in tests/currency-fixtures/). Live run 2026-08-01:
  `registry current: game 1.0.2, SDK 62fad41`, exit 0.
- **refresh-items.yml rewritten:** was re-deriving identical Jan-2024 paldex data weekly
  (exactly what hid the staleness). Now: upstream dump file SHA (GitHub commits API,
  path-filtered) vs `items.json._provenance.sourceCommit` + `versions:check`; opens a
  deduped issue only when something moved. self-test.yml gained the 1.0.1..1.0.2 migrate
  step + an informational (continue-on-error) versions:check step.
- **items.json `_provenance`** (build-items.mjs): valuesCurrent:false, gameEra 0.1.x
  (Jan 2024), fieldNamesVerifiedAgainst PalworldModdingKit@62fad41, rowCount 947,
  upstreamRowCountToday 2466 (paldb.cc, checked 2026-08-01), knownMissingRows
  [AncientHelmet], sourceCommit (paldex dump file's commit — c19739b — for the cron SHA
  check). `--src` override documented in README for the day a real 1.0-era dump appears
  (2026-08-01 sweep: none exists publicly; paldb.cc has no JSON/CSV export).
  **items.html** renders a persistent amber banner (NAMES current-verified, VALUES
  0.1.x-era, ~62% of today's rows missing, "a search miss means old data, not a
  nonexistent item") + per-row-card footnote. diff.html picker-order fix (1.0 → 1.0.1 →
  1.0.2). Both pages verified in headless Chrome incl. deep link ?from=1.0&to=1.0.2
  (alias banner) and ?from=1.0.1&to=1.0.2.
- Tests 20 → **27**, all green. Root + CLI bumped to **0.3.0**; CHANGELOG entries for
  0.2.2 (retroactive) and 0.3.0.

## Session 2026-07-27 — version-diff engine (v0.2.0)
Shipped the "what changed between game versions" lane (answers the follow-up question
of the same issue-#53 audience):
- `versions.json`: 12 Palworld versions pinned to the SDK commits that regenerated
  `Source/Pal/Public` (verified against the path-filtered commit list); 0.7.3 + 1.0.1
  recorded as ALIASES (no header change) — CLI/UI say "no row-struct changes".
- `scripts/lib/sdk-parse.mjs`: UPROPERTY parser/enum extractor/headerFor/fragForType
  extracted from augment-from-sdk.mjs as `createSdkParser(hdrDir)`; **proved
  byte-identical** augment output (old vs new script on same input, diff -r clean).
- `scripts/snapshot-structs.mjs` (+`npm run snapshot:all`): downloads each version's
  SDK tarball (unauthenticated codeload; .cache/sdk-<ver>/), parses every
  FTableRowBase struct + all manifest rowStructs → `structs/<ver>.json` (97→135
  structs across 12 versions, field order = struct order, inheritance included).
  Gotcha: GNU tar on Windows parses `D:\...` as a remote host — extract with cwd +
  relative paths. Extraction success is detected by the tarball root dir, not the
  target dir's existence (interrupted runs).
- `scripts/build-diff.mjs` (+`npm run diff:all`): diffs/<a>..<b>.json+.md for all 66
  ascending pairs + 2 alias pairs. added/removed/retyped per struct, DT_* rollup via
  tableToStruct, conservative labelled rename heuristic (high = same type + name equal
  after lowercase/strip[_ ]; medium = same type + one-substring insertion/deletion,
  primary candidate = first in new-struct field order). VERIFIED: 0.7.2→1.0 reproduces
  the real delta (OverridePartnerSkillTextID removed; NameTextID/DescTextID/
  EnemyWazaCoolTimeRate/BestWorkSuitability added; medium rename note → NameTextID,
  alt DescTextID; affects DT_PalMonsterParameter + DT_PalHumanParameter) and the
  negative control (DT_PalDropItem unchanged). Also true: 0.7.0→0.7.2 changed NO row
  structs (those SDK commits touched other classes).
- `diff.html`: two version pickers (aliases inline as "0.7.3 (= 0.7.2)"), red/green/
  amber lists, confidence chips, alias banner, auto-swap note for newer→older picks,
  deep-linkable ?from=&to=. Rendered + verified in headless Chrome (alias banner,
  reversed pair, nav link from index.html). pages.yml stages diff.html + versions.json
  + diffs/ + structs/ (whitelist gotcha).
- CLI 0.2.0: `--migrate <from>..<to>` (mutually exclusive with --version), same
  --registry resolution (new shared registryLocation/loadRegistryJson in core.ts),
  alias resolution, downgrade scans invert the diff, unknown-table warnings, exact
  brief-format hit lines + `N file(s) scanned · M breaking field(s) in K file(s)`.
  Packed tarball verified from a clean scratch install (relative path!), both modes.
  Added repository/author/homepage/bugs + cli/README.md (npm page was README-less).
- Tests 13→18 (worked-example reproduction, DropItem negative control, migrate
  hit/clean/alias). self-test.yml gained 2 migrate steps. CHANGELOG.md added; root +
  cli bumped to 0.2.0.
- **SHIPPED (same session, owner authorized):**
  - Pushed `3e52d7c` to main → **self-test CI passed** (incl. the 2 new migrate steps)
    and **Pages deployed**. All new paths verified 200 live: diff.html, versions.json,
    diffs/0.7.2..1.0.json, diffs/0.7.2..0.7.3.json, structs/1.0.json (the pages.yml
    whitelist gotcha was covered). diff.html re-rendered live in headless Chrome.
  - **npm: `palschema-validate@0.2.0` published** as `latest` (2026-07-27T08:50Z).
    Verified by cold `npx` in a clean temp dir with NO --registry — package from npm,
    versions.json + diff from the live GitHub raw registry, correct hit + exit 1.
    Gotcha: the first `npx pkg@0.2.0` failed `ETARGET` for ~1 min (local npm CLI had a
    stale cached packument while registry.npmjs.org already served 0.2.0) — retry with
    `--prefer-online`; it is NOT a publish failure.
  - **Announced** on PalSchema issue #53:
    https://github.com/Okaetsu/PalSchema/issues/53#issuecomment-5089309606
    (framed as complementing the Schema Generator #107, which gives current-version
    truth but no cross-version delta; led with the finding that 1.0 removed exactly ONE
    field across the 30 covered registry tables and added 23). Draft file was deleted
    after posting — GitHub is the record; only staged-but-unposted text needs a file.
- Watch for: an Okaetsu reply. #53 was left open pending "a better method", so an
  upstream ack or docs link is the highest-value distribution outcome available here.

## Session 2026-07-27 (cont.) — v0.2.1 + Nexus v1.1 published
- **v0.2.1 (npm, `latest`):** ajv is now loaded LAZILY. Only validation needs it, so
  `--migrate` runs with **zero dependencies** — which is what makes the offline Nexus
  archive (ships `cli/dist` with no node_modules) able to do a full breaking-change
  scan with no `npm install`. Missing ajv during validation now prints one clear
  sentence instead of MODULE_NOT_FOUND. Tests 18 → **20**.
- **Nexus mods/4084 updated to v1.1** (description + version + new file), all verified
  live. The archive went 45 → **192 files** (66KB → 453KB): it had been TWO releases
  stale (predated items.html/items.json). Built with bsdtar; `unzip -l` shows zero
  backslash entries, and **Nexus's own file previewer parses it** (listing diff.html,
  diffs/, structs/, items.html, schemas/) — that previewer failure was the exact v1.0
  quarantine symptom, so this is the direct all-clear. Old 1.0.1 kept under Old files.
- **CDP/Nexus gotchas proven this session** (see LESSONS.md):
  - Nexus's description editor is **SCEditor** (global `sceditor`). The visible surface
    is a same-origin `about:blank` iframe; the BBCode lives in a HIDDEN textarea.
    `setReactValue` on that textarea **silently reverts on save** — you must go through
    `sceditor.instance(ta).val(bbcode)`. SCEditor canonicalises list items to
    `[*]item[/*]`, so gate on equality modulo `[/*]`, not byte equality.
  - `clickSelector` on an element below the fold clicks whatever is at those viewport
    coords (it navigated to the site home) — scrollIntoView + assert `activeElement`.
  - Navigating away from a dirty form fires a beforeunload that **wedges the whole tab**
    (Page.enable, Runtime.evaluate all time out) and `handleJavaScriptDialog` answers
    "No dialog is showing" because Page wasn't enabled when it opened. Recovery that
    works: close the target via `/json/close/<id>` and reopen. So: set + verify + save
    in ONE script run, and never navigate while the form is dirty.
  - File upload DOES work headlessly: `DOM.setFileInputFiles` with the input's objectId.
    `input.files` still reads empty afterwards (React takes it into component state) —
    confirm by the UI showing the filename, not by reading `.files`.
- Re-verified after all of it: `npm test` 20/20, Pages 200s, npm `latest` = 0.2.1.

## Session 2026-07-24 — per-item VALUE reference (items.html / items.json)
Prompted by Person7557 in issue #53 (couldn't find "ActorClass"; cloned AncientHelmet
row showed bare hair): the missing field is **`ItemActorClass`** in DT_ItemDataTable —
the game itself ships variants by reusing another item's actor (LightzHelmet →
"IronHelmet"). Shipped a per-item value reference:
- `scripts/build-items.mjs` → `items.json` (947 rows from the public paldex dump,
  Editor_RowNameHash stripped) + `items.html` (searchable; asset fields + full
  copy/paste row JSON), linked from index.html. **Gotcha:** pages.yml stages a
  whitelist — new root files must be added to its `cp` line or they 404 on Pages.
- Live + verified in a real browser: https://booyaka101.github.io/palschema-hub/items.html
- Replied to Person7557: https://github.com/Okaetsu/PalSchema/issues/53#issuecomment-5063959860
- Caveat recorded: paldex dump is an earlier game build (no AncientHelmet row);
  a fresh FModel export would refresh it — rerun build-items with a new SRC.
- Note: the owner-machine folder D:\Repos\ideas\palschema-hub is the STALE
  pre-publish workspace (not a git repo, old v1.5.2 layout); clone fresh from
  GitHub to work on the live hub (this session used D:\tmp\palschema-hub).

## Publish status (2026-07-20 session)
**Status:** PUBLISHED. Repo pushed to https://github.com/Booyaka101/palschema-hub,
Pages live at https://booyaka101.github.io/palschema-hub/ (deploy gated on `npm test`,
passed on CI), comment posted on PalSchema issue #53
(https://github.com/Okaetsu/PalSchema/issues/53#issuecomment-5022177544).
**npm:** `palschema-validate@0.1.1` published (0.1.0 was broken by a stray `file:..`
dependency — deprecated on npm; 0.1.1 verified via cold-cache `npx` against real mods).
The issue #53 comment was edited in place to the `npx` one-liner.
**Nexus:** first page (mods/4063, 2026-07-20) was removed by staff under the
placeholder-file rule — the original zip was a 533B pointer README. Fixed by
building a real 61KB offline archive (31 schemas + index + browser + CLI +
README, verified from clean extract), emailing support@nexusmods.com, and —
with their go-ahead ("create a new page") — republishing on 2026-07-21 as
**https://www.nexusmods.com/palworld/mods/4084** (Utilities, v1.0, header +
gallery image, Pal Schema soft requirement, MIT custom permissions + credits).
**Quarantine follow-up (2026-07-21):** the v1.0 zip on mods/4084 was
auto-quarantined — NOT malware (VirusTotal 0/64) but a malformed archive:
PowerShell Compress-Archive writes backslash entry paths, which Nexus's
previewer can't parse. Fixed by repackaging with bsdtar (forward slashes,
proper dir entries; nexus/palschema-hub-registry.zip is now that build) and
uploading as v1.0.1 via the file Update flow; quarantined v1.0 kept under
Old files per Nexus guidance. Support follow-up drafted in
nexus/QUARANTINE_REPLY_EMAIL.txt (owner sends). Lesson: never ship
Compress-Archive zips — use bsdtar/7z.
**All four publish steps from PUBLISHING.md are DONE.**

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
