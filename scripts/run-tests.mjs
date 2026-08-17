#!/usr/bin/env node
/**
 * run-tests.mjs — portable acceptance-test runner (works on Windows cmd & Unix).
 * Asserts: index.json valid w/ >=10 tables; valid-mod passes (0); invalid-mod fails (1).
 */
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registryNewest } from './lib/version-sources.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const node = process.execPath;
let failures = 0;

function assert(label, ok, why = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${why ? `  (${why})` : ''}`);
  if (!ok) failures++;
}

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

// Real public mods (see tests/real-mods/SOURCES.md for provenance). Known-good mods
// must stay warning-free — an unknown-key false positive here is the staleness
// failure mode this release exists to remove.
run('real mod: Palvolve passes clean, zero unknown-key warnings',
  validate('tests/real-mods/palvolve'), 0, '0 unknown-key warnings');
run('real mod: Unlimited Buildings passes clean', validate('tests/real-mods/unlimited-buildings'), 0, '0 unknown-key warnings');
run('real mod: Old School Loot passes clean (8 files, no unresolved tables)',
  validate('tests/real-mods/palschemafied-old-school-loot'), 0, '0 unknown-key warnings');
// (0.4.0, PalSchema#134 semantics: a stale-but-real field is a WARNING now — the
// run no longer fails, but it still names RedialIndex. --strict restores the gate.)
run('real mod: Accessory Condenser reports stale RedialIndex as a warning, exit 0',
  validate('tests/real-mods/accessory-condenser'), 0, 'unknown field "RedialIndex"');
run('real mod: Accessory Condenser fails under --strict (CI mode)',
  [...validate('tests/real-mods/accessory-condenser'), '--strict'], 1, 'unknown field "RedialIndex"');
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
// struct doesn't have (only 1..15) is warned, and --strict promotes it to exit 1.
run('SDK-only table: nonexistent lottery slot -> flagged, exit 1 under --strict',
  [...validate('tests/real-mods-broken/fieldlottery-broken.json'), '--strict'], 1, 'unknown field "ItemSlot16_ProbabilityPercent"');

// 0.4.0 unknown-key warnings (Okaetsu/PalSchema#134 semantics): warn + suggest,
// never reject; pseudo-keys stay silent; --strict is the CI gate.
run('unknown key: case-only typo warns with did-you-mean, exit 0',
  validate('tests/fixtures/unknown-keys.json'), 0,
  'WARN tests/fixtures/unknown-keys.json:Lamball unknown field "rarity" — did you mean "Rarity"?');
run('unknown key: invented field warns with NO suggestion',
  validate('tests/fixtures/unknown-keys.json'), 0,
  'unknown field "DefinitelyNotARealPalField"\n');
run('unknown key: summary counts warnings, run still succeeds',
  validate('tests/fixtures/unknown-keys.json'), 0, '1 file validated, 0 errors, 2 unknown-key warnings');
run('pseudo-keys: $Filters + {"Action":"Clear","Items":[...]} wrapper stay silent',
  validate('tests/fixtures/pseudo-keys.json'), 0, '1 file validated, 0 errors, 0 unknown-key warnings');
run('--strict promotes unknown-key warnings to errors, exit 1',
  [...validate('tests/fixtures/unknown-keys.json'), '--strict'], 1, '1 file validated, 2 errors (strict), 0 warnings');

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
// Currency + auto-bump. The fixtures are ANCHORED to versions.json rather than
// naming a game version: hardcoded ones rotted on every alias bump (the day
// 1.0.3 shipped, the "1.0.3 is hypothetical" fixture became a lie).
const versionsInfo = JSON.parse(readFileSync(join(ROOT, 'versions.json'), 'utf8'));
const newestLabel = registryNewest(versionsInfo);
const nextLabel = (() => {
  const p = newestLabel.split('.').map(Number);
  p[p.length - 1] += 1;
  return p.join('.');
})();
const pinnedNewest = versionsInfo.order[versionsInfo.order.length - 1];
const pinnedSha = versionsInfo.versions[pinnedNewest].sdkCommit;
const headSha = versionsInfo.sdkHead.commit;

const fx = mkdtempSync(join(tmpdir(), 'psv-currency-'));
try {
  const steamTpl = JSON.parse(readFileSync(join(ROOT, 'tests/currency-fixtures/steam-insync.json'), 'utf8'));
  const commitsTpl = JSON.parse(readFileSync(join(ROOT, 'tests/currency-fixtures/commits-insync.json'), 'utf8'));
  const write = (name, obj) => {
    const p = join(fx, name);
    writeFileSync(p, JSON.stringify(obj, null, 2));
    return p;
  };
  // Real API shapes (the committed fixtures), with the version-dependent bits
  // rewritten to whatever the registry claims right now.
  const feedWith = (v) => ({
    ...steamTpl,
    appnews: {
      ...steamTpl.appnews,
      newsitems: [
        ...steamTpl.appnews.newsitems,
        { gid: 'gen', title: `v${v}: Balance Adjustments & Bug Fixes`, date: 1790000000, feedlabel: 'Community Announcements' },
      ],
    },
  });
  const commitsWith = (sha) => [{ ...commitsTpl[0], sha }];
  const steamInsync = write('steam-insync.json', feedWith(newestLabel));
  const steamStale = write('steam-stale.json', feedWith(nextLabel));
  const commitsHead = write('commits-head.json', commitsWith(headSha));
  const publicInsync = write('public-insync.json', commitsWith(pinnedSha));
  const publicRegen = write('public-regen.json', commitsWith('deadbee'));

  run('check-currency: in-sync fixture -> exit 0 "registry current"',
    ['scripts/check-currency.mjs', '--steam-json', steamInsync, '--commits-json', commitsHead],
    0, `registry current: game ${newestLabel}, SDK ${headSha}`);
  run('check-currency: stale fixture -> exit 1 naming the new game version',
    ['scripts/check-currency.mjs', '--steam-json', steamStale, '--commits-json', commitsHead],
    1, `game ${nextLabel} released, registry newest is ${newestLabel}`);

  // bump-version: the alias path is mechanical, the regenerate path must refuse.
  run('bump-version: versions.json round-trips through the serializer byte-for-byte',
    ['scripts/bump-version.mjs', '--check-format'], 0, 'round-trips byte-identically');
  run('bump-version: nothing moved -> exit 4, no write',
    ['scripts/bump-version.mjs', '--dry-run', '--steam-json', steamInsync,
      '--commits-json', commitsHead, '--public-commits-json', publicInsync],
    4, 'nothing to do');
  const before = readFileSync(join(ROOT, 'versions.json'), 'utf8');
  run(`bump-version: new patch + unchanged headers -> alias of ${pinnedNewest}`,
    ['scripts/bump-version.mjs', '--dry-run', '--today', '2026-01-01', '--steam-json', steamStale,
      '--commits-json', commitsHead, '--public-commits-json', publicInsync],
    0, `Palworld ${nextLabel} is an alias of ${pinnedNewest}`);
  assert('bump-version: --dry-run leaves versions.json untouched',
    readFileSync(join(ROOT, 'versions.json'), 'utf8') === before);
  run('bump-version: Source/Pal/Public regenerated -> refuses (exit 3), never guesses an alias',
    ['scripts/bump-version.mjs', '--dry-run', '--steam-json', steamStale,
      '--commits-json', commitsHead, '--public-commits-json', publicRegen],
    3, 'is NOT an alias');
} finally {
  rmSync(fx, { recursive: true, force: true });
}

// Every alias must carry its generated artifacts — this is what an automated
// bump produces, and what diff.html/the CLI 404 on if a step is skipped.
run('every alias has a struct snapshot and a diff against its pinned version',
  ['-e', `const {existsSync}=require('fs');const v=require('./versions.json');` +
    `const missing=[];for(const [a,{of}] of Object.entries(v.aliases)){` +
    `if(!existsSync('structs/'+a+'.json'))missing.push('structs/'+a+'.json');` +
    `if(!existsSync('diffs/'+of+'..'+a+'.json'))missing.push('diffs/'+of+'..'+a+'.json');}` +
    `if(missing.length){console.error('missing: '+missing.join(', '));process.exit(1);}` +
    `console.log('all '+Object.keys(v.aliases).length+' aliases have artifacts');`],
  0, 'aliases have artifacts');

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
