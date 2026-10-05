# Examples

Sample inputs for the [package checker](../package.html) and
`palschema-validate check-package`. These files are **examples**, not data the
tools return — copy them as starting points, don't install them.

- `official-mod/` — a minimal official Palworld Workshop package:
  `Info.json` with `PackageName` + two `InstallRule` entries (a Lua mod and a
  server-capable `.pak`), plus the files those targets name. Run
  `npx palschema-validate check-package examples/official-mod` against it.
- `palschema-mod.json` — a UE4SS-era PalSchema raw-table patch (the format this
  registry's schemas describe). Validated by
  `npx palschema-validate examples/palschema-mod.json`.
