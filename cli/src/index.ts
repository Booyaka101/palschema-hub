#!/usr/bin/env node
import {
  buildDiffIndex,
  cmpVersions,
  collectFiles,
  invertDiff,
  loadRegistryJson,
  migrateScanFile,
  resolveVersionLabel,
  validateFile,
  type FileResult,
  type FileWarning,
  type Finding,
  type MigrateHit,
  type Options,
  type VersionDiff,
  type VersionsInfo,
} from './core';

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

interface Parsed {
  opts: Options;
  paths: string[];
  strict: boolean;
  migrate?: { from: string; to: string };
  /** Raw --palschema-version value; resolved against the registry in main(). */
  palschemaVersion?: string;
}

function parseArgs(argv: string[]): Parsed | null {
  let version = '';
  let migrate = '';
  let registry: string | undefined;
  let owner = process.env.PALSCHEMA_OWNER || 'Booyaka101';
  let strict = false;
  let palschemaVersion = '';
  const paths: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') return null;
    else if (a === '--version') version = argv[++i] ?? '';
    else if (a === '--migrate') migrate = argv[++i] ?? '';
    else if (a === '--registry') registry = argv[++i];
    else if (a === '--owner') owner = argv[++i] ?? owner;
    else if (a === '--strict') strict = true;
    else if (a === '--palschema-version') palschemaVersion = argv[++i] ?? '';
    else if (a.startsWith('--version=')) version = a.slice('--version='.length);
    else if (a.startsWith('--migrate=')) migrate = a.slice('--migrate='.length);
    else if (a.startsWith('--registry=')) registry = a.slice('--registry='.length);
    else if (a.startsWith('--owner=')) owner = a.slice('--owner='.length);
    else if (a.startsWith('--palschema-version=')) palschemaVersion = a.slice('--palschema-version='.length);
    else if (a.startsWith('-')) {
      console.error(`Unknown option: ${a}`);
      return null;
    } else paths.push(a);
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

async function runMigrate(parsed: Parsed): Promise<never> {
  const { from: fromLabel, to: toLabel } = parsed.migrate!;
  const { opts } = parsed;

  let info: VersionsInfo;
  try {
    info = await loadRegistryJson('versions.json', opts);
  } catch (e: any) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
  const from = resolveVersionLabel(info, fromLabel);
  const to = resolveVersionLabel(info, toLabel);
  for (const [label, r] of [[fromLabel, from], [toLabel, to]] as const) {
    if (!r) {
      console.error(`Error: unknown Palworld version "${label}".`);
      console.error(`Known versions: ${info.order.join(', ')}${Object.keys(info.aliases).length ? ` · aliases: ${Object.keys(info.aliases).join(', ')}` : ''}`);
      process.exit(1);
    }
  }
  for (const note of [from!.aliasNote, to!.aliasNote]) {
    if (note) console.log(`note: ${note}`);
  }

  // Same SDK commit (identical version, or an alias pair like 0.7.2..0.7.3 or
  // 1.0.1..1.0.2): the row structs are identical, so no mod field can break.
  if (info.versions[from!.version].sdkCommit === info.versions[to!.version].sdkCommit) {
    const canonical = from!.version;
    // For the newest version's aliases, name the SDK branch head — it proves the
    // whole patch line shipped no header regeneration. It moves on unrelated SDK
    // commits too, so docs quoting this line are gated in scripts/run-tests.mjs.
    const sdkName =
      canonical === info.order[info.order.length - 1] && info.sdkHead
        ? info.sdkHead.commit
        : info.versions[canonical].sdkCommit;
    console.log(
      from!.aliasNote && to!.aliasNote && from!.version === to!.version
        ? `no row-struct changes between ${fromLabel} and ${toLabel} (both alias Palworld ${canonical}, SDK ${sdkName}); PalSchema mods need no field migration.`
        : `no row-struct changes — Palworld ${fromLabel} and ${toLabel} share SDK commit ` +
            `${info.versions[to!.version].sdkCommit}; PalSchema mods need no field migration.`
    );
    // With target paths given, still enumerate them so the caller sees their
    // files were considered (trivially zero hits — the structs are identical).
    if (parsed.paths.length) {
      const files: string[] = [];
      for (const p of parsed.paths) {
        try {
          files.push(...collectFiles(p));
        } catch (e: any) {
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
  const files: string[] = [];
  for (const p of parsed.paths) {
    try {
      files.push(...collectFiles(p));
    } catch (e: any) {
      console.error(`Cannot read "${p}": ${e.message}`);
      process.exit(1);
    }
  }
  if (!files.length) {
    console.error('No .json/.jsonc files found to scan.');
    process.exit(1);
  }

  // Diffs are published for ascending pairs; a downgrade scan inverts the diff.
  const oi = info.order.indexOf(from!.version);
  const ti = info.order.indexOf(to!.version);
  const [a, b] = oi <= ti ? [from!.version, to!.version] : [to!.version, from!.version];
  let diff: VersionDiff;
  try {
    diff = await loadRegistryJson(`diffs/${a}..${b}.json`, opts);
  } catch (e: any) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
  if (oi > ti) diff = invertDiff(diff);
  const index = buildDiffIndex(diff);

  console.log(`palschema-validate · migrate ${fromLabel} → ${toLabel} · ${files.length} file(s)\n`);

  const unknownTables = new Set<string>();
  const allHits: MigrateHit[] = [];
  let parseFailures = 0;
  for (const file of files) {
    let hits: MigrateHit[];
    try {
      hits = migrateScanFile(file, diff, index, unknownTables);
    } catch (e: any) {
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
      const msg =
        h.kind === 'removed'
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
  if (parsed.migrate) await runMigrate(parsed);
  const { opts, paths } = parsed;

  // No --version: validate against the newest Palworld version the registry
  // knows (aliases resolve to their pinned version's schemas).
  if (!opts.version) {
    let info: VersionsInfo;
    try {
      info = await loadRegistryJson('versions.json', opts);
    } catch (e: any) {
      console.error(`Error: ${e.message}`);
      console.error('Pass --version <palworld_version> to skip the versions.json lookup.');
      process.exit(1);
    }
    const labels = [...info.order, ...Object.keys(info.aliases ?? {})];
    const newest = labels.reduce((a, b) => (cmpVersions(a, b) >= 0 ? a : b));
    const resolved = resolveVersionLabel(info, newest)!;
    opts.version = resolved.version;
    console.log(
      `validating against Palworld ${opts.version} schemas` +
        (newest !== opts.version ? ` (newest known: ${newest}, which aliases ${opts.version})` : ' (newest known)')
    );
  }

  // --palschema-version: only recorded releases are accepted — an unknown value
  // fails loudly instead of silently defaulting to the newest behavior.
  if (parsed.palschemaVersion) {
    let info: VersionsInfo & { upstream?: { palSchema?: { version?: string; releases?: Array<{ version: string }> } } };
    try {
      info = await loadRegistryJson('versions.json', opts);
    } catch (e: any) {
      console.error(`Error: ${e.message}`);
      process.exit(1);
    }
    const ps = info.upstream?.palSchema;
    const known = (ps?.releases ?? []).map((r) => r.version);
    if (!known.length && ps?.version) known.push(ps.version);
    if (!known.length) {
      console.error('Error: this registry does not record PalSchema releases (versions.json upstream.palSchema.releases) — cannot honor --palschema-version.');
      process.exit(1);
    }
    if (!known.includes(parsed.palschemaVersion)) {
      const newest = known.reduce((a, b) => (cmpVersions(a, b) >= 0 ? a : b));
      console.error(`Error: unknown PalSchema version "${parsed.palschemaVersion}".`);
      console.error(`This registry records PalSchema releases: ${known.join(', ')} (newest: ${newest}).`);
      console.error('Pass one of those, or omit --palschema-version to target the newest.');
      process.exit(1);
    }
    opts.palschemaVersion = parsed.palschemaVersion;
    console.log(`targeting PalSchema ${opts.palschemaVersion}`);
  }

  const files: string[] = [];
  for (const p of paths) {
    try {
      files.push(...collectFiles(p));
    } catch (e: any) {
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
  const LOADER_NOTES: Record<string, string> = {
    pals: "not caught in game: PalSchema's pal loader silently ignores unknown fields — Okaetsu/PalSchema#134",
    items: 'PalSchema 0.6.3+ also warns about this at load time — Okaetsu/PalSchema#138',
  };

  // Unknown-key warnings (PalSchema#134 semantics): direct row fields print as
  //   WARN <file>:<rowKey> unknown field "<key>" — did you mean "<suggestion>"?
  // nested keys keep the CLI's established "unknown key" wording plus their path.
  // Compat warnings (since-version gates, advisories, loader-mismatch) carry
  // their full message instead.
  const warnLine = (w: FileWarning): string => {
    if (w.kind === 'compat') return `WARN ${w.file}:${w.row} ${w.message}`;
    const what = w.path ? `unknown key "${w.key}" (in ${w.path})` : `unknown field "${w.key}"`;
    const note = w.loader && LOADER_NOTES[w.loader] ? ` (${LOADER_NOTES[w.loader]})` : '';
    return `WARN ${w.file}:${w.row} ${what}${w.suggestion ? ` — did you mean "${w.suggestion}"?` : ''}${note}`;
  };

  const allFindings: Finding[] = [];
  const allWarnings: FileWarning[] = [];
  for (const file of files) {
    let result: FileResult;
    try {
      result = await validateFile(file, opts);
    } catch (e: any) {
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
    for (const w of result.warnings) console.log(warnLine(w));
    allWarnings.push(...result.warnings);
  }

  // Never claim unqualified success while warnings exist; --strict promotes them.
  const compatCount = allWarnings.filter((w) => w.kind === 'compat').length;
  const unknownCount = allWarnings.length - compatCount;
  const errorCount = allFindings.length + (parsed.strict ? allWarnings.length : 0);
  const s = (n: number) => (n === 1 ? '' : 's');
  console.log(
    `${files.length} file${s(files.length)} validated, ` +
      `${errorCount} error${s(errorCount)}${parsed.strict && allWarnings.length ? ' (strict)' : ''}, ` +
      (parsed.strict
        ? `0 warning${s(0)}`
        : `${unknownCount} unknown-key warning${s(unknownCount)}` +
          (compatCount ? `, ${compatCount} compatibility warning${s(compatCount)}` : ''))
  );
  process.exit(errorCount ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
