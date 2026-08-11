# palschema-validate

Validate [Palworld PalSchema](https://github.com/Okaetsu/PalSchema) mod JSON/JSONC files
against the [palschema-hub](https://github.com/Booyaka101/palschema-hub) schema registry —
and scan them for fields the game **removed or retyped between versions**.

## Validate (schema check)

```bash
npx palschema-validate --version 1.0 ./mods/
```

Flags typos, unknown fields, and wrong types per table/row, with PalSchema's exact loader
semantics (array `{"Action":"Clear","Items":[…]}` wrappers, `$Filters` row keys, JSONC).

**Unknown keys warn, they don't reject** (since 0.4.0 — the semantics PalSchema itself
is adopting, [Okaetsu/PalSchema#134](https://github.com/Okaetsu/PalSchema/issues/134)):
a field the registry's row struct doesn't declare gets a warning with a did-you-mean
suggestion, so a legitimately-new game field never breaks your build. Genuine
type/shape errors still fail the run.

```
WARN mods/pals.json:Lamball unknown field "rarity" — did you mean "Rarity"?
1 file validated, 0 errors, 1 unknown-key warning
```

In CI, add `--strict` to promote unknown-key warnings to errors (exit 1).

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
regenerated its SDK headers. Versions that shipped no header change (0.7.3, 1.0.1, and
the whole 1.0.2 patch line) are aliases: `--migrate 1.0.1..1.0.2` reports
"no row-struct changes between 1.0.1 and 1.0.2 (both alias Palworld 1.0, SDK 62fad41)"
and exits 0 instead of pretending a diff exists. Rename notes are heuristic and always labelled (high/medium confidence).

## Options

| flag | meaning |
|---|---|
| `--version <v>` | validate against Palworld version `<v>` (exactly one of `--version` / `--migrate`) |
| `--migrate <a>..<b>` | scan for fields removed/retyped between versions `<a>` and `<b>` |
| `--registry <r>` | schema/diff source: base URL or local repo-root path (default: the GitHub registry) |
| `--owner <o>` | GitHub owner for the default registry URL (default `Booyaka101`) |
| `--strict` | CI mode: promote unknown-key warnings to errors (exit 1) |

## Exit codes

| code | meaning |
|---|---|
| 0 | all files pass — unknown-key warnings alone never fail a run |
| 1 | validation error / breaking `--migrate` field / bad usage — or any unknown-key warning under `--strict` |

Browse the registry: https://booyaka101.github.io/palschema-hub/ · version diffs:
https://booyaka101.github.io/palschema-hub/diff.html

MIT. Field names/types derived from decompiled SDK headers (credit
[localcc/PalworldModdingKit](https://github.com/localcc/PalworldModdingKit)); no game assets.
