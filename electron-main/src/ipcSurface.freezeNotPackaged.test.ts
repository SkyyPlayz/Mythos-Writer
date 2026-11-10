// Guard (#1747 Critic N1): ipcSurface.contract.freeze.json is test data.
//
// ipcSurface.contract.test.ts reads it with fs.readFileSync and nothing else
// may. It must never ship in the app. electron-builder.json packages
// `out/**/*` + `package.json`, so today it is not packaged, but nothing pinned
// that. This file fails when:
//   1. a non-test source under electron-main/src or frontend/src imports,
//      requires or opens the freeze file (a bundler would pull it into out/), or
//   2. electron-builder.json (`files`, `extraResources`, `extraFiles`,
//      `asarUnpack`, root or per platform) would include the freeze file or
//      any electron-main/src source.
//
// Path-only: it never opens the freeze file and never edits any config.

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const REPO_ROOT = path.resolve(SRC_DIR, '..', '..');
const FRONTEND_SRC_DIR = path.join(REPO_ROOT, 'frontend', 'src');
const BUILDER_CONFIG_PATH = path.join(REPO_ROOT, 'electron-builder.json');

const FREEZE_BASENAME = 'ipcSurface.contract.freeze.json';
const FREEZE_REPO_PATH = `electron-main/src/${FREEZE_BASENAME}`;

// ---------------------------------------------------------------------------
// Part 1: no production source references the freeze file
// ---------------------------------------------------------------------------

interface ScannedSource {
  /** posix path relative to the repo root */
  rel: string;
  text: string;
}

const CODE_EXT = /\.(?:[cm]?[jt]sx?)$/;

function isTestSource(rel: string): boolean {
  const base = path.posix.basename(rel);
  return base.includes('.test.') || base.includes('.spec.') || base.includes('.bench.');
}

function walkCode(dir: string, relDir: string, out: ScannedSource[]): void {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = `${relDir}/${ent.name}`;
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules') continue;
      walkCode(abs, rel, out);
      continue;
    }
    if (!ent.isFile() || !CODE_EXT.test(ent.name) || isTestSource(rel)) continue;
    out.push({ rel, text: fs.readFileSync(abs, 'utf8') });
  }
}

function readProductionCode(): ScannedSource[] {
  const out: ScannedSource[] = [];
  walkCode(SRC_DIR, 'electron-main/src', out);
  walkCode(FRONTEND_SRC_DIR, 'frontend/src', out);
  return out;
}

// A quoted string naming the freeze file covers `import x from '…'`,
// `import '…'`, `require('…')`, `import('…')` and `path.join(dir, '…')`.
const FREEZE_STRING_REF = /['"`][^'"`\r\n]*ipcSurface\.contract\.freeze[^'"`\r\n]*['"`]/;

function findFreezeReferences(sources: readonly ScannedSource[]): string[] {
  return sources.filter((s) => FREEZE_STRING_REF.test(s.text)).map((s) => s.rel);
}

// ---------------------------------------------------------------------------
// Part 2: electron-builder config would not ship it
// ---------------------------------------------------------------------------

type BuilderConfig = Record<string, unknown>;

/**
 * Synthetic paths for shapes the tree may not contain today: nested sources
 * and non-code files. The real tree is enumerated on top of these.
 */
const SYNTHETIC_PROBES: readonly string[] = [
  'electron-main/src/data.json',
  'electron-main/src/vault/nested/deep.ts',
];

/** Every file under electron-main/src as a posix repo path. Names only, never contents. */
function listSourceTreePaths(dir: string, relDir: string, out: string[] = []): string[] {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = `${relDir}/${ent.name}`;
    if (ent.isDirectory()) listSourceTreePaths(path.join(dir, ent.name), rel, out);
    else if (ent.isFile()) out.push(rel);
  }
  return out;
}

let sourceProbes: readonly string[] | undefined;

/** The freeze file, every real source file, and the synthetic shapes. Built once. */
function getSourceProbes(): readonly string[] {
  sourceProbes ??= [
    ...new Set([FREEZE_REPO_PATH, ...listSourceTreePaths(SRC_DIR, 'electron-main/src'), ...SYNTHETIC_PROBES]),
  ];
  return sourceProbes;
}

const BUILDER_LIST_KEYS = ['files', 'extraResources', 'extraFiles', 'asarUnpack'] as const;
const BUILDER_PLATFORM_KEYS = ['mac', 'win', 'linux'] as const;

function cleanPattern(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

const globRegExpCache = new Map<string, RegExp>();

function globToRegExp(glob: string): RegExp {
  const cached = globRegExpCache.get(glob);
  if (cached) return cached;
  const compiled = compileGlob(glob);
  globRegExpCache.set(glob, compiled);
  return compiled;
}

function compileGlob(glob: string): RegExp {
  let re = '';
  let braceDepth = 0;
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 2;
        } else {
          re += '.*';
          i += 1;
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if (c === '{') {
      braceDepth++;
      re += '(?:';
    } else if (c === '}' && braceDepth > 0) {
      braceDepth--;
      re += ')';
    } else if (c === ',' && braceDepth > 0) {
      re += '|';
    } else {
      re += c.replace(/[.+^$()|[\]\\{}]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}

/**
 * True when `glob` matches `rel` or any parent directory of it. electron-builder
 * treats a pattern that names a directory as including everything below it, so
 * `electron-main` or `electron-main/*` ship `electron-main/src/**` too. Erring
 * wide is right for a guard.
 */
function globCovers(glob: string, rel: string): boolean {
  const re = globToRegExp(cleanPattern(glob));
  const parts = rel.split('/');
  for (let n = parts.length; n >= 1; n--) {
    if (re.test(parts.slice(0, n).join('/'))) return true;
  }
  return false;
}

/** Ordered include/exclude list. Only `!` patterns means "everything but". */
function listIncludes(patterns: readonly string[], rel: string): boolean {
  let included = !patterns.some((p) => !p.startsWith('!'));
  for (const p of patterns) {
    const negated = p.startsWith('!');
    if (globCovers(negated ? p.slice(1) : p, rel)) included = !negated;
  }
  return included;
}

interface FileSet {
  from?: unknown;
  filter?: unknown;
}

function asStringArray(v: unknown): string[] {
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  return [];
}

function fileSetIncludes(set: FileSet, rel: string): boolean {
  const from = typeof set.from === 'string' ? cleanPattern(set.from) : '';
  let sub = rel;
  if (from !== '' && from !== '.') {
    if (!globCovers(from, rel)) return false;
    sub = rel.startsWith(`${from}/`) ? rel.slice(from.length + 1) : rel;
  }
  const filter = asStringArray(set.filter);
  return filter.length === 0 ? true : listIncludes(filter, sub);
}

/**
 * Whether one electron-builder list (`files`, `extraResources`, …) includes
 * `rel`. electron-builder accepts a single string or FileSet as well as an array.
 */
function entriesInclude(value: unknown, rel: string): boolean {
  if (value === undefined || value === null) return false;
  const entries: unknown[] = Array.isArray(value) ? value : [value];
  const patterns = entries.filter((e): e is string => typeof e === 'string');
  const sets = entries.filter(
    (e): e is FileSet => typeof e === 'object' && e !== null && !Array.isArray(e),
  );
  if (patterns.length > 0 && listIncludes(patterns, rel)) return true;
  return sets.some((s) => fileSetIncludes(s, rel));
}

/** Config locations (root and per platform) whose lists would ship `rel`. */
function shippedBy(config: BuilderConfig, rel: string): string[] {
  const hits: string[] = [];
  for (const key of BUILDER_LIST_KEYS) {
    if (entriesInclude(config[key], rel)) hits.push(key);
  }
  for (const platform of BUILDER_PLATFORM_KEYS) {
    const section = config[platform];
    if (typeof section !== 'object' || section === null) continue;
    for (const key of BUILDER_LIST_KEYS) {
      if (entriesInclude((section as BuilderConfig)[key], rel)) hits.push(`${platform}.${key}`);
    }
  }
  return hits;
}

/** `<location>: <path>` for every source probe the config would ship. */
function findPackagedSources(config: BuilderConfig): string[] {
  const hits: string[] = [];
  for (const probe of getSourceProbes()) {
    for (const where of shippedBy(config, probe)) hits.push(`${where}: ${probe}`);
  }
  return hits;
}

function loadBuilderConfig(): BuilderConfig {
  return JSON.parse(fs.readFileSync(BUILDER_CONFIG_PATH, 'utf8')) as BuilderConfig;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ipcSurface.contract.freeze.json is test-only and never packaged', () => {
  describe('production sources', () => {
    it('no non-test source under electron-main/src or frontend/src references the freeze file', () => {
      const sources = readProductionCode();
      // Not vacuous: the walk must have reached both trees.
      expect(sources.map((s) => s.rel)).toEqual(
        expect.arrayContaining(['electron-main/src/main.ts', 'frontend/src/main.tsx']),
      );
      expect(findFreezeReferences(sources)).toEqual([]);
    });

    it('the freeze file exists and the contract test still reads it', () => {
      // If the file is renamed or the reader moves, this guard goes stale.
      expect(fs.existsSync(path.join(SRC_DIR, FREEZE_BASENAME))).toBe(true);
      const reader = fs.readFileSync(path.join(SRC_DIR, 'ipcSurface.contract.test.ts'), 'utf8');
      expect(FREEZE_STRING_REF.test(reader)).toBe(true);
    });

    it.each([
      ['static import', `import freeze from './${FREEZE_BASENAME}';`],
      ['import with attributes', `import f from "./${FREEZE_BASENAME}" with { type: 'json' };`],
      ['side-effect import', `import '../${FREEZE_BASENAME}';`],
      ['require', `const f = require('./${FREEZE_BASENAME}');`],
      ['dynamic import', `const f = await import(\`./${FREEZE_BASENAME}\`);`],
      ['fs read', `fs.readFileSync(path.join(__dirname, '${FREEZE_BASENAME}'), 'utf8');`],
    ])('detector flags a planted %s', (_label, line) => {
      const planted: ScannedSource = { rel: 'electron-main/src/planted.ts', text: `${line}\n` };
      expect(findFreezeReferences([planted])).toEqual(['electron-main/src/planted.ts']);
    });

    it('detector ignores unrelated sources', () => {
      const clean: ScannedSource = {
        rel: 'frontend/src/clean.ts',
        text: `import x from './ipcSurface';\nconst a = require('./other.json');\n`,
      };
      expect(findFreezeReferences([clean])).toEqual([]);
    });
  });

  describe('electron-builder.json', () => {
    it('would not package the freeze file or any electron-main/src source', () => {
      const config = loadBuilderConfig();
      // Control: the matcher sees what the app really ships. A matcher or
      // schema change that made everything "not shipped" fails here, not silently.
      expect(shippedBy(config, 'out/main/main.js')).toContain('files');
      expect(shippedBy(config, 'package.json')).toContain('files');
      expect(shippedBy(config, 'out/main/main.js')).not.toContain('extraResources');

      expect(findPackagedSources(config)).toEqual([]);
    });

    it('the shipped config keeps `files` to the build output', () => {
      const files = asStringArray(loadBuilderConfig().files);
      expect(files).toEqual(expect.arrayContaining(['out/**/*']));
    });

    const cleanConfig = (): BuilderConfig => structuredClone(loadBuilderConfig());

    it.each([
      ['files: electron-main/src/**', (c: BuilderConfig) => (c.files as unknown[]).push('electron-main/src/**')],
      ['files: electron-main/**/*', (c: BuilderConfig) => (c.files as unknown[]).push('electron-main/**/*')],
      ['files: bare directory electron-main', (c: BuilderConfig) => (c.files as unknown[]).push('electron-main')],
      ['files: **/*', (c: BuilderConfig) => (c.files as unknown[]).push('**/*')],
      ['files: the freeze file itself', (c: BuilderConfig) => (c.files as unknown[]).push(FREEZE_REPO_PATH)],
      ['files: **/*.json', (c: BuilderConfig) => (c.files as unknown[]).push('**/*.json')],
      ['asarUnpack: electron-main/src/**', (c: BuilderConfig) => (c.asarUnpack as unknown[]).push('electron-main/src/**')],
      [
        'extraResources: from electron-main/src',
        (c: BuilderConfig) => (c.extraResources as unknown[]).push({ from: 'electron-main/src', to: 'src' }),
      ],
      [
        'extraResources: from electron-main, filter *.json',
        (c: BuilderConfig) =>
          (c.extraResources as unknown[]).push({ from: 'electron-main', to: 'x', filter: ['**/*.json'] }),
      ],
      [
        'extraResources: from repo root',
        (c: BuilderConfig) => (c.extraResources as unknown[]).push({ from: '.', to: 'root' }),
      ],
      ['extraFiles: electron-main/src/**', (c: BuilderConfig) => { c.extraFiles = ['electron-main/src/**']; }],
      // electron-builder accepts a single string or FileSet, not only an array.
      ['extraFiles: singleton string, the freeze file', (c: BuilderConfig) => { c.extraFiles = FREEZE_REPO_PATH; }],
      ['extraFiles: singleton FileSet from electron-main/src', (c: BuilderConfig) => { c.extraFiles = { from: 'electron-main/src', to: 'src' }; }],
      ['extraResources: singleton string electron-main/src/**', (c: BuilderConfig) => { c.extraResources = 'electron-main/src/**'; }],
      ['extraResources: singleton FileSet from electron-main/src', (c: BuilderConfig) => { c.extraResources = { from: 'electron-main/src', to: 'src' }; }],
      ['files: singleton string electron-main/src/**', (c: BuilderConfig) => { c.files = 'electron-main/src/**'; }],
      ['win.extraFiles: singleton string, the freeze file', (c: BuilderConfig) => { (c.win as BuilderConfig).extraFiles = FREEZE_REPO_PATH; }],
      // File-specific and narrow patterns must hit real source files, not only four probes.
      ['files: one source file, electron-main/src/preload.ts', (c: BuilderConfig) => (c.files as unknown[]).push('electron-main/src/preload.ts')],
      ['files: narrow directory glob, electron-main/src/vault/*.ts', (c: BuilderConfig) => (c.files as unknown[]).push('electron-main/src/vault/*.ts')],
      [
        'extraResources: FileSet from one source file',
        (c: BuilderConfig) => (c.extraResources as unknown[]).push({ from: 'electron-main/src/preload.ts', to: 'p.ts' }),
      ],
      ['win.files: electron-main/src/**', (c: BuilderConfig) => { (c.win as BuilderConfig).files = ['electron-main/src/**']; }],
    ])('detector flags a planted pattern (%s)', (_label, plant) => {
      const config = cleanConfig();
      expect(findPackagedSources(config)).toEqual([]);
      plant(config);
      expect(findPackagedSources(config).length).toBeGreaterThan(0);
    });

    it('detector respects negations and unrelated resource folders', () => {
      const config = cleanConfig();
      (config.files as unknown[]).push('electron-main/**', '!electron-main/src/**');
      expect(findPackagedSources(config)).toEqual([]);

      const resources = cleanConfig();
      (resources.extraResources as unknown[]).push({ from: 'electron-main/resources/more', to: 'more' });
      expect(findPackagedSources(resources)).toEqual([]);
    });
  });
});
