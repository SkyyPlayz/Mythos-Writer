// Blindness gate: nothing under factLedger/extract/ may reach db.ts or
// ledgerDb.ts through a value import, a re-export, a side-effect import, a
// dynamic import() or require(), directly or transitively. Type-only imports
// are erased at build time and do not count. The eslint zone in
// electron-main/eslint.config.js covers static imports; this test also covers
// dynamic ones and the whole import graph.
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../..');
const PKG = path.resolve(SRC, '..');
const SHARED = path.resolve(PKG, '../shared');
const FACT_LEDGER = path.resolve(SRC, 'factLedger');
const BLOCKED = new Set(['db.ts', 'ledgerDb.ts']);
const NON_LITERAL = '<non-literal>';

type Reader = (file: string) => string | null;

const diskReader: Reader = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null);

/** Runtime import specifiers of one module. Type-only imports and exports are skipped. */
function valueImports(source: string, fileName = 'x.ts'): string[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out: string[] = [];
  const literal = (node: ts.Node | undefined): string =>
    node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : NON_LITERAL;

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      const named = clause?.namedBindings;
      const allTypeNamed =
        !!clause &&
        !clause.name &&
        !!named &&
        ts.isNamedImports(named) &&
        named.elements.length > 0 &&
        named.elements.every((el) => el.isTypeOnly);
      if (!clause?.isTypeOnly && !allTypeNamed) out.push(literal(node.moduleSpecifier));
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      const named = node.exportClause;
      const allTypeNamed =
        !!named && ts.isNamedExports(named) && named.elements.length > 0 && named.elements.every((el) => el.isTypeOnly);
      if (!node.isTypeOnly && !allTypeNamed) out.push(literal(node.moduleSpecifier));
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      if (!node.isTypeOnly) out.push(literal(node.moduleReference.expression));
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isDynamicImport = callee.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(callee) && callee.text === 'require';
      if (isDynamicImport || isRequire) out.push(literal(node.arguments[0]));
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

function resolveSpecifier(from: string, spec: string, read: Reader): string | null {
  let base: string | null = null;
  if (spec.startsWith('.')) base = path.resolve(path.dirname(from), spec);
  else if (spec.startsWith('@mythos-writer/shared/')) base = path.join(SHARED, spec.slice('@mythos-writer/shared/'.length));
  if (base === null) return null;
  const stem = base.replace(/\.(js|ts|mjs|cjs)$/, '');
  for (const candidate of [`${stem}.ts`, base, path.join(base, 'index.ts')]) {
    if (read(candidate) !== null) return candidate;
  }
  // Unresolvable local import: keep the path so a blocked basename still shows.
  return `${stem}.ts`;
}

interface Walk {
  /** Every reached module, with the import chain that reached it. */
  reached: Map<string, string[]>;
  nonLiteral: string[];
}

function walkImports(entries: string[], read: Reader = diskReader): Walk {
  const reached = new Map<string, string[]>();
  const nonLiteral: string[] = [];
  const queue: Array<[string, string[]]> = entries.map((e) => [e, [e]]);
  while (queue.length > 0) {
    const [file, chain] = queue.shift()!;
    if (reached.has(file)) continue;
    reached.set(file, chain);
    const source = read(file);
    if (source === null) continue;
    for (const spec of valueImports(source, file)) {
      if (spec === NON_LITERAL) {
        nonLiteral.push(file);
        continue;
      }
      const target = resolveSpecifier(file, spec, read);
      if (target && !reached.has(target)) queue.push([target, [...chain, target]]);
    }
  }
  return { reached, nonLiteral };
}

/** Repo-style path relative to src/, with forward slashes on every platform. */
function relToSrc(file: string): string {
  return path.relative(SRC, file).split(path.sep).join('/');
}

function blockedChains(walk: Walk): string[] {
  return [...walk.reached.entries()]
    .filter(([file]) => BLOCKED.has(path.basename(file)))
    .map(([, chain]) => chain.map(relToSrc).join(' -> '));
}

function productionFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...productionFiles(full));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

describe('extract/ blindness', () => {
  const extractFiles = productionFiles(HERE);

  it('covers every extract module', () => {
    const names = extractFiles.map((f) => path.basename(f)).sort();
    expect(names).toEqual(
      expect.arrayContaining(['cdmExtractor.ts', 'localExtractor.ts', 'scriptExtractor.ts', 'types.ts', 'validateOutput.ts']),
    );
  });

  it('db.ts and ledgerDb.ts are not reachable from extract/ (static and dynamic imports)', () => {
    const walk = walkImports(extractFiles);
    expect(walk.reached.size).toBeGreaterThan(extractFiles.length);
    expect(blockedChains(walk)).toEqual([]);
  });

  it('factLedger modules have no non-literal dynamic import or require', () => {
    const walk = walkImports(productionFiles(FACT_LEDGER));
    const local = walk.nonLiteral.filter((f) => f.startsWith(FACT_LEDGER + path.sep));
    expect(local.map(relToSrc)).toEqual([]);
  });

  it('extract test files do not import the DB either', () => {
    const tests = fs
      .readdirSync(HERE)
      .filter((n) => n.endsWith('.test.ts') && n !== 'blindness.test.ts')
      .map((n) => path.join(HERE, n));
    expect(blockedChains(walkImports(tests))).toEqual([]);
  });
});

describe('the walker catches a planted DB import (mutant: value import of db or ledgerDb)', () => {
  const root = path.join(SRC, 'factLedger', 'extract');
  const fake = (files: Record<string, string>): Reader => (file) => files[file] ?? null;
  const entry = path.join(root, 'planted.ts');
  const db = path.join(SRC, 'db.ts');
  const ledgerDb = path.join(SRC, 'factLedger', 'ledgerDb.ts');

  it.each([
    ['a named value import', "import { openDb } from '../../db.js';"],
    ['a default import', "import db from '../../db.js';"],
    ['a namespace import', "import * as db from '../../db';"],
    ['a side-effect import', "import '../../db.js';"],
    ['a re-export', "export { openDb } from '../../db.js';"],
    ['a star re-export', "export * from '../ledgerDb.js';"],
    ['a dynamic import', "export async function f() { return import('../ledgerDb.js'); }"],
    ['a require', "const db = require('../../db.js');"],
    ['an import-equals', "import db = require('../../db.js');"],
    ['a mixed type and value import', "import { type Row, openDb } from '../../db.js';"],
  ])('%s is caught', (_label, source) => {
    const walk = walkImports([entry], fake({ [entry]: source, [db]: '', [ledgerDb]: '' }));
    expect(blockedChains(walk)).toHaveLength(1);
  });

  it('a transitive import through another module is caught', () => {
    const mid = path.join(SRC, 'factLedger', 'helper.ts');
    const walk = walkImports(
      [entry],
      fake({ [entry]: "import { h } from '../helper.js';", [mid]: "export const h = () => import('./ledgerDb.js');", [ledgerDb]: '' }),
    );
    expect(blockedChains(walk)).toEqual(['factLedger/extract/planted.ts -> factLedger/helper.ts -> factLedger/ledgerDb.ts']);
  });

  it.each([
    ['import type', "import type { DbSuggestion } from '../../db.js';"],
    ['all-type named imports', "import { type DbSuggestion, type DbRow } from '../../db.js';"],
    ['export type', "export type { DbSuggestion } from '../../db.js';"],
  ])('%s is erased and not counted', (_label, source) => {
    const walk = walkImports([entry], fake({ [entry]: source, [db]: '' }));
    expect(blockedChains(walk)).toEqual([]);
  });

  it('records a non-literal dynamic import', () => {
    const walk = walkImports([entry], fake({ [entry]: "const name = '../../db.js'; void import(name);" }));
    expect(walk.nonLiteral).toEqual([entry]);
  });
});

describe('quoteCheck is pure', () => {
  it('imports nothing at all (no fs, DB or hashing)', () => {
    const src = fs.readFileSync(path.join(FACT_LEDGER, 'quoteCheck.ts'), 'utf8');
    expect(valueImports(src)).toEqual([]);
    expect(src).not.toMatch(/\bimport\b/);
    expect(src).not.toMatch(/\brequire\s*\(/);
  });
});

describe('factLedger modules import no fs, Electron or database driver directly', () => {
  it.each(productionFiles(FACT_LEDGER).map((f) => [relToSrc(f), f]))('%s', (_rel, file) => {
    const specs = valueImports(fs.readFileSync(file, 'utf8'), file);
    const banned = specs.filter((s) =>
      /^(node:)?(fs|fs\/promises|child_process|net|http|https)$|^electron$|sqlite/.test(s),
    );
    expect(banned).toEqual([]);
  });
});

describe('eslint zone (tighten only)', () => {
  it('blocks db and ledgerDb under factLedger/extract and keeps the test-hook rule', async () => {
    const config = (await import(pathToFileURL(path.join(PKG, 'eslint.config.js')).href)).default as Array<{
      files?: string[];
      ignores?: string[];
      rules?: Record<string, unknown>;
    }>;
    const groups = (entry: (typeof config)[number]): string[] => {
      const rule = entry.rules?.['no-restricted-imports'] as [string, { patterns: Array<{ group: string[] }> }];
      return rule[1].patterns.flatMap((p) => p.group);
    };
    const base = config.find((c) => c.files?.includes('src/**/*.ts'));
    expect(base).toBeDefined();
    expect(groups(base!)).toEqual(expect.arrayContaining(['**/noFollowWrite.testing']));

    const zone = config.find((c) => c.files?.includes('src/factLedger/extract/**/*.ts'));
    expect(zone).toBeDefined();
    expect((zone!.rules!['no-restricted-imports'] as unknown[])[0]).toBe('error');
    expect(groups(zone!)).toEqual(
      expect.arrayContaining(['**/db', '**/db.js', '**/ledgerDb', '**/ledgerDb.js', '**/noFollowWrite.testing']),
    );
  });
});
