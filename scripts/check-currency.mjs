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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const versionsInfo = JSON.parse(readFileSync(join(ROOT, 'versions.json'), 'utf8'));

const STEAM_URL = 'https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=1623730&count=20&format=json';
const COMMITS_URL = `https://api.github.com/repos/${versionsInfo.repo}/commits?per_page=1`;
const PUBLIC_COMMITS_URL = `https://api.github.com/repos/${versionsInfo.repo}/commits?path=Source%2FPal%2FPublic&per_page=1`;

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
    if (fixturePath) return JSON.parse(readFileSync(fixturePath, 'utf8'));
    const res = await fetch(url, {
      headers: { 'User-Agent': 'palschema-hub check-currency', Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    console.error(`network failure: cannot load ${what} (${fixturePath ?? url}): ${e.message}`);
    process.exit(2);
  }
}

/** "v1.0.2.101103:Bug fixes" -> "1.0.2" (drop >=5-digit build-number components). */
function versionFromTitle(title) {
  const m = String(title).match(/^v(\d+(?:\.\d+){1,3})\b/i);
  if (!m) return null;
  const parts = m[1].split('.');
  while (parts.length > 1 && parts[parts.length - 1].length >= 5) parts.pop();
  return parts.join('.');
}

const cmpVersions = (a, b) => {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
};

// ---- GAME: newest patch version in the Steam news window --------------------
const steam = await loadJson(STEAM_URL, fixtures.steam, 'Steam news for appid 1623730');
const newsItems = steam?.appnews?.newsitems;
if (!Array.isArray(newsItems)) {
  console.error('network failure: Steam news response has no appnews.newsitems');
  process.exit(2);
}
// Sort by the raw unix `date` field ourselves — the feed interleaves sources.
const patches = newsItems
  .map((n) => ({ version: versionFromTitle(n.title), date: Number(n.date) || 0 }))
  .filter((p) => p.version)
  .sort((a, b) => b.date - a.date);
let gameNewest = null;
for (const p of patches) {
  if (!gameNewest || cmpVersions(p.version, gameNewest) > 0) gameNewest = p.version;
}

const registryLabels = [...versionsInfo.order, ...Object.keys(versionsInfo.aliases)];
const registryNewest = registryLabels.reduce((a, b) => (cmpVersions(a, b) >= 0 ? a : b));

// ---- SDK: branch head vs the recorded head ----------------------------------
const headCommits = await loadJson(COMMITS_URL, fixtures.commits, 'PalworldModdingKit commit list');
const headSha = Array.isArray(headCommits) ? headCommits[0]?.sha : undefined;
if (!headSha) {
  console.error('network failure: PalworldModdingKit commit list is empty/unparseable');
  process.exit(2);
}
const recordedHead = versionsInfo.sdkHead?.commit ?? versionsInfo.versions[versionsInfo.order[versionsInfo.order.length - 1]].sdkCommit;

const problems = [];
if (gameNewest && cmpVersions(gameNewest, registryNewest) > 0) {
  problems.push(`game ${gameNewest} released, registry newest is ${registryNewest}`);
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
console.log(`registry current: game ${registryNewest}, SDK ${recordedHead}`);
process.exit(0);
