/**
 * loader-overlay.mjs — shared access to structs/loader-overlay.json.
 *
 * The overlay records PalSchema loader-implemented keys (RanchActionData, Loot,
 * Type, Recipe, ...) that no UE row struct declares. Schema generators merge
 * them into the published schema files; overlay-merged properties are marked
 * with a "$comment" starting with MARKER so re-runs (and the SDK augmenter)
 * can tell them apart from struct-derived fields.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const MARKER = 'palschema-loader-overlay';

export function loadOverlay(root) {
  return JSON.parse(readFileSync(join(root, 'structs', 'loader-overlay.json'), 'utf8'));
}

export function isOverlayProp(frag) {
  return typeof frag?.$comment === 'string' && frag.$comment.startsWith(MARKER);
}

/** Overlay property fragment: the entry's schema plus a provenance $comment. */
export function overlayFrag(entry) {
  const meta = [MARKER, `loader=${entry.loader}`]
    .concat(entry.sincePalSchema ? [`sincePalSchema=${entry.sincePalSchema}`] : [])
    .concat([`source=${entry.source}`])
    .join(' | ');
  return { ...entry.schema, $comment: meta };
}
