"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.stripJsonc = stripJsonc;
exports.parseJsonc = parseJsonc;
exports.collectFiles = collectFiles;
exports.getValidator = getValidator;
exports.detectTargets = detectTargets;
exports.validateFile = validateFile;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const ajv_1 = __importDefault(require("ajv"));
const ajv = new ajv_1.default({
    strict: true,
    allErrors: true,
    allowUnionTypes: true, // derived schemas use union types (e.g. ["string","object"])
    strictTypes: false, // silence advisory type warnings; keep genuine strict-schema checks
});
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
function schemaLocation(table, opts) {
    const reg = opts.registry;
    if (reg && /^https?:\/\//i.test(reg)) {
        return { url: `${reg.replace(/\/+$/, '')}/schemas/v${opts.version}/${table}.schema.json` };
    }
    if (reg) {
        return { path: (0, node_path_1.join)(reg, 'schemas', `v${opts.version}`, `${table}.schema.json`) };
    }
    return {
        url: `https://raw.githubusercontent.com/${opts.owner}/palschema-hub/main/schemas/v${opts.version}/${table}.schema.json`,
    };
}
const validatorCache = new Map();
/** Load + compile a table's schema. Returns null (with a warning) if unavailable. */
async function getValidator(table, opts) {
    const key = `${opts.version}:${table}`;
    if (validatorCache.has(key))
        return validatorCache.get(key);
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
        validatorCache.set(key, null);
        return null;
    }
    // ajv keys schemas by $id — avoid "already exists" if two files share a $id.
    let validate = schema.$id ? ajv.getSchema(schema.$id) : undefined;
    if (!validate)
        validate = ajv.compile(schema);
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
/** Validate one mod file. Returns findings ([] = clean). */
async function validateFile(file, opts) {
    const text = (0, node_fs_1.readFileSync)(file, 'utf8');
    const data = parseJsonc(text, file);
    const targets = detectTargets(data, file);
    const findings = [];
    if (!targets.length) {
        findings.push({
            file,
            table: '(unknown)',
            row: '',
            path: '/',
            message: 'could not determine target DataTable — expected top-level "DT_*" keys, a "$schema" field, or a DT_*-prefixed filename',
        });
        return findings;
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
    }
    return findings;
}
