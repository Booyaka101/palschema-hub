"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PSEUDO_KEYS = void 0;
exports.stripJsonc = stripJsonc;
exports.parseJsonc = parseJsonc;
exports.collectFiles = collectFiles;
exports.loadRegistryJson = loadRegistryJson;
exports.getTableSchema = getTableSchema;
exports.getValidator = getValidator;
exports.levenshtein = levenshtein;
exports.suggestKey = suggestKey;
exports.unknownKeys = unknownKeys;
exports.detectTargets = detectTargets;
exports.validateFile = validateFile;
exports.resolveVersionLabel = resolveVersionLabel;
exports.invertDiff = invertDiff;
exports.buildDiffIndex = buildDiffIndex;
exports.migrateScanFile = migrateScanFile;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
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
        return JSON.parse(stripJsonc(text));
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
/** Load a table's RAW schema JSON. Returns null (with a warning) if unavailable. */
async function getTableSchema(table, opts) {
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
        console.warn(`  ! No schema for table "${table}" (v${opts.version}): ${e.message}`);
        schemaCache.set(key, null);
        return null;
    }
    schemaCache.set(key, schema);
    return schema;
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
    if (err.keyword === 'additionalProperties') {
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
    const compositePaths = [
        ...new Set(errs.filter((e) => e.keyword === 'oneOf' || e.keyword === 'anyOf').map((e) => e.instancePath)),
    ].sort((a, b) => b.length - a.length); // deepest first
    let remaining = errs;
    for (const p of compositePaths) {
        const inside = remaining.filter((e) => e.instancePath === p || e.instancePath.startsWith(p + '/'));
        const outside = remaining.filter((e) => !inside.includes(e));
        const kept = inside.filter((e) => e.instancePath !== p || !['type', 'oneOf', 'anyOf'].includes(e.keyword));
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
        return tableKeys.map((k) => ({ table: k, content: obj[k] }));
    }
    // Fallback: single-table file identified by $schema URL or filename prefix,
    // where the whole object is the table-content (RowName -> row).
    const fromHint = schemaHint?.match(/(DT_[A-Za-z0-9_]+)\.schema\.json/)?.[1];
    const fromName = (0, node_path_1.basename)(file).match(/^(DT_[A-Za-z0-9_]+)/)?.[1];
    const table = fromHint || fromName;
    if (table)
        return [{ table, content: obj }];
    return [];
}
/** Validate one mod file. Returns AJV findings (errors) + unknown-key warnings. */
async function validateFile(file, opts) {
    const text = (0, node_fs_1.readFileSync)(file, 'utf8');
    const data = parseJsonc(text, file);
    const targets = detectTargets(data, file);
    const findings = [];
    const warnings = [];
    if (!targets.length) {
        findings.push({
            file,
            table: '(unknown)',
            row: '',
            path: '/',
            message: 'could not determine target DataTable — expected top-level "DT_*" keys, a "$schema" field, or a DT_*-prefixed filename',
        });
        return { findings, warnings };
    }
    for (const { table, content } of targets) {
        const validate = await getValidator(table, opts);
        if (!validate)
            continue; // unresolved schema already warned
        if (content === null || typeof content !== 'object' || Array.isArray(content)) {
            findings.push({ file, table, row: '', path: '/', message: `table "${table}" must map row names to row objects` });
            continue;
        }
        for (const [rowName, row] of Object.entries(content)) {
            if (row === null || typeof row !== 'object' || Array.isArray(row)) {
                findings.push({ file, table, row: rowName, path: '/', message: 'row must be an object of fields' });
                continue;
            }
            const valid = validate(row);
            if (!valid && validate.errors) {
                for (const err of pruneCompositeNoise(validate.errors)) {
                    findings.push({ ...friendly(table, rowName, err), file });
                }
            }
        }
        const schema = await getTableSchema(table, opts); // cached — same fetch as getValidator
        if (schema)
            warnings.push(...unknownKeys(content, schema).map((w) => ({ ...w, file, table })));
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
