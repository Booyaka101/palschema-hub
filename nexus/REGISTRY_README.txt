PalSchema Hub — Community Schema Registry (offline archive)
============================================================

A complete, self-contained copy of the PalSchema Hub schema registry:
31 Palworld gameplay DataTables (DT_PalMonsterParameter, DT_ItemDataTable,
DT_ItemRecipeDataTable, DT_BuildObjectDataTable, DT_PalDropItem,
DT_WazaDataTable, ...) plus an item-loader schema (PalStaticItemData), with
every field name, type, example values and enum value lists — verified
against the current game's row structs (July 2026 SDK headers) and
cross-checked with real dumped row data.

Plus the CURRENT ROW VALUES for 28 of those tables, a per-item and
per-building VALUE reference, and a VERSION DIFF showing what changed in
the game's row structs between Palworld versions.

NEW IN THIS VERSION (registry 0.12.0, 2026-09-07)
  * PALWORLD 1.0.4 COVERED, WITH ONE HONEST ASTERISK. The patch changed no
    row struct the modding SDK describes, so a mod that worked on 1.0 needs
    no field migration. But the game's own cooked tables carry a property
    the SDK does not have yet: PalCharacterParameterDatabaseRow gained a
    91st (DT_PalMonsterParameter, DT_PalHumanParameter), set on 103 of the
    753 monster rows, all raid, tower, predator and boss entries. It was
    read out of the 1.0.4 pak rather than inferred. Nothing was removed,
    retyped or reordered; something was added, and this registry cannot
    name it until the SDK regenerates. versions.json records the whole
    finding under aliases["1.0.4"].gameDelta.
  * VALUES RE-READ FROM THE 1.0.4 BUILD. Item, build-object and map-object
    tables came back byte-identical, so items.json and buildings.json move
    only their version label. DT_PalDropItem, DT_PassiveSkill_Main and
    DT_WazaDataTable did move, including the Power Bomb minimum range drop
    from 1000 to 400.
  * BUILDING REFERENCE IS 483 ROWS, up from 460, and lost nothing. The
    source site quietly stopped listing 16 buildings whose pages are still
    live (the Egg Incubator among them); those are re-read by name now
    instead of vanishing from the reference.
  * CAUGHT UP TO PALSCHEMA 0.6.7, AND THE UE4SS PIN IS NOW CHECKED.
    0.6.7 must be run with UE4SS commit 2281fa31, which is a change 0.6.6
    made and nothing about a schema could have told you. That commit is now
    recorded in versions.json and compared against the release itself, so a
    UE4SS-only PalSchema release cannot slip past this registry again.
  * NOTHING IN 0.6.6 OR 0.6.7 CHANGES A FIELD, AND THAT WAS PROVEN, NOT
    ASSUMED. Every generated file was hashed, the whole registry was
    regenerated from the SDK headers, and the result matched byte for byte
    across all 34 files. 0.6.5's item changes (bLegalInGame, WazaID on
    Consumables, $resource icons) were already shipped in 0.10.0 and are
    still exact: PalSchema's items.schema.json is the same blob at 0.6.5,
    0.6.6, 0.6.7 and on main.
  * A MISSING SDK HEADER NOW FAILS THE BUILD BY NAME instead of quietly
    leaving that table on three-year-old dump data under a comment claiming
    otherwise.

PREVIOUSLY (registry 0.11.0, 2026-08-30)
  * EVERY TABLE'S ACTUAL VALUES, NOT JUST ITS FIELDS. values.html and
    values/<Table>.json carry 41,416 rows across 28 of the 31 tables:
    pals, passive skills, waza, recipes, drops, lotteries, icons and the
    rest. Pick a table, filter to a row, read every field, and copy a
    paste-ready raw-table patch for it. Works offline from this archive.
  * READ FROM THE GAME, NOT SCRAPED. The values come out of Palworld's own
    cooked DataTables (pak -> Oodle -> unversioned properties), so they are
    the build you are playing rather than a mirror of it. Example: the
    Legend passive is Rank 4 with ShotAttack, Defense and Move Speed all
    at 20 — the widely-copied community dump still says Rank 3 and move
    speed 15, because it is from January 2024.
  * EVERY PUBLISHED VALUE IS SCHEMA-CHECKED. All 41,416 rows validate
    against this registry's own schema for their table, so the field list
    and the data agree. That check already caught seven fields typed too
    narrowly to accept the asset paths the game itself stores.
  * Three tables do not extract yet (DT_TechnologyRecipeUnlock,
    DT_MapObjectAssignData, DT_TechnologyIconData). values/index.json says
    so and says why, rather than quietly omitting them.

PREVIOUSLY (registry 0.10.0 / validator 0.6.0, 2026-08-30)
  * ITEM MODS GET REAL VALUE CHECKS, ported from PalSchema 0.6.5's own
    items.schema.json (its PR #145, released 2026-08-28). Errors now catch:
    an IconTexture or VisualBlueprintClassSoft path whose asset name does
    not repeat after the dot (reported naming both parts — the game
    resolves the typo to nothing); Rarity outside 0-4; negative
    Rank/Price/Weight/Durability; MaxStackCount below 1; a missing
    required field on a NEW item; and Weight/CorruptionFactor/Durability/
    SneakAttackRate/Recipe.WorkAmount written as bare integers where the
    loader wants float literals (1.0, not 1 — checked on the raw text,
    because a JSON parser erases the difference).
  * $resource/YourMod/YourImage icon paths validate fine — that loader
    feature has worked since PalSchema 0.5.0.
  * FIELDS USED ON THE WRONG ITEM CLASS WARN, NAMING THE CLASS. WazaID on
    a Weapon: the loader ignores it and the game only warns at load time;
    the validator says so in CI. Upstream's own schema cannot catch this
    (its per-Type branches do not actually enforce scope), and its Weapon
    branch's "AttackPower" is a typo for AttackValue — this registry
    scopes the real name. MaxStackCount above 9999 also warns (the game
    duplicates items when moving such stacks).
  * Partial patches of existing items are untouched: the required-field
    list only applies when the entry carries a Type key, which the loader
    requires when adding and ignores when editing.

PREVIOUSLY (registry 0.9.0, 2026-08-19)
  * BUILDING REFERENCE (buildings.html / buildings.json): 460 buildings,
    current game (Palworld 1.0.3). A building spans TWO DataTables sharing
    one row name (HatchingPalEgg in both DT_MapObjectMasterDataTable and
    DT_BuildObjectDataTable; the unlocking DT_TechnologyRecipeUnlock row is
    Special_HatchingPalEgg). Each entry shows both rows, materials mapped
    to item Codes, and copy/paste JSON for a raw-table mod.

PREVIOUSLY (registry 0.8.0 / validator 0.5.0, 2026-08-19)
  * TRACKS PALSCHEMA 0.6.3 AND 0.6.4. PalSchema 0.6.4 lets new pals carry
    ranch suitability through a RanchActionData object in pals json
    (its PR #143). That key lives in PalSchema's LOADER, not on any UE row
    struct, so schemas built from SDK headers alone would flag a legal
    0.6.4 mod. The registry now ships structs/loader-overlay.json with
    every loader-implemented key (RanchActionData, Loot, AbilitiesByLevel,
    IconAssetPath, Recipe, Type, SortID, ...), read off the loader source.
  * PAL AND ITEM LOADER FILES VALIDATE DIRECTLY. Files shaped
    { "<CharacterId>": {...} } (pals folder) and { "<ItemId>": {...} }
    (items folder) are recognized alongside raw DT_* files. Item files
    check against the actual UPalStaticItemData class fields; an item's
    Recipe object checks against DT_ItemRecipeDataTable.
  * NEW --palschema-version FLAG. Target the PalSchema release you run:
    RanchActionData on a new pal against 0.6.3 reports
    "requires PalSchema >= 0.6.4" with the PR link, instead of a generic
    unknown-field warning. --version now defaults to the newest known
    Palworld version, so plain `palschema-validate my-mod/` works.
  * WARNINGS NOW SAY WHETHER THE GAME CATCHES THE SAME MISTAKE. Item
    loader: PalSchema 0.6.3+ also warns at load time (its PR #138). Pal
    loader: nothing in game warns (PalSchema issue #134, still open), so
    a typo'd pal field is caught by this validator and by nothing else.

PREVIOUSLY (registry 0.7.0, 2026-08-17)
  * PALWORLD 1.0.3 COVERED. The patch changed no DataTable row structs, so
    a mod that worked on 1.0 needs no field migration. Verified rather than
    assumed: the decompiled SDK's row-struct headers have not been
    regenerated since 1.0 (Source/Pal/Public @98ee60d, 2026-07-11).
  * ITEM VALUES ARE 1.0.3. 1.0.3 was a balance patch, so row values moved
    while the structs stood still. items.json was re-scraped: World Tree
    Holy Water weighs 0.1 instead of 1, the Aquatic Construction Kit is
    rank 2 instead of 4.
  * INT COLUMNS ARE NOW TYPED integer, NOT number. 158 fields the game
    declares int32 (DT_PalDropItem.Level, DT_PalHumanParameter.MeleeAttack
    and others) used to accept 1.5 and fail only in-game. They now fail
    validation with "must be integer", which is where you want to find out.
  * Compatible with PalSchema 0.6.3 (checked against the whole 0.6.0-0.6.3
    diff: no field renamed, no path moved, no row validation changed).

PREVIOUSLY (validator 0.4.0, 2026-08-11)
  * UNKNOWN FIELDS WARN INSTEAD OF FAILING YOUR BUILD. If your mod
    sets a field this registry's row struct does not know about, the
    validator prints a warning with a did-you-mean suggestion and still
    exits 0:

        WARN mods/pals.json:Lamball unknown field "rarity"
             - did you mean "Rarity"?
        1 file validated, 0 errors, 1 unknown-key warning

    Why it matters: these schemas are derived from a snapshot of the
    game's SDK headers. Every field Palworld adds AFTER that snapshot
    used to be a hard rejection of perfectly correct mod JSON. Now a
    stale schema degrades to a warning you can ignore, never a blocked
    build. Genuine mistakes - wrong types, malformed rows - still fail.
  * NEW --strict FLAG for CI, which turns those warnings back into
    errors (exit 1) when you want the stricter gate:

        npx palschema-validate --version 1.0 --strict my-mod/

  * PalSchema's own pseudo-keys never warn: the $Filters row key and the
    {"Action": "Clear", "Items": [...]} wrapper accepted on array fields.
  * These are the semantics PalSchema itself is adopting - see issue #134
    on its GitHub. Registry DATA is unchanged in this release: the
    schemas, structs, diffs and item values below are all still current.

PREVIOUSLY (registry v0.4.0, 2026-08-04)
  * ITEM VALUES ARE NOW CURRENT-GAME. items.json went from 947 rows of
    Jan-2024 data to 2,445 rows of current-game data, scraped from
    paldb.cc. Items added since 1.0 are finally present (Hexolite Helmet,
    internal Code SFHelmet, SortId 1325, among them), and the dead field
    SortID - which the current game renamed to SortId - is gone.
  * Rarity variants are separate rows, as the game stores them:
    PlasticHelmet, PlasticHelmet_2 .. _5, each with its own SortId,
    Rarity, Defense, Health and Durability.
  * A gate (npm run check:items) validates every row against the
    DT_ItemDataTable schema and fails the build if the data goes stale
    again - no more silently shipping year-old values.
  * Palworld 1.0.2 covered (from v0.3.0). The whole 1.0.2 patch line
    (v1.0.2, v1.0.2.100993 "Mod Support Improvement", v1.0.2.101103)
    changed NO DataTable row structs, so if your mod worked on 1.0 it
    needs no field migration. Verified, not assumed: the decompiled SDK's
    row-struct headers have not been regenerated since 1.0
    (Source/Pal/Public @98ee60d, 2026-07-11).

WHAT'S IN THIS ARCHIVE
----------------------
  schemas/v1.0/*.schema.json   31 JSON Schemas, one per DataTable (+ manifest)
  schemas/index.json           machine-readable table listing
  index.json                   registry catalog
  index.html                   the searchable schema browser (see below)
  items.html / items.json      per-item value reference for DT_ItemDataTable
                               (2,445 current-game items: ItemActorClass /
                               ItemStaticClass / ItemDynamicClass + full row
                               JSON to copy)
  diff.html                    version-diff viewer (what changed between
                               Palworld versions)
  versions.json                Palworld version -> pinned SDK commit
  structs/<version>.json       12 row-struct snapshots, 0.3.1 through 1.0
  diffs/<a>..<b>.json + .md    field-level deltas for every version pair
  cli/                         the palschema-validate CLI (MIT)
  LICENSE                      MIT

LOOK UP A FIELD (no tools needed)
---------------------------------
Open any schemas/v1.0/DT_*.schema.json in a text editor. Every field lists
its type, an example value from real game data, and enum values where known.

WHAT CHANGED BETWEEN GAME VERSIONS
----------------------------------
Open diffs/0.7.2..1.0.md in any text editor to see exactly which row-struct
fields 1.0 added, removed or retyped, and which DT_* tables each change hits.
Across the 30 covered registry tables, 1.0 removed exactly ONE field:
OverridePartnerSkillTextID on PalCharacterParameterDatabaseRow (used by both
DT_PalMonsterParameter and DT_PalHumanParameter), replaced by the split pair
OverridePartnerSkillNameTextID + OverridePartnerSkillDescTextID.

Scan your own mod for fields a patch broke:
    npx palschema-validate --migrate 0.7.2..1.0 my-mod/

It prints one line per affected field (with a labelled possible-rename note)
and exits 1 if anything broke, so it drops straight into CI.

Note: Palworld 0.7.3, 1.0.1, the 1.0.2 line, 1.0.3 and 1.0.4 shipped no row-struct
changes, so they are recorded as aliases of 0.7.2 / 1.0 / 1.0 / 1.0 / 1.0 — those pairs report
"no row-struct changes" rather than inventing a diff. For example:

    npx palschema-validate --migrate 1.0.1..1.0.2 my-mod/
    -> no row-struct changes between 1.0.1 and 1.0.2
       (both alias Palworld 1.0, SDK e663245)   [exit 0]

HOW CURRENT IS EACH PART? (read this before trusting a value)
-------------------------------------------------------------
Field NAMES and TYPES — the schemas, the version diffs, the --migrate scan —
are verified against the CURRENT game's row structs (PalworldModdingKit SDK
headers @62fad41). That part is 1.0.4-current, with one exception the SDK
cannot cover: 1.0.4 added a property to PalCharacterParameterDatabaseRow
(DT_PalMonsterParameter, DT_PalHumanParameter) that the headers do not
describe, so it is absent here. Nothing was removed, retyped or reordered,
so a mod written against 1.0 still needs no field migration. versions.json
aliases["1.0.4"].gameDelta records what was read out of the game.

Row VALUES in items.json / items.html are current too, re-scraped for 1.0.4
(the patch moved no item row at all — the game's own DT_ItemDataTable is
byte-identical to 1.0.3).
They come from paldb.cc, which tracks the live build (its footer pins to
v1.0.4, 2026/09/07): 2,445 rows, one per rarity variant. Fields paldb.cc does not
render (VisualBlueprintClassSoft, DropItemType, GrantEffect*, TechnologyTreeLock
and friends) are filled from the old Jan-2024 paldex dump where that row existed
back then; paldb wins every conflict, and items.json's fieldSources object
records, per row, exactly which fields are live and which are legacy fill.
Ten rows exist only in the old dump and are labelled as such on the page.
About 20 internal TEST/Blueprint rows have no paldb page and are absent.

BROWSE WITH THE UI
------------------
index.html, items.html and diff.html need to be served over HTTP (browsers
block file:// data loads). From this folder run either:
    npx serve .
    python -m http.server 8080
then open http://localhost:8080. Or just use the always-current hosted copy:
    https://booyaka101.github.io/palschema-hub/

VALIDATE YOUR MOD'S JSON
------------------------
Online (simplest, always latest schemas):
    npx palschema-validate --version 1.0 my-mod/DT_PalMonsterParameter.json

Fully offline against this archive (one-time npm install for the CLI's deps):
    cd cli
    npm install
    node dist/index.js --version 1.0 --registry .. ..\my-mod\DT_PalMonsterParameter.json

It reports typed errors — wrong value types, malformed rows — before you ever
launch the game, and warns (without failing) on fields this registry does not
recognise, with a did-you-mean suggestion. That is the same class of mistake
PalSchema logs as "Property not found in Row" at load time, caught earlier.
Add --strict to make those warnings fail the run instead, for CI.

Exit codes:
    0   all files pass (unknown-key warnings alone never fail a run)
    1   type/shape error, breaking --migrate field, or bad usage —
        or any unknown-key warning when --strict is given
    2   the registry could not be read at all (bad --registry path, network
        failure, or a GitHub rate limit) — nothing was validated. A table this
        registry does not carry is still only a warning.

LINKS
-----
  Live browser   :  https://booyaka101.github.io/palschema-hub/
  Version diff   :  https://booyaka101.github.io/palschema-hub/diff.html
  Source (MIT)   :  https://github.com/Booyaka101/palschema-hub
  CLI on npm     :  https://www.npmjs.com/package/palschema-validate
  Pal Schema     :  https://www.nexusmods.com/palworld/mods/2361  (by Okaetsu)

Compatible with PalSchema 0.6.71 and the UE4SS build it requires
(commit 2281fa31): https://github.com/Okaetsu/RE-UE4SS/releases/tag/2281fa31

This archive contains no game assets. Schema data derived from the public
paldex game-data dump (blaynem) and PalworldModdingKit SDK headers (localcc),
verified July 2026. License: MIT.
