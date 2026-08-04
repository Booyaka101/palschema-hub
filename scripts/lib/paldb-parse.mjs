/**
 * paldb-parse.mjs — pure HTML → row parsers for paldb.cc (no DOM library).
 *
 * paldb.cc renders DT_ItemDataTable raw fields as label/value pairs inside
 * Bootstrap cards; one item detail page carries a block per rarity VARIANT
 * (e.g. Plasteel_Helmet lists PlasticHelmet + PlasticHelmet_2.._5), each
 * starting with its own "Stats" card. Verified live 2026-08-04 against
 * /en/Plasteel_Helmet, /en/Animal_Skin, /en/Assault_Rifle, /en/NPC_WEAPON.
 *
 * Everything here is string/regex parsing on the raw HTML. The one genuine
 * trap: tooltip attributes contain literal "<br/>" inside quoted attribute
 * values, so tag-stripping must respect quotes (a naive /<[^>]+>/ stops at
 * the ">" of that embedded <br/> and leaks attribute text into the value).
 */

/** paldb.cc display label → DT_ItemDataTable field name.
 *  Labels not listed here pass through under their own name; anything that is
 *  not a real DT field gets dropped (and logged) against the schema later.
 *  Every mapping below was verified against a live page + the schema examples
 *  (e.g. Assault Rifle "Attack: 320" matches PhysicalAttackValue's example). */
export const LABEL_MAP = {
  'Gold Coin': 'Price',
  'Gold Coin Price': 'Price',
  Health: 'HPValue',
  Defense: 'PhysicalDefenseValue',
  Attack: 'PhysicalAttackValue',
  Shield: 'ShieldValue', // Common Shield: paldb "Shield: 100" == paldex ShieldValue 100
  Nutrition: 'RestoreSatiety', // Berries: paldb "Nutrition: 15" == paldex RestoreSatiety 15
  SAN: 'RestoreSanity', // Baked Berries: paldb "SAN: 1" == paldex RestoreSanity 1
  // NOT mapped on purpose: "Corruption" (a derived display — "600 Seconds", not the
  // raw CorruptionFactor 0.1667) and pal/rock stats ("Hp", "Defense_PVP", "Mining", …)
  // that belong to OTHER entities paldb renders on the same page (see the index-code
  // filter in build-items.mjs).
};

/** Rarity is rendered as a word in the Stats card ("Rarity: Common") and — for
 *  variants above Common — ALSO as a number in the Others card. The numeric row
 *  comes later in the block and wins; word-only blocks map through this table
 *  (pairs verified on Plasteel_Helmet: Uncommon/1, Rare/2, Epic/3, Legendary/4). */
export const RARITY_WORDS = { Common: 0, Uncommon: 1, Rare: 2, Epic: 3, Legendary: 4 };

/** Bare enum tokens are expanded to the long form the paldex-derived items.json
 *  has always shipped (both spellings load in-game; long form preserves the
 *  contract). paldb prints TypeA "Armor" — items.json says "EPalItemTypeA::Armor". */
export const ENUM_PREFIXES = {
  TypeA: 'EPalItemTypeA::',
  TypeB: 'EPalItemTypeB::',
  ElementType: 'EPalElementType::',
  DropItemType: 'EPalDropItemType::',
};

/** Strip HTML tags respecting quoted attribute values (which may contain "<br/>"). */
export function stripTags(html) {
  let out = '';
  let i = 0;
  const n = html.length;
  while (i < n) {
    const c = html[i];
    if (c === '<') {
      // consume the tag, skipping over quoted attribute values
      i++;
      let quote = null;
      while (i < n) {
        const t = html[i];
        if (quote) {
          if (t === quote) quote = null;
        } else if (t === '"' || t === "'") {
          quote = t;
        } else if (t === '>') {
          break;
        }
        i++;
      }
      i++; // past '>'
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#x27': "'" };
export function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, e) => {
    if (e in ENTITIES) return ENTITIES[e];
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return m;
  });
}

const clean = (s) => decodeEntities(stripTags(s)).replace(/\s+/g, ' ').trim();

/** The label/value rows all use this exact Bootstrap class combo (cards other
 *  than Stats/Others — recipes, drop sources — use different markup). */
const ROW_RE =
  /<div class="d-flex justify-content-between p-2 align-items-center border-bottom">\s*<div[^>]*>([\s\S]*?)<\/div>\s*<div[^>]*>([\s\S]*?)<\/div>\s*<\/div>/g;

const STATS_HEADING_RE = /<h5 class="card-title[^"]*">\s*Stats\s*<\/h5>/g;

/**
 * Parse one item detail page into one entry per variant block.
 * @param {string} html
 * @returns {{ entries: Array<{rowName: string, fields: Record<string, string|number>}>, warnings: string[] }}
 */
export function parseItemPage(html) {
  const warnings = [];
  const rows = [];
  for (const m of html.matchAll(ROW_RE)) {
    const label = clean(m[1]);
    const value = clean(m[2]);
    if (label) rows.push({ offset: m.index, label, value });
  }

  // Variant blocks start at each "Stats" card heading. Pages with rows but no
  // Stats heading (not observed live, but cheap to survive) become one block.
  const starts = [...html.matchAll(STATS_HEADING_RE)].map((m) => m.index);
  if (!starts.length && rows.length) starts.push(0);

  const entries = [];
  for (let b = 0; b < starts.length; b++) {
    const from = starts[b];
    const to = b + 1 < starts.length ? starts[b + 1] : Infinity;
    const block = rows.filter((r) => r.offset >= from && r.offset < to);
    if (!block.length) continue;

    const fields = {};
    let code = null;
    for (const { label, value } of block) {
      if (label === 'Code') {
        if (code === null) code = value;
        else warnings.push(`block ${b}: second Code "${value}" inside one block (kept "${code}")`);
        continue;
      }
      const name = LABEL_MAP[label] ?? label;
      if (name === 'Rarity' && value in RARITY_WORDS) {
        // word form; only set if the numeric Others-card row hasn't already won
        if (!('Rarity' in fields)) fields.Rarity = RARITY_WORDS[value];
        continue;
      }
      const prefix = ENUM_PREFIXES[name];
      fields[name] = prefix && value && !value.includes('::') ? prefix + value : value;
    }

    if (!code) {
      warnings.push(`block ${b}: no Code row — block dropped (${block.length} rows)`);
      continue;
    }
    entries.push({ rowName: code, fields });
  }
  return { entries, warnings };
}

const INDEX_ITEM_RE = /<a href="#" data-hover="[^"]*">([\s\S]*?)<\/a><div>([^<]*)<\/div>/g;

/**
 * Parse the /en/Items_Table index into { name (display), code (internal) } pairs.
 * @param {string} html
 * @returns {{ declaredCount: number|null, items: Array<{name: string, code: string}> }}
 */
export function parseIndex(html) {
  const header = html.match(/Items\s*\/(\d+)/);
  const items = [];
  for (const m of html.matchAll(INDEX_ITEM_RE)) {
    const name = clean(m[1]);
    const code = m[2].trim();
    if (name && code) items.push({ name, code });
  }
  return { declaredCount: header ? Number(header[1]) : null, items };
}

/** Detail page URL for a display name — spaces become underscores, the rest is
 *  percent-encoded. paldb wants ' raw but : [ ] ( ) ☆ é ENCODED (live-verified:
 *  Foxparks'_Harness 200 / %27 404; Life_Lotus_(S) 404 / %28S%29 200). Parens must
 *  be escaped manually — encodeURIComponent leaves them raw. */
export function detailUrlFor(displayName) {
  return (
    'https://paldb.cc/en/' +
    encodeURIComponent(displayName.replace(/ /g, '_')).replace(/\(/g, '%28').replace(/\)/g, '%29')
  );
}
