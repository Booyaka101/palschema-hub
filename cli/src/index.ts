#!/usr/bin/env node
import { collectFiles, validateFile, type Finding, type Options } from './core';

const HELP = `palschema-validate — validate Palworld PalSchema mod JSON/JSONC against the palschema-hub registry

Usage:
  palschema-validate --version <palworld_version> <file-or-dir> [more...]

Options:
  --version <v>    Palworld version to validate against (e.g. 1.0)   [required]
  --registry <r>   Schema source: a base URL, or a local repo-root path
                   (default: https://raw.githubusercontent.com/<owner>/palschema-hub/main)
  --owner <o>      GitHub owner for the default registry URL          (default: Booyaka101)
  -h, --help       Show this help

Examples:
  npx palschema-validate --version 1.0 ./mods/
  npx palschema-validate --version 1.0 mod.json
  npx palschema-validate --version 1.0 --registry . tests/valid-mod.json

Exit code: 0 if all files pass, 1 if any validation error (or bad usage).`;

function parseArgs(argv: string[]): { opts: Options; paths: string[] } | null {
  let version = '';
  let registry: string | undefined;
  let owner = process.env.PALSCHEMA_OWNER || 'Booyaka101';
  const paths: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') return null;
    else if (a === '--version') version = argv[++i] ?? '';
    else if (a === '--registry') registry = argv[++i];
    else if (a === '--owner') owner = argv[++i] ?? owner;
    else if (a.startsWith('--version=')) version = a.slice('--version='.length);
    else if (a.startsWith('--registry=')) registry = a.slice('--registry='.length);
    else if (a.startsWith('--owner=')) owner = a.slice('--owner='.length);
    else if (a.startsWith('-')) {
      console.error(`Unknown option: ${a}`);
      return null;
    } else paths.push(a);
  }
  if (!version) {
    console.error('Error: --version <palworld_version> is required.\n');
    return null;
  }
  if (!paths.length) {
    console.error('Error: provide at least one file or directory to validate.\n');
    return null;
  }
  return { opts: { version, registry, owner }, paths };
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed) {
    console.log(HELP);
    process.exit(process.argv.slice(2).some((a) => a === '-h' || a === '--help') ? 0 : 1);
  }
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
