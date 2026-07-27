#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("./core");
const HELP = `palschema-validate — validate Palworld PalSchema mod JSON/JSONC against the palschema-hub registry

Usage:
  palschema-validate --version <palworld_version> <file-or-dir> [more...]
  palschema-validate --migrate <from>..<to>      <file-or-dir> [more...]

Modes (exactly one):
  --version <v>        Validate mod files against version <v>'s schemas (e.g. 1.0)
  --migrate <a>..<b>   Scan mod files for fields that were removed or retyped
                       between two Palworld versions (e.g. 0.7.2..1.0) — flags
                       every field a mod sets that no longer exists (with a
                       possible-rename note when the SDK headers suggest one).
                       Exit 1 if any breaking field is found.

Options:
  --registry <r>   Schema/diff source: a base URL, or a local repo-root path
                   (default: https://raw.githubusercontent.com/<owner>/palschema-hub/main)
  --owner <o>      GitHub owner for the default registry URL          (default: Booyaka101)
  -h, --help       Show this help

Examples:
  npx palschema-validate --version 1.0 ./mods/
  npx palschema-validate --migrate 0.7.2..1.0 ./mods/
  npx palschema-validate --migrate 0.7.2..1.0 --registry . tests/migrate-fixtures/partner-skill.json

Exit code: 0 if all files pass, 1 if any validation error / breaking field (or bad usage).`;
function parseArgs(argv) {
    let version = '';
    let migrate = '';
    let registry;
    let owner = process.env.PALSCHEMA_OWNER || 'Booyaka101';
    const paths = [];
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '-h' || a === '--help')
            return null;
        else if (a === '--version')
            version = argv[++i] ?? '';
        else if (a === '--migrate')
            migrate = argv[++i] ?? '';
        else if (a === '--registry')
            registry = argv[++i];
        else if (a === '--owner')
            owner = argv[++i] ?? owner;
        else if (a.startsWith('--version='))
            version = a.slice('--version='.length);
        else if (a.startsWith('--migrate='))
            migrate = a.slice('--migrate='.length);
        else if (a.startsWith('--registry='))
            registry = a.slice('--registry='.length);
        else if (a.startsWith('--owner='))
            owner = a.slice('--owner='.length);
        else if (a.startsWith('-')) {
            console.error(`Unknown option: ${a}`);
            return null;
        }
        else
            paths.push(a);
    }
    if (version && migrate) {
        console.error('Error: --version and --migrate are mutually exclusive — pick one mode.\n');
        return null;
    }
    if (!version && !migrate) {
        console.error('Error: one of --version <palworld_version> (validate) or --migrate <from>..<to> (breaking-change scan) is required.\n');
        return null;
    }
    if (migrate) {
        const m = migrate.match(/^([^.\s]+(?:\.[^.\s]+)*)\.\.([^.\s]+(?:\.[^.\s]+)*)$/);
        if (!m) {
            console.error(`Error: --migrate expects <from>..<to> (e.g. 0.7.2..1.0), got "${migrate}".\n`);
            return null;
        }
        return { opts: { version: m[2], registry, owner }, paths, migrate: { from: m[1], to: m[2] } };
    }
    if (!paths.length) {
        console.error('Error: provide at least one file or directory to validate.\n');
        return null;
    }
    return { opts: { version, registry, owner }, paths };
}
async function runMigrate(parsed) {
    const { from: fromLabel, to: toLabel } = parsed.migrate;
    const { opts } = parsed;
    let info;
    try {
        info = await (0, core_1.loadRegistryJson)('versions.json', opts);
    }
    catch (e) {
        console.error(`Error: ${e.message}`);
        process.exit(1);
    }
    const from = (0, core_1.resolveVersionLabel)(info, fromLabel);
    const to = (0, core_1.resolveVersionLabel)(info, toLabel);
    for (const [label, r] of [[fromLabel, from], [toLabel, to]]) {
        if (!r) {
            console.error(`Error: unknown Palworld version "${label}".`);
            console.error(`Known versions: ${info.order.join(', ')}${Object.keys(info.aliases).length ? ` · aliases: ${Object.keys(info.aliases).join(', ')}` : ''}`);
            process.exit(1);
        }
    }
    for (const note of [from.aliasNote, to.aliasNote]) {
        if (note)
            console.log(`note: ${note}`);
    }
    // Same SDK commit (identical version, or an alias pair like 0.7.2..0.7.3):
    // the row structs are identical, so no mod field can break.
    if (info.versions[from.version].sdkCommit === info.versions[to.version].sdkCommit) {
        console.log(`no row-struct changes — Palworld ${fromLabel} and ${toLabel} share SDK commit ` +
            `${info.versions[to.version].sdkCommit}; PalSchema mods need no field migration.`);
        process.exit(0);
    }
    if (!parsed.paths.length) {
        console.error('Error: provide at least one mod file or directory to scan.\n');
        console.log(HELP);
        process.exit(1);
    }
    const files = [];
    for (const p of parsed.paths) {
        try {
            files.push(...(0, core_1.collectFiles)(p));
        }
        catch (e) {
            console.error(`Cannot read "${p}": ${e.message}`);
            process.exit(1);
        }
    }
    if (!files.length) {
        console.error('No .json/.jsonc files found to scan.');
        process.exit(1);
    }
    // Diffs are published for ascending pairs; a downgrade scan inverts the diff.
    const oi = info.order.indexOf(from.version);
    const ti = info.order.indexOf(to.version);
    const [a, b] = oi <= ti ? [from.version, to.version] : [to.version, from.version];
    let diff;
    try {
        diff = await (0, core_1.loadRegistryJson)(`diffs/${a}..${b}.json`, opts);
    }
    catch (e) {
        console.error(`Error: ${e.message}`);
        process.exit(1);
    }
    if (oi > ti)
        diff = (0, core_1.invertDiff)(diff);
    const index = (0, core_1.buildDiffIndex)(diff);
    console.log(`palschema-validate · migrate ${fromLabel} → ${toLabel} · ${files.length} file(s)\n`);
    const unknownTables = new Set();
    const allHits = [];
    let parseFailures = 0;
    for (const file of files) {
        let hits;
        try {
            hits = (0, core_1.migrateScanFile)(file, diff, index, unknownTables);
        }
        catch (e) {
            console.log(`  ✗ ${file}: ${e.message}`);
            parseFailures++;
            continue;
        }
        if (!hits.length) {
            console.log(`  ✓ ${file}`);
            continue;
        }
        console.log(`  ✗ ${file}`);
        for (const h of hits) {
            const msg = h.kind === 'removed'
                ? `removed in ${toLabel} (was ${h.detail})` +
                    (h.rename ? ` — possible rename to ${h.rename.to} (${h.rename.confidence} confidence)` : '')
                : `retyped in ${toLabel} (${h.detail})`;
            console.log(`      ${h.file} > ${h.table} > ${h.row} > ${h.field}: ${msg}`);
        }
        allHits.push(...hits);
    }
    for (const t of [...unknownTables].sort()) {
        console.warn(`  ! table "${t}" is not in the registry's struct map — cannot check it`);
    }
    const hitFiles = new Set(allHits.map((h) => h.file)).size;
    console.log(`\n${files.length} file(s) scanned · ${allHits.length} breaking field(s) in ${hitFiles} file(s)`);
    process.exit(allHits.length || parseFailures ? 1 : 0);
}
async function main() {
    const parsed = parseArgs(process.argv.slice(2));
    if (!parsed) {
        console.log(HELP);
        process.exit(process.argv.slice(2).some((a) => a === '-h' || a === '--help') ? 0 : 1);
    }
    if (parsed.migrate)
        await runMigrate(parsed);
    const { opts, paths } = parsed;
    const files = [];
    for (const p of paths) {
        try {
            files.push(...(0, core_1.collectFiles)(p));
        }
        catch (e) {
            console.error(`Cannot read "${p}": ${e.message}`);
            process.exit(1);
        }
    }
    if (!files.length) {
        console.error('No .json/.jsonc files found to validate.');
        process.exit(1);
    }
    console.log(`palschema-validate · Palworld v${opts.version} · ${files.length} file(s)\n`);
    const allFindings = [];
    let passed = 0;
    for (const file of files) {
        let findings;
        try {
            findings = await (0, core_1.validateFile)(file, opts);
        }
        catch (e) {
            findings = [{ file, table: '(parse)', row: '', path: '/', message: e.message }];
        }
        if (findings.length === 0) {
            console.log(`  ✓ ${file}`);
            passed++;
        }
        else {
            console.log(`  ✗ ${file}`);
            for (const f of findings) {
                const where = [f.table, f.row].filter(Boolean).join(' > ');
                console.log(`      ${where}${f.path && f.path !== '/' ? ' ' + f.path : ''}: ${f.message}`);
            }
            allFindings.push(...findings);
        }
    }
    const failedFiles = new Set(allFindings.map((f) => f.file)).size;
    console.log(`\n${passed}/${files.length} file(s) passed` +
        (allFindings.length ? ` · ${allFindings.length} error(s) in ${failedFiles} file(s)` : ''));
    process.exit(allFindings.length ? 1 : 0);
}
main().catch((e) => {
    console.error(e);
    process.exit(1);
});
