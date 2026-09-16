/**
 * SKY-11718 — repo-wide guard: no two source files may collide on a
 * case-insensitive filesystem.
 *
 * The bug class: SKY-11191 landed `BoardMinimap.tsx` (the React component,
 * default export) next to `boardMinimap.ts` (the pure geometry helpers, named
 * exports only). Linux and macOS CI both build it, because their filesystems
 * are case-sensitive and `./BoardMinimap` and `./boardMinimap` are two
 * different modules there. On the `windows-latest` runner — and on the
 * owner's own machine — the two specifiers collapse onto one entry, the
 * bundler resolves the component's import to the helpers, and the production
 * build dies with `"default" is not exported by ... boardMinimap.ts`.
 *
 * That failure is invisible to every job except the Windows one, which is the
 * last to run, so the break reached main. This makes it a unit-test failure
 * on the machine the author is already sitting at.
 *
 * ## The rule
 *
 * Inside one directory, no two entries may be equal once case is discarded:
 *
 *   - for a module, compare the name WITHOUT its extension. `Foo.ts` and
 *     `foo.tsx` never coexist safely: an extensionless `./Foo` picks whichever
 *     extension the resolver tries first, and that order is not ours to
 *     control. This is the case that actually broke, and a plain filename
 *     comparison would have missed it.
 *   - for anything else (`.css`, `.json`, a fixture), compare the full name.
 *   - directories compare by full name, since a colliding segment breaks every
 *     path underneath it.
 *
 * There is no baseline. The tree is clean, git cannot even check out a
 * colliding pair on Windows, and the fix is always a rename.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '../..');

/** Directories swept, relative to the repo root. */
const ROOTS = ['frontend/src', 'electron-main/src', 'e2e'] as const;

/** Extensions a bare `./specifier` may resolve to, so the extension is not part of the identity. */
const MODULE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

/** `'Foo.test.tsx'` → `'Foo.test'`; `'tokens.css'` → `'tokens.css'`. */
function identity(fileName: string): string {
  const ext = MODULE_EXTENSIONS.find((e) => fileName.endsWith(e));
  return (ext ? fileName.slice(0, -ext.length) : fileName).toLowerCase();
}

/** Every collision under `dir`, as a human-readable line each. */
function collisionsUnder(dir: string): string[] {
  const found: string[] = [];
  const entries = readdirSync(resolve(REPO_ROOT, dir), { withFileTypes: true });
  const byKey = new Map<string, string[]>();

  for (const entry of entries) {
    if (entry.name === 'node_modules') continue;
    const key = entry.isDirectory() ? `dir:${entry.name.toLowerCase()}` : `mod:${identity(entry.name)}`;
    const bucket = byKey.get(key);
    if (bucket) bucket.push(entry.name);
    else byKey.set(key, [entry.name]);
  }

  for (const names of byKey.values()) {
    if (names.length > 1) found.push(`${dir}/  →  ${[...names].sort().join('  vs  ')}`);
  }
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name !== 'node_modules') {
      found.push(...collisionsUnder(`${dir}/${entry.name}`));
    }
  }
  return found;
}

describe('module case collisions (SKY-11718)', () => {
  it('no two source entries differ only by case', () => {
    const collisions = ROOTS.flatMap(collisionsUnder);
    expect(
      collisions,
      collisions.length === 0
        ? ''
        : `These entries are one file on Windows and on macOS's default filesystem, so the\n` +
          `production build resolves the wrong module there. Rename one side — give the\n` +
          `component and its helpers distinct names, as boardLinks.ts / BoardLinkOverlay.tsx\n` +
          `already do:\n\n  ${collisions.join('\n  ')}\n`,
    ).toEqual([]);
  });
});
