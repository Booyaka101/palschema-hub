# PROGRESS — palschema-hub

**Last updated:** 2026-08-11 (CLI 0.4.0 unknown-key-warnings session)

## Session 2026-08-11 — palschema-validate 0.4.0: unknown keys warn, don't reject (#134 semantics)
Workspace was 1 commit behind origin (Dependabot @types/node bump in cli/) — fast-forwarded
first. Baseline recorded before any change: **29 tests** (brief guessed 26; 29 is the truth).
- **Phase-0 verified live (all):** PalSchema #134 open (gettygoop 2026-08-05, warn-don't-reject
  + did-you-mean + pseudo-keys stay accepted); #133 open (WorkableAttribute min-1 vs vanilla 0
  — does NOT apply to us, our schema has no min, and the CHANGELOG says so explicitly); our
  live DT_ItemRecipeDataTable schema (additionalProperties:false at root + DenyRecipeChain);
  PalSchema's bundled assets/schemas (5 files); cli/package.json 0.3.0/ajv ^8.17.1. All free/local.
- **cli/src/core.ts:** `getTableSchema` (raw-schema cache) split out of `getValidator`, which
  now compiles an in-memory clone with every `additionalProperties: false` deleted — the
  published schemas/v1.0 files are BYTE-UNCHANGED (registry contract; acceptance (e) verified
  via git diff). New exports: `PSEUDO_KEYS` (single extension point: row `$Filters` +
  arrayWrapper Action/Items), `levenshtein` (capped), `suggestKey` (case-insensitive exact
  always wins; else distance ≤ 2, closest, ties alphabetical; at most one), `unknownKeys(rows,
  schema)` post-validation walker. Key subtlety found by corpus grep: 10 schema nodes are
  DELIBERATELY open (`additionalProperties: true` soft-object-path structs like
  VisualBlueprintClassSoft) — the walker only enforces keys where the ORIGINAL schema said
  `false`, so its accepted set is exactly AJV's old accepted set, softened to warnings; zero
  false-positive risk on mods that used to pass. Wrapper keys are only allowed on nodes that
  actually accept an array form. `validateFile` returns `{findings, warnings}`.
- **cli/src/index.ts:** `--strict` flag; validate-mode output is now WARN lines
  (`WARN <file>:<row> unknown field "<k>" — did you mean "<s>"?`; nested keys keep the CLI's
  established `unknown key "<k>" (in <path>)` wording, which preserves the wrapper-typo test)
  + the honest summary `N file(s) validated, E error(s)[ (strict)], W unknown-key warning(s)`.
  The old banner + per-file ✓ lines are GONE in validate mode (worked example demands exact
  stdout); ✗ error blocks unchanged; --migrate wholly untouched.
- **Tests 29 → 35** (all green). New fixtures tests/fixtures/{unknown-keys,pseudo-keys}.json.
  Two tests that asserted the old rejection semantics were PORTED to the new truth (same
  precedent as the 0.4.0 items flip): Accessory Condenser RedialIndex → warning/exit 0 +
  a NEW --strict exit-1 case; fieldlottery ItemSlot16 → asserted under --strict. Known-good
  mods (Palvolve/Unlimited Buildings/Old School Loot) now assert `0 unknown-key warnings`.
- **VERIFIED end-to-end:** worked example byte-exact (2 WARN lines + `1 file validated,
  0 errors, 2 unknown-key warnings`, exit 0; --strict → `2 errors (strict)`, exit 1);
  pseudo-key fixture silent; real-mod corpus zero warnings; tarball npm-packed + installed in
  a clean D:\tmp scratch dir (relative path!) and run against BOTH a local registry and the
  LIVE GitHub raw registry — remote schemas strip client-side, works. self-test.yml needs no
  edit (invalid-mod still exits 1 via its type error; migrate steps untouched).
- cli 0.3.0 → **0.4.0** (+package-lock sync), CHANGELOG entry dated 2026-08-11 crediting
  Okaetsu/PalSchema#134, README + cli/README rewritten (--strict, exit-code table, sample
  WARN line). Root package stays 0.4.0 (registry/site unchanged).
- **DISTRIBUTION — all shipped this session (owner authorized mid-session: "handle everything"):**
  - **Pushed `01e0008`** → all three workflows green on that sha: **self-test success**,
    Guards success, Pages deploy success. (No registry file changed — docs + CLI only.)
  - **npm: `palschema-validate@0.4.0` published and `latest`** (`npm view` confirms
    `dist-tags.latest = 0.4.0`). No ETARGET this time — the 0.2.0 stale-packument race did
    not reproduce; `npx -y --prefer-online` resolved 0.4.0 on the first try.
  - **Cold-install VERIFIED from a stranger's path:** fresh `D:\tmp\psv-cold`, mod file
    authored there, `npx -y --prefer-online palschema-validate@0.4.0 --version 1.0 mymod.json`
    with **no `--registry`** → schemas fetched from the LIVE GitHub raw registry, printed the
    two WARN lines + `1 file validated, 0 errors, 2 unknown-key warnings`, exit 0; `--strict`
    exit 1; the `$Filters` + Clear/Items pseudo-key file `0 unknown-key warnings`, exit 0.
    (Ran from a NON-package dir — never from `cli/`, whose own package.json is
    `palschema-validate@0.4.0` and would trigger the npx cwd-collision of LESSONS 2026-08-05.)
  - **PalSchema #134 comment posted** (2,680 chars, verified intact via the API):
    https://github.com/Okaetsu/PalSchema/issues/134#issuecomment-5248755385 — answers
    gettygoop's four acceptance checks, argues their "don't use additionalProperties:false as
    the only fix" bullet deserves stronger wording (it was OUR bug), and contributes the
    measured number they don't have: **warn-first fires exactly once across 13 files of 4
    published mods** (only the genuinely-stale RedialIndex), i.e. a warn-first rollout will be
    quiet rather than drowning existing mods. Offered to align wording with their PR.
- **Watch for:** a gettygoop/Okaetsu reply on #134 (and their promised PR — if it lands with
  different suggestion ordering or message wording, match it so the validator and the loader
  say the same thing to authors). PR #128 (the SortID copy path) is the narrower sibling.
- **NOT done, deliberately:** Nexus mods/4084 still ships the 0.3.0 CLI inside its offline
  archive. No registry data changed this release, so the archive's schemas/structs/diffs are
  all still current — only `cli/dist` inside it is one version behind. Out of this brief's
  stated RELEASE scope; roll it into the next release that changes registry data (the Nexus
  UI/SCEditor gotchas from the 08-04 session still apply).

## Session 2026-08-04 — v0.4.0: items.json 947 → 2,445 rows from paldb.cc + check-items gate
Brief targeted "v0.3.0" but 0.3.0 had already shipped (npm/GitHub/Nexus) from the 08-01
session — this ships as **0.4.0**. NOTE: D:\Repos\ideas\palschema-hub is now a REAL git
clone of the live repo (the 07-24 "stale workspace" note is obsolete); it was 4 commits
behind origin/main at session start — fast-forwarded before touching anything.
- **Phase-0 verified live (all):** paldb.cc robots.txt `Allow: /`; /en/Items_Table header
  "Items /2466" citing DT_ItemDataTable.uasset; Plasteel_Helmet renders 5 variant blocks
  (Code PlasticHelmet.._5, SortId 1320-1324); Animal_Skin + Assault_Rifle field labels;
  paldb footer pins data to **v1.0.2 2026/7/29** (independently: mp1st build 1.100.933,
  July 29 2026 — mp1st 403s WebFetch, needs browser UA via curl).
- **scripts/lib/paldb-parse.mjs (NEW):** pure regex/string html→rows. Rows are
  `<div class="d-flex justify-content-between p-2 align-items-center border-bottom">`
  label/value pairs; variant blocks split at `<h5 class="card-title…"> Stats </h5>`
  headings. Tag-stripping MUST be quote-aware — tooltip attrs contain literal `<br/>`
  (naive /<[^>]+>/ leaks attribute text into values). LABEL_MAP (exported, each mapping
  verified against known paldex values): Gold Coin→Price, Health→HPValue,
  Defense→PhysicalDefenseValue, Attack→PhysicalAttackValue, Shield→ShieldValue (100=100),
  Nutrition→RestoreSatiety (15=15), SAN→RestoreSanity (1=1). NOT mapped: "Corruption"
  (derived "600 Seconds", not the raw CorruptionFactor), "Waza" (display name, not
  EPalWazaID), pal/rock stats. Rarity: word in Stats card (Common=0…Legendary=4), numeric
  in Others card for variants ≥1 — numeric wins. Bare enums expand (TypeA "Armor" →
  "EPalItemTypeA::Armor" — preserves the items.json contract).
- **URL derivation (all classes live-tested):** detail URL =
  `encodeURIComponent(name.replace(/ /g,'_'))` + manual %28/%29 for parens. Apostrophe
  must stay RAW (%27 404s!); colon/brackets/☆/é must be ENCODED (raw 404s); parens must
  be ENCODED (encodeURIComponent leaves them raw → 34 pages 404'd on first run). Index
  links are `href="#"` + data-hover; the internal Code sits in the sibling `<div>`.
  ~30 "en text" entries (untranslated TEST/Blueprint items) + 2 `<characterName id=|X|/>`
  template names have no page — code-URL fallback (/en/<Code>) recovers some
  (Glider_Legendary), rest reported skipped (28 of 2,466 codes absent, all test items).
- **TRAP FOUND: item pages render OTHER DataTables' entities as variant-shaped blocks**
  (/en/Coal carries mineable rock "DamagableRock0004" with Hp/Defense pal-object stats
  under its own Stats heading — it entered items.json on the first run). Fix: only Codes
  the item index lists are DT_ItemDataTable rows (foreignCodes filter, reported).
- **build-items.mjs (REWRITE):** index → dedupe by display name (1,847 pages for 2,466
  codes; one page serves all same-named codes — /en/Gunpowder carries Gunpowder+Gunpowder2)
  → fetch concurrency 4 / 150ms spacing / 2 retries / .cache/paldb/ (full run ~8 min cold,
  free warm) → schema-filter (drops print at end = new-field radar; currently only
  display-only labels) → merge: paldex fills only paldb-invisible fields, paldb wins
  conflicts, per-row split in top-level `fieldSources` (same key order as items —
  regeneration is byte-idempotent modulo generatedAt, VERIFIED run4==run5). 10 legacy
  paldex-only rows kept (fieldSources.paldb=[]). `_provenance` kept (valuesCurrent:true,
  gameVersion 1.0.2, sourceCommit still the paldex sha so refresh-items.yml needs NO edit).
- **check-items.mjs (NEW, npm run check:items):** ajv (from cli/node_modules via
  createRequire, same strict config as CLI) validates every row; asserts count≥2400, no
  SortID anywhere, /^SFHelmet/ present (Hexolite Helmet, 1.0-only, SortId 1325 — parsed
  value matches the brief exactly), ≥200 real ItemActorClass, fieldSources complete.
  Optional file arg for fixtures. Run against the OLD items.json it fails with 947×
  "must NOT have additional properties (SortID)" — proving the brief's staleness claim.
- **Tests 27 → 29** (gate passes on shipped file; tests/items-stale-fixture.json exits 1
  naming SortID). The 0.3.0 assertion "provenance says 947 rows / valuesCurrent:false"
  necessarily FLIPPED to assert the new truth (valuesCurrent:true, ≥2400) — the only
  existing assertion changed, because it asserted the staleness this release fixes.
- **items.html:** green "ok" banner (valuesCurrent:true path; amber path kept for future
  honest staleness), Durability/Defense/Health/Shield/Attack chips where present, per-row
  footnote names the paldex-filled fields (or flags legacy-only rows). VERIFIED in
  headless Chrome (banner+count) AND by executing select() in Node with a DOM stub.
  GOTCHA: a node server from the 08-01 session (PID from Aug 1) was still squatting :8080
  serving the OLD clone's items.json — Windows let the new serve bind "successfully"
  anyway (LESSONS #50 pattern). Kill by PID via Get-NetTCPConnection before trusting a
  localhost render.
- README item section + CHANGELOG 0.4.0 (dated 2026-08-04) rewritten; package.json 0.4.0
  + `items`/`check:items` scripts. cli/ NOT touched (still 0.3.0 — no CLI change).
- **VERIFIED end-to-end:** `node scripts/build-items.mjs` → 2,445 rows (2,435 live paldb);
  `check-items` exit 0; acceptance one-liner prints `2445 PlasticHelmet 1320 false`;
  `npm test` 29/29 PASS.
- **DISTRIBUTION — all shipped this session (owner authorized mid-session):**
  - **Pushed `7b6df35`** → self-test + Guards + Pages all green; live-verified 200s on
    items.json / items.html / index.html / diff.html / versions.json, live items.json
    count 2445, PlasticHelmet SortId 1320 / no SortID, headless render shows the green
    current-game banner and "2445 of 2445 items".
  - **PalSchema #53 comment:** https://github.com/Okaetsu/PalSchema/issues/53#issuecomment-5176872323
  - **X (@KillKenny101):** https://x.com/KillKenny101/status/2084567570125091100
  - **npm: deliberately NOT published** — cli/ untouched, 0.3.0 is still `latest`.
  - **Nexus mods/4084 → v1.3** (file + mod version + description), `5fbf100`.
- **NEXUS GOTCHAS (new UI, supersede the 08-01 notes):**
  - The edit URL moved to **`/games/palworld/mods/<id>/edit/files`** — the old
    `/palworld/mods/<id>/edit/files` silently redirects to the public mod page, which
    reads exactly like "not logged in".
  - The **dropzone hidden `input[type=file]`** still works via `DOM.setFileInputFiles`
    (pick the one whose `accept` contains `zip` — there are two). Selecting the existing
    file in the headlessui combobox **auto-fills display name AND auto-increments the
    version** (1.2 → 1.3). The combobox does NOT open on click — needs focus + ArrowDown,
    then ArrowDown-to-highlight + Enter (`.click()` on `[role=option]` does nothing).
  - Upload type / archive are `[role=radio]` / `[role=checkbox]` SPANs, not real inputs
    (the only real `input[type=radio]`s on the page are a "Very bad/Very good" feedback
    widget — do not mistake them for the form).
  - Per-file commit is **"Save file"**; the mod-level header **"Save"** is separate and
    stays disabled until something on THAT form changes.
  - **The description is still SCEditor** (hidden textarea inside `.bbcode-editor`,
    `sceditor.instance(ta)`), and `setReactValue` on it **silently reverts on save** —
    it read back perfectly, Save went disabled, and a reload showed the OLD text.
    Working path: `inst.val(bb)` → `inst.updateOriginal()` → native-setter + input/change
    events → verify with `inst.val()` → Save. Verified persisted across a reload.
  - **Always re-read the LIVE description before editing it** — the repo copy had drifted
    1,144 chars behind the page, so pushing the local file would have deleted live-only
    sections. Fixed by patching the live text in place; `nexus/NEXUS_DESCRIPTION.bbcode`
    is now the live copy.
  - Navigating away from a dirty form still wedges the tab (beforeunload) — close via
    `/json/close/<id>` and reopen; that also discards unsaved edits, which is the cheap
    way to revert.
- **Watch / left open:** after the v1.3 update the public files tab lists **1.3 (Main)
  and only 1.0.1 + 1.0 under Old files** — 1.1 and 1.2 are no longer publicly listed
  (the new UI appears to move "Archive existing file" uploads into a separate File
  archive rather than Old files). Un-archive from the mod's file manager if those older
  builds should stay downloadable. Also: the 28 missing TEST codes are permanently absent
  from paldb — acceptable, documented.

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
- **SHIPPED (same session):** pushed `4273141` + workflow fix `30fa528` (gotcha: a
  multiline `gh issue create --body "..."` string whose continuation lines start at
  column 1 TERMINATES a YAML `run: |` block scalar — GitHub creates a failed run named
  after the workflow file path with zero jobs; build bodies with printf instead).
  All 4 workflows green incl. a live workflow_dispatch of the rewritten cron
  (recorded==current paldex sha c19739b, no issue opened). **npm
  palschema-validate@0.3.0 = latest**, verified by cold `npx -y --prefer-online` in a
  clean dir against the LIVE registry (alias line + "no row-struct changes between
  1.0.1 and 1.0.2 (both alias Palworld 1.0, SDK 62fad41)" + scan summary, exit 0; and
  a 0.7.2..1.0 regression scan). Pages live-verified: items.html / diff.html /
  versions.json / structs/1.0.2.json / diffs/1.0..1.0.2.json / diffs/1.0.1..1.0.2.json
  all 200; live headless-Chrome render shows the alias banner at ?from=1.0&to=1.0.2
  and the amber Data-age banner (947 vs 2466, "roughly 62%") on items.html.
  **Announced** on PalSchema #53 (answers Person7557 directly):
  https://github.com/Okaetsu/PalSchema/issues/53#issuecomment-5149637406
- **Distribution (same session, owner-approved):**
  - **Nexus mods/4084 -> v1.2**, live and verified on the public page. New 205-file
    bsdtar archive (0 backslash entries; offline `--migrate 1.0.1..1.0.2` runs from a
    clean extract with no node_modules). Uploaded via the dropzone's hidden input with
    `DOM.setFileInputFiles` (the row "Update" button ignores both `el.click()` and a
    real mouse click; the dropzone path just works), upload type "Update existing file"
    + "Archive existing file" so 1.1/1.0.1/1.0 stay under Old files. Description
    rewritten to LEAD with the 1.0.2 finding and to carry the data-age section.
    CDP gotchas proven this time: (a) the All/Main/Optional/Update **filter chips**
    are also `button` elements reading "Update" — walking UP from a button matches the
    chip's section container, so locate the row by its file-name cell and search DOWN;
    (b) `sceditor.instance(ta).val()` updates the editor only — the backing textarea
    stays stale until `inst.updateOriginal()`, so verify via `inst.val()`, not the
    textarea; (c) SCEditor canonicalises `[/*]` onto its own line AND inserts a newline
    after `[/code]`, so the submit gate must strip ALL whitespace, not just collapse it.
  - **X post** (KillKenny101), 378 chars, verified intact on its permalink (the
    timeline preview truncates at 280 behind "Show more"):
    https://x.com/KillKenny101/status/2083420915140800667
- Watch for: Okaetsu/Person7557 replies on #53; the weekly cron opening an issue the
  day the game/SDK/paldex dump moves (that is the designed signal to cut the next
  release — 1.0.3 would be ~30 minutes of work: alias-or-snapshot, regen, bump).

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
