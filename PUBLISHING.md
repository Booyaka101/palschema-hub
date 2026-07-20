# PUBLISHING — owner actions (everything below is prepared; nothing has been posted)

This build ran under a no-publish / no-account policy, so the three outward-facing
steps are staged here as copy-paste actions. Total time: ~10 minutes.

Everything referenced is already in the repo and verified locally:
`npm test` → 10/10 (including 4 real Nexus mods), browser + `schemas/index.json`
serve correctly, `pages.yml` deploys with tests as a gate.

---

## 1. Push to GitHub + enable Pages (~3 min)

```bash
cd D:/Repos/ideas/palschema-hub-unblocked
git init -b main
git add -A
git commit -m "palschema-hub: 31 SDK-verified Palworld DataTable schemas + validator CLI + browser"
gh repo create palschema-hub --public --source . --push
# Enable Pages via the Actions workflow (pages.yml is already in the repo):
gh api repos/Booyaka101/palschema-hub/pages -X POST -f build_type=workflow
gh workflow run pages.yml
```

Pages URL: **https://booyaka101.github.io/palschema-hub/**
Check: the browser loads with 31 searchable tables, and
`https://booyaka101.github.io/palschema-hub/schemas/index.json` returns the listing.

> The CLI's default registry already points at
> `raw.githubusercontent.com/Booyaka101/palschema-hub/main` (`--owner` overrides).

## 2. (Recommended) Publish the CLI to npm so `npx` works (~2 min)

```bash
cd cli && npm publish   # builds via prepublishOnly; package name: palschema-validate
```

## 3. Comment on PalSchema issue #53 (~1 min)

`gh issue comment 53 -R Okaetsu/PalSchema --body-file PUBLISH_COMMENT.md`
(after replacing the npx line if you skipped step 2 — see note inside the file).

The prepared comment is in [`PUBLISH_COMMENT.md`](PUBLISH_COMMENT.md).

## 4. Nexus Mods page (~5 min, needs your Nexus login)

Nexus blocks automated/anonymous access (pages + API 403 without an account), so
this is manual. On https://www.nexusmods.com/palworld → "Upload a mod":

- **Title:** `PalSchema Hub — Community Schema Registry`
- **Category:** Modders Resources
- **File:** upload `nexus/palschema-hub-registry.zip` (already built — contains a
  README pointing at the registry; Nexus requires at least one file).
- **Description:** paste [`nexus/NEXUS_DESCRIPTION.bbcode`](nexus/NEXUS_DESCRIPTION.bbcode)
  (Nexus descriptions use BBCode).
- **Permissions:** open/MIT; **Requirements:** link PalSchema
  (https://www.nexusmods.com/palworld/mods/2361) as a soft requirement.

---

### Why these weren't done autonomously
Posting the issue comment, pushing the repo, and creating the Nexus page are
external publications (and Nexus additionally requires an account + manual
download gates), which this run was not authorized to perform. All content is
final-form; no placeholders except the two marked npx lines.
