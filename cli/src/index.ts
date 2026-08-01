#!/usr/bin/env node
import {
  buildDiffIndex,
  collectFiles,
  invertDiff,
  loadRegistryJson,
  migrateScanFile,
  resolveVersionLabel,
  validateFile,
  type Finding,
  type MigrateHit,
  type Options,
  type VersionDiff,
  type VersionsInfo,
} from './core';

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

interface Parsed {
  opts: Options;
  paths: string[];
  migrate?: { from: string; to: string };
}

function parseArgs(argv: string[]): Parsed | null {
  let version = '';
  let migrate = '';
  let registry: string | undefined;
  let owner = process.env.PALSCHEMA_OWNER || 'Booyaka101';
  const paths: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') return null;
    else if (a === '--version') version = argv[++i] ?? '';
    else if (a === '--migrate') migrate = argv[++i] ?? '';
    else if (a === '--registry') registry = argv[++i];
    else if (a === '--owner') owner = argv[++i] ?? owner;
    else if (a.startsWith('--version=')) version = a.slice('--version='.length);
    else if (a.startsWith('--migrate=')) migrate = a.slice('--migrate='.length);
    else if (a.startsWith('--registry=')) registry = a.slice('--registry='.length);
    else if (a.startsWith('--owner=')) owner = a.slice('--owner='.length);
    else if (a.startsWith('-')) {
      console.error(`Unknown option: ${a}`);
      return null;
    } else paths.push(a);
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
    // For the newest version's aliases, name the SDK branch head (e.g. 62fad41) —
    // it proves the whole patch line shipped no header regeneration.
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

  console.log(`palschema-validate · Palworld v${opts.version} · ${files.length} file(s)\n`);

  const allFindings: Finding[] = [];
  let passed = 0;
  for (const file of files) {
    let findings: Finding[];
    try {
      findings = await validateFile(file, opts);
    } catch (e: any) {
      findings = [{ file, table: '(parse)', row: '', path: '/', message: e.message }];
    }
    if (findings.length === 0) {
      console.log(`  ✓ ${file}`);
      passed++;
    } else {
      console.log(`  ✗ ${file}`);
      for (const f of findings) {
        const where = [f.table, f.row].filter(Boolean).join(' > ');
        console.log(`      ${where}${f.path && f.path !== '/' ? ' ' + f.path : ''}: ${f.message}`);
      }
      allFindings.push(...findings);
    }
  }

  const failedFiles = new Set(allFindings.map((f) => f.file)).size;
  console.log(
    `\n${passed}/${files.length} file(s) passed` +
      (allFindings.length ? ` · ${allFindings.length} error(s) in ${failedFiles} file(s)` : '')
  );
  process.exit(allFindings.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
