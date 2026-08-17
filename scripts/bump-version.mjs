#!/usr/bin/env node
/**
 * bump-version.mjs — turn "Palworld shipped a patch" into a reviewable commit.
 *
 * Only one branch of that work is mechanical, and this does exactly that one:
 * the game moved but localcc/PalworldModdingKit's Source/Pal/Public did NOT
 * regenerate, so the row structs are identical to the newest pinned version and
 * the new label is an ALIAS. This verifies that against both live sources, adds
 * the alias to versions.json (evidence in `aliasReason`), then re-runs
 * snapshot:all + diff:all so structs/ and diffs/ carry the new label.
 *
 * If Source/Pal/Public DID regenerate, the row structs really changed: that needs
 * a new pin, re-derived schemas and a human reading the delta. This refuses (3).
 *
 * Exit codes:
 *   0  alias written (and artifacts regenerated unless --dry-run/--no-build)
 *   1  usage / precondition failure
 *   2  a live source could not be read
 *   3  SDK regenerated — not an alias, needs a human
 *   4  nothing to do (registry already knows the newest game version)
 *
 * Flags:
 *   --version <x.y.z>   bump to this label instead of the newest Steam patch
 *   --dry-run           print what would change, write nothing
 *   --no-build          write versions.json but skip snapshot:all/diff:all
 *   --today <date>      stamp aliasReason with this date (default: today, UTC)
 *   --check-format      only verify versions.json round-trips through the
 *                       serializer below (byte-identical), then exit
 *   --steam-json <f> --commits-json <f> --public-commits-json <f>
 *                       saved API responses; no network when all three are given
 *
 * Under GitHub Actions it also writes `version=` / `alias_of=` to $GITHUB_OUTPUT,
 * so the workflow can name the branch without re-parsing stdout.
 */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  STEAM_URL,
  commitsUrl,
  publicCommitsUrl,
  SourceError,
  loadJson,
  cmpVersions,
  patchEntries,
  newestGameVersion,
  registryNewest,
} from './lib/version-sources.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERSIONS_PATH = join(ROOT, 'versions.json');

const args = process.argv.slice(2);
const has = (name) => args.includes(name);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

// ---- versions.json serializer ----------------------------------------------
// versions.json is hand-readable on purpose: short records stay on one line,
// long ones expand. JSON.stringify(x, null, 2) would reflow every record in the
// file, burying a one-line alias addition in 40 lines of churn.
const INLINE_MAX = 200;

function compact(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(compact).join(', ')}]`;
  const entries = Object.entries(v);
  if (!entries.length) return '{}';
  return `{ ${entries.map(([k, val]) => `${JSON.stringify(k)}: ${compact(val)}`).join(', ')} }`;
}

function expand(v, indent) {
  const pad = ' '.repeat(indent + 2);
  const close = ' '.repeat(indent);
  const render = (prefix, val) => {
    const one = prefix + compact(val);
    if (one.length <= INLINE_MAX || val === null || typeof val !== 'object') return one;
    return prefix + expand(val, indent + 2);
  };
  if (Array.isArray(v)) return `[\n${v.map((item) => render(pad, item)).join(',\n')}\n${close}]`;
  const parts = Object.entries(v).map(([k, val]) => render(`${pad}${JSON.stringify(k)}: `, val));
  return `{\n${parts.join(',\n')}\n${close}}`;
}

/** Serialize with the file's own EOL so a CRLF checkout doesn't rewrite every line. */
function serialize(obj, eol = '\n') {
  return (expand(obj, 0) + '\n').replace(/\n/g, eol);
}

const rawVersions = readFileSync(VERSIONS_PATH, 'utf8');
const EOL = rawVersions.includes('\r\n') ? '\r\n' : '\n';
const versionsInfo = JSON.parse(rawVersions);

// The serializer must reproduce the committed file exactly before it is trusted
// to rewrite it — otherwise a hand edit that drifted from this style would be
// silently reformatted.
const roundTrips = serialize(versionsInfo, EOL) === rawVersions;

if (has('--check-format')) {
  if (!roundTrips) {
    console.error('versions.json does not round-trip through bump-version.mjs\'s serializer.');
    console.error('Re-align the file with the style it emits (or update the serializer).');
    process.exit(1);
  }
  console.log('versions.json round-trips byte-identically');
  process.exit(0);
}

const dryRun = has('--dry-run');
const today = flag('--today') ?? new Date().toISOString().slice(0, 10);
const fixtures = {
  steam: flag('--steam-json'),
  commits: flag('--commits-json'),
  publicCommits: flag('--public-commits-json'),
};

async function load(url, fixturePath, what) {
  try {
    return await loadJson(url, fixturePath, what);
  } catch (e) {
    if (e instanceof SourceError) {
      console.error(`network failure: ${e.message}`);
      process.exit(2);
    }
    throw e;
  }
}

// ---- what shipped, and did the headers move? --------------------------------
const steam = await load(STEAM_URL, fixtures.steam, 'Steam news for appid 1623730');
let entries;
try {
  entries = patchEntries(steam);
} catch (e) {
  console.error(`network failure: ${e.message}`);
  process.exit(2);
}

const known = new Set([...versionsInfo.order, ...Object.keys(versionsInfo.aliases)]);
const target = flag('--version') ?? newestGameVersion(steam);
const newest = registryNewest(versionsInfo);

if (!target) {
  console.error('no Palworld patch version found in the Steam news window');
  process.exit(2);
}
if (known.has(target)) {
  console.log(`nothing to do: registry already knows Palworld ${target}`);
  process.exit(4);
}
if (cmpVersions(target, newest) <= 0) {
  console.error(`refusing: ${target} is not newer than the registry's newest label (${newest}).`);
  console.error('Back-filling a skipped version is a manual call — the pin has to be researched.');
  process.exit(1);
}

const pub = await load(
  publicCommitsUrl(versionsInfo.repo),
  fixtures.publicCommits,
  'PalworldModdingKit Source/Pal/Public commit list',
);
const commitDate = (c) => (c?.commit?.author?.date ?? c?.commit?.committer?.date)?.slice(0, 10);
const pubSha = Array.isArray(pub) ? pub[0]?.sha : undefined;
const pubDate = Array.isArray(pub) ? commitDate(pub[0]) : undefined;
if (!pubSha) {
  console.error('network failure: Source/Pal/Public commit list is empty/unparseable');
  process.exit(2);
}

const pinnedNewest = versionsInfo.order[versionsInfo.order.length - 1];
if (!pubSha.startsWith(versionsInfo.versions[pinnedNewest].sdkCommit)) {
  console.error(
    `Source/Pal/Public regenerated at ${pubSha.slice(0, 7)}${pubDate ? ` (${pubDate})` : ''}, ` +
      `newest pin ${pinnedNewest} is ${versionsInfo.versions[pinnedNewest].sdkCommit}.`,
  );
  console.error(`Palworld ${target} is NOT an alias: the row structs changed.`);
  console.error(`Pin it for real — add it to versions.json order+versions, then run:`);
  console.error(`  npm run snapshot:all && npm run diff:all && npm run seed && npm run check`);
  console.error('and read the diff before shipping.');
  process.exit(3);
}

const headCommits = await load(
  commitsUrl(versionsInfo.repo),
  fixtures.commits,
  'PalworldModdingKit commit list',
);
const headSha = Array.isArray(headCommits) ? headCommits[0]?.sha : undefined;
const headDate = Array.isArray(headCommits) ? commitDate(headCommits[0]) : undefined;
if (!headSha) {
  console.error('network failure: PalworldModdingKit commit list is empty/unparseable');
  process.exit(2);
}

// ---- compose the alias record ----------------------------------------------
// The patch line as Steam titled it, e.g. v1.0.2 · v1.0.2.100993 "Mod Support
// Improvement" · v1.0.2.101103 — quoted verbatim so the claim is checkable.
const patchTitles = entries
  .filter((p) => p.version === target)
  .sort((a, b) => a.date - b.date)
  .map((p) => p.title.trim());
const patchLine = patchTitles.length ? ` (${[...new Set(patchTitles)].join(' · ')})` : '';

const alias = {
  of: pinnedNewest,
  note:
    `Palworld ${target}${patchLine} shipped no Source/Pal/Public header change. ` +
    `Its row structs are identical to ${pinnedNewest}.`,
  aliasReason:
    `Source/Pal/Public was last regenerated at ${pubSha.slice(0, 7)}${pubDate ? ` (${pubDate})` : ''}, ` +
    `which is the commit Palworld ${pinnedNewest} pins, and the SDK head is ${headSha.slice(0, 7)}` +
    `${headDate ? ` (${headDate})` : ''}, so ${target} aliases ${pinnedNewest}. ` +
    `Verified ${today} against the Steam news API (appid 1623730) and the SDK commit list.`,
};

const updated = JSON.parse(rawVersions);
updated.aliases[target] = alias;
if (updated.sdkHead && !headSha.startsWith(updated.sdkHead.commit)) {
  updated.sdkHead.commit = headSha.slice(0, 7);
  if (headDate) updated.sdkHead.date = headDate;
  console.log(`sdkHead moved: ${versionsInfo.sdkHead.commit} -> ${updated.sdkHead.commit}`);
}

console.log(`Palworld ${target} is an alias of ${pinnedNewest}`);
console.log(`  ${alias.note}`);
console.log(`  ${alias.aliasReason}`);
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `version=${target}\nalias_of=${pinnedNewest}\n`);
}

if (dryRun) {
  console.log('\n--dry-run: versions.json not written');
  process.exit(0);
}
if (!roundTrips) {
  console.error(
    '\nrefusing to write: versions.json does not round-trip through this serializer ' +
      '(run --check-format). Add the alias by hand to avoid reformatting the file.',
  );
  process.exit(1);
}
writeFileSync(VERSIONS_PATH, serialize(updated, EOL));
console.log(`\nversions.json: added aliases["${target}"]`);

if (has('--no-build')) {
  console.log('--no-build: skipping snapshot:all + diff:all');
  process.exit(0);
}
for (const script of ['snapshot-structs.mjs', 'build-diff.mjs']) {
  console.log(`\n$ node scripts/${script} all`);
  const r = spawnSync(process.execPath, [join('scripts', script), 'all'], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  if (r.status !== 0) {
    console.error(`scripts/${script} all failed (exit ${r.status}) — versions.json is already written.`);
    process.exit(1);
  }
}
console.log(`\nDone. structs/${target}.json and diffs/*..${target}.* now exist.`);
console.log('Prose that names the alias list still needs a human: README alias caveat, cli/README, CHANGELOG.');
