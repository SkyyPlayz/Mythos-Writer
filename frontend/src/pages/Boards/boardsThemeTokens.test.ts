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
 * The "nothing defines it" half of that check now runs repo-wide, over every
 * stylesheet under frontend/src, in theme/themeTokenCoverage.test.ts (SKY-11482)
 * — so it is not repeated here. What stays here is the part that check cannot
 * know: which *specific* tokens the Boards mockup calls for.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const readBoardsCss = (relPath: string): string => readFileSync(resolve(__dirname, relPath), 'utf8');

/** Strip comments so a token named in prose isn't mistaken for a reference. */
const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('SKY-11449 — Boards surface is wired to the Liquid Neon theme engine', () => {
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
