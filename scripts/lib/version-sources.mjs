/**
 * version-sources.mjs — the two live sources both currency tools read.
 *
 *   Steam news API (appid 1623730)  -> newest shipped Palworld patch version
 *   localcc/PalworldModdingKit      -> branch head + last Source/Pal/Public commit
 *
 * check-currency.mjs reports on them; bump-version.mjs acts on them. Keeping the
 * parsing here means the two can never disagree about what "newest" means.
 */
import { readFileSync } from 'node:fs';

export const STEAM_URL =
  'https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=1623730&count=20&format=json';
export const commitsUrl = (repo) => `https://api.github.com/repos/${repo}/commits?per_page=1`;
export const publicCommitsUrl = (repo) =>
  `https://api.github.com/repos/${repo}/commits?path=Source%2FPal%2FPublic&per_page=1`;
/** Release list, not /releases/latest: /latest follows whatever upstream marked
 *  latest, and PalSchema has shipped same-day pairs (0.6.2 and 0.6.3 both on
 *  2026-08-15), so the list plus its publish times is the truth. */
export const releasesUrl = (repo) => `https://api.github.com/repos/${repo}/releases?per_page=10`;
/** A file's blob metadata on the default branch — check-currency compares its
 *  sha against the blob a constraint port was read from. */
export const contentsUrl = (repo, path) => `https://api.github.com/repos/${repo}/contents/${path}`;

/** A source could not be fetched or parsed — callers map this to their own exit code. */
export class SourceError extends Error {}

export async function loadJson(url, fixturePath, what) {
  try {
    if (fixturePath) return JSON.parse(readFileSync(fixturePath, 'utf8'));
    const headers = { 'User-Agent': 'palschema-hub check-currency', Accept: 'application/json' };
    // Unauthenticated api.github.com is 60/hr per IP, which shared CI egress
    // burns through; GITHUB_TOKEN raises it to 5000 and is already in scope.
    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    if (token && url.startsWith('https://api.github.com/')) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    throw new SourceError(`cannot load ${what} (${fixturePath ?? url}): ${e.message}`);
  }
}

/** "v1.0.2.101103:Bug fixes" -> "1.0.2" (drop >=5-digit build-number components). */
export function versionFromTitle(title) {
  const m = String(title).match(/^v(\d+(?:\.\d+){1,3})\b/i);
  if (!m) return null;
  const parts = m[1].split('.');
  while (parts.length > 1 && parts[parts.length - 1].length >= 5) parts.pop();
  return parts.join('.');
}

export function cmpVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/**
 * Patch entries from a Steam news payload, newest first. Items arrive out of
 * order and `date` is a unix timestamp, so we sort locally and never trust the
 * feed's own ordering. Throws SourceError if the payload isn't a news response.
 */
export function patchEntries(steam) {
  const newsItems = steam?.appnews?.newsitems;
  if (!Array.isArray(newsItems)) throw new SourceError('Steam news response has no appnews.newsitems');
  return newsItems
    .map((n) => ({ version: versionFromTitle(n.title), title: String(n.title), date: Number(n.date) || 0 }))
    .filter((p) => p.version)
    .sort((a, b) => b.date - a.date);
}

/**
 * The UE4SS commit a PalSchema release says it must be run with, read from the
 * release body. Two wordings appear: 0.6.6/0.6.7 use "must be used with
 * [UE4SS <sha>]", 0.6.5 only has "Updated UE4SS to commit [<sha>]". Releases
 * older than 0.6.5 name no commit at all (they link the moving
 * experimental-palworld tag), so null means "this release does not pin one",
 * never "mismatch".
 */
export function ue4ssCommitFromRelease(release) {
  const body = String(release?.body ?? '');
  for (const re of [/must be used with \[UE4SS\s+([0-9a-f]{7,40})\]/i, /Updated UE4SS to commit \[([0-9a-f]{7,40})\]/i]) {
    const m = body.match(re);
    if (m) return m[1];
  }
  return null;
}

/** Shas are quoted at different lengths upstream and here; compare by prefix. */
export const shaMatches = (a, b) => Boolean(a && b) && (a.startsWith(b) || b.startsWith(a));

/**
 * The tag of the most recently PUBLISHED release, or null if the list holds no
 * usable tag. Deliberately not a version max: PalSchema followed 0.6.7 with
 * 0.6.71, which compares ABOVE a later 0.6.8 would, so a max would report the
 * registry current while a newer release sat upstream. Publish time is the
 * question the currency check actually asks. Equal or absent timestamps fall back
 * to the version compare, which is how the same-day 0.6.2/0.6.3 pair resolves.
 */
export function newestReleaseTag(releases) {
  const entries = (Array.isArray(releases) ? releases : [])
    .map((r) => ({
      tag: String(r?.tag_name ?? '').replace(/^v/i, ''),
      at: Date.parse(r?.published_at ?? '') || 0,
    }))
    .filter((e) => /^\d+(\.\d+)*$/.test(e.tag));
  if (!entries.length) return null;
  return entries.reduce((a, b) => ((b.at - a.at || cmpVersions(b.tag, a.tag)) > 0 ? b : a)).tag;
}

/** Highest patch version anywhere in the news window (not just the most recent item). */
export function newestGameVersion(steam) {
  let newest = null;
  for (const p of patchEntries(steam)) {
    if (!newest || cmpVersions(p.version, newest) > 0) newest = p.version;
  }
  return newest;
}

/** Highest version label the registry knows — pinned versions and aliases alike. */
export function registryNewest(versionsInfo) {
  return [...versionsInfo.order, ...Object.keys(versionsInfo.aliases)].reduce((a, b) =>
    cmpVersions(a, b) >= 0 ? a : b,
  );
}
