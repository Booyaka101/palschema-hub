#!/usr/bin/env node
/**
 * run-tests.mjs — portable acceptance-test runner (works on Windows cmd & Unix).
 * Asserts: index.json valid w/ >=10 tables; valid-mod passes (0); invalid-mod fails (1).
 */
import { spawnSync } from 'node:child_process';
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

console.log(`\n${failures ? failures + ' test(s) FAILED' : 'All tests passed ✓'}`);
process.exit(failures ? 1 : 0);
