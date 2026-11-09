// safeVaultJoin containment boundary — killing tests (FOLLOWUPS SECURITY-REQUIRED, #1744 scope).
//
// Owns: the `<root>-evil` sibling boundary and the final lexical containment
// re-check. Each case asserts the full refusal message. The mutant block below
// rebuilds safeVaultJoin from its real source with one fault injected and
// requires a named case to go red on it:
//   - the lexical re-check's `startsWith(root + sep)` weakened to `startsWith(root)`
//   - isResolvedPathInsideRoot's `startsWith(r + sep)` weakened to `startsWith(r)`
//   - the final lexical containment re-check removed
// A control copy built from the unmutated source must pass every case, so the
// harness itself cannot fake a kill. A kill is only a probe the mutant let
// through: a non-denial throw (fixture or harness error) fails the test.
// Never touches: safeVaultJoin.ts (tests only).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import ts from 'typescript';
import * as noFollowOpen from './noFollowOpen.js';
import { isResolvedPathInsideRoot, safeVaultJoin } from './safeVaultJoin.js';

type Join = typeof safeVaultJoin;
type InsideRoot = typeof isResolvedPathInsideRoot;
interface Impl {
  safeVaultJoin: Join;
  isResolvedPathInsideRoot: InsideRoot;
}

const SOURCE_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'safeVaultJoin.ts');

let base: string;
let root: string;

beforeEach(() => {
  // `root` sits inside a fresh parent so `<root>-evil` and `outside` are
  // siblings this test fully controls (nothing else can create them).
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-svj-boundary-'));
  root = path.join(base, 'vault');
  fs.mkdirSync(root);
});

afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

/** Re-create an empty fixture: `root` inside a fresh `base`, no siblings. */
function resetFixture(): void {
  fs.rmSync(base, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
}

/**
 * What a probe saw. `denied` only for a genuine safeVaultJoin refusal: any
 * other throw (fixture, harness, TypeError) is rethrown by `attempt`, so it
 * fails the test and can never be counted as a mutant kill.
 */
type Outcome = { denied: true; message: string } | { denied: false; value: unknown };

const DENIAL_PREFIX = 'Path traversal denied: ';

function attempt(call: () => unknown): Outcome {
  try {
    return { denied: false, value: call() };
  } catch (err) {
    if (err instanceof Error && err.message.startsWith(DENIAL_PREFIX)) {
      return { denied: true, message: err.message };
    }
    throw err;
  }
}

const SIBLING = 'vault-evil';

interface KillCase {
  name: string;
  /** Builds this case's fixture. A throw here is a harness error, never a kill. */
  setup?: () => void;
  /** The one guarded call. The real module must deny it with `expected`. */
  probe: (impl: Impl) => Outcome;
  /** Full refusal message, `Path traversal denied:` prefix included. */
  expected: () => string;
  /** Extra real-module checks (side effects, the allowed half of a helper). */
  after?: (impl: Impl) => void;
}

const CASES: Record<string, KillCase> = {
  siblingMissingRead: {
    name: 'read of a not-yet-existing path in sibling <root>-evil is denied by the lexical check',
    setup: () => expect(fs.existsSync(path.join(base, SIBLING))).toBe(false),
    probe: ({ safeVaultJoin: join }) => attempt(() => join(root, `../${SIBLING}/x/y.md`)),
    expected: () => `${DENIAL_PREFIX}../${SIBLING}/x/y.md`,
  },
  outsideMissingRead: {
    name: 'read of a not-yet-existing path outside the root is denied by the final re-check',
    setup: () => expect(fs.existsSync(path.join(base, 'outside'))).toBe(false),
    probe: ({ safeVaultJoin: join }) => attempt(() => join(root, '../outside/deep/y.md')),
    expected: () => `${DENIAL_PREFIX}../outside/deep/y.md`,
  },
  siblingExistingWrite: {
    name: 'write into an existing sibling <root>-evil directory is denied',
    setup: () => fs.mkdirSync(path.join(base, SIBLING), { recursive: true }),
    probe: ({ safeVaultJoin: join }) => attempt(() => join(root, `../${SIBLING}/new.md`, { writeMode: true })),
    expected: () => `${DENIAL_PREFIX}../${SIBLING}/new.md (parent symlink escapes vault)`,
    after: () => expect(fs.existsSync(path.join(base, SIBLING, 'new.md'))).toBe(false),
  },
  siblingExistingRead: {
    name: 'read of an existing file in sibling <root>-evil is denied',
    setup: () => {
      fs.mkdirSync(path.join(base, SIBLING), { recursive: true });
      fs.writeFileSync(path.join(base, SIBLING, 'secret.md'), 'secret');
    },
    probe: ({ safeVaultJoin: join }) => attempt(() => join(root, `../${SIBLING}/secret.md`)),
    expected: () => `${DENIAL_PREFIX}../${SIBLING}/secret.md (symlink escape detected)`,
  },
  insideRootHelper: {
    name: 'isResolvedPathInsideRoot rejects the <root>-evil prefix sibling',
    // The helper returns a boolean: `false` for the sibling is its refusal.
    probe: ({ isResolvedPathInsideRoot: inside }) => {
      const sibling = path.join(base, SIBLING, 'a.md');
      return inside(root, sibling)
        ? { denied: false, value: true }
        : { denied: true, message: `outside root: ${sibling}` };
    },
    expected: () => `outside root: ${path.join(base, SIBLING, 'a.md')}`,
    after: ({ isResolvedPathInsideRoot: inside }) => {
      expect(inside(root, path.join(base, SIBLING))).toBe(false);
      expect(inside(root, root)).toBe(true);
      expect(inside(root, path.join(root, 'a.md'))).toBe(true);
    },
  },
};

/** Real and control runs: the probe must be the expected denial, in full. */
function expectCaseDenied(c: KillCase, impl: Impl): void {
  c.setup?.();
  expect(c.probe(impl), c.name).toEqual({ denied: true, message: c.expected() });
  c.after?.(impl);
}

describe('safeVaultJoin — <root>-evil sibling boundary (real module)', () => {
  const real: Impl = { safeVaultJoin, isResolvedPathInsideRoot };
  for (const c of Object.values(CASES)) {
    it(c.name, () => expectCaseDenied(c, real));
  }

  it('still allows nested reads and writes inside the root (no over-blocking)', () => {
    expect(safeVaultJoin(root, 'a/b/c.md')).toBe(path.join(root, 'a', 'b', 'c.md'));
    const written = safeVaultJoin(root, 'a/b/c.md', { writeMode: true });
    expect(written.endsWith(path.join('vault', 'a', 'b', 'c.md'))).toBe(true);
  });
});

// ── Self-checking mutants ───────────────────────────────────────────────────

/**
 * Build safeVaultJoin from its real source, after `mutate`. Transpiled in
 * memory and wired to the real `fs`, `path` and `noFollowOpen` modules, so no
 * file is written and imports resolve the same on every platform.
 */
function buildImpl(mutate: (src: string) => string): Impl {
  const src = mutate(fs.readFileSync(SOURCE_PATH, 'utf8'));
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  });
  const deps: Record<string, unknown> = { fs, path, './noFollowOpen.js': noFollowOpen };
  const fakeRequire = (id: string): unknown => {
    if (!(id in deps)) throw new Error(`mutant harness: unexpected import "${id}" — add it to deps`);
    return deps[id];
  };
  const mod: { exports: Record<string, unknown> } = { exports: {} };
  new Function('require', 'exports', 'module', outputText)(fakeRequire, mod.exports, mod);
  return mod.exports as unknown as Impl;
}

/** Replace `find` exactly once; fail loudly if the source drifted so the mutant would be a no-op. */
function replaceOnce(src: string, find: string, replacement: string): string {
  const first = src.indexOf(find);
  expect(first, `mutant target not found in safeVaultJoin.ts — update this test: ${find}`).toBeGreaterThan(-1);
  expect(src.indexOf(find, first + 1), `mutant target is not unique in safeVaultJoin.ts: ${find}`).toBe(-1);
  return src.slice(0, first) + replacement + src.slice(first + find.length);
}

const LEXICAL_CHECK = '!lexicalResolved.startsWith(lexicalRoot + path.sep)';
const HELPER_CHECK = 'c.startsWith(r + path.sep)';
const FINAL_RECHECK = [
  '  if (!lexicalResolved.startsWith(lexicalRoot + path.sep) && lexicalResolved !== lexicalRoot) {',
  '    throw new Error(`Path traversal denied: ${relPath}`);',
  '  }',
].join('\n');

const MUTANTS: Array<{ name: string; mutate: (src: string) => string; killedBy: Array<keyof typeof CASES> }> = [
  {
    name: 'lexical re-check startsWith(root + sep) → startsWith(root)',
    mutate: (s) => replaceOnce(s, LEXICAL_CHECK, '!lexicalResolved.startsWith(lexicalRoot)'),
    killedBy: ['siblingMissingRead'],
  },
  {
    name: 'isResolvedPathInsideRoot startsWith(r + sep) → startsWith(r)',
    mutate: (s) => replaceOnce(s, HELPER_CHECK, 'c.startsWith(r)'),
    killedBy: ['insideRootHelper', 'siblingExistingWrite', 'siblingExistingRead'],
  },
  {
    name: 'final lexical containment re-check removed',
    mutate: (s) => replaceOnce(s.replace(/\r\n/g, '\n'), FINAL_RECHECK, ''),
    killedBy: ['outsideMissingRead', 'siblingMissingRead'],
  },
];

describe('safeVaultJoin — boundary mutants go red', () => {
  it('control: the unmutated source built by the harness passes every case', () => {
    const control = buildImpl((s) => s);
    for (const c of Object.values(CASES)) {
      // Fresh fixture per case, so the control does not depend on CASES order.
      resetFixture();
      expectCaseDenied(c, control);
    }
  });

  for (const m of MUTANTS) {
    it(`mutant "${m.name}" is killed`, () => {
      const impl = buildImpl(m.mutate);
      for (const key of m.killedBy) {
        const c = CASES[key];
        resetFixture();
        // Setup and probe errors propagate (attempt rethrows non-denials), so
        // only a mutant that let the guarded path through counts as a kill.
        c.setup?.();
        const outcome = c.probe(impl);
        expect(
          outcome.denied,
          `mutant "${m.name}" survives case "${c.name}": ${JSON.stringify(outcome)}`,
        ).toBe(false);
      }
    });
  }
});
