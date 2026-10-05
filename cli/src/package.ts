/**
 * Official Workshop package validation (`check-package`).
 *
 * Palworld's first-party mod system deploys packages from
 * Mods/Workshop/<folder>/Info.json: rules in the `InstallRule` array name a
 * Type (the install root inside the game directory) and Targets (paths inside
 * the package that are copied there). Field list verified against
 * pocketpairjp/PalworldModUploader Models/ModInfo.cs and
 * docs.palworldgame.com/settings-and-operation/mod (both fetched 2026-10-05).
 *
 * Like `--migrate`, this mode needs no registry, no network and no ajv — it
 * reads only the package folder, so it runs from the offline archive.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { parseJsonc } from './core';

/** Install roots, from the official docs' Install Type table. Shown to the user;
 *  the loader itself owns the real mapping. */
export const INSTALL_TYPES: Record<string, string> = {
  UE4SS: 'Mods/NativeMods/UE4SS',
  Lua: 'Mods/NativeMods/UE4SS/Mods/{PackageName}',
  PalSchema: 'Mods/NativeMods/UE4SS/Mods/PalSchema/mods/{PackageName}',
  LogicMods: 'Pal/Content/Paks/LogicMods',
  Paks: 'Pal/Content/Paks/~WorkshopMods/{PackageName}',
};

export type Severity = 'error' | 'warning' | 'note';

export interface PackageIssue {
  severity: Severity;
  message: string;
}

export type PackageKind = 'official' | 'palschema' | 'unknown';

export interface PackageReport {
  /** The package folder, as given on the command line. */
  path: string;
  infoPath: string;
  kind: PackageKind;
  packageName?: string;
  version?: string;
  modName?: string;
  rules: number;
  serverRules: number;
  errors: PackageIssue[];
  warnings: PackageIssue[];
  notes: PackageIssue[];
  ruleLines: string[];
  /** PackageName and folder name — the keys a ConfigOverrides folder may use. */
  knownKeys: string[];
}

const issue = (severity: Severity, message: string): PackageIssue => ({ severity, message });

export { issue };
const err = (message: string) => issue('error', message);
const warn = (message: string) => issue('warning', message);
const note = (message: string) => issue('note', message);

/**
 * Decode Info.json bytes to text, detecting the encodings seen in the wild
 * (Windows editors write a UTF-8 BOM; some tools write UTF-16). Every
 * non-plain-UTF-8 detection is reported so the author can re-save as UTF-8.
 */
export function decodeInfoJson(buf: Buffer, file: string): { text: string; warnings: string[] } {
  const warnings: string[] = [];
  const where = `${file}: `;
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    warnings.push(`${where}UTF-8 BOM detected — stripped before parsing`);
    return { text: buf.toString('utf8', 3), warnings };
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    warnings.push(`${where}UTF-16 LE (BOM) detected — decoded for this check; consider re-saving as UTF-8`);
    return { text: buf.toString('utf16le', 2), warnings };
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    // swap16 (below) throws on an odd byte count, so a truncated file is cut
    // to its last whole UTF-16 unit and left to the JSON parser to complain about.
    const body = Buffer.from(buf.subarray(2, buf.length - (buf.length % 2)));
    body.swap16();
    warnings.push(`${where}UTF-16 BE (BOM) detected — decoded for this check; consider re-saving as UTF-8`);
    return { text: body.toString('utf16le'), warnings };
  }
  // BOM-less UTF-16: every other byte is NUL for ASCII-range JSON, which no
  // valid UTF-8 JSON produces. Only trust the guess on a clear signal.
  const sample = buf.subarray(0, 512);
  let zeros = 0;
  for (const b of sample) if (b === 0) zeros++;
  if (buf.length >= 4 && sample.length > 0 && zeros / sample.length > 0.25) {
    const bigEndian = buf[0] === 0;
    warnings.push(
      `${where}UTF-16 ${bigEndian ? 'BE' : 'LE'} without BOM detected (guessed from the byte layout) — ` +
        'decoded for this check; consider re-saving as UTF-8 with a BOM'
    );
    const le = Buffer.from(buf.subarray(0, buf.length - (buf.length % 2)));
    if (bigEndian) le.swap16();
    return { text: le.toString('utf16le'), warnings };
  }
  return { text: buf.toString('utf8'), warnings };
}

/** The rule array, accepting the "InstallRules" alias with a complaint. */
export function ruleListOf(
  info: any
): { rules: any[]; issues: PackageIssue[] } {
  const issues: PackageIssue[] = [];
  const alias = Array.isArray(info?.InstallRules);
  const main = Array.isArray(info?.InstallRule);
  if (main && alias) {
    issues.push(warn('both "InstallRule" and "InstallRules" are present — using "InstallRule", ignoring the alias'));
    return { rules: info.InstallRule, issues };
  }
  if (main) return { rules: info.InstallRule, issues };
  if (alias) {
    issues.push(
      warn('"InstallRules" used — the official key is "InstallRule" (singular, per the official uploader); accepted as an alias')
    );
    return { rules: info.InstallRules, issues };
  }
  if (info?.InstallRule !== undefined || info?.InstallRules !== undefined) {
    const bad = info?.InstallRule !== undefined ? 'InstallRule' : 'InstallRules';
    issues.push(err(`"${bad}" must be an array of rule objects`));
  }
  return { rules: [], issues };
}

/** Which kind of mod content this parsed JSON holds. Official first: a file
 *  could name both worlds, and only the official shape deploys itself. */
export function detectPackageKindJson(json: any): PackageKind {
  if (json && typeof json === 'object' && !Array.isArray(json)) {
    const hasName = typeof json.PackageName === 'string' && json.PackageName.length > 0;
    const ruleKey = json.InstallRule ?? json.InstallRules;
    if (hasName && Array.isArray(ruleKey)) return 'official';
    if (Object.keys(json).some((k) => /^DT_/.test(k))) return 'palschema';
  }
  return 'unknown';
}

/** Package-relative target -> path segments, or null when it escapes the
 *  package (and therefore the game directory it deploys into). */
function targetSegments(target: string): string[] | null {
  const segments: string[] = [];
  for (const part of target.replace(/\\/g, '/').split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') return null;
    segments.push(part);
  }
  return segments;
}

/** A drive letter (C:/…), UNC (//…), or root-anchored (/…) target cannot be
 *  resolved inside the package folder — say so instead of a confusing
 *  "not found" after path.join mangles it. */
function isAbsoluteTarget(target: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(target) || target.startsWith('/');
}

/** Validate one package folder that HAS an Info.json. Never throws: every
 *  failure mode becomes an issue so one bad package cannot kill a batch. */
export function checkPackageDir(dir: string, infoPath = join(dir, 'Info.json')): PackageReport {
  const report: PackageReport = {
    path: dir,
    infoPath,
    kind: 'unknown',
    rules: 0,
    serverRules: 0,
    errors: [],
    warnings: [],
    notes: [],
    ruleLines: [],
    knownKeys: [basename(dir)],
  };
  let buf: Buffer;
  try {
    buf = readFileSync(infoPath);
  } catch (e: any) {
    report.errors.push(err(`cannot read ${infoPath}: ${e.message}`));
    return report;
  }
  const { text, warnings } = decodeInfoJson(buf, 'Info.json');
  for (const w of warnings) report.warnings.push(warn(w));

  let info: any;
  try {
    info = parseJsonc(text, 'Info.json');
  } catch (e: any) {
    report.errors.push(err(e.message));
    return report;
  }
  if (info === null || typeof info !== 'object' || Array.isArray(info)) {
    report.errors.push(err('Info.json must contain a JSON object'));
    return report;
  }

  const kind = detectPackageKindJson(info);
  report.kind = kind;
  if (kind === 'palschema') {
    report.errors.push(
      err(
        'this file is PalSchema (UE4SS) mod JSON, not an official Workshop package — ' +
          'validate it with `palschema-validate` (without check-package)'
      )
    );
    return report;
  }

  if (typeof info.PackageName !== 'string' || !info.PackageName.length) {
    report.errors.push(err('"PackageName" is required and must be a non-empty string'));
  } else {
    report.packageName = info.PackageName;
    report.knownKeys.push(info.PackageName);
  }
  if (typeof info.ModName === 'string') report.modName = info.ModName;
  if (typeof info.Version === 'string') report.version = info.Version;
  else {
    // State the mechanism, not a guessed consequence: the loader detects
    // updates by comparing Version strings (04-Tech.md).
    report.notes.push(note('"Version" is absent — the loader detects updates by comparing Version strings (04-Tech.md)'));
  }
  if (info.DebugMode === true) {
    report.notes.push(note('DebugMode is true — the mod reinstalls from the Workshop folder on every launch (04-Tech.md)'));
  }
  if (Array.isArray(info.Dependencies) && info.Dependencies.length &&
      info.Dependencies.every((d: any) => typeof d === 'string' && d.length)) {
    report.notes.push(note(`depends on: ${info.Dependencies.join(', ')} — those packages must be installed and enabled too`));
  }
  if (typeof info.Thumbnail === 'string' && info.Thumbnail.length) {
    const segments = targetSegments(info.Thumbnail);
    if (segments !== null && !isAbsoluteTarget(info.Thumbnail) && !existsSync(join(dir, ...segments))) {
      report.warnings.push(warn(`Thumbnail not found in package: ${info.Thumbnail}`));
    }
  }

  const { rules, issues } = ruleListOf(info);
  report.errors.push(...issues.filter((i) => i.severity === 'error'));
  report.warnings.push(...issues.filter((i) => i.severity === 'warning'));
  const ruleKeyUsed = Array.isArray(info.InstallRule) ? 'InstallRule' : 'InstallRules';
  const ruleKeyPresent = info.InstallRule !== undefined || info.InstallRules !== undefined;
  if (!ruleKeyPresent) {
    // Report BOTH missing required keys, not just whichever fired first.
    report.errors.push(err('"InstallRule" is required — an array of { Type, Targets } rules (the official key is singular)'));
  } else if (rules.length === 0 && Array.isArray(info[ruleKeyUsed])) {
    // An empty rule list is legal JSON but deploys nothing — a warning, not
    // an error (the loader will happily install an empty package).
    report.warnings.push(warn(`"${ruleKeyUsed}" is empty — the package would install nothing`));
  }

  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    const n = i + 1;
    if (rule === null || typeof rule !== 'object' || Array.isArray(rule)) {
      report.errors.push(err(`rule ${n}: must be an object with "Type" and "Targets"`));
      continue;
    }
    const type = rule.Type;
    if (typeof type !== 'string' || !type.length) {
      report.errors.push(err(`rule ${n}: "Type" is required and must be a non-empty string`));
    } else if (!INSTALL_TYPES[type]) {
      report.warnings.push(
        warn(`rule ${n}: unknown InstallRule Type "${type}" — official types: ${Object.keys(INSTALL_TYPES).join(', ')}`)
      );
    }
    const targets = rule.Targets;
    if (!Array.isArray(targets)) {
      report.errors.push(err(`rule ${n}: "Targets" must be an array of paths inside the package`));
    } else if (!targets.length) {
      report.errors.push(err(`rule ${n}: "Targets" is empty — nothing to install`));
    } else {
      for (let t = 0; t < targets.length; t++) {
        const target = targets[t];
        if (typeof target !== 'string' || !target.length) {
          report.errors.push(err(`rule ${n}: target ${t + 1} must be a non-empty string`));
          continue;
        }
        const segments = targetSegments(target);
        if (segments === null) {
          report.errors.push(err(`rule ${n}: Destination escapes game directory: ${target}`));
          continue;
        }
        if (isAbsoluteTarget(target)) {
          report.errors.push(err(`rule ${n}: Target must be a package-relative path (no drive letters or leading "/"): ${target}`));
          continue;
        }
        if (!existsSync(join(dir, ...segments))) {
          report.errors.push(err(`rule ${n}: Source path not found in package: ${target}`));
          continue;
        }
        const root = (INSTALL_TYPES[type] ?? '<unknown type>').replaceAll(
          '{PackageName}',
          report.packageName ?? '{PackageName}'
        );
        const isServer = rule.IsServer === true;
        if (isServer) report.serverRules++;
        report.ruleLines.push(
          `rule ${n}: ${type} -> ${root}  (${target}${isServer ? ' · server' : ''})`
        );
      }
    }
    if (rule.IsServer !== undefined && typeof rule.IsServer !== 'boolean') {
      report.warnings.push(warn(`rule ${n}: "IsServer" must be a boolean`));
    }
  }

  if (rules.length && !report.serverRules && !report.errors.length) {
    report.notes.push(
      note('no rule sets "IsServer": true — dedicated servers will not run this package (docs: Installing Mods on a Server)')
    );
  }

  report.rules = rules.length;
  return report;
}

/** Immediate subdirectories, skipping the noise every recursive walk meets. */
function subdirs(dir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((n) => n !== 'node_modules' && !n.startsWith('.'))
    .map((n) => join(dir, n))
    .filter((p) => {
      try {
        return statSync(p).isDirectory();
      } catch {
        return false;
      }
    });
}

/**
 * Package folders under a target: the target itself, else its immediate
 * children, else grandchildren (a game root -> Mods/Workshop/<id>). Bounded at
 * depth 2 so pointing this at a whole drive cannot happen by accident.
 */
export function collectPackageDirs(target: string, depth = 2): string[] {
  if (existsSync(join(target, 'Info.json'))) return [target];
  const withInfo = subdirs(target).filter((d) => existsSync(join(d, 'Info.json')));
  if (withInfo.length) return withInfo;
  if (depth > 0) {
    const out: string[] = [];
    for (const child of subdirs(target)) out.push(...collectPackageDirs(child, depth - 1));
    return out;
  }
  return [];
}

/** Nested Info.json inside a scanned package (one level down): a duplicate
 *  PackageName is the "only one will be enabled" trap; any other nested
 *  package will simply never load. */
export function nestedPackageIssues(report: PackageReport): PackageIssue[] {
  const out: PackageIssue[] = [];
  for (const child of subdirs(report.path)) {
    const nestedInfo = join(child, 'Info.json');
    if (!existsSync(nestedInfo)) continue;
    const nested = checkPackageDir(child, nestedInfo);
    const nameOf = (r: PackageReport) => r.packageName ?? '(no PackageName)';
    if (report.packageName && nested.packageName === report.packageName) {
      out.push(
        err(
          `duplicate PackageName "${report.packageName}" declared by both:\n` +
            `      ${report.infoPath}\n      ${nestedInfo}\n` +
            `    only one will be enabled and the order is not guaranteed`
        )
      );
    } else {
      out.push(
        warn(
          `nested package (${nameOf(nested)}) at ${nestedInfo} will not load — ` +
            'the loader reads Info.json directly under the Workshop item folder'
        )
      );
    }
  }
  return out;
}

export interface OverridesFolder {
  name: string;
  kind: 'package-name' | 'workshop-id' | 'unknown';
  parsed: number;
  errors: string[];
}

export interface OverridesReport {
  dir: string;
  folders: OverridesFolder[];
}

/** Walk up from a package folder (itself, parent, grandparent) looking for a
 *  sibling of Mods/: ConfigOverrides, PalModSettings.ini. First hit wins. */
function findNearby(packageDir: string, name: string, isDir: boolean): string | null {
  for (const base of [packageDir, join(packageDir, '..'), join(packageDir, '..', '..')]) {
    const candidate = join(base, name);
    if (existsSync(candidate)) {
      try {
        if (statSync(candidate).isDirectory() === isDir) return candidate;
      } catch {
        // unreadable entry: keep looking
      }
    }
  }
  return null;
}

/** Mods/ConfigOverrides next to the package (covers <game>/Mods/<pkg>,
 *  <game>/Mods/Workshop/<pkg> and <game>/Mods itself). */
export function findOverridesDir(packageDir: string): string | null {
  return findNearby(packageDir, 'ConfigOverrides', true);
}

/** Mods/PalModSettings.ini next to the package, per the official layout. */
export function findPalModSettings(packageDir: string): string | null {
  return findNearby(packageDir, 'PalModSettings.ini', false);
}

export interface PalModSettings {
  /** null = the key is absent (the loader's default is enabled). */
  globalEnabled: boolean | null;
  activeMods: string[];
}

/** The two keys check-package can reason about. Keys are case-insensitive
 *  (UE inis are), values are trimmed, and `;`/`#` comments are stripped —
 *  `ActiveModList=Foo ; disabled` enables "Foo", not that whole string. */
export function parsePalModSettings(text: string): PalModSettings {
  let globalEnabled: boolean | null = null;
  const activeMods: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s*[;#].*$/, '').trim();
    const g = line.match(/^bGlobalEnableMod\s*=\s*(\S+)\s*$/i);
    if (g) globalEnabled = /^true$/i.test(g[1]);
    const a = line.match(/^ActiveModList\s*=\s*(\S.*?)\s*$/i);
    if (a) activeMods.push(a[1]);
  }
  return { globalEnabled, activeMods };
}

/**
 * Scan a ConfigOverrides directory. Folders are keyed by PackageName or the
 * numeric Workshop ID (the deployment convention documented by the
 * docker-palworld-dedicated-server-wine project); anything else gets a note,
 * and every .json/.jsonc file inside must parse.
 */
export function scanOverrides(dir: string, knownKeys: Iterable<string>): OverridesReport {
  const known = [...new Set(knownKeys)].map((k) => k.toLowerCase());
  const report: OverridesReport = { dir, folders: [] };
  for (const child of subdirs(dir)) {
    const name = basename(child);
    // Numeric names are Workshop IDs by convention even when they also match
    // a package's folder name — label the more specific thing. Matching is
    // case-insensitive: Windows paths and the game's own ini matching both are.
    const isNumeric = /^\d+$/.test(name);
    const isKnown = known.includes(name.toLowerCase());
    const folder: OverridesFolder = {
      name,
      kind: isNumeric ? 'workshop-id' : isKnown ? 'package-name' : 'unknown',
      parsed: 0,
      errors: [],
    };
    let files: string[] = [];
    try {
      files = readdirSync(child).filter((f) => {
        const lower = f.toLowerCase();
        return lower.endsWith('.json') || lower.endsWith('.jsonc');
      });
    } catch (e: any) {
      folder.errors.push(`cannot read ${child}: ${e.message}`);
      report.folders.push(folder);
      continue;
    }
    for (const f of files) {
      const full = join(child, f);
      try {
        const { text } = decodeInfoJson(readFileSync(full), f);
        parseJsonc(text, `ConfigOverrides/${name}/${f}`);
        folder.parsed++;
      } catch (e: any) {
        folder.errors.push(e.message);
      }
    }
    report.folders.push(folder);
  }
  return report;
}

/** Why a folder is not a package, so the message names what it actually is. */
export function folderHint(dir: string): string {
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return '';
  }
  const lower = names.map((n) => n.toLowerCase());
  if (lower.includes('mods.txt')) return 'looks like a UE4SS Lua mod (mods.txt)';
  if (names.some((n) => /\.lua$/i.test(n))) return 'looks like a UE4SS Lua mod (.lua scripts)';
  if (lower.some((n) => n === 'ue4ss.dll' || n === 'dwmapi.dll')) return 'looks like a UE4SS install (DLLs)';
  if (names.some((n) => n.toLowerCase().endsWith('.pak'))) return 'looks like loose .pak files';
  if (names.some((n) => /^DT_.*\.jsonc?$/i.test(n))) {
    return 'looks like PalSchema (UE4SS) mod JSON — validate it with palschema-validate instead';
  }
  return '';
}
