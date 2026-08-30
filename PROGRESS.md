# PROGRESS — palschema-hub

**Last updated:** 2026-08-30 (0.10.0 + CLI 0.6.0 SHIPPED: PR #33 merged, npm 0.6.0 latest, Nexus v1.7 live)

## Session 2026-08-30 — 0.10.0 + CLI 0.6.0: upstream 0.6.5 item constraints ported
Trigger: PalSchema 0.6.5 (2026-08-28) updated its hand-written items.schema.json (PR #145).
Our SDK-derived PalStaticItemData schema knew all 44 property names and almost no value
constraints; they are now ported. Items-loader files only; nothing else changed.
- **Phase-0 verified live (all):** 0.6.5 items.schema.json fetched at the tag (blob
  b41a965b14da064c6bef05bd8361194b85cb233c, cached .cache/upstream-items-0.6.5.schema.json),
  0.6.4 baseline (per-Type required lists incl. AttackValue; no bLegalInGame/WazaID/$resource),
  release body + published_at 2026-08-28T20:39:46Z, PR #145 file list + loader diff
  (bLegalInGame → IsCustomProperty; IsThrowableWeapon for SPWeaponCaptureRope/Ball; nothing
  icon-related), ExampleMod/items/example_items.json (AttackValue 500, MagazineSize,
  ItemBaseName, CorruptionFactor 0.0, WorkAmount 10.0).
- **structs/upstream-constraints.json (new):** every ported rule as data with tag/file/blob/PR
  provenance, plus the seven recorded divergences (anyOf-does-not-scope, AttackPower typo,
  $resource-predates-0.6.5, float-literals-raw-text, required-gated-on-Type,
  base-class-fields-not-branch-scoped, type-enum-superset).
- **scripts/apply-upstream-constraints.mjs (new, in `seed` after the overlay):** merges field
  keywords (IconTexture/VisualBlueprintClassSoft anyOf patterns, Rarity 0-4, Rank/Price/Weight/
  CorruptionFactor/Durability >= 0, MaxStackCount >= 1, defaults), the required list as
  if:{required:[Type]}/then (+ Recipe's 4), and per-Type scope branches DERIVED from the
  "Class property (...)" annotations in the schema's own descriptions (11 scoped fields in 4
  owner groups). Byte-idempotent, asserted in the suite. **Re-run bug found the 0.7.0 way:**
  the first $comment-segment strip regex ate the space before the next segment, which broke
  the loaderKeys-last invariant and compounded garbage on every run — three different hashes
  before the segment-split rewrite.
- **CLI 0.6.0 (cli/src/core.ts):** shared bareIntegerLiterals() raw-text scanner (pals
  DropChance now goes through it too, comment-stripped first); items float-literal ERRORS from
  the schema's floatLiteral= $comment segment; classScopeWarnings() reads the marked scope
  branches (getValidator strips them pre-ajv so they stay warnings, #134 semantics);
  MaxStackCount soft-cap warning from stackSoftCap=; backreference mismatch note names both
  parts; required-when-adding message explains the Type gate. ajv config gains
  strictRequired:false (standard if/then layout) and **verbose:true — without it
  err.parentSchema is undefined and the existing description-fallback path had been silently
  dead**.
- **check-currency sixth axis:** live blob sha of upstream items.schema.json (contents API,
  default branch) vs the pinned b41a965; exit 1 stale / 2 network; --upstream-schema-json
  fixture flag; in-sync line appends "items.schema.json blob b41a965". Live run: exit 0, fully
  current.
- **versions.json:** upstream.palSchema → 0.6.5/2026-08-28 + releases append; the palSchema
  record crossed the serializer's 200-char inline limit so it is now expanded — round-trip
  verified byte-identical (edit made with the file's CRLF EOLs preserved).
- **Tests 79 → 99, all green.** New fixtures under tests/fixtures/items/: upstream example
  (must be zero errors AND zero warnings — the false-positive canary), icon-backref,
  resource-icon, misscoped-waza (+--strict), weight-int, new-item-missing-typea, edit-patch,
  rarity-5, stack-10000; apply idempotency (2 runs byte-identical to committed); AttackPower
  absence; constraints provenance; 2 new currency-axis tests. items/typo.json dropped its
  Type key (kept it an existing-item patch; its assertions never touched Type). Real-mod
  corpus baseline unchanged and unweakened.
- **E2E COLD-VERIFIED:** packed tarball → clean D:\tmp\psv-060-e2e install (relative path) →
  3-entry mod: 4 errors (backref naming both parts, Rarity 7, Weight 1 float, Recipe missing
  Material1_Count via the Type gate) + WazaID-on-Weapon warning; the Price-only existing-item
  patch stayed silent; exit 1.
- Docs: README (compat → 0.6.5/UE4SS ba2efd55, six axes, item-constraints section),
  cli/README, REGISTRY_README.txt leads 0.10.0, NEXUS_DESCRIPTION.bbcode "New in 1.7".
  Nexus zip rebuilt (212 entries, 616 KB), nexus:check green.
- **DISTRIBUTION — all shipped this session (owner authorized mid-session: "handle everything"):**
  - **PR #33 merged** (squash `85a0016`). Seven checks green on the branch head `9b06d14`
    (ShellCheck, CodeQL x2, validate, test, guards) and six on the merge commit including the
    **Pages deploy**, all read from the check-runs API rather than run-level status.
  - **Live registry verified** after deploy: the raw schema URL serves
    `upstreamConstraints=0.6.5@b41a965`, `floatLiteral=Weight,CorruptionFactor,Durability,`
    `SneakAttackRate,WorkAmount`, `Rarity.maximum 4`, 4 scope branches, **no AttackPower**;
    live `versions.json` claims PalSchema 0.6.5 with all three releases; Pages 200s on
    index.html, `structs/upstream-constraints.json` and the item schema.
  - **npm `palschema-validate@0.6.0` published and `latest`** (2026-08-30T12:07:36Z, 4 files,
    19.0 kB). No ETARGET race this time. **Cold-verified from a stranger's path:** fresh
    `D:\tmp\psv-cold-060`, `npx -y --prefer-online palschema-validate@0.6.0` with **no
    --registry**, so schemas came from the live GitHub raw registry — the 3-entry mod
    produced the 4 expected errors + the WazaID warning (exit 1), `--strict` exit 1, and
    upstream's ExampleMod items file (fetched fresh from tag 0.6.5) validated **0 errors,
    0 warnings, exit 0** against the published build.
  - **Nexus mods/4084 → v1.7 LIVE and verified on the PUBLIC page.** File 1.7 (615KB,
    30 Aug 8:15PM), **1.6 archived** (only 1.0.1 remains under Old files), mod version synced
    to 1.7, virus scan **"Safe to use"**. Description replaced with the "New in 1.7" lead and
    verified: byte-exact read-back (9301 == 9301) before saving, persisted through an editor
    reload, and confirmed on the public page (`New in 1.7`, the `T_Icon_A` backref example,
    the `$resource/YourMod/YourImage` line, the AttackPower note).
  - **Issue #32** ("registry stale: PalSchema 0.6.5 released") closed with the outcome. Zero
    open issues.
- **Nexus mechanics worth keeping (this session):** the public mod page is the OLD-style
  `/palworld/mods/4084` — the `/games/palworld/mods/4084` form is edit-only and returns a real
  **404 page** for the public view, which reads exactly like a dead mod if you don't notice.
  The upload combobox pre-selects the **OLD 1.0.1** file, not the current main one, and
  ArrowDown does NOT wrap past it — walking DOWN silently lands you on 1.0.1 and auto-fills
  version **1.0.2**. Walk **UP** and gate on `data-headlessui-state` containing `active`;
  selecting the right entry auto-fills 1.6 → **1.7**. Both checkboxes are now real
  `[role=checkbox]` with readable `aria-checked` (Archive existing file / Update mod version),
  so they can be gated on state instead of a screenshot.
- **File changelog: still not attempted, deliberately.** 0 for 3 across two UI generations is
  a Nexus-side defect (LESSONS 2026-08-19); the release notes are public in the description.
- **Next-release candidates:** SortID minimum 0 (upstream declares it, not ported), Recipe
  subfield minimums (Product_Count/Material counts >= 1) via DT_ItemRecipeDataTable,
  TypeA/TypeB/WazaID enum-value warnings (we carry the full value lists in descriptions
  already), surfacing the constraints in the browser UI.
- **Not done, needs the owner's word:** any community announcement. PalSchema #53/#134 and
  the Nexus audience are the natural venues and past releases were announced there, but
  house rules put the final wording on the owner, so nothing was posted.

## Session 2026-08-26 — SDK head moved to e663245 (bookkeeping, no data change)
Cron issue #29: `versions:check` exit 1, "SDK head moved to e663245 (no Source/Pal/Public
change), registry records 62fad41".
- **Verified live before touching anything.** Head is `e663245` (2026-08-24, merge of PR #55
  "Fix primary asset label settings"), and its file list is exactly one entry:
  `Config/DefaultGame.ini`. `Source/Pal/Public` is still last regenerated at `98ee60d`
  (2026-07-11), the commit 1.0 pins. So no schema, struct snapshot, diff or item/building
  value is affected — `sdkHead` was the only stale field in the repo.
- **versions.json** `sdkHead` → e663245 / 2026-08-24, `$comment` naming what that commit
  actually was. Round-trips through the bump serializer; check-currency back to exit 0:
  `registry current: game 1.0.3, SDK e663245, PalSchema 0.6.4, item values 1.0.3, building
  values 1.0.3`.
- **What this exposed:** the CLI's alias line names the BRANCH HEAD ("both alias Palworld 1.0,
  SDK <sha>") and four docs quote that line verbatim — README, cli/README,
  nexus/REGISTRY_README.txt, nexus/NEXUS_DESCRIPTION.bbcode. Nothing checked them, so they
  would have read 62fad41 forever. All four updated, and now gated in `npm test`: 75 → **79**.
- **Two of those docs cited the head as the EVIDENCE** for the alias claim ("the SDK has not
  been regenerated since 1.0 (head 62fad41)"). The head proves nothing about headers — both
  re-worded to cite `Source/Pal/Public @98ee60d`, which only moves when structs really change.
  Left alone on purpose: the schemas' `sdk=...@62fad41` stamps and the `aliasReason` strings.
  Those are dated derivation/verification records, not claims about today's head, and the
  1.0.2 alias test was re-anchored to the SHAPE of that evidence rather than the literal sha.
- README's staleness paragraph said "four axes" and quoted a pre-0.9.0 sample line; it is five
  axes and the sample now matches real output.
- The refresh-items stale-registry issue body covered "game moved" and "SDK regenerated" but
  not this third case; it now says what to do. Deliberately NOT automated: an auto-PR that
  bumped `sdkHead` would fail the new doc gate, which is the whole point of the gate.
- Nexus archive rebuilt (211 entries, 606 KB).
- **Shipped:** PR #30 merged (squash `304f493`), issue #29 auto-closed, all six checks green
  on the merge commit including the Pages deploy.
- **Live mods/4084 description re-posted and verified on the PUBLIC page.** Read the live
  bbcode first and diffed it against `git show 7428553:nexus/NEXUS_DESCRIPTION.bbcode` (the
  bytes the 1.6 session set): identical but for the trailing newline, so no live-only drift
  to lose. The 08-19 recipe still holds — `ta._sceditor.val(bb)` → `updateOriginal()` →
  native setter → input/change — with one addition worth keeping: **Save stays `disabled`
  afterwards.** The textarea is uncontrolled (`defaultValue` + `ref`) and React's
  `_valueTracker` had already absorbed sceditor's write, so the input event looked like a
  no-op. `ta._valueTracker.setValue('')` before dispatching enables both Save buttons.
  Gated on a byte-exact read-back (8721 == 8721) before clicking, verified after by reloading
  the editor and by reading the public page. The one remaining `62fad41` there is the
  intended one: the headers-parsed-at stamp, matching the schema files.

## Session 2026-08-19c — DISTRIBUTION: npm 0.5.0 + Nexus v1.6
- **npm: `palschema-validate@0.5.0` published and `latest`.** Pre-flight: CI green on the
  exact merge commit `7428553` (check-runs API, not run-level status), tree clean and
  synced, 73 tests green, `--dry-run` showed exactly 4 files (dist/core.js, dist/index.js,
  README, package.json) and no `file:`/`link:` deps. The post-publish `E404` is the known
  stale-packument race — the registry served 0.5.0 ~10 s later; poll
  `registry.npmjs.org/<pkg>` directly rather than trusting the local npm cache.
  **Cold-verified** in a fresh dir: a `pals/` file with `RanchActionData` passes clean with
  NO flags (folder-based loader detection working through the published build),
  `--palschema-version 0.6.3` emits the >=0.6.4 gate, `0.9.9` exits 1.
- **Nexus mods/4084 → v1.6 SHIPPED, fully verified on the public page.** Owner's Chrome
  session had EXPIRED (every nexusmods tab rendered "unauthenticated / Please log in
  again", including /users/myaccount) — an expired session looks exactly like a layout
  change, so probe `myaccount` before blaming selectors. Owner re-authed over TeamViewer.
  - File **1.6** live (605 KB, 211 entries), **1.5 archived**, 1.0.1 still deliberately
    under Old files. Virus scan polled to completion: **Safe to use, downloadable**, no
    quarantine (the v1.0 malformed-archive failure mode did not recur).
  - **The new upload form is much friendlier than the 08-17 notes suggest:** selecting the
    existing file in the headlessui combobox **auto-incremented the version 1.5 → 1.6** and
    auto-filled the display name, and the "Archive existing file" control is now a real
    `[role=checkbox]` with a readable `aria-checked` — so it can be gated on state instead
    of a screenshot. Combobox still needs focus + ArrowDown (click alone won't open it).
  - **Description updated and verified on the PUBLIC page.** Re-read the LIVE bbcode first
    and diffed it against `git show 2774c74:nexus/NEXUS_DESCRIPTION.bbcode`: byte-identical,
    so zero live-only drift to lose. Set via the only path that persists —
    `ta._sceditor.val(bb)` → `inst.updateOriginal()` → native setter → input/change — gated
    on a whitespace-stripped read-back (8684 == 8684) before saving.
  - **STILL NOT DONE — the file changelog, now 0 for 3** (1.4 = 403, 1.5 = empty, 1.6 =
    empty). Filled `#file-changelog-text` with 941 chars, read back byte-exact, saved with
    the file; the file/version/archive/description all persisted and the Changelogs tab is
    still empty. Three attempts across two UI generations: treat this as a Nexus-side
    defect, not an automation bug, and stop spending attempts on it. The same content is
    public in the description.

## Session 2026-08-19b — 0.9.0: the building value reference (issue #21)
Owner asked to build #21 once 0.8.0's CI was green, and to check the auto-created
issue/PR. Status of those: issue #22 auto-closed by the 0.8.0 merge; the auto PR was
Dependabot #11 (@types/node 26.2.0 in cli/) — it had REBASED itself onto the new
package-lock, its diff was one version hunk plus removing the stale extraneous ".."
record, full suite green on it, merged. Nothing broke.
- **The unblock:** paldb.cc building pages NOW render raw DataTable rows (the issue was
  parked on "does not render"). Verified live, then built the lane.
- **scripts/build-buildings.mjs** (`npm run buildings`): scrapes the ten construction
  category indexes (Production, Pal, Storage, Food, Infrastructure, Lighting,
  Foundations, Defenses, Furniture, Other — entries are `data-hover="?s=MapObjects%2F<row>"`),
  then one detail page per building (cache .cache/paldb-buildings/<ver>/, footer-version
  asserted like build-items). Fields route to whichever schema declares them —
  DT_MapObjectMasterDataTable and DT_BuildObjectDataTable share NO field name (asserted
  fatal in the script), so routing is unambiguous. Enum prefixes are the BUILDING enums
  (EPalBuildObjectTypeA/B). Materials (recipes div, p-1 rows) map display name → item
  Code via the item index, unique names only: 930/930 mapped (Paldium Fragment →
  Pal_crystal_S). Unrouted labels land under `display` (Workload, Worker Max + some
  tutorial-card noise on a few pages); paldb-unrendered fields (BlueprintClassName,
  RequiredBuildWorkAmount, raw Material1..4 columns, DT_TechnologyRecipeUnlock rows)
  are documented absent.
- **paldb-parse refactor:** parseDetailPage(html, {labelMap, enumPrefixes, rarityWords})
  extracted; parseItemPage delegates with the item mappings. Without this the ITEM
  label map silently misroutes building fields (Defense → PhysicalDefenseValue) — caught
  before first full run, worth remembering for any third lane.
- **scripts/check-buildings.mjs** (`npm run check:buildings`, in npm test): ajv-validates
  every routed field against its schema, ≥150 rows, ≥80% of buildings with BOTH tables
  populated, HatchingPalEgg spot values pinned to the live page (Hp 2000,
  DeteriorationDamage 0.04, TypeB Pal_Breed, materials present). check-currency gained
  a --buildings-json axis (balance-patch staleness, same as items).
- **buildings.html**: items.html-style browser (category filter, search, both tables,
  materials with Codes, copy/paste raw-table JSON, tech-row naming note). Verified by
  executing the page script in Node with a DOM stub against the real buildings.json
  (banner, 460/460 count, both tables, Hp 2000, materials, Special_ note) — headless
  Chrome --dump-dom returned empty on this box, so the DOM-stub path is the render check.
- Wired: pages.yml cp line (+buildings.html/json), nexus zip FILES (471 entries now),
  index.html nav link, package.json 0.9.0. Tests 70 → **73**, all green.
- 460 buildings across 10 categories; result posted on #21 and the issue closed.

## Session 2026-08-19 — 0.8.0 + CLI 0.5.0: the loader overlay (PalSchema 0.6.3/0.6.4)
Trigger: cron issue #22 (PalSchema 0.6.4 released, registry claimed 0.6.3). 0.6.4's
change is loader-side — `RanchActionData` on new pals (PR #143) is implemented in
`PalMonsterModLoader.cpp`, not on any row struct — so header-derived schemas would
false-positive a legal mod. Owner asked to fold the open issues into the build.
- **Phase-0 verified live (all):** 0.6.4 release body + published_at 2026-08-18T07:09:36Z;
  0.6.3 body (0.6.2+0.6.3) + 2026-08-15T12:54:33Z; issue #134 still open (pal loop has
  no null-property warning branch); SDK head still 62fad413/2026-07-11 (no header move,
  1.0 pin 98ee60d intact); PR #143 diff = ONE line (PalMonsterModLoader.cpp:181, the
  new-pal path call — NO key name in the diff); the key name + object gate + 7 nested
  properties (ChargeMontage, FunMontage, ChargeFacialEye, FunFacialEye, SpawnSocketName,
  SpawnLocationOffset, SpawnItemRotator) read off HandleRanchSuitability on main;
  PR #128 diff (SortID copy on the new-item path). Also pulled PalSchema's own bundled
  assets/schemas/{pals,items}.schema.json for alignment — notable: THEIR pals schema
  does not document RanchActionData at all yet.
- **structs/loader-overlay.json (new):** every loader-implemented key with per-entry
  source/provenance. pals: RanchActionData (sincePalSchema 0.6.4 + sinceNote),
  IconAssetPath, BlueprintAssetPath, ActorClassPath, AbilitiesByLevel, Loot, Name,
  ShortDescription, LongDescription. items: Type (enum, both short + class-name
  spellings), Name, Description, Recipe, SortID, bLegalInGame. Plus an `advisories`
  block (SortID/SortId below 0.6.4 → PR #128 note) and per-loader in-game-warning
  metadata (#134 vs #138).
- **Generators:** scripts/apply-loader-overlay.mjs merges pals entries into
  DT_PalMonsterParameter.schema.json (marked with a `palschema-loader-overlay` $comment;
  idempotent — proven byte-identical on re-run); scripts/derive-loader-schemas.mjs emits
  schemas/v1.0/PalStaticItemData.schema.json from the UPalStaticItemDataBase/Armor/
  Weapon/Consume class headers (38 fields incl. enums, chain-parsed like the loader's
  GetPropertyByNameInChain) + items overlay keys. augment-from-sdk.mjs now PRESERVES
  overlay-marked props (would otherwise drop them as "removed" on re-run). seed order:
  derive → augment → sdk-tables → loader-schemas → overlay → index. Registry is now
  32 schema files.
- **CLI 0.5.0:** pals/items loader files are first-class targets (detected by DT_ keys →
  raw; parent folder pals/items; else a ≥50% field-match sniff — delete-only files are
  items by definition). `--palschema-version` gates overlay keys (`"RanchActionData"
  requires PalSchema >= 0.6.4 when adding new pals...` + PR link, as a compatibility
  warning; --strict → exit 1); unknown values fail loudly listing versions.json's
  recorded releases. `--version` now optional (defaults to newest known, aliases
  resolved). Warn lines carry per-loader notes: pals → #134 (not caught in game),
  items → #138 (game also warns since 0.6.3); raw lines BYTE-UNCHANGED (existing test
  assertions untouched). Item Recipe objects validate against DT_ItemRecipeDataTable;
  null item entries (delete syntax) legal. Two text-level checks schemas can't express:
  loader-only keys in raw DT_ files (raw loader would skip them) and bare-integer Loot
  DropChance (loader's is_number_float() skips the entry; JSON.parse erases 100 vs
  100.0 so it reads the raw text — an ajv not:{type:integer} would false-positive on a
  correct "100.0", which JSON.parse collapses to integer 100).
- **BOM fix (real find from the cold-install test):** PowerShell/Notepad write a UTF-8
  BOM; nlohmann (the game) skips it; the CLI rejected it. parseJsonc now strips it.
- **versions.json:** upstream.palSchema → version 0.6.4/2026-08-18 + releases
  [0.6.3/2026-08-15, 0.6.4/2026-08-18]; serializer round-trip verified. check-currency/
  bump-version unchanged (fixtures anchor to the file and followed automatically).
  cli/package-lock.json: version sync also flushed a STALE `palschema-hub file:..`
  remnant that was still in the lock (harmless but wrong) from the 0.4.1 incident.
- **Tests 46 → 70, all green.** New fixtures: ranch-new-pal.{json,jsonc} (worked
  example, byte-equal behavior), pals/typo.json (did-you-mean + #134 + nested
  RanchActionData key check), items/typo.json (did-you-mean + #138 + Recipe nested +
  null delete), ranch-raw-mismatch.json, pals/loot-int-dropchance.json, bom.json,
  unknown --palschema-version, versions/schema provenance asserts. Real-mod corpus
  still zero warnings. Nexus zip rebuilt (209 entries), REGISTRY_README.txt leads 0.8.0.
- **VERIFIED cold:** packed tarball → clean D:\tmp\psv-050-e2e install → new-pal mod
  with RanchActionData: no flags exit 0 clean; --palschema-version 0.6.3 → the
  requires->=0.6.4 warning; .jsonc identical; BOM'd file parses.
- Root 0.7.1 → **0.8.0**, CLI 0.4.2 → **0.5.0**. CHANGELOG names 0.6.3, 0.6.4, #134,
  #138, #139, #128, #143.
- **Issue #22** closes with this release (registry claims 0.6.4). **Issue #21** (building
  value browser): investigated live — paldb.cc building pages NOW RENDER the DataTable
  rows (Egg Incubator page shows Hp 2000, DeteriorationDamage 0.04, SortId 14,
  BuildExpRate 2.74, materials, Code HatchingPalEgg), so the issue's "does not render
  the DataTable rows" blocker is GONE. Scoped as its own release (new scrape lane +
  browser page); findings to be recorded on the issue.

## Session 2026-08-17e — Nexus mods/4084 → v1.5 SHIPPED
Owner asked for the Nexus update after the npm release. All of it landed except the file
changelog, same as 1.4.
- **File 1.5 live** (551KB, 207 entries, uploaded 17 Aug 9:43PM), mod version synced to
  **1.5**, **1.4 archived**, and the **v1.0 file archived** on request — that was the
  first upload, the malformed archive that drew the untrusted-file warning (2 downloads).
  1.0.1 deliberately left as "Old": 53 real downloads and it was never quarantined.
  Public page now lists 1.5 + 1.0.1, virus scan "Safe to use".
- **Description updated and verified on the PUBLIC page** (lead is 1.0.3, new "New in 1.5"
  section on item values + integer enforcement + PalSchema 0.6.3, 1.4's section demoted to
  "Previously, in 1.4"). `nexus/NEXUS_DESCRIPTION.bbcode` is the source and matches.
- **NEXUS HAS A NEW EDIT UI** (the 08-11 notes are obsolete): `/games/<game>/mods/<id>/edit/
  {general,files}`, React + headlessui. What changed for automation:
  - The upload form is a hidden `input[type=file]`; `DOM.setFileInputFiles` with a
    FORWARD-SLASH path still works and the form shows `palschema-hub-registry.zip (551KB)`,
    which is the size gate (`input.files[0]` reads back null here — the app copies the File
    and clears the input, so assert on the rendered chip instead).
  - "Update existing file" + a combobox (`button[aria-label="Show options"]`) to pick which
    file, plus an **Archive existing file** checkbox that does the 1.4 archiving in one step.
    Old files are archived individually from the row kebab ("More actions" → Archive).
  - Custom checkboxes are `<label>`-wrapped spans with no `role`/`aria-checked`: a real
    mouse click on the label toggles them, `el.click()` on the inner span does NOT, and
    there is no readable state — **verify with a screenshot**, not the DOM. A stray click
    on a tagged wrapper navigated the tab to the homepage once; re-resolve, don't reuse.
  - **The description is still SCEditor** under a WYSIWYG toolbar, in an about:blank iframe.
    Setting the backing textarea (even via the native setter + input/change) SAVES NOTHING:
    the instance owns the value. The 08-11 recipe still holds and is the only thing that
    works: `ta._sceditor.val(bb)` → `inst.updateOriginal()` → native setter → input/change.
    Confirmed by `POST next.nexusmods.com/api/flamework/mods/save` → 200 and a reload.
  - "Import description" exists but returns "This feature is not implemented (yet)".
- **STILL NOT DONE — the file changelog.** Filled the upload form's changelog textarea
  (`#file-changelog-text`, read-back matched) and saved; the file, version, archive flags
  and description all persisted, but the Changelogs tab is still empty. Same outcome as
  1.4's 403, so it is not transient and not worth another attempt from this path. The same
  content is public in the description.

## Session 2026-08-17d — v0.7.1: the archive stops being hand-built
Last stale surface from the 0.6.0 sweep. `nexus/palschema-hub-registry.zip` was a
committed 207-entry binary with NO build script, so the copy modders download still
described 1.0.2 item values and PalSchema 0.6.1 while the repo had moved twice.
- **scripts/build-nexus-zip.mjs** assembles it from the repo (registry + items + structs
  + diffs + cli/dist + REGISTRY_README.txt as README.txt), same single-root layout the
  published v1.4 archive used so existing download paths don't move. Written with a
  minimal deflate zip writer (no dependency) and a FIXED dos timestamp, which is what
  makes `--check` possible: two builds of identical content are byte-identical, so CI
  can assert the committed zip matches the repo. Wired into self-test.yml.
- Content delta vs the published archive: +structs/1.0.3.json, +3 pairs of ..1.0.3
  diffs, nothing missing (the 7 dropped entries are bare directory records).
- Archive text + NEXUS_DESCRIPTION.bbcode refreshed to 1.0.3 / integer typing / 0.6.3.
- **Still manual and still the owner's:** the Nexus upload itself and pasting the
  bbcode. PUBLISHING.md documents it; nothing here touches the live mod page.

## Session 2026-08-17c — v0.7.0: int32 columns stop accepting 1.5
The finding parked at the end of 0.6.0, now shipped. 158 fields the SDK declares `int32`
were typed `number` because the Jan-2024 dump is JSON and JSON has no integer type; the
augmenter kept observed types for dump-era fields, so `DT_PalDropItem.Level` accepted 1.5
and only failed in-game.
- **alignIntegerness() in augment-from-sdk.mjs**: retype `number` → `integer` when
  `fragForType(cppType)` says integer, but ONLY if every observed example is whole. A
  fractional example against an int32 column is a conflict to report, not a fix to apply.
  Zero conflicts across 31 tables, and all 2,445 items.json rows still validate under the
  tightened schemas — the live data agrees with the headers.
- **The re-run was the real test.** Running the augmenter twice surfaced three latent
  bugs, all of which would have quietly corrupted a future regeneration: (1) the
  provenance sentence appended a second copy (its strip regex still matched the OLD
  wording "Field names authoritative"); (2) `sdkAdded`/`droppedRemovedFields` were erased
  whenever a later run added nothing; (3) array fields lost observed item examples,
  because after the first pass items live at `oneOf[0].items`, not `.items`. Also: it was
  rewriting `DT_FieldLotteryNameDataTable`, which derive-sdk-tables.mjs owns — harmless
  only because `seed` happens to run sdk-tables last. Now skipped by `source=` tag.
  Second run is byte-identical; that check is worth repeating on any generator here.
- Diff is exactly 158 `"type": "number"` → `"type": "integer"` lines across 21 files,
  nothing else. Tests 43 → **46** (fractional fixture rejected, both offending fields
  named, published schema asserted). Root 0.6.0 → **0.7.0**.

## Session 2026-08-17b — v0.6.0: the axes the sha checks can't see
Follow-up to 0.5.0 in the same session, from one question: "was there nothing we needed to
actually update as well?" There was. 1.0.3 is a BALANCE patch, so row values moved while
every struct and sha stayed put, which is exactly the shape our staleness detection was
blind to.
- **Correction worth recording:** the first read of this was wrong. I probed `parseIndex`
  by reading `idx.codes` (it returns `{declaredCount, items}`) and passed a row CODE to
  `detailUrlFor` (it takes the DISPLAY name), concluded paldb.cc had changed layout, and
  filed it as a scraper rewrite. Re-probed correctly: 2,466 items parse fine, detail URLs
  resolve. The refresh was a re-scrape, not a rewrite. Verify a parser against its own
  signature before declaring upstream broken.
- **items.json → Palworld 1.0.3** (paldb.cc footer `v1.0.3 2026/8/12`). Exactly 3 rows
  changed and all three are in the patch notes: WorldTreeHolyWater Weight 1 → 0.1,
  WaterBuildKit Rank 4 → 2, SkillCard_Psychokinesis gains bLegalInGame. Cross-checking the
  diff against the notes is what proves the scrape captured the new build.
- **The cache was the real trap.** `.cache/paldb/` was flat and never expired, and every
  URL is stable across a balance patch, so a re-run would have rebuilt 1.0.2 values from
  disk and stamped them 1.0.3. Cache is now keyed by game version, `--refresh` bypasses it,
  and `build-items.mjs` reads paldb's version footer and REFUSES to write when it disagrees
  with GAME_VERSION (also kills the hardcoded gameVersionDate).
- **check-currency gained two axes:** items provenance lag (local, no network) and the
  newest PalSchema release vs `versions.json` `upstream.palSchema` (new key). In sync:
  `registry current: game 1.0.3, SDK 62fad41, PalSchema 0.6.3, item values 1.0.3`.
- **PalSchema 0.6.1 → 0.6.3 compat verified from the DIFF, not the notes** (`gh api compare
  0.6.1...0.6.3`): only items.schema.json (WorkableAttribute minimum 1 → 0, which we never
  constrained), the custom-item loader, signatures and docs. No field renames, no path
  moves, no validation changes. 0.6.2/0.6.3's unknown-property warnings (#138) are the
  semantics our CLI shipped in 0.4.0.
- **Open finding, not acted on:** 158 fields typed `number` in our schemas are `int32` in
  the SDK (e.g. DT_PalDropItem.Level, DT_PalHumanParameter.MeleeAttack). augment-from-sdk
  deliberately keeps observed-data types for fields that existed in the Jan-2024 dump and
  only maps C++ types for NEW fields, and JSON has no int/float distinction, so they all
  landed as `number`. Tightening to `integer` would match PalSchema's own generator, but it
  changes the published contract for 158 fields and needs its own PR + real-mod corpus run.
- Tests 41 → **43**, all green. Root package 0.5.0 → **0.6.0**.

## Session 2026-08-17 — v0.5.0: the registry bumps itself (issue #12, Palworld 1.0.3)
Trigger: the cron's own issue #12 ("game 1.0.3 released, registry newest is 1.0.2"). The
question was whether the follow-up work has to be manual at all. Half of it doesn't.
- **Phase-0 verified live:** Steam news (appid 1623730) lists `v1.0.3: Balance Adjustments
  & Bug Fixes` (2026-08-12) and nothing newer; `Source/Pal/Public` last regenerated at
  `98ee60d` (2026-07-11), the commit 1.0 pins; SDK head still `62fad41`. So 1.0.3 is an
  alias of 1.0, not a new pin.
- **scripts/bump-version.mjs** (`npm run versions:bump`): the alias path end to end, and a
  hard refusal (exit 3) on the regenerate path. Exit codes 0 wrote / 1 usage / 2 network /
  3 needs-a-human / 4 nothing-to-do. Writes `version=`/`alias_of=` to `$GITHUB_OUTPUT` when
  running under Actions. The interesting part is the **versions.json serializer**:
  `JSON.stringify(x, null, 2)` would reflow all 12 pinned records and bury a 5-line alias
  addition in 40 lines of churn, so it re-emits the file's own style (records inline under
  200 chars, longer ones expanded) and **asserts a byte-identical round-trip of the
  committed file before it is allowed to write** — `--check-format` exposes that as a CI
  gate (self-test.yml). It also preserves the file's EOLs (this clone has CRLF on disk
  despite `.gitattributes eol=lf`).
- **scripts/lib/version-sources.mjs:** Steam/SDK parsing extracted from check-currency so
  the reporter and the actor can't disagree on "newest". check-currency's output and exit
  codes are unchanged (fixture tests prove it). GitHub calls now send `GITHUB_TOKEN` when
  present — the 60/hr unauthenticated limit was hit during this very session.
- **refresh-items.yml → daily**, plus a `version-alias` job: bump, `npm run cli:build &&
  npm test`, then open a PR (branch `auto/palworld-<v>-alias`) that closes the stale issue.
  Gotcha recorded: PRs opened with `GITHUB_TOKEN` do NOT trigger self-test, which is why
  the suite runs inside the job and the PR body says so.
- **Currency fixtures are now generated from versions.json** at test time (the committed
  files stay as API-shape templates; `steam-stale.json` deleted). Hardcoded versions in
  those two assertions rotted on every bump — 1.0.3 was still labelled "hypothetical".
  Tests 35 → **41**, all green.
- **1.0.3 shipped as data:** versions.json alias + `structs/1.0.3.json` + three empty-delta
  diffs. Re-running snapshot:all/diff:all left every pre-existing file byte-identical.
- Root package 0.4.0 → **0.5.0** (CLI untouched at 0.4.0: it reads the registry from GitHub
  raw at runtime, so 1.0.3 works with the already-published npm build, no republish).

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
- **Nexus mods/4084 → v1.4 SHIPPED** (owner asked for it after the npm/GitHub work):
  - **New archive** built with bsdtar (never Compress-Archive — backslash entries quarantine):
    207 entries, **file list byte-for-byte identical to the v1.3 archive** (diffed; `cli/package.json`
    was missing on the first staging pass and is required for the offline `npm install` path),
    zero backslash entries, `unzip -t` clean, 566 KB. `nexus/REGISTRY_README.txt` rewritten to
    LEAD with the unknown-key change + exit-code table.
  - **VERIFIED from a clean extract** (not just packed): `--migrate 1.0.1..1.0.2` and
    `0.7.2..1.0` both run with **zero deps installed**; validation without ajv prints the clear
    one-sentence instruction; after the documented `cd cli && npm install`, the unknown-key
    warnings + `--strict` exit 1 both work **offline against the archive's own schemas**.
  - **Nexus previewer parses the zip** (lists schemas/structs/diffs/cli/items.json/index.html/
    README.txt) — the definitive all-clear against the v1.0 malformed-archive quarantine.
  - File **1.4** live (566 KB, 11 Aug 12:23PM), mod version synced to **1.4**, 1.3 archived,
    description updated (new "New in 1.4" section leading on warn-don't-reject) and **verified
    persisted on the PUBLIC page** — the SCEditor silent-revert trap did not fire because the
    `inst.val()` → `inst.updateOriginal()` → native-setter path was used, gated on
    whitespace-stripped equality. `nexus/NEXUS_DESCRIPTION.bbcode` re-synced to the live copy.
  - **NOT done — the file changelog.** `POST next.nexusmods.com/api/flamework/mods/changelogs/add`
    returned **403** when "Save file" committed, so the mod's Changelogs tab is still EMPTY. The
    file itself, its version, the archive flag and the description all saved fine — only the
    changelog entry was rejected. No retry path exists: `/edit/changelog(s)` both 404, the row's
    per-file **Update** button remains undrivable (08-01 finding, re-confirmed), and the
    "Add changelog" textarea only appears inside the upload form. The changelog text is
    preserved verbatim in this session's transcript and the same content is already public in
    the description, so nothing is lost to users. Worth one manual attempt from the browser, or
    re-try on the next file upload to see whether the 403 is per-account or transient.
  - **NEW LESSON recorded** (LESSONS.md 2026-08-11): `DOM.setFileInputFiles` on Windows needs
    FORWARD-SLASH paths — a backslash path silently produces a **0-byte** File (no CDP error),
    which surfaced as a Nexus **HTTP 500** plus the misleading client error "Cannot read
    properties of undefined (reading 'data')". Cost ~4 failed upload attempts before
    `Network.getResponseBody` showed `size_bytes:0` in the POST body. Always gate on
    `input.files[0].size > 0`.

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
