#!/usr/bin/env node
/**
 * run-tests.mjs — portable acceptance-test runner (works on Windows cmd & Unix).
 * Asserts: index.json valid w/ >=10 tables; valid-mod passes (0); invalid-mod fails (1).
 */
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const node = process.execPath;
let failures = 0;

function run(label, args, expectCode, expectOutput) {
  const r = spawnSync(node, args, { cwd: ROOT, encoding: 'utf8' });
  const code = r.status;
  let ok = code === expectCode;
  let why = `exit ${code}, expected ${expectCode}`;
  if (ok && expectOutput && !(r.stdout + r.stderr).includes(expectOutput)) {
    ok = false;
    why = `output missing "${expectOutput}"`;
  }
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (${why})`);
  if (!ok) {
    failures++;
    if (r.stdout) console.log(r.stdout.split('\n').map((l) => '      ' + l).join('\n'));
    if (r.stderr) console.log(r.stderr);
  }
  return r;
}

const validate = (target) => ['cli/dist/index.js', '--version', '1.0', '--registry', '.', target];

console.log('palschema-hub acceptance tests\n');
run('index.json valid & >=10 tables', ['scripts/check-index.mjs'], 0);
run('tests/valid-mod.json passes',   validate('tests/valid-mod.json'), 0);
run('tests/invalid-mod.json fails',  validate('tests/invalid-mod.json'), 1);
run('tests/example-chikipi.jsonc passes', validate('tests/example-chikipi.jsonc'), 0);

// Real public mods (see tests/real-mods/SOURCES.md for provenance).
run('real mod: Palvolve passes clean', validate('tests/real-mods/palvolve'), 0);
run('real mod: Unlimited Buildings passes clean', validate('tests/real-mods/unlimited-buildings'), 0);
run('real mod: Old School Loot passes clean (8 files, no unresolved tables)',
  validate('tests/real-mods/palschemafied-old-school-loot'), 0);
run('real mod: Accessory Condenser flags stale RedialIndex (true positive)',
  validate('tests/real-mods/accessory-condenser'), 1, 'unknown field "RedialIndex"');
run('broken real mod: typo\'d field name -> typed error',
  validate('tests/real-mods-broken/unlimited-buildings-broken.json'), 1, 'unknown field "InstallMaxNumInBaseCampp"');
run('broken real mod: wrong type -> typed error',
  validate('tests/real-mods-broken/unlimited-buildings-broken.json'), 1, 'must be integer');

// PalSchema array-wrapper forms: valid rows pass, typos yield ONE precise error each.
run('array wrapper: typo\'d "Itemss" -> precise error',
  validate('tests/wrapper-typo.json'), 1, 'unknown key "Itemss"');
run('array wrapper: bad Action value -> precise error',
  validate('tests/wrapper-typo.json'), 1, 'allowed values');

// SDK-only table (DT_FieldLotteryNameDataTable derived from headers, no paldex source):
// the real Old School Loot rows validate for real (asserted clean above); a slot the
// struct doesn't have (only 1..15) is flagged.
run('SDK-only table: nonexistent lottery slot -> typed error',
  validate('tests/real-mods-broken/fieldlottery-broken.json'), 1, 'unknown field "ItemSlot16_ProbabilityPercent"');

// Version-diff engine (structs/ snapshots + diffs/ + CLI --migrate).
const migrate = (pair, target) => ['cli/dist/index.js', '--migrate', pair, '--registry', '.', ...(target ? [target] : [])];

run('build-diff 0.7.2 1.0 reproduces the verified partner-skill delta',
  ['scripts/build-diff.mjs', '0.7.2', '1.0'], 0, 'OverridePartnerSkillTextID');
run('0.7.2..1.0 diff JSON reports DT_PalDropItem unchanged',
  ['-e', `const d=require('./diffs/0.7.2..1.0.json');` +
    `if(!d.unchangedTables.includes('DT_PalDropItem')||('DT_PalDropItem' in d.affectedTables))process.exit(1);` +
    `console.log('DT_PalDropItem unchanged');`], 0, 'DT_PalDropItem unchanged');
run('--migrate 0.7.2..1.0 flags the removed OverridePartnerSkillTextID (exit 1)',
  migrate('0.7.2..1.0', 'tests/migrate-fixtures/partner-skill.json'), 1, 'OverridePartnerSkillTextID');
run('--migrate 0.7.2..1.0: Old School Loot (drop/lottery tables) is unaffected',
  migrate('0.7.2..1.0', 'tests/real-mods/palschemafied-old-school-loot'), 0);
run('--migrate 0.7.2..0.7.3 (alias pair) -> "no row-struct changes"',
  migrate('0.7.2..0.7.3'), 0, 'no row-struct changes');

// v0.3.0: Palworld 1.0.2 currency, provenance honesty, staleness detection.
run('versions.json: 1.0.2 alias of 1.0, aliasReason names SDK head 62fad41',
  ['-e', `const v=require('./versions.json');const a=v.aliases['1.0.2'];` +
    `if(!a||a.of!=='1.0'||!/62fad41/.test(a.aliasReason||''))process.exit(1);` +
    `console.log('1.0.2 alias OK');`], 0, '1.0.2 alias OK');
run('--migrate 1.0.1..1.0.2 alias-resolves, scans, exits 0',
  migrate('1.0.1..1.0.2', 'tests/valid-mod.json'), 0, 'both alias Palworld 1.0, SDK 62fad41');
run('1.0.1..1.0.2 diff is an empty delta',
  ['-e', `const d=require('./diffs/1.0.1..1.0.2.json');` +
    `if(Object.keys(d.structs).length||d.structsAdded.length||d.structsRemoved.length` +
    `||!d.summary.includes('no row-struct changes'))process.exit(1);console.log('1.0.1..1.0.2 empty');`],
  0, '1.0.1..1.0.2 empty');
run('1.0..1.0.2 diff is an empty delta',
  ['-e', `const d=require('./diffs/1.0..1.0.2.json');` +
    `if(Object.keys(d.structs).length||d.structsAdded.length||d.structsRemoved.length` +
    `||!d.summary.includes('no row-struct changes'))process.exit(1);console.log('1.0..1.0.2 empty');`],
  0, '1.0..1.0.2 empty');
// (0.4.0: items.json regenerated from paldb.cc — valuesCurrent flipped to true,
// so this assertion now checks the CURRENT truth instead of the old staleness.)
run('items.json carries _provenance: current-game values, >= 2400 rows',
  ['-e', `const p=require('./items.json')._provenance;` +
    `if(!p||p.valuesCurrent!==true||p.gameVersion!=='1.0.2'||!(p.rowCount>=2400))process.exit(1);` +
    `console.log('provenance OK');`],
  0, 'provenance OK');
run('check-currency: in-sync fixture -> exit 0 "registry current"',
  ['scripts/check-currency.mjs', '--steam-json', 'tests/currency-fixtures/steam-insync.json',
    '--commits-json', 'tests/currency-fixtures/commits-insync.json'],
  0, 'registry current: game 1.0.2, SDK 62fad41');
run('check-currency: stale fixture -> exit 1 naming the new game version',
  ['scripts/check-currency.mjs', '--steam-json', 'tests/currency-fixtures/steam-stale.json',
    '--commits-json', 'tests/currency-fixtures/commits-insync.json'],
  1, 'game 1.0.3 released, registry newest is 1.0.2');

// v0.4.0: the items.json gate (paldb.cc-sourced data must stay schema-valid & fresh).
run('check-items gate: shipped items.json passes (schema-valid, fresh, no SortID)',
  ['scripts/check-items.mjs'], 0, 'no SortID');
run('check-items gate: stale Jan-2024-shaped fixture fails, naming SortID',
  ['scripts/check-items.mjs', 'tests/items-stale-fixture.json'], 1, 'SortID');

// The offline archive ships cli/dist WITHOUT node_modules, and --migrate needs no
// dependencies (only schema validation uses ajv). Copy dist somewhere with no
// node_modules above it and prove the scan still runs.
const isolated = mkdtempSync(join(tmpdir(), 'psv-noajv-'));
try {
  cpSync(join(ROOT, 'cli', 'dist'), join(isolated, 'dist'), { recursive: true });
  run('--migrate runs with ZERO dependencies installed (offline-archive path)',
    [join(isolated, 'dist', 'index.js'), '--migrate', '0.7.2..1.0', '--registry', ROOT,
      'tests/migrate-fixtures/partner-skill.json'], 1, 'OverridePartnerSkillTextID');
  run('validation without ajv explains itself instead of crashing',
    [join(isolated, 'dist', 'index.js'), '--version', '1.0', '--registry', ROOT,
      'tests/valid-mod.json'], 1, "'ajv' package is required");
} finally {
  rmSync(isolated, { recursive: true, force: true });
}

console.log(`\n${failures ? failures + ' test(s) FAILED' : 'All tests passed ✓'}`);
process.exit(failures ? 1 : 0);
