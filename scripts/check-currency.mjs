#!/usr/bin/env node
/**
 * check-currency.mjs — is versions.json still current with the real world?
 *
 * Two live sources, compared against versions.json:
 *   1. GAME:  the Steam news API for Palworld (appid 1623730). Patch titles look
 *      like "v1.0.2: Bug fixes" / "v1.0.2.101103:Bug fixes"; the newest game
 *      version is extracted from them (build-number components are dropped, so
 *      v1.0.2.101103 -> 1.0.2). NOTE: items arrive out of order and `date` is a
 *      unix timestamp — we sort/convert locally, never trusting feed order.
 *   2. SDK:   the localcc/PalworldModdingKit commit list. The branch head is
 *      compared against versions.json's `sdkHead.commit`; when the head moved we
 *      additionally check whether Source/Pal/Public itself was regenerated
 *      (that's what would make the row structs — and this registry — stale).
 *   3. PALSCHEMA: the newest Okaetsu/PalSchema release vs the version this repo
 *      claims compatibility with (versions.json `upstream.palSchema`).
 *   4. ITEMS SCHEMA: the live blob sha of PalSchema's assets/schemas/items.schema.json
 *      (default branch) vs the sha structs/upstream-constraints.json pins. The
 *      item-loader constraints are PORTED from that file, so an upstream edit
 *      makes the port stale even before it reaches a release — and a release
 *      that doesn't touch the schema doesn't invalidate the port.
 *
 * Plus one purely local check that the first two structurally cannot catch: a
 * BALANCE patch changes row VALUES while every struct and sha stays put, so
 * items.json._provenance.gameVersion is compared against the newest game label
 * too. Palworld 1.0.3 was exactly that case (Holy Water weight 1 -> 0.1).
 *
 * Exit codes (never conflated):
 *   0  in sync   — prints "registry current: game <v>, SDK <sha>, PalSchema <v>"
 *   1  stale     — one diagnostic line naming exactly what moved
 *   2  network   — a source could not be fetched/parsed
 *
 * Fixture overrides (used by the test suite; no network touched when all given):
 *   --steam-json <file>            saved Steam news API response
 *   --commits-json <file>          saved GitHub commit-list response (head)
 *   --public-commits-json <file>   saved commit list filtered to Source/Pal/Public
 *   --releases-json <file>         saved Okaetsu/PalSchema releases response
 *   --items-json <file>            items.json to read _provenance from
 *   --upstream-schema-json <file>  saved contents-API response for items.schema.json
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  STEAM_URL,
  commitsUrl,
  publicCommitsUrl,
  releasesUrl,
  contentsUrl,
  SourceError,
  loadJson as loadSource,
  cmpVersions,
  newestGameVersion,
  registryNewest,
} from './lib/version-sources.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const versionsInfo = JSON.parse(readFileSync(join(ROOT, 'versions.json'), 'utf8'));

const COMMITS_URL = commitsUrl(versionsInfo.repo);
const PUBLIC_COMMITS_URL = publicCommitsUrl(versionsInfo.repo);
const RELEASES_URL = releasesUrl(versionsInfo.upstream?.palSchema?.repo ?? 'Okaetsu/PalSchema');

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const fixtures = {
  steam: flag('--steam-json'),
  commits: flag('--commits-json'),
  publicCommits: flag('--public-commits-json'),
  releases: flag('--releases-json'),
  items: flag('--items-json'),
  buildings: flag('--buildings-json'),
  upstreamSchema: flag('--upstream-schema-json'),
};

async function loadJson(url, fixturePath, what) {
  try {
    return await loadSource(url, fixturePath, what);
  } catch (e) {
    if (!(e instanceof SourceError)) throw e;
    console.error(`network failure: ${e.message}`);
    process.exit(2);
  }
}

// ---- GAME: newest patch version in the Steam news window --------------------
const steam = await loadJson(STEAM_URL, fixtures.steam, 'Steam news for appid 1623730');
let gameNewest;
try {
  gameNewest = newestGameVersion(steam);
} catch (e) {
  console.error(`network failure: ${e.message}`);
  process.exit(2);
}

const newest = registryNewest(versionsInfo);

// ---- SDK: branch head vs the recorded head ----------------------------------
const headCommits = await loadJson(COMMITS_URL, fixtures.commits, 'PalworldModdingKit commit list');
const headSha = Array.isArray(headCommits) ? headCommits[0]?.sha : undefined;
if (!headSha) {
  console.error('network failure: PalworldModdingKit commit list is empty/unparseable');
  process.exit(2);
}
const recordedHead = versionsInfo.sdkHead?.commit ?? versionsInfo.versions[versionsInfo.order[versionsInfo.order.length - 1]].sdkCommit;

const problems = [];
if (gameNewest && cmpVersions(gameNewest, newest) > 0) {
  problems.push(`game ${gameNewest} released, registry newest is ${newest}`);
}
if (!headSha.startsWith(recordedHead)) {
  // Head moved — did Source/Pal/Public (the row structs) actually regenerate?
  const pub = await loadJson(PUBLIC_COMMITS_URL, fixtures.publicCommits, 'PalworldModdingKit Source/Pal/Public commit list');
  const pubSha = Array.isArray(pub) ? pub[0]?.sha : undefined;
  const newestPin = versionsInfo.versions[versionsInfo.order[versionsInfo.order.length - 1]].sdkCommit;
  if (pubSha && !pubSha.startsWith(newestPin)) {
    problems.push(`SDK regenerated at ${pubSha.slice(0, 7)}, registry pins ${newestPin}`);
  } else {
    problems.push(`SDK head moved to ${headSha.slice(0, 7)} (no Source/Pal/Public change), registry records ${recordedHead}`);
  }
}

// ---- ITEM VALUES: a balance patch moves data, not structs -------------------
// Nothing above can see this: 1.0.3 changed item values with an unchanged SDK and
// an unchanged struct set, so every sha check reported "current" while items.json
// still shipped 1.0.2 numbers.
const itemsPath = fixtures.items ?? join(ROOT, 'items.json');
let itemsProvenance;
try {
  itemsProvenance = JSON.parse(readFileSync(itemsPath, 'utf8'))._provenance;
} catch (e) {
  console.error(`network failure: cannot read ${itemsPath}: ${e.message}`);
  process.exit(2);
}
const itemsVersion = itemsProvenance?.gameVersion;
if (itemsVersion && cmpVersions(itemsVersion, newest) < 0) {
  problems.push(`items.json values are Palworld ${itemsVersion}, registry newest is ${newest}`);
}

// buildings.json has the same balance-patch blindness as items.json.
const buildingsPath = fixtures.buildings ?? join(ROOT, 'buildings.json');
let buildingsVersion;
try {
  buildingsVersion = JSON.parse(readFileSync(buildingsPath, 'utf8'))._provenance?.gameVersion;
} catch (e) {
  console.error(`network failure: cannot read ${buildingsPath}: ${e.message}`);
  process.exit(2);
}
if (buildingsVersion && cmpVersions(buildingsVersion, newest) < 0) {
  problems.push(`buildings.json values are Palworld ${buildingsVersion}, registry newest is ${newest}`);
}

// ---- PALSCHEMA: the framework these schemas are written for ------------------
const claimed = versionsInfo.upstream?.palSchema?.version;
let palSchemaNewest = claimed;
if (claimed) {
  const releases = await loadJson(RELEASES_URL, fixtures.releases, 'Okaetsu/PalSchema releases');
  // Releases are returned newest-first, but tags are compared by version anyway.
  const tags = (Array.isArray(releases) ? releases : [])
    .map((r) => String(r?.tag_name ?? '').replace(/^v/i, ''))
    .filter((t) => /^\d+(\.\d+)*$/.test(t));
  if (!tags.length) {
    console.error('network failure: PalSchema release list is empty/unparseable');
    process.exit(2);
  }
  palSchemaNewest = tags.reduce((a, b) => (cmpVersions(a, b) >= 0 ? a : b));
  if (cmpVersions(palSchemaNewest, claimed) > 0) {
    problems.push(`PalSchema ${palSchemaNewest} released, this registry claims ${claimed}`);
  }
}

// ---- UPSTREAM ITEMS SCHEMA: the constraint source the item schema ports ------
// A release bump alone doesn't invalidate the port (0.6.5's loader changes left
// the constraints intact); an edit to items.schema.json on main does, before any
// release exists to compare against. So the blob itself is the axis.
const pinned = JSON.parse(readFileSync(join(ROOT, 'structs', 'upstream-constraints.json'), 'utf8')).verifiedAgainst;
let upstreamSchemaSha;
if (pinned?.blobSha) {
  const live = await loadJson(
    contentsUrl(pinned.repo, pinned.file),
    fixtures.upstreamSchema,
    `${pinned.repo} ${pinned.file} blob`
  );
  upstreamSchemaSha = live?.sha;
  if (!upstreamSchemaSha) {
    console.error(`network failure: ${pinned.repo} ${pinned.file} response has no blob sha`);
    process.exit(2);
  }
  if (upstreamSchemaSha !== pinned.blobSha) {
    problems.push(
      `upstream items.schema.json changed (blob ${upstreamSchemaSha.slice(0, 7)}, ` +
        `the ported constraints pin ${pinned.blobSha.slice(0, 7)} from tag ${pinned.tag})`
    );
  }
}

if (problems.length) {
  console.log(problems.join('; '));
  process.exit(1);
}
console.log(
  `registry current: game ${newest}, SDK ${recordedHead}` +
    (claimed ? `, PalSchema ${claimed}` : '') +
    (itemsVersion ? `, item values ${itemsVersion}` : '') +
    (buildingsVersion ? `, building values ${buildingsVersion}` : '') +
    (upstreamSchemaSha ? `, items.schema.json blob ${upstreamSchemaSha.slice(0, 7)}` : ''),
);
process.exit(0);
