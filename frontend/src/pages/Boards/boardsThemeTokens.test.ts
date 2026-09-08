/**
 * SKY-11449 regression guard — the Boards surface must stay wired to the theme.
 *
 * The bug this encodes: BoardCanvas.css / BoardsTabPanel.css shipped reading
 * `var(--surface-card, #1e2130)`, `var(--accent-guide, #6366f1)` and friends.
 * Those custom properties were never defined in tokens.css and were never
 * stamped by theme/liquidNeonEngine.ts, so every one silently resolved to its
 * hardcoded fallback. CSS has no error for that — the surface just quietly
 * stopped responding to accent colour, glow, glass and blur changes forever.
 *
 * So: resolve every `var(--x)` these two files reference against the two real
 * sources of truth (tokens.css declarations + what the engine actually stamps
 * onto an element at runtime), and fail on anything that resolves to nothing.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyLiquidNeonV2Tokens } from '../../theme/liquidNeonEngine';

const BOARDS_CSS_FILES = ['BoardCanvas.css', 'BoardsTabPanel.css'] as const;

const readBoardsCss = (relPath: string): string => readFileSync(resolve(__dirname, relPath), 'utf8');

/** Strip comments so a token named in prose isn't mistaken for a reference. */
const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Every `--name` declared as a property in the given CSS text. */
function declaredIn(css: string): Set<string> {
  return new Set(Array.from(stripComments(css).matchAll(/(--[\w-]+)\s*:/g), (m) => m[1]));
}

/** Every `--name` read through `var(--name, …)` in the given CSS text. */
function referencedIn(css: string): string[] {
  return Array.from(stripComments(css).matchAll(/var\(\s*(--[\w-]+)/g), (m) => m[1]);
}

/** Custom properties the v2 engine stamps onto :root at runtime. */
function engineStampedTokens(): (name: string) => boolean {
  const el = document.createElement('div');
  applyLiquidNeonV2Tokens(null, 'cosmic.png', el);
  return (name) => el.style.getPropertyValue(name) !== '';
}

const tokensCssDeclared = declaredIn(readFileSync(resolve(__dirname, '../../tokens.css'), 'utf8'));

describe('SKY-11449 — Boards surface is wired to the Liquid Neon theme engine', () => {
  it.each(BOARDS_CSS_FILES)('%s references no undefined custom properties', (relPath) => {
    const css = readBoardsCss(relPath);
    const isEngineStamped = engineStampedTokens();
    const localDeclared = declaredIn(css);

    const orphans = [...new Set(referencedIn(css))].filter(
      (name) => !tokensCssDeclared.has(name) && !localDeclared.has(name) && !isEngineStamped(name),
    );

    expect(
      orphans,
      `${relPath} reads custom propert${orphans.length === 1 ? 'y' : 'ies'} that nothing defines: `
        + `${orphans.join(', ')}. Each one silently resolves to its var() fallback, which means this `
        + 'surface will not repaint when the theme changes. Use a token from tokens.css or one the '
        + 'engine stamps (--n1..--n6, --b1..--b6, --g1..--g6, --gs1..--gs6, --glass-fill*, --blur-panel*).',
    ).toEqual([]);
  });

  it('colours cards and rims from the accent slots, not a fixed palette', () => {
    const canvas = stripComments(readBoardsCss('BoardCanvas.css'));

    // Notes take slot 1, boards take slot 2 — the mockup colours cards by category.
    expect(canvas).toMatch(/--board-item-n:\s*var\(--n1/);
    expect(canvas).toMatch(/\.board-canvas__item--folder\s*\{[^}]*--board-item-n:\s*var\(--n2/);
    // Card fill is the engine's live glass, not a flat grey.
    expect(canvas).toMatch(/background:\s*var\(--glass2/);
    // The indigo that was never in the neon palette is gone for good.
    expect(canvas).not.toMatch(/#6366f1/i);
  });

  it('blurs the floating toolbar off the engine blur, not a hardcoded value', () => {
    // Drop `@supports (backdrop-filter: blur(1px))` conditions — that literal is
    // a feature probe, not a painted value.
    const canvas = stripComments(readBoardsCss('BoardCanvas.css')).replace(/@supports[^{]*/g, '');
    expect(canvas).toMatch(/backdrop-filter:\s*blur\(var\(--blur-panel-overlay/);
    expect(canvas).not.toMatch(/backdrop-filter:\s*blur\(\d/);
  });
});
