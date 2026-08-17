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
 *
 * Exit codes (never conflated):
 *   0  in sync   — prints "registry current: game <v>, SDK <sha>"
 *   1  stale     — one diagnostic line naming exactly what moved
 *   2  network   — a source could not be fetched/parsed
 *
 * Fixture overrides (used by the test suite; no network touched when all given):
 *   --steam-json <file>            saved Steam news API response
 *   --commits-json <file>          saved GitHub commit-list response (head)
 *   --public-commits-json <file>   saved commit list filtered to Source/Pal/Public
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  STEAM_URL,
  commitsUrl,
  publicCommitsUrl,
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

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const fixtures = {
  steam: flag('--steam-json'),
  commits: flag('--commits-json'),
  publicCommits: flag('--public-commits-json'),
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

if (problems.length) {
  console.log(problems.join('; '));
  process.exit(1);
}
console.log(`registry current: game ${newest}, SDK ${recordedHead}`);
process.exit(0);
