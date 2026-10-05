#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const core_1 = require("./core");
const package_1 = require("./package");
const HELP = `palschema-validate — validate Palworld PalSchema mod JSON/JSONC against the palschema-hub registry

Usage:
  palschema-validate <file-or-dir> [more...]
  palschema-validate --version <palworld_version> <file-or-dir> [more...]
  palschema-validate --migrate <from>..<to>      <file-or-dir> [more...]

Modes:
  (default)            Validate mod files. Raw-table files ({"DT_*": {...}}),
                       pal-loader files ({"<CharacterId>": {...}}) and
                       item-loader files ({"<ItemId>": {...}}) are all
                       recognized — by their DT_* keys, their pals/ or items/
                       folder, or their fields.
  --version <v>        Validate against Palworld version <v>'s schemas
                       (default: the newest version the registry knows)
  --migrate <a>..<b>   Scan mod files for fields that were removed or retyped
                       between two Palworld versions (e.g. 0.7.2..1.0) — flags
                       every field a mod sets that no longer exists (with a
                       possible-rename note when the SDK headers suggest one).
                       Exit 1 if any breaking field is found.
  check-package <dir>  Validate an official Palworld Workshop package
                       (Mods/Workshop/<folder>/Info.json: PackageName,
                       InstallRule rules, Targets, ConfigOverrides). Needs no
                       registry, network or dependencies. Use
                        "check-package --help" for its full check list.

Options:
  --palschema-version <v>  Target a specific PalSchema release (e.g. 0.6.3).
                       Loader keys newer than the target are flagged, e.g.
                       RanchActionData on a new pal needs PalSchema >= 0.6.4
                       (PR #143). Unknown values fail loudly; the registry's
                       versions.json records which releases are known.
  --registry <r>   Schema/diff source: a base URL, or a local repo-root path
                   (default: https://raw.githubusercontent.com/<owner>/palschema-hub/main)
  --owner <o>      GitHub owner for the default registry URL          (default: Booyaka101)
  --strict         CI mode: promote warnings to errors (exit 1)
  -h, --help       Show this help

Unknown keys (validate mode): a field the schema doesn't declare is reported as a
WARNING with a did-you-mean suggestion, not a rejection — the semantics PalSchema
itself is adopting (Okaetsu/PalSchema#134). The note on each warning says whether
the game would catch it too: the pal loader stays silent in game (#134), the item
loader warns at load since PalSchema 0.6.3 (#138). PalSchema pseudo-keys ($Filters,
the {"Action": "Clear", "Items": [...]} array wrapper) and loader keys read off
PalSchema's source (RanchActionData, Loot, Recipe, ...) never warn.

Examples:
  npx palschema-validate ./mods/
  npx palschema-validate --palschema-version 0.6.3 pals/mynewpal.json
  npx palschema-validate --migrate 0.7.2..1.0 ./mods/

Exit codes: 0 = all files pass (warnings alone never fail a run);
            1 = validation error / breaking field / bad usage, or any warning
                when --strict is given.`;
const CHECK_PACKAGE_HELP = `palschema-validate check-package — validate an official Palworld Workshop mod package

Usage:
  palschema-validate check-package <package-folder|Info.json> [more...]
  palsc check-package <package-folder|Info.json> [more...]

What it checks (no registry, no network, no dependencies — works offline):
  * Info.json parses; UTF-8 BOM and UTF-16 encodings are detected, decoded,
    and reported so the file can be re-saved as plain UTF-8
  * required keys: "PackageName" (non-empty string) and the "InstallRule"
    array — the "InstallRules" spelling is accepted as an alias, with a
    warning that the official key is singular
  * every rule: "Type" (official types: UE4SS, Lua, PalSchema, LogicMods,
    Paks — an unknown value warns), "Targets" a non-empty array of non-empty
    strings, and "IsServer" a boolean when present
  * every Target path exists inside the package folder
  * no Target escapes the game directory — any ".." segment fails, because
    the rule's destination would land outside the game
  * duplicate PackageNames across a scanned Workshop root fail, naming every
    declaring path (only one of them would ever be enabled in game)
  * a Mods/ConfigOverrides directory next to the package is scanned: folders
    keyed by a scanned PackageName or a numeric Workshop ID have their JSON
    files parsed; any other folder gets an informational note only

Exit codes: 0 = valid (warnings and notes never fail a run);
            1 = any error, a missing path, or any warning under --strict.

Options:
  --strict   promote warnings to errors (exit 1)
  --json     print one JSON object (packages / palModSettings /
             configOverrides / summary) instead of human output — same
             exit codes, nothing else on stdout

Docs: https://docs.palworldgame.com/settings-and-operation/mod`;
function parseArgs(argv) {
    let version = '';
    let migrate = '';
    let registry;
    let owner = process.env.PALSCHEMA_OWNER || 'Booyaka101';
    let strict = false;
    let palschemaVersion = '';
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
        else if (a === '--strict')
            strict = true;
        else if (a === '--palschema-version')
            palschemaVersion = argv[++i] ?? '';
        else if (a.startsWith('--version='))
            version = a.slice('--version='.length);
        else if (a.startsWith('--migrate='))
            migrate = a.slice('--migrate='.length);
        else if (a.startsWith('--registry='))
            registry = a.slice('--registry='.length);
        else if (a.startsWith('--owner='))
            owner = a.slice('--owner='.length);
        else if (a.startsWith('--palschema-version='))
            palschemaVersion = a.slice('--palschema-version='.length);
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
    if (migrate && palschemaVersion) {
        console.error('Error: --palschema-version applies to validate mode, not --migrate.\n');
        return null;
    }
    if (!version && !migrate && !paths.length) {
        console.error('Error: provide mod files/directories to validate, or --migrate <from>..<to> for a breaking-change scan.\n');
        return null;
    }
    if (migrate) {
        const m = migrate.match(/^([^.\s]+(?:\.[^.\s]+)*)\.\.([^.\s]+(?:\.[^.\s]+)*)$/);
        if (!m) {
            console.error(`Error: --migrate expects <from>..<to> (e.g. 0.7.2..1.0), got "${migrate}".\n`);
            return null;
        }
        return { opts: { version: m[2], registry, owner }, paths, strict, migrate: { from: m[1], to: m[2] } };
    }
    if (!paths.length) {
        console.error('Error: provide at least one file or directory to validate.\n');
        return null;
    }
    return { opts: { version, registry, owner }, paths, strict, palschemaVersion: palschemaVersion || undefined };
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
    // Same SDK commit (identical version, or an alias pair like 0.7.2..0.7.3 or
    // 1.0.1..1.0.2): the row structs are identical, so no mod field can break.
    if (info.versions[from.version].sdkCommit === info.versions[to.version].sdkCommit) {
        const canonical = from.version;
        // For the newest version's aliases, name the SDK branch head — it proves the
        // whole patch line shipped no header regeneration. It moves on unrelated SDK
        // commits too, so docs quoting this line are gated in scripts/run-tests.mjs.
        const sdkName = canonical === info.order[info.order.length - 1] && info.sdkHead
            ? info.sdkHead.commit
            : info.versions[canonical].sdkCommit;
        console.log(from.aliasNote && to.aliasNote && from.version === to.version
            ? `no row-struct changes between ${fromLabel} and ${toLabel} (both alias Palworld ${canonical}, SDK ${sdkName}); PalSchema mods need no field migration.`
            : `no row-struct changes — Palworld ${fromLabel} and ${toLabel} share SDK commit ` +
                `${info.versions[to.version].sdkCommit}; PalSchema mods need no field migration.`);
        // With target paths given, still enumerate them so the caller sees their
        // files were considered (trivially zero hits — the structs are identical).
        if (parsed.paths.length) {
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
            console.log(`\n${files.length} file(s) scanned · 0 breaking field(s) in 0 file(s)`);
        }
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
async function runCheckPackage(argv) {
    if (argv.some((a) => a === '-h' || a === '--help')) {
        console.log(CHECK_PACKAGE_HELP);
        process.exit(0);
    }
    const paths = [];
    let strict = false;
    let json = false;
    for (const a of argv) {
        if (a === '--strict') {
            strict = true;
        }
        else if (a === '--json') {
            json = true;
        }
        else if (a === '--registry' || a === '--owner' || a === '--version' ||
            a === '--palschema-version' || a === '--migrate') {
            console.error(`Error: check-package reads only the package folder — "${a}" is not needed here.`);
            process.exit(1);
        }
        else if (a.startsWith('--')) {
            console.error(`Unknown option: ${a}`);
            process.exit(1);
        }
        else {
            paths.push(a);
        }
    }
    if (!paths.length) {
        console.error('Error: provide a package folder (or an Info.json file) to check.\n');
        console.log(CHECK_PACKAGE_HELP);
        process.exit(1);
    }
    const reports = [];
    /** True only when the path itself is the package (Info.json directly under
     *  it) — a walked root that happens to contain one package is not. */
    let directPackage = false;
    for (const p of paths) {
        let st;
        try {
            st = (0, node_fs_1.statSync)(p);
        }
        catch {
            console.error(`Error: path does not exist: ${p}`);
            process.exit(1);
        }
        if (st.isFile()) {
            if ((0, node_path_1.basename)(p).toLowerCase() !== 'info.json') {
                console.error(`Error: ${p} is not an Info.json — point check-package at the package folder (or its Info.json).`);
                process.exit(1);
            }
            reports.push((0, package_1.checkPackageDir)((0, node_path_1.dirname)(p), p));
            directPackage = true;
        }
        else {
            const dirs = (0, package_1.collectPackageDirs)(p);
            if (!dirs.length) {
                const hint = (0, package_1.folderHint)(p);
                console.error(`✗ ${p}`);
                console.error(`  no Info.json here — not an official Workshop package${hint ? ` (${hint})` : ''}.`);
                console.error('  Official packages live at Mods/Workshop/<folder>/Info.json with "PackageName" and "InstallRule" — ' +
                    'https://docs.palworldgame.com/settings-and-operation/mod');
                process.exit(1);
            }
            for (const d of dirs)
                reports.push((0, package_1.checkPackageDir)(d));
            if (dirs.length === 1 && (0, node_fs_1.existsSync)((0, node_path_1.join)(p, 'Info.json')))
                directPackage = true;
        }
    }
    const single = paths.length === 1 && reports.length === 1 && directPackage;
    for (const r of reports) {
        // A nested Info.json is the "mod zipped inside a folder" accident; a
        // duplicate PackageName there is the one that breaks enabling in game.
        // Runs in walk mode too — a root scan must not miss what a direct scan sees.
        const nested = (0, package_1.nestedPackageIssues)(r);
        r.errors.push(...nested.filter((i) => i.severity === 'error'));
        r.warnings.push(...nested.filter((i) => i.severity === 'warning'));
    }
    // Workshop roots: two subscribed items sharing a PackageName is legal JSON
    // but only one of them can ever be enabled (04-Tech.md) — fail loudly.
    const byName = new Map();
    for (const r of reports) {
        if (!r.packageName)
            continue;
        const group = byName.get(r.packageName) ?? [];
        group.push(r);
        byName.set(r.packageName, group);
    }
    for (const [name, group] of byName) {
        if (group.length < 2)
            continue;
        group[0].errors.push((0, package_1.issue)('error', `duplicate PackageName "${name}" declared by:\n` +
            group.map((g) => `      ${g.infoPath}`).join('\n') +
            '\n    only one will be enabled and the order is not guaranteed'));
    }
    let errorCount = reports.reduce((n, r) => n + r.errors.length, 0);
    let warnCount = reports.reduce((n, r) => n + r.warnings.length, 0);
    // PalModSettings.ini (official layout: Mods/PalModSettings.ini) is only
    // linted in multi-package mode: checking one package of ten would otherwise
    // warn about the nine that are simply outside this scan.
    let settingsLint = null;
    if (!single && reports.length) {
        const iniPath = (0, package_1.findPalModSettings)(reports[0].path);
        if (iniPath) {
            const { text, warnings: encodingWarnings } = (0, package_1.decodeInfoJson)((0, node_fs_1.readFileSync)(iniPath), 'PalModSettings.ini');
            const settings = (0, package_1.parsePalModSettings)(text);
            settingsLint = {
                iniPath,
                encodingWarnings,
                globalEnabled: settings.globalEnabled,
                activeMods: settings.activeMods,
            };
            if (settings.globalEnabled === false)
                warnCount++;
        }
    }
    // ConfigOverrides: sibling of the package folder (Mods/<pkg>, or
    // Mods/Workshop/<pkg> two levels up), keyed by PackageName or Workshop ID.
    const known = new Set(reports.flatMap((r) => r.knownKeys));
    const overridesSeen = new Set();
    const overridesOut = [];
    for (const r of reports) {
        const dir = (0, package_1.findOverridesDir)(r.path);
        if (!dir || overridesSeen.has(dir))
            continue;
        overridesSeen.add(dir);
        const overrides = (0, package_1.scanOverrides)(dir, known);
        if (!overrides.folders.length)
            continue;
        overridesOut.push(overrides);
        errorCount += overrides.folders.reduce((n, f) => n + f.errors.length, 0);
    }
    if (json) {
        // One JSON object on stdout, nothing else — CI and scripts parse this.
        console.log(JSON.stringify({
            packages: reports.map((r) => ({
                path: r.path,
                infoPath: r.infoPath,
                kind: r.kind,
                packageName: r.packageName ?? null,
                version: r.version ?? null,
                modName: r.modName ?? null,
                rules: r.rules,
                serverRules: r.serverRules,
                errors: r.errors.map((i) => i.message),
                warnings: r.warnings.map((i) => i.message),
                notes: r.notes.map((i) => i.message),
            })),
            palModSettings: settingsLint
                ? {
                    path: settingsLint.iniPath,
                    globalEnabled: settingsLint.globalEnabled,
                    activeMods: settingsLint.activeMods,
                    encodingWarnings: settingsLint.encodingWarnings,
                }
                : null,
            configOverrides: overridesOut,
            summary: { packages: reports.length, errors: errorCount, warnings: warnCount },
        }, null, 2));
    }
    else {
        for (const r of reports) {
            const mark = r.errors.length ? '✗' : '✓';
            const label = r.packageName ? ` — "${r.packageName}"${r.version ? ` v${r.version}` : ''}` : '';
            console.log(`${mark} ${r.path}${label}`);
            for (const line of r.ruleLines)
                console.log(`    ${line}`);
            for (const i of r.errors)
                console.log(`    ${i.message}`);
            for (const i of r.warnings)
                console.log(`    WARN ${i.message}`);
            for (const i of r.notes)
                console.log(`    note: ${i.message}`);
            if (!r.errors.length) {
                // Bare line for a directly-pointed package (the documented contract);
                // indented under its header when a walk found several.
                console.log(single ? `official package OK: ${r.rules} rules validated` : `    official package OK: ${r.rules} rules validated`);
            }
        }
        if (settingsLint) {
            for (const w of settingsLint.encodingWarnings)
                console.log(`    WARN ${w}`);
            if (settingsLint.globalEnabled === false) {
                console.log('    WARN PalModSettings.ini sets bGlobalEnableMod=false — no mods will load');
            }
            const declared = new Set(reports.flatMap((r) => (r.packageName ? [r.packageName] : [])));
            for (const r of reports) {
                if (r.packageName && !settingsLint.activeMods.some((m) => m.toLowerCase() === r.packageName.toLowerCase())) {
                    console.log(`    note: "${r.packageName}" is present but not enabled — no ActiveModList entry in PalModSettings.ini matches it`);
                }
            }
            for (const m of settingsLint.activeMods) {
                if (![...declared].some((d) => d.toLowerCase() === m.toLowerCase())) {
                    console.log(`    note: ActiveModList entry "${m}" matches no scanned package (its folder may be outside this scan)`);
                }
            }
        }
        for (const overrides of overridesOut) {
            console.log(`ConfigOverrides: ${overrides.dir} — ${overrides.folders.length} folder(s)`);
            for (const f of overrides.folders) {
                if (f.kind === 'unknown') {
                    console.log(`    note: ConfigOverrides/${f.name} matches no scanned PackageName and is not a numeric Workshop ID`);
                }
                else {
                    const key = f.kind === 'package-name' ? 'PackageName' : 'Workshop ID';
                    console.log(`    ✓ ConfigOverrides/${f.name} (${key}): ${f.parsed} JSON file(s) parsed`);
                }
                for (const e of f.errors)
                    console.log(`    ✗ ${e}`);
            }
        }
        const s = (n) => (n === 1 ? '' : 's');
        const strictFails = strict && warnCount > 0;
        console.log(`${reports.length} package${s(reports.length)} checked, ${errorCount} error${s(errorCount)}, ` +
            `${warnCount} warning${s(warnCount)}${strictFails ? ' (strict)' : ''}`);
    }
    process.exit(errorCount || (strict && warnCount > 0) ? 1 : 0);
}
async function main() {
    const argv = process.argv.slice(2);
    if (argv[0] === 'check-package')
        await runCheckPackage(argv.slice(1));
    const parsed = parseArgs(argv);
    if (!parsed) {
        console.log(HELP);
        process.exit(process.argv.slice(2).some((a) => a === '-h' || a === '--help') ? 0 : 1);
    }
    if (parsed.migrate)
        await runMigrate(parsed);
    const { opts, paths } = parsed;
    // No --version: validate against the newest Palworld version the registry
    // knows (aliases resolve to their pinned version's schemas).
    if (!opts.version) {
        let info;
        try {
            info = await (0, core_1.loadRegistryJson)('versions.json', opts);
        }
        catch (e) {
            console.error(`Error: ${e.message}`);
            console.error('Pass --version <palworld_version> to skip the versions.json lookup.');
            process.exit(1);
        }
        const labels = [...info.order, ...Object.keys(info.aliases ?? {})];
        const newest = labels.reduce((a, b) => ((0, core_1.cmpVersions)(a, b) >= 0 ? a : b));
        const resolved = (0, core_1.resolveVersionLabel)(info, newest);
        opts.version = resolved.version;
        console.log(`validating against Palworld ${opts.version} schemas` +
            (newest !== opts.version ? ` (newest known: ${newest}, which aliases ${opts.version})` : ' (newest known)'));
    }
    // --palschema-version: only recorded releases are accepted — an unknown value
    // fails loudly instead of silently defaulting to the newest behavior.
    if (parsed.palschemaVersion) {
        let info;
        try {
            info = await (0, core_1.loadRegistryJson)('versions.json', opts);
        }
        catch (e) {
            console.error(`Error: ${e.message}`);
            process.exit(1);
        }
        const ps = info.upstream?.palSchema;
        const known = (ps?.releases ?? []).map((r) => r.version);
        if (!known.length && ps?.version)
            known.push(ps.version);
        if (!known.length) {
            console.error('Error: this registry does not record PalSchema releases (versions.json upstream.palSchema.releases) — cannot honor --palschema-version.');
            process.exit(1);
        }
        if (!known.includes(parsed.palschemaVersion)) {
            const newest = known.reduce((a, b) => ((0, core_1.cmpVersions)(a, b) >= 0 ? a : b));
            console.error(`Error: unknown PalSchema version "${parsed.palschemaVersion}".`);
            console.error(`This registry records PalSchema releases: ${known.join(', ')} (newest: ${newest}).`);
            console.error('Pass one of those, or omit --palschema-version to target the newest.');
            process.exit(1);
        }
        opts.palschemaVersion = parsed.palschemaVersion;
        console.log(`targeting PalSchema ${opts.palschemaVersion}`);
    }
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
    // Per-loader note: does the GAME catch this too? The raw table loader always
    // warned, the item loader warns since PalSchema 0.6.3 (#138), the pal loader
    // stays silent (#134) — which is exactly why this scan exists for pals files.
    const LOADER_NOTES = {
        pals: "not caught in game: PalSchema's pal loader silently ignores unknown fields — Okaetsu/PalSchema#134",
        items: 'PalSchema 0.6.3+ also warns about this at load time — Okaetsu/PalSchema#138',
    };
    // Unknown-key warnings (PalSchema#134 semantics): direct row fields print as
    //   WARN <file>:<rowKey> unknown field "<key>" — did you mean "<suggestion>"?
    // nested keys keep the CLI's established "unknown key" wording plus their path.
    // Compat warnings (since-version gates, advisories, loader-mismatch) carry
    // their full message instead.
    const warnLine = (w) => {
        if (w.kind === 'compat')
            return `WARN ${w.file}:${w.row} ${w.message}`;
        const what = w.path ? `unknown key "${w.key}" (in ${w.path})` : `unknown field "${w.key}"`;
        const note = w.loader && LOADER_NOTES[w.loader] ? ` (${LOADER_NOTES[w.loader]})` : '';
        return `WARN ${w.file}:${w.row} ${what}${w.suggestion ? ` — did you mean "${w.suggestion}"?` : ''}${note}`;
    };
    const allFindings = [];
    const allWarnings = [];
    for (const file of files) {
        let result;
        try {
            result = await (0, core_1.validateFile)(file, opts);
        }
        catch (e) {
            // A file this run could not parse is one finding; a registry it could not
            // read is not a per-file problem and must not be reported as one.
            if (e instanceof core_1.RegistryUnavailableError) {
                console.error(`Registry unavailable: ${e.message}`);
                console.error('Nothing was validated. Check --registry, your network, or a GitHub rate limit.');
                process.exit(2);
            }
            result = { findings: [{ file, table: '(parse)', row: '', path: '/', message: e.message }], warnings: [] };
        }
        if (result.findings.length) {
            console.log(`  ✗ ${file}`);
            for (const f of result.findings) {
                const where = [f.table, f.row].filter(Boolean).join(' > ');
                console.log(`      ${where}${f.path && f.path !== '/' ? ' ' + f.path : ''}: ${f.message}`);
            }
            allFindings.push(...result.findings);
        }
        for (const w of result.warnings)
            console.log(warnLine(w));
        allWarnings.push(...result.warnings);
    }
    // Never claim unqualified success while warnings exist; --strict promotes them.
    const compatCount = allWarnings.filter((w) => w.kind === 'compat').length;
    const unknownCount = allWarnings.length - compatCount;
    const errorCount = allFindings.length + (parsed.strict ? allWarnings.length : 0);
    const s = (n) => (n === 1 ? '' : 's');
    console.log(`${files.length} file${s(files.length)} validated, ` +
        `${errorCount} error${s(errorCount)}${parsed.strict && allWarnings.length ? ' (strict)' : ''}, ` +
        (parsed.strict
            ? `0 warning${s(0)}`
            : `${unknownCount} unknown-key warning${s(unknownCount)}` +
                (compatCount ? `, ${compatCount} compatibility warning${s(compatCount)}` : '')));
    process.exit(errorCount ? 1 : 0);
}
main().catch((e) => {
    console.error(e);
    process.exit(1);
});
