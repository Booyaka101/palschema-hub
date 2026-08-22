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
run('index.json valid & >=10 tables', ['scripts/check-index.mjs'], 0, 'table note(s)');
// table-notes.json is hand-edited and baked into index.json by build-index.mjs;
// these prove a note that was never rebuilt, or one naming a table nobody ships,
// fails the build instead of silently going missing from the browser.
run('table notes: edited-but-not-rebuilt fixture fails, naming the rebuild',
  ['scripts/check-index.mjs', 'tests/table-notes-stale-fixture.json'], 1, 'npm run index');
run('table notes: note for a nonexistent table fails, naming it',
  ['scripts/check-index.mjs', 'tests/table-notes-orphan-fixture.json'], 1, 'DT_TableThatDoesNotExist');
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

// 0.8.0: PalSchema 0.6.3/0.6.4 loader tracking. Pal- and item-loader files are
// first-class targets, loader-implemented keys come from structs/loader-overlay.json
// (read off PalSchema's source), and --palschema-version gates keys newer than the
// targeted release. The worked example: a new pal carrying RanchActionData (PR #143).
const noVersion = (target, ...extra) => ['cli/dist/index.js', '--registry', '.', target, ...extra];

run('ranch mod: no flags -> newest known version, exit 0, zero warnings',
  noVersion('tests/fixtures/ranch-new-pal.json'), 0, '1 file validated, 0 errors, 0 unknown-key warnings');
run('ranch mod: no flags defaults to the newest known Palworld version',
  noVersion('tests/fixtures/ranch-new-pal.json'), 0, 'validating against Palworld 1.0 schemas');
const ranch063 = run('ranch mod: --palschema-version 0.6.3 -> requires PalSchema >= 0.6.4, naming the key',
  noVersion('tests/fixtures/ranch-new-pal.json', '--palschema-version', '0.6.3'), 0,
  '"RanchActionData" requires PalSchema >= 0.6.4');
assert('0.6.3 report links PR #143', /github\.com\/Okaetsu\/PalSchema\/pull\/143/.test(ranch063.stdout + ranch063.stderr));
assert('0.6.3 report is NOT the generic unknown-field message',
  !(ranch063.stdout + ranch063.stderr).includes('unknown field "RanchActionData"'));
run('ranch mod as .jsonc: identical no-flags behavior (PalSchema PR #139)',
  noVersion('tests/fixtures/ranch-new-pal.jsonc'), 0, '1 file validated, 0 errors, 0 unknown-key warnings');
run('ranch mod as .jsonc: identical --palschema-version 0.6.3 behavior',
  noVersion('tests/fixtures/ranch-new-pal.jsonc', '--palschema-version', '0.6.3'), 0,
  '"RanchActionData" requires PalSchema >= 0.6.4');
run('ranch mod: --palschema-version 0.6.3 --strict promotes the gate to exit 1',
  noVersion('tests/fixtures/ranch-new-pal.json', '--palschema-version', '0.6.3', '--strict'), 1,
  'requires PalSchema >= 0.6.4');
run('unknown --palschema-version fails loudly instead of silently defaulting',
  noVersion('tests/fixtures/ranch-new-pal.json', '--palschema-version', '0.9.9'), 1,
  'unknown PalSchema version "0.9.9"');

const palsTypo = run('pals-loader typo: warning + did-you-mean, exit 0',
  validate('tests/fixtures/pals/typo.json'), 0, 'unknown field "Tirbe" — did you mean "Tribe"?');
assert('pals-loader typo cites #134 as the reason the game will not catch it',
  (palsTypo.stdout + palsTypo.stderr).includes('Okaetsu/PalSchema#134'));
assert('pals-loader typo: nested RanchActionData key is checked too',
  (palsTypo.stdout + palsTypo.stderr).includes('unknown key "SpawnSocket" (in RanchActionData)'));
const itemsTypo = run('item-loader typo: warning + did-you-mean, exit 0',
  validate('tests/fixtures/items/typo.json'), 0, 'unknown field "Rarty" — did you mean "Rarity"?');
assert('item-loader typo notes that PalSchema 0.6.3+ also warns at load time (#138)',
  (itemsTypo.stdout + itemsTypo.stderr).includes('Okaetsu/PalSchema#138'));
assert('item-loader Recipe object is validated against DT_ItemRecipeDataTable',
  (itemsTypo.stdout + itemsTypo.stderr).includes('unknown key "Material1_Idd" (in Recipe)'));
assert('item-loader null entry (delete syntax) is not flagged',
  (itemsTypo.stdout + itemsTypo.stderr).includes('0 errors'));

run('a UTF-8 BOM (Notepad/PowerShell default) parses fine, as it does in-game',
  validate('tests/fixtures/bom.json'), 0, '1 file validated, 0 errors');
run('raw table file using a pals-loader key gets a loader-mismatch warning',
  validate('tests/fixtures/ranch-raw-mismatch.json'), 0, 'the raw table loader will report Property not found');
run('pals Loot with a bare-integer DropChance is flagged (the loader skips it in game)',
  validate('tests/fixtures/pals/loot-int-dropchance.json'), 0, 'float literal');

run('versions.json records PalSchema 0.6.3 and 0.6.4 with published dates',
  ['-e', `const v=require('./versions.json').upstream.palSchema;` +
    `const r=Object.fromEntries((v.releases||[]).map(x=>[x.version,x.date]));` +
    `if(v.version!=='0.6.4'||r['0.6.3']!=='2026-08-15'||r['0.6.4']!=='2026-08-18')process.exit(1);` +
    `console.log('palSchema releases OK');`], 0, 'palSchema releases OK');
run('published DT_PalMonsterParameter schema declares RanchActionData with PR #143 provenance',
  ['-e', `const s=require('./schemas/v1.0/DT_PalMonsterParameter.schema.json');` +
    `const p=s.properties.RanchActionData;` +
    `if(!p||p.type!=='object'||!/pull\\/143/.test(p.$comment||'')||!/sincePalSchema=0.6.4/.test(p.$comment||''))process.exit(1);` +
    `const want=['ChargeMontage','FunMontage','ChargeFacialEye','FunFacialEye','SpawnSocketName','SpawnLocationOffset','SpawnItemRotator'];` +
    `const got=Object.keys(p.properties);` +
    `if(want.length!==got.length||want.some(k=>!got.includes(k)))process.exit(1);` +
    `console.log('RanchActionData declared');`], 0, 'RanchActionData declared');
run('PalStaticItemData schema (item loader) declares the class fields and loader keys',
  ['-e', `const s=require('./schemas/v1.0/PalStaticItemData.schema.json');const p=s.properties;` +
    `if(!p.Rarity||!p.SortId||!p.SortID||!p.Recipe||!p.Type||!Array.isArray(p.Type.enum))process.exit(1);` +
    `console.log('PalStaticItemData OK');`], 0, 'PalStaticItemData OK');

// 0.7.0: int32 columns are `integer`, not `number`. The Jan-2024 dump is JSON,
// which has no integer type, so 158 fields accepted 1.5 until the augmenter
// started aligning integer-ness with the headers.
run('int32 fields reject fractional values (was accepted before 0.7.0)',
  validate('tests/fixtures/fractional-ints.json'), 1, 'Alpaca /Level: must be integer');
run('int32 fields: every offending field is named, not just the first',
  validate('tests/fixtures/fractional-ints.json'), 1, 'Alpaca /min1: must be integer');
run('DT_PalDropItem.Level is typed integer in the published schema',
  ['-e', `const s=require('./schemas/v1.0/DT_PalDropItem.schema.json');` +
    `if(s.properties.Level.type!=='integer')process.exit(1);console.log('Level integer');`],
  0, 'Level integer');

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
// Shape, not a specific version: which game build the values track is a
// freshness question, and check-currency owns that (it exits 1 and the cron
// opens an issue). Asserting a literal here just turned data lag into red CI.
run('items.json carries _provenance: current-game values, dated version, >= 2400 rows',
  ['-e', `const p=require('./items.json')._provenance;` +
    `if(!p||p.valuesCurrent!==true||!/^\\d+(\\.\\d+)+$/.test(p.gameVersion||'')` +
    `||!/^\\d{4}-\\d{2}-\\d{2}$/.test(p.gameVersionDate||'')||!(p.rowCount>=2400))process.exit(1);` +
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

  // Upstream PalSchema releases + the item-value provenance, both anchored the
  // same way. bumpLast turns "0.6.3" into "0.6.4" without naming either.
  const bumpLast = (v) => {
    const p = v.split('.').map(Number);
    p[p.length - 1] += 1;
    return p.join('.');
  };
  const psClaimed = versionsInfo.upstream.palSchema.version;
  const releasesCurrent = write('releases-current.json', [{ tag_name: psClaimed }, { tag_name: '0.6.0' }]);
  const releasesNew = write('releases-new.json', [{ tag_name: bumpLast(psClaimed) }, { tag_name: psClaimed }]);
  const itemsBehind = write('items-behind.json', {
    _provenance: { gameVersion: versionsInfo.order[0], valuesCurrent: true },
  });
  const currency = (extra = []) => [
    'scripts/check-currency.mjs',
    '--steam-json', steamInsync, '--commits-json', commitsHead, '--releases-json', releasesCurrent,
    ...extra,
  ];

  run('check-currency: in-sync fixture -> exit 0 "registry current"',
    currency(),
    0, `registry current: game ${newestLabel}, SDK ${headSha}, PalSchema ${psClaimed}`);
  run('check-currency: stale fixture -> exit 1 naming the new game version',
    ['scripts/check-currency.mjs', '--steam-json', steamStale, '--commits-json', commitsHead,
      '--releases-json', releasesCurrent],
    1, `game ${nextLabel} released, registry newest is ${newestLabel}`);
  // A balance patch: structs and shas are untouched, only the VALUES moved.
  run('check-currency: item values behind the game -> exit 1 (the 1.0.3 case)',
    currency(['--items-json', itemsBehind]),
    1, `items.json values are Palworld ${versionsInfo.order[0]}, registry newest is ${newestLabel}`);
  run('check-currency: newer PalSchema release -> exit 1 naming it',
    ['scripts/check-currency.mjs', '--steam-json', steamInsync, '--commits-json', commitsHead,
      '--releases-json', releasesNew],
    1, `PalSchema ${bumpLast(psClaimed)} released, this registry claims ${psClaimed}`);

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

// A local path dependency publishes fine and then breaks every fresh install of
// the package. This exact line ("palschema-hub": "file:..") was removed once in
// cli 0.1.1 and came back through an `npm install` inside cli/, shipping in
// 0.4.1. Nothing caught it until a post-publish smoke test, so: assert it.
run('cli/package.json declares no local path dependencies (file:/link:)',
  ['-e', `const p=require('./cli/package.json');` +
    `const bad=Object.entries({...p.dependencies,...p.peerDependencies})` +
    `.filter(([,v])=>/^(file:|link:)/.test(String(v)));` +
    `if(bad.length){console.error('local dep(s): '+bad.map(([k,v])=>k+'='+v).join(', '));process.exit(1);}` +
    `console.log('cli deps publishable');`],
  0, 'cli deps publishable');

// The offline archive bundles the registry AND cli/{package.json,README.md}, so a
// CLI version bump alone makes it stale. Running this only in CI meant finding
// that out from a red PR instead of from `npm test`.
run('nexus offline archive matches the repo', ['scripts/build-nexus-zip.mjs', '--check'],
  0, 'archive is current');

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

// 0.9.0 (issue #21): the buildings.json gate — two build tables per building,
// every scraped field routed by schema membership, spot values pinned to the
// live page (Egg Incubator, read 2026-08-19).
run('check-buildings gate: shipped buildings.json passes (schema-valid, both tables, materials mapped)',
  ['scripts/check-buildings.mjs'], 0, 'all routed fields schema-valid');
run('check-buildings gate: broken fixture fails naming the violations',
  ['scripts/check-buildings.mjs', 'tests/buildings-broken-fixture.json'], 1, 'schema violation');
run('buildings.json: HatchingPalEgg spans both tables with the live-verified values',
  ['-e', `const b=require('./buildings.json').buildings.HatchingPalEgg;` +
    `if(b.tables.DT_MapObjectMasterDataTable.Hp!==2000||b.tables.DT_BuildObjectDataTable.SortId!==14` +
    `||!b.materials.some(m=>m.item==='Paldium Fragment'&&m.code))process.exit(1);` +
    `console.log('HatchingPalEgg OK');`], 0, 'HatchingPalEgg OK');

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
