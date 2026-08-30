"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LOADER_SCHEMAS = exports.PSEUDO_KEYS = void 0;
exports.cmpVersions = cmpVersions;
exports.stripJsonc = stripJsonc;
exports.parseJsonc = parseJsonc;
exports.collectFiles = collectFiles;
exports.loadRegistryJson = loadRegistryJson;
exports.getTableSchema = getTableSchema;
exports.getLoaderOverlay = getLoaderOverlay;
exports.getValidator = getValidator;
exports.levenshtein = levenshtein;
exports.suggestKey = suggestKey;
exports.unknownKeys = unknownKeys;
exports.bareIntegerLiterals = bareIntegerLiterals;
exports.detectTargets = detectTargets;
exports.sniffLoaderTargets = sniffLoaderTargets;
exports.validateFile = validateFile;
exports.resolveVersionLabel = resolveVersionLabel;
exports.invertDiff = invertDiff;
exports.buildDiffIndex = buildDiffIndex;
exports.migrateScanFile = migrateScanFile;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
/** Numeric dotted-version compare (same rules as scripts/lib/version-sources.mjs). */
function cmpVersions(a, b) {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const d = (pa[i] ?? 0) - (pb[i] ?? 0);
        if (d)
            return d < 0 ? -1 : 1;
    }
    return 0;
}
/**
 * ajv is loaded lazily: only schema validation needs it. `--migrate` reads
 * versions.json + a diff JSON and nothing else, so the offline archive can run a
 * migration scan with no `npm install` at all. Missing dep => a clear instruction,
 * not a MODULE_NOT_FOUND stack trace.
 */
let ajvInstance;
function getAjv() {
    if (ajvInstance)
        return ajvInstance;
    let AjvCtor;
    try {
        AjvCtor = require('ajv');
    }
    catch {
        throw new Error("the 'ajv' package is required for schema validation but is not installed — " +
            'run `npm install` in this CLI\'s folder (or use `npx palschema-validate`). ' +
            'Note: `--migrate` needs no dependencies and works without it.');
    }
    const Ajv = AjvCtor.default ?? AjvCtor; // ajv 8 ships both CJS and .default
    ajvInstance = new Ajv({
        strict: true,
        allErrors: true,
        allowUnionTypes: true, // derived schemas use union types (e.g. ["string","object"])
        strictTypes: false, // silence advisory type warnings; keep genuine strict-schema checks
        // The upstream-constraints if/then branches put required[] in subschemas that
        // declare no properties of their own (if:{required:["Type"]}) — the standard
        // draft-07 conditional layout, which strictRequired rejects.
        strictRequired: false,
        // Errors need parentSchema: friendly() reads its description for composite
        // fallbacks and its $comment to spot the required-when-adding branch.
        verbose: true,
    });
    return ajvInstance;
}
/** Strip // and block comments and trailing commas from JSONC, respecting strings. */
function stripJsonc(text) {
    let out = '';
    let inStr = false;
    let esc = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inStr) {
            out += c;
            if (esc)
                esc = false;
            else if (c === '\\')
                esc = true;
            else if (c === '"')
                inStr = false;
            continue;
        }
        if (c === '"') {
            inStr = true;
            out += c;
            continue;
        }
        if (c === '/' && text[i + 1] === '/') {
            i += 2;
            while (i < text.length && text[i] !== '\n')
                i++;
            out += '\n';
            continue;
        }
        if (c === '/' && text[i + 1] === '*') {
            i += 2;
            while (i < text.length && !(text[i] === '*' && text[i + 1] === '/'))
                i++;
            i += 1; // loop's i++ consumes the trailing '/'
            continue;
        }
        out += c;
    }
    return out.replace(/,(\s*[}\]])/g, '$1'); // trailing commas
}
function parseJsonc(text, file) {
    try {
        // Strip a UTF-8 BOM: Windows editors (Notepad, PowerShell redirects) write
        // one, and PalSchema's nlohmann parser skips it — rejecting it here would
        // fail files the game loads fine.
        return JSON.parse(stripJsonc(text.replace(/^﻿/, '')));
    }
    catch (e) {
        throw new Error(`${file}: not valid JSON/JSONC — ${e.message}`);
    }
}
/** Recursively collect .json/.jsonc files from a file or directory path. */
function collectFiles(target) {
    const st = (0, node_fs_1.statSync)(target);
    if (st.isFile())
        return [target];
    const out = [];
    for (const name of (0, node_fs_1.readdirSync)(target)) {
        if (name === 'node_modules' || name.startsWith('.'))
            continue;
        const full = (0, node_path_1.join)(target, name);
        const s = (0, node_fs_1.statSync)(full);
        if (s.isDirectory())
            out.push(...collectFiles(full));
        else if (['.json', '.jsonc'].includes((0, node_path_1.extname)(name).toLowerCase()))
            out.push(full);
    }
    return out;
}
/** Resolve a registry-relative file (schema, versions.json, diff) the same way for
 *  all three registry forms: base URL, local repo-root path, or the default GitHub raw URL. */
function registryLocation(relPath, opts) {
    const reg = opts.registry;
    if (reg && /^https?:\/\//i.test(reg)) {
        return { url: `${reg.replace(/\/+$/, '')}/${relPath}` };
    }
    if (reg) {
        return { path: (0, node_path_1.join)(reg, ...relPath.split('/')) };
    }
    return {
        url: `https://raw.githubusercontent.com/${opts.owner}/palschema-hub/main/${relPath}`,
    };
}
function schemaLocation(table, opts) {
    return registryLocation(`schemas/v${opts.version}/${table}.schema.json`, opts);
}
/** Fetch/read a registry-relative JSON file. Throws with a clear message on failure. */
async function loadRegistryJson(relPath, opts) {
    const loc = registryLocation(relPath, opts);
    try {
        if (loc.path)
            return JSON.parse((0, node_fs_1.readFileSync)(loc.path, 'utf8'));
        const res = await fetch(loc.url);
        if (!res.ok)
            throw new Error(`HTTP ${res.status}`);
        return await res.json();
    }
    catch (e) {
        throw new Error(`cannot load ${relPath} from registry (${loc.path ?? loc.url}): ${e.message}`);
    }
}
const validatorCache = new Map();
const schemaCache = new Map();
/** Load a table's RAW schema JSON. Returns null (with a warning unless quiet) if unavailable. */
async function getTableSchema(table, opts, quiet = false) {
    const key = `${opts.version}:${table}`;
    if (schemaCache.has(key))
        return schemaCache.get(key);
    const loc = schemaLocation(table, opts);
    let schema;
    try {
        if (loc.path) {
            schema = JSON.parse((0, node_fs_1.readFileSync)(loc.path, 'utf8'));
        }
        else {
            const res = await fetch(loc.url);
            if (!res.ok)
                throw new Error(`HTTP ${res.status}`);
            schema = await res.json();
        }
    }
    catch (e) {
        if (!quiet)
            console.warn(`  ! No schema for table "${table}" (v${opts.version}): ${e.message}`);
        schemaCache.set(key, null);
        return null;
    }
    schemaCache.set(key, schema);
    return schema;
}
let overlayCache;
/** The loader-key overlay, or null when the registry predates it (loader-aware
 *  checks degrade gracefully — schema validation itself is unaffected). */
async function getLoaderOverlay(opts) {
    if (overlayCache !== undefined)
        return overlayCache;
    try {
        overlayCache = (await loadRegistryJson('structs/loader-overlay.json', opts));
    }
    catch {
        overlayCache = null;
    }
    return overlayCache;
}
/**
 * Deep-clone a schema with every `"additionalProperties": false` removed, so ajv
 * reports only genuine type/shape errors. Unknown keys are handled by the
 * post-validation `unknownKeys` pass instead, as warnings with did-you-mean
 * suggestions — the semantics PalSchema itself is adopting (Okaetsu/PalSchema#134):
 * a legitimately-new game field must degrade to a warning, never a rejection.
 */
function stripAdditionalProps(node) {
    if (Array.isArray(node))
        return node.map(stripAdditionalProps);
    if (node && typeof node === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(node)) {
            if (k === 'additionalProperties' && v === false)
                continue;
            out[k] = stripAdditionalProps(v);
        }
        return out;
    }
    return node;
}
/** Load + compile a table's schema (additionalProperties-stripped — see above).
 *  Returns null (with a warning) if unavailable. */
async function getValidator(table, opts) {
    const key = `${opts.version}:${table}`;
    if (validatorCache.has(key))
        return validatorCache.get(key);
    const schema = await getTableSchema(table, opts);
    if (!schema) {
        validatorCache.set(key, null);
        return null;
    }
    const stripped = stripAdditionalProps(schema);
    // Class-scope branches (palschema-upstream-scope) are warnings, not errors: a
    // misscoped field is ignored by the loader (and warned about in game since
    // 0.6.3), so classScopeWarnings re-implements them and ajv must not see them.
    // The published schema keeps them for editors and other draft-07 consumers.
    if (Array.isArray(stripped.allOf)) {
        stripped.allOf = stripped.allOf.filter((b) => !String(b?.$comment ?? '').startsWith('palschema-upstream-scope'));
        if (!stripped.allOf.length)
            delete stripped.allOf;
    }
    // ajv keys schemas by $id — avoid "already exists" if two files share a $id.
    const ajv = getAjv();
    let validate = stripped.$id ? ajv.getSchema(stripped.$id) : undefined;
    if (!validate)
        validate = ajv.compile(stripped);
    validatorCache.set(key, validate);
    return validate;
}
function friendly(table, row, err) {
    let path = err.instancePath || '/';
    let message = err.message || 'is invalid';
    if (err.keyword === 'required') {
        // The upstream-constraints branch gates required[] on the presence of Type
        // (required when adding, ignored when editing) — say so, or the bare ajv
        // message reads like every partial patch is broken.
        const missing = err.params.missingProperty;
        if (String(err.parentSchema?.$comment ?? '').startsWith('palschema-upstream-required')) {
            message =
                `missing required field "${missing}" — required when adding a new item ` +
                    `(this entry has a Type key); a patch to an existing item may omit it`;
        }
    }
    else if (err.keyword === 'additionalProperties') {
        const bad = err.params.additionalProperty;
        path = `${err.instancePath}/${bad}`;
        // Top level = row struct member; nested = key inside a struct/array-patch object.
        message = err.instancePath
            ? `unknown key "${bad}" (typo?)`
            : `unknown field "${bad}" — not a member of this table's row struct (typo?)`;
    }
    else if (err.keyword === 'type') {
        message = `must be ${err.params.type}`;
    }
    else if (err.keyword === 'not') {
        // Only used for "float literal required" fields (e.g. Loot DropChance,
        // which PalSchema's loader rejects as a bare integer) — surface the
        // schema's own explanation instead of ajv's "must NOT be valid".
        const desc = err.parentSchema?.description;
        if (desc)
            message = `invalid value — ${desc}`;
    }
    return { file: '', table, row, path, message };
}
/* ---------------- unknown-key warnings (PalSchema#134 semantics) ---------------- */
/**
 * Pseudo-keys PalSchema's loaders consume that are NOT row-struct members.
 * Single extension point: add here when PalSchema grows a new loader form.
 */
exports.PSEUDO_KEYS = {
    /** Row-level metadata key (PalRawTableLoader skips it; used with wildcard row keys). */
    row: ['$Filters'],
    /** The {"Action": "Clear", "Items": [...]} wrapper accepted on any array field. */
    arrayWrapper: ['Action', 'Items'],
};
/** Levenshtein distance with a cap: returns cap+1 as soon as the distance exceeds it. */
function levenshtein(a, b, cap = 2) {
    if (a === b)
        return 0;
    if (Math.abs(a.length - b.length) > cap)
        return cap + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
        const cur = [i];
        let rowMin = i;
        for (let j = 1; j <= b.length; j++) {
            const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
            cur.push(v);
            if (v < rowMin)
                rowMin = v;
        }
        if (rowMin > cap)
            return cap + 1;
        prev = cur;
    }
    return prev[b.length];
}
/**
 * At most one suggestion per unknown key. In order: exact case-insensitive match
 * (always suggest); else Levenshtein <= 2, closest wins, ties alphabetical; else none.
 */
function suggestKey(key, declared) {
    const sorted = [...declared].sort();
    const lower = key.toLowerCase();
    for (const d of sorted)
        if (d.toLowerCase() === lower)
            return d;
    let best;
    let bestDist = 3;
    for (const d of sorted) {
        const dist = levenshtein(key, d, 2);
        if (dist < bestDist) {
            bestDist = dist;
            best = d;
        }
    }
    return best;
}
/** Object-shaped branches of a schema node (itself, plus oneOf/anyOf alternatives). */
function objectBranches(node) {
    const out = [];
    for (const b of [node, ...(node?.oneOf ?? []), ...(node?.anyOf ?? [])]) {
        if (b && typeof b === 'object' && b.properties)
            out.push(b);
    }
    return out;
}
function walkUnknown(value, node, path, rowName, isRow, out) {
    if (!value || typeof value !== 'object' || !node || typeof node !== 'object')
        return;
    if (Array.isArray(value)) {
        const arrayBranch = [node, ...(node.oneOf ?? []), ...(node.anyOf ?? [])].find((b) => b && typeof b === 'object' && b.items);
        if (arrayBranch) {
            value.forEach((el, i) => walkUnknown(el, arrayBranch.items, `${path}[${i}]`, rowName, false, out));
        }
        return;
    }
    const branches = objectBranches(node);
    // Only enforce keys where the ORIGINAL schema said additionalProperties: false —
    // deliberately-open structs (additionalProperties true/absent) accept anything.
    const closed = branches.filter((b) => b.additionalProperties === false);
    const declared = new Set();
    for (const b of branches)
        for (const k of Object.keys(b.properties))
            declared.add(k);
    if (closed.length) {
        const allowed = new Set(declared);
        if (isRow)
            for (const k of exports.PSEUDO_KEYS.row)
                allowed.add(k);
        // The Clear/Items wrapper is legal wherever the field also accepts a plain array.
        const acceptsArray = [node, ...(node.oneOf ?? []), ...(node.anyOf ?? [])].some((b) => b &&
            typeof b === 'object' &&
            (b.type === 'array' || (Array.isArray(b.type) && b.type.includes('array')) || b.items));
        if (acceptsArray)
            for (const k of exports.PSEUDO_KEYS.arrayWrapper)
                allowed.add(k);
        for (const k of Object.keys(value)) {
            if (!allowed.has(k))
                out.push({ row: rowName, key: k, path, suggestion: suggestKey(k, declared) });
        }
    }
    // Recurse into declared members (a nested object with its own properties is walked).
    for (const [k, v] of Object.entries(value)) {
        for (const b of branches) {
            if (b.properties[k]) {
                walkUnknown(v, b.properties[k], path ? `${path}/${k}` : k, rowName, false, out);
                break;
            }
        }
    }
}
/**
 * Post-validation pass: compare each row's own keys against the schema's declared
 * properties plus the PSEUDO_KEYS allowlist. Returns warnings, never errors —
 * unknown keys must not fail a run (PalSchema#134); --strict promotes them.
 */
function unknownKeys(rows, schema) {
    const out = [];
    if (!rows || typeof rows !== 'object' || Array.isArray(rows))
        return out;
    for (const [rowName, row] of Object.entries(rows)) {
        if (row === null || typeof row !== 'object' || Array.isArray(row))
            continue;
        walkUnknown(row, schema, '', rowName, true, out);
    }
    return out;
}
/**
 * Array fields use oneOf [plain array, {Items/Action} wrapper] (PalSchema accepts
 * both), so one bad value yields noisy branch errors plus a generic oneOf error.
 * Per composite path: drop the type/oneOf/anyOf errors AT that path; if nothing
 * more specific remains inside it, emit a single self-describing error instead.
 */
function pruneCompositeNoise(errs) {
    // "must match then schema" restates whatever the then-branch already reported.
    errs = errs.filter((e) => e.keyword !== 'if');
    const compositePaths = [
        ...new Set(errs.filter((e) => e.keyword === 'oneOf' || e.keyword === 'anyOf').map((e) => e.instancePath)),
    ].sort((a, b) => b.length - a.length); // deepest first
    let remaining = errs;
    for (const p of compositePaths) {
        const inside = remaining.filter((e) => e.instancePath === p || e.instancePath.startsWith(p + '/'));
        const outside = remaining.filter((e) => !inside.includes(e));
        // 'pattern' joins the same-path drop list: an anyOf of asset-path patterns
        // (IconTexture) would otherwise surface each branch's raw regex; the
        // composite's own description explains the rule better.
        const kept = inside.filter((e) => e.instancePath !== p || !['type', 'oneOf', 'anyOf', 'pattern'].includes(e.keyword));
        if (kept.length) {
            remaining = [...outside, ...kept];
        }
        else {
            const composite = inside.find((e) => e.instancePath === p && (e.keyword === 'oneOf' || e.keyword === 'anyOf'));
            const desc = composite.parentSchema?.description;
            remaining = [
                ...outside,
                { ...composite, message: desc ? `invalid value — ${desc}` : 'does not match any accepted form for this field' },
            ];
        }
    }
    return remaining;
}
/**
 * "<field>": <bare integer> occurrences in the comment-stripped source text.
 * PalSchema wants float literals for these fields and JSON.parse erases 100 vs
 * 100.0 (proven live in 0.8.0 with Loot DropChance), so the check must read the
 * text, not the parsed value. Shared by the pals Loot DropChance warning and the
 * item float-field errors (the field lists come from their schemas' $comments).
 */
function bareIntegerLiterals(text, fields) {
    const src = stripJsonc(text);
    const out = [];
    for (const field of fields) {
        for (const m of src.matchAll(new RegExp(`"${field}"\\s*:\\s*(-?\\d+)\\s*[,}\\]]`, 'g'))) {
            out.push({ field, literal: m[1] });
        }
    }
    return out;
}
/** Value of a named segment in a schema's "a | b=c | d=e" $comment, if present. */
function commentSegment(schema, name) {
    return String(schema?.$comment ?? '')
        .split(' | ')
        .find((s) => s.startsWith(`${name}=`))
        ?.slice(name.length + 1);
}
/**
 * A /Game soft-object path must repeat the asset name after the dot (optionally
 * with _C). When a failed value has that shape, name the two mismatched parts —
 * the composite error alone only restates the rule.
 */
function backrefNote(value) {
    if (typeof value !== 'string')
        return '';
    const m = value.match(/^\/Game(?:\/[^/]+)*\/([A-Za-z0-9_]+)\.([A-Za-z0-9_]+?)(_C)?$/);
    if (!m || m[1] === m[2])
        return '';
    return ` (the path names "${m[1]}" but after the dot it says "${m[2]}" — they must match)`;
}
const valueAt = (row, path) => path
    .split('/')
    .filter(Boolean)
    .reduce((v, k) => (v && typeof v === 'object' ? v[k] : undefined), row);
/**
 * Fields used outside the item class the entry's Type constructs. The schema's
 * marked if/then scope branches (derived from the SDK class annotations — see
 * structs/upstream-constraints.json) carry the table; getValidator strips them
 * before ajv compilation so these surface as warnings, not errors: the loader's
 * GetPropertyByNameInChain just misses them, and PalSchema 0.6.3+ warns in game.
 */
function classScopeWarnings(content, schema, table, loader) {
    const out = [];
    const branches = (schema?.allOf ?? []).filter((b) => String(b?.$comment ?? '').startsWith('palschema-upstream-scope'));
    if (!branches.length)
        return out;
    const typeEnum = schema?.properties?.Type?.enum ?? [];
    for (const [rowName, row] of Object.entries(content)) {
        if (!row || typeof row !== 'object' || Array.isArray(row))
            continue;
        const type = row.Type;
        // Without a (valid) Type the entry patches an existing item whose class we
        // cannot know from the file alone — no scope claim is possible.
        if (typeof type !== 'string' || !typeEnum.includes(type))
            continue;
        for (const b of branches) {
            const outOfScope = b.if?.properties?.Type?.enum ?? [];
            if (!outOfScope.includes(type))
                continue;
            const classes = (commentSegment(b, 'classes') ?? '').split(',').filter(Boolean);
            const shortTypes = (commentSegment(b, 'types') ?? '')
                .split(',')
                .filter((t) => t && !t.startsWith('PalStatic'));
            for (const key of Object.keys(b.then?.properties ?? {})) {
                if (!(key in row))
                    continue;
                out.push({
                    row: rowName,
                    key,
                    path: '',
                    file: '',
                    table,
                    loader,
                    kind: 'compat',
                    message: `"${key}" is declared by ${classes.join(', ')} (${shortTypes.join('/')} items only) — ` +
                        `this entry's Type is "${type}", so the item loader ignores it ` +
                        `(PalSchema 0.6.3+ also warns about this at load time — Okaetsu/PalSchema#138)`,
                });
            }
        }
    }
    return out;
}
/** Schema each non-raw loader validates its entries against. */
exports.LOADER_SCHEMAS = {
    pals: 'DT_PalMonsterParameter',
    items: 'PalStaticItemData',
};
/** Determine which (table -> table-content) targets a mod file contains. */
function detectTargets(data, file) {
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
        return [];
    }
    const schemaHint = typeof data.$schema === 'string' ? data.$schema : undefined;
    const obj = { ...data };
    delete obj.$schema;
    // Primary: top-level keys that are table names (DT_*). Real PalSchema format:
    //   { "DT_Table": { "RowName": { ...fields } }, ... }
    const tableKeys = Object.keys(obj).filter((k) => /^DT_/.test(k));
    if (tableKeys.length) {
        return tableKeys.map((k) => ({ table: k, content: obj[k], loader: 'raw' }));
    }
    // PalSchema dispatches on the folder a file sits in: <mod>/pals/*.json goes to
    // the pal loader, <mod>/items/*.json to the item loader. Honor the same hint.
    const parent = (0, node_path_1.basename)((0, node_path_1.dirname)(file)).toLowerCase();
    if (parent === 'pals')
        return [{ table: exports.LOADER_SCHEMAS.pals, content: obj, loader: 'pals' }];
    if (parent === 'items')
        return [{ table: exports.LOADER_SCHEMAS.items, content: obj, loader: 'items' }];
    // Fallback: single-table file identified by $schema URL or filename prefix,
    // where the whole object is the table-content (RowName -> row).
    const fromHint = schemaHint?.match(/(DT_[A-Za-z0-9_]+)\.schema\.json/)?.[1];
    const fromName = (0, node_path_1.basename)(file).match(/^(DT_[A-Za-z0-9_]+)/)?.[1];
    const table = fromHint || fromName;
    if (table)
        return [{ table, content: obj, loader: 'raw' }];
    return [];
}
/**
 * Content sniff for a bare pals/items-loader file (no DT_ keys, not inside a
 * pals/ or items/ folder): score the rows' keys against each loader's schema
 * and take a clear majority. A delete-only file ({ "<ItemId>": null }) is items
 * syntax by definition.
 */
async function sniffLoaderTargets(data, opts) {
    if (data === null || typeof data !== 'object' || Array.isArray(data))
        return [];
    const obj = { ...data };
    delete obj.$schema;
    const rows = Object.values(obj);
    if (!rows.length)
        return [];
    if (rows.some((r) => r !== null && (typeof r !== 'object' || Array.isArray(r))))
        return [];
    if (rows.every((r) => r === null)) {
        return [{ table: exports.LOADER_SCHEMAS.items, content: obj, loader: 'items' }];
    }
    const keys = new Set();
    for (const r of rows)
        if (r)
            for (const k of Object.keys(r))
                keys.add(k);
    if (!keys.size)
        return [];
    const score = async (loader) => {
        const schema = await getTableSchema(exports.LOADER_SCHEMAS[loader], opts, true);
        if (!schema?.properties)
            return 0;
        let hit = 0;
        for (const k of keys)
            if (schema.properties[k])
                hit++;
        return hit / keys.size;
    };
    const pals = await score('pals');
    const items = await score('items');
    const best = Math.max(pals, items);
    if (best < 0.5 || pals === items)
        return [];
    const loader = pals > items ? 'pals' : 'items';
    return [{ table: exports.LOADER_SCHEMAS[loader], content: obj, loader }];
}
/** Loader-key checks that schema validation cannot express: since-version gates
 *  (RanchActionData needs PalSchema >= 0.6.4 on new pals), advisories (SortId on
 *  new items before 0.6.4), and loader-only keys used in a raw table file. */
function loaderCompatWarnings(target, overlay, opts) {
    if (!overlay || !target.content || typeof target.content !== 'object')
        return [];
    const out = [];
    const push = (row, key, message) => out.push({ row, key, path: '', file: '', table: target.table, loader: target.loader, kind: 'compat', message });
    if (target.loader === 'raw') {
        // A loader-only key in a raw table file is real: the merged schema accepts
        // it, but in game only the owning loader processes it — the raw table
        // loader warns "Property ... not found" and skips it.
        const owner = Object.entries(overlay.loaders).find(([, l]) => l.schema === target.table)?.[0];
        if (!owner)
            return out;
        const ownKeys = new Map(overlay.entries.filter((e) => e.loader === owner).map((e) => [e.key, e]));
        const folder = overlay.loaders[owner]?.folder ?? owner;
        for (const [rowName, row] of Object.entries(target.content)) {
            if (!row || typeof row !== 'object' || Array.isArray(row))
                continue;
            for (const key of Object.keys(row)) {
                if (ownKeys.has(key)) {
                    push(rowName, key, `"${key}" is a PalSchema ${owner}-loader key (${folder}/ folder) — the raw table loader will report ` +
                        `Property not found and skip it in this file`);
                }
            }
        }
        return out;
    }
    const entries = new Map(overlay.entries.filter((e) => e.loader === target.loader).map((e) => [e.key, e]));
    const target_ = opts.palschemaVersion;
    for (const [rowName, row] of Object.entries(target.content)) {
        if (!row || typeof row !== 'object' || Array.isArray(row))
            continue;
        for (const key of Object.keys(row)) {
            if (!target_)
                continue;
            const entry = entries.get(key);
            if (entry?.sincePalSchema && cmpVersions(target_, entry.sincePalSchema) < 0) {
                push(rowName, key, `"${key}" requires PalSchema >= ${entry.sincePalSchema}` +
                    (entry.sinceNote ? ` ${entry.sinceNote}` : '') +
                    ` (you targeted ${target_}) — ${entry.source}`);
            }
            for (const adv of overlay.advisories ?? []) {
                if (adv.loader === target.loader && adv.keys.includes(key) && cmpVersions(target_, adv.whenTargetBelow) < 0) {
                    push(rowName, key, `${adv.message} (you targeted ${target_}) — ${adv.source}`);
                }
            }
        }
    }
    return out;
}
/** Validate one mod file. Returns AJV findings (errors) + unknown-key/compat warnings. */
async function validateFile(file, opts) {
    const text = (0, node_fs_1.readFileSync)(file, 'utf8');
    const data = parseJsonc(text, file);
    let targets = detectTargets(data, file);
    if (!targets.length)
        targets = await sniffLoaderTargets(data, opts);
    const findings = [];
    const warnings = [];
    if (!targets.length) {
        findings.push({
            file,
            table: '(unknown)',
            row: '',
            path: '/',
            message: 'could not determine the target — expected top-level "DT_*" keys, a "$schema" field, a DT_*-prefixed ' +
                'filename, a pals/ or items/ folder, or rows whose fields match the pal or item loader',
        });
        return { findings, warnings };
    }
    const overlay = await getLoaderOverlay(opts);
    for (const target of targets) {
        const { table, content, loader } = target;
        // PalSchema's pal loader skips a Loot entry whose DropChance is a bare
        // integer literal (is_number_float() check in AddLoot). JSON.parse erases
        // the 100 vs 100.0 distinction, so this one is checked on the raw text.
        if (loader === 'pals') {
            for (const _hit of bareIntegerLiterals(text, ['DropChance'])) {
                warnings.push({
                    row: '',
                    key: 'DropChance',
                    path: 'Loot',
                    file,
                    table,
                    loader,
                    kind: 'compat',
                    message: 'a Loot DropChance is written as a bare integer — PalSchema requires a float literal (e.g. 100.0, ' +
                        'not 100) and silently skips the loot entry otherwise (is_number_float() in PalMonsterModLoader.cpp)',
                });
            }
        }
        const validate = await getValidator(table, opts);
        if (!validate)
            continue; // unresolved schema already warned
        const schema = await getTableSchema(table, opts); // cached — same fetch as getValidator
        // Upstream's items.schema.json marks five fields "must be a float value"
        // (not:{type:integer}) — an error, unlike the pals warning: the field lands
        // on a real FloatProperty, upstream requires the literal, and the registry's
        // schema $comment (floatLiteral=...) says which fields, so an older registry
        // simply skips the check.
        if (loader === 'items' && schema) {
            const floatFields = commentSegment(schema, 'floatLiteral')?.split(',') ?? [];
            for (const { field, literal } of bareIntegerLiterals(text, floatFields)) {
                findings.push({
                    file,
                    table,
                    row: '',
                    path: `/${field}`,
                    message: `"${field}": ${literal} — must be a float value e.g. ${literal}.0 ` +
                        `(PalSchema requires a float literal here; JSON.parse hides the difference, so this is read off the raw text)`,
                });
            }
        }
        if (content === null || typeof content !== 'object' || Array.isArray(content)) {
            findings.push({ file, table, row: '', path: '/', message: `table "${table}" must map row names to row objects` });
            continue;
        }
        const recipeRows = {};
        for (const [rowName, row] of Object.entries(content)) {
            if (row === null && loader === 'items')
                continue; // { "<ItemId>": null } deletes the item
            if (row === null || typeof row !== 'object' || Array.isArray(row)) {
                findings.push({ file, table, row: rowName, path: '/', message: 'row must be an object of fields' });
                continue;
            }
            const valid = validate(row);
            if (!valid && validate.errors) {
                for (const err of pruneCompositeNoise(validate.errors)) {
                    const f = { ...friendly(table, rowName, err), file };
                    if (f.message.startsWith('invalid value'))
                        f.message += backrefNote(valueAt(row, f.path));
                    findings.push(f);
                }
            }
            // MaxStackCount's 9999 cap is prose-only upstream ("the game ... will
            // cause items to duplicate when moving them around"), so it warns instead
            // of erroring; the cap comes from the schema $comment (stackSoftCap=).
            for (const seg of (commentSegment(schema, 'stackSoftCap') ?? '').split(',').filter(Boolean)) {
                const [capField, capValue] = seg.split(':');
                const v = row[capField];
                if (typeof v === 'number' && v > Number(capValue)) {
                    warnings.push({
                        row: rowName,
                        key: capField,
                        path: '',
                        file,
                        table,
                        loader,
                        kind: 'compat',
                        message: `"${capField}": ${v} is above ${capValue} — the game duplicates items when moving stacks ` +
                            `larger than that (documented in PalSchema's own items.schema.json, prose only, so this is a warning)`,
                    });
                }
            }
            // The item loader copies "Recipe" onto a DT_ItemRecipeDataTable row —
            // validate it against that table's schema (Product_Id comes from the key).
            if (loader === 'items' && row.Recipe && typeof row.Recipe === 'object' && !Array.isArray(row.Recipe)) {
                recipeRows[rowName] = row.Recipe;
            }
        }
        if (Object.keys(recipeRows).length) {
            const recipeTable = 'DT_ItemRecipeDataTable';
            const recipeValidate = await getValidator(recipeTable, opts);
            const recipeSchema = await getTableSchema(recipeTable, opts);
            if (recipeValidate && recipeSchema) {
                for (const [rowName, recipe] of Object.entries(recipeRows)) {
                    if (!recipeValidate(recipe) && recipeValidate.errors) {
                        for (const err of pruneCompositeNoise(recipeValidate.errors)) {
                            const f = friendly(table, rowName, err);
                            f.path = `/Recipe${f.path === '/' ? '' : f.path}`;
                            findings.push({ ...f, file });
                        }
                    }
                    warnings.push(...unknownKeys({ [rowName]: recipe }, recipeSchema).map((w) => ({
                        ...w,
                        path: w.path ? `Recipe/${w.path}` : 'Recipe',
                        file,
                        table,
                        loader,
                    })));
                }
            }
        }
        if (schema) {
            warnings.push(...unknownKeys(content, schema).map((w) => ({ ...w, file, table, loader })));
            warnings.push(...classScopeWarnings(content, schema, table, loader).map((w) => ({ ...w, file })));
        }
        warnings.push(...loaderCompatWarnings(target, overlay, opts).map((w) => ({ ...w, file })));
    }
    return { findings, warnings };
}
/** Resolve a version label (or alias like "0.7.3") against versions.json. */
function resolveVersionLabel(info, label) {
    if (info.versions[label])
        return { version: label, aliasNote: null };
    const alias = info.aliases[label];
    if (alias)
        return { version: alias.of, aliasNote: alias.note };
    return null;
}
/** Reverse a diff for downgrade scans (added<->removed, retyped/renames flipped). */
function invertDiff(d) {
    const structs = {};
    for (const [name, s] of Object.entries(d.structs)) {
        structs[name] = {
            added: s.removed,
            removed: s.added,
            retyped: s.retyped.map((r) => ({ field: r.field, from: r.to, to: r.from })),
            renames: s.renames.map((r) => ({ ...r, from: r.to, to: r.from, altCandidates: undefined })),
            tables: s.tables,
        };
    }
    return { ...d, from: d.to, to: d.from, structs };
}
function buildDiffIndex(diff) {
    const index = new Map();
    for (const [name, s] of Object.entries(diff.structs)) {
        const removed = new Map();
        for (const r of s.removed) {
            removed.set(r.field, { type: r.type, rename: s.renames.find((rn) => rn.from === r.field) });
        }
        const retyped = new Map(s.retyped.map((r) => [r.field, { from: r.from, to: r.to }]));
        index.set(name, { removed, retyped });
    }
    return index;
}
/** Scan one mod file's DT_* rows for fields the diff marks removed/retyped. */
function migrateScanFile(file, diff, index, unknownTables) {
    const data = parseJsonc((0, node_fs_1.readFileSync)(file, 'utf8'), file);
    const hits = [];
    for (const { table, content } of detectTargets(data, file)) {
        const structName = diff.tableToStruct[table];
        if (!structName) {
            unknownTables.add(table);
            continue;
        }
        const structIndex = index.get(structName);
        if (!structIndex)
            continue; // struct unchanged between the two versions
        if (content === null || typeof content !== 'object' || Array.isArray(content))
            continue;
        for (const [rowName, row] of Object.entries(content)) {
            if (row === null || typeof row !== 'object' || Array.isArray(row))
                continue;
            for (const field of Object.keys(row)) {
                if (field === '$Filters')
                    continue;
                const removed = structIndex.removed.get(field);
                if (removed) {
                    hits.push({ file, table, row: rowName, field, kind: 'removed', detail: removed.type, rename: removed.rename });
                    continue;
                }
                const retyped = structIndex.retyped.get(field);
                if (retyped) {
                    hits.push({ file, table, row: rowName, field, kind: 'retyped', detail: `${retyped.from} -> ${retyped.to}` });
                }
            }
        }
    }
    return hits;
}
