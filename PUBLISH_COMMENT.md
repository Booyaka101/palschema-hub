A community schema registry for this now exists: **https://booyaka101.github.io/palschema-hub/**

It's a browsable, searchable index of the raw-table surface — 31 gameplay DataTables (`DT_PalMonsterParameter`, `DT_ItemDataTable`, `DT_ItemRecipeDataTable`, `DT_BuildObjectDataTable`, …) with every row-struct field name, type, example values, and enum value lists. Machine-readable listing: [`schemas/index.json`](https://booyaka101.github.io/palschema-hub/schemas/index.json).

**Provenance:** field names are verified against the current game's row structs (decompiled SDK headers, July 2026) and cross-checked with real FModel row data — including post-1.0 fields like `InstallMaxNumInBaseCamp`, `CraftExpRate` and drop slots 6–10, and both array patch forms (`[...]` replace / `{"Action": "Clear", "Items": [...]}`) plus `$Filters`. It is *not* Schema Generator output; if you generate official schemas in-game, they can supersede these files in place ([repo](https://github.com/Booyaka101/palschema-hub)).

There's also a validator CLI that checks a mod's JSON/JSONC against the registry and reports typed field errors (unknown/renamed fields, wrong types) before you launch the game:

```
npx palschema-validate --version 1.0 my-mod/DT_PalMonsterParameter.json
```

It's validated against real published PalSchema mods (Palvolve, Unlimited Buildings, Old School Loot validate clean; it even caught a genuinely stale `RedialIndex` field in one popular mod — the same thing PalSchema logs as `Property not found in Row` at load time). Hope this helps until an official database exists!
