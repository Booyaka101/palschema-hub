# palschema-validate

Validate [Palworld PalSchema](https://github.com/Okaetsu/PalSchema) mod JSON/JSONC files
against the [palschema-hub](https://github.com/Booyaka101/palschema-hub) schema registry —
and scan them for fields the game **removed or retyped between versions**.

## Validate (schema check)

```bash
npx palschema-validate ./mods/
```

Flags typos, unknown fields, and wrong types per table/row, with PalSchema's exact loader
semantics (array `{"Action":"Clear","Items":[…]}` wrappers, `$Filters` row keys, JSONC).
Since 0.5.0 all three PalSchema file shapes are recognized: raw table files
(`{"DT_*": {...}}`), pal-loader files (`{"<CharacterId>": {...}}`) and item-loader
files (`{"<ItemId>": {...}}`, where a `null` entry deletes the item) — detected by
their `DT_*` keys, their `pals/`/`items/` folder, or their fields. Loader-implemented
keys (`RanchActionData`, `Loot`, `AbilitiesByLevel`, `Recipe`, `Type`, ...) come from
the registry's loader overlay, read off PalSchema's loader source.

**Unknown keys warn, they don't reject** (since 0.4.0 — the semantics PalSchema itself
adopted for its item loader in 0.6.2, [Okaetsu/PalSchema#134](https://github.com/Okaetsu/PalSchema/issues/134)
/ [#138](https://github.com/Okaetsu/PalSchema/pull/138)): a field the schema doesn't
declare gets a warning with a did-you-mean suggestion, so a legitimately-new game field
never breaks your build. Each warning notes whether the game would catch it too — the
item loader warns in game since PalSchema 0.6.3, the pal loader silently drops unknown
keys (#134, still open), which makes this scan the only thing that catches a pals typo.

**`--palschema-version <v>`** targets a specific PalSchema release. Loader keys newer
than the target are flagged with the release they need — e.g. `RanchActionData` on a
new pal against 0.6.3 reports `requires PalSchema >= 0.6.4`
([PR #143](https://github.com/Okaetsu/PalSchema/pull/143)). Unknown values fail loudly.

**Integer columns are enforced** since registry 0.7.0. 158 fields the game declares
`int32` (`DT_PalDropItem.Level`, `DT_PalHumanParameter.MeleeAttack`, …) used to accept
`1.5` and fail only in-game; they now report `must be integer`. The CLI reads schemas
from the registry at runtime, so this applies to every installed version, including
older ones.

**Item-loader constraints** since registry 0.10.0, ported from PalSchema's own
`items.schema.json` (0.6.5, [PR #145](https://github.com/Okaetsu/PalSchema/pull/145)).
Errors: an `IconTexture`/`VisualBlueprintClassSoft` path whose asset name doesn't
repeat after the dot (reported naming both parts; `$resource/<Mod>/<Image>` imports
are fine), out-of-range values (`Rarity` 0–4, `Rank`/`Price` ≥ 0, `MaxStackCount` ≥ 1),
a missing required field on a NEW item (entries with a `Type` key — partial patches
of existing items are untouched), and a bare integer on the five float-literal
fields (`Weight`, `CorruptionFactor`, `Durability`, `SneakAttackRate`,
`Recipe.WorkAmount` — checked on the raw text, since `100.0` and `100` parse
identically). Warnings: a field used outside its item class (`WazaID` on a Weapon
names `UPalStaticConsumeItemData`; the loader ignores it and the game warns since
0.6.3) and `MaxStackCount` above 9999 (the game duplicates items past it).

```
WARN mods/pals/mypal.json:Lamball unknown field "rarity" — did you mean "Rarity"? (not caught in game: PalSchema's pal loader silently ignores unknown fields — Okaetsu/PalSchema#134)
1 file validated, 0 errors, 1 unknown-key warning
```

In CI, add `--strict` to promote warnings to errors (exit 1).

## Migrate (breaking-change scan)

```bash
npx palschema-validate --migrate 0.7.2..1.0 ./mods/
```

For every field your mod sets that no longer exists (or changed C++ type) in the target
version, prints one line:

```
mod.json > DT_PalMonsterParameter > ChickenPal000 > OverridePartnerSkillTextID: removed in 1.0 (was FName) — possible rename to OverridePartnerSkillNameTextID (medium confidence)
```

Exit code 1 if any breaking field is found, 0 otherwise. A migration scan needs **no
dependencies** — `ajv` is only loaded for schema validation, so `--migrate` runs straight
from `dist/` with nothing installed. Version pins come from the
registry's `versions.json` — each Palworld version maps to the
[localcc/PalworldModdingKit](https://github.com/localcc/PalworldModdingKit) commit that
regenerated its SDK headers. Versions that shipped no header change (0.7.3, 1.0.1, the
whole 1.0.2 patch line, and 1.0.3) are aliases: `--migrate 1.0.1..1.0.2` reports
"no row-struct changes between 1.0.1 and 1.0.2 (both alias Palworld 1.0, SDK e663245)"
and exits 0 instead of pretending a diff exists. Rename notes are heuristic and always labelled (high/medium confidence).

## Options

| flag | meaning |
|---|---|
| `--version <v>` | validate against Palworld version `<v>` (default: the newest the registry knows) |
| `--palschema-version <v>` | PalSchema release to target; loader keys newer than it are flagged. Unknown values fail loudly |
| `--migrate <a>..<b>` | scan for fields removed/retyped between versions `<a>` and `<b>` (mutually exclusive with `--version`) |
| `--registry <r>` | schema/diff source: base URL or local repo-root path (default: the GitHub registry) |
| `--owner <o>` | GitHub owner for the default registry URL (default `Booyaka101`) |
| `--strict` | CI mode: promote warnings to errors (exit 1) |

## Exit codes

| code | meaning |
|---|---|
| 0 | all files pass — warnings alone never fail a run |
| 1 | validation error / breaking `--migrate` field / bad usage — or any warning under `--strict` |

Browse the registry: https://booyaka101.github.io/palschema-hub/ · version diffs:
https://booyaka101.github.io/palschema-hub/diff.html

MIT. Field names/types derived from decompiled SDK headers (credit
[localcc/PalworldModdingKit](https://github.com/localcc/PalworldModdingKit)); no game assets.
