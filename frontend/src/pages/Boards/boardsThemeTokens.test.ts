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
 * — so it is not repeated here. That sweep already resolves names a component
 * writes with `style.setProperty`, which is how SKY-11494 drives the dot grid.
 * What stays here is the part that sweep cannot know: which *specific* tokens
 * the Boards mockup calls for.
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
    // Every rim/glow alpha in the state ladder is mixed off that slot hex, so
    // the accent still drives the surface even though the tile FILL no longer
    // does (SKY-11494 BD-3 — the fill is the mockup's fixed legibility plate).
    for (const local of [
      '--board-item-rim-hover',
      '--board-item-rim-selected',
      '--board-item-halo-selected',
      '--board-item-glow-hover',
      '--board-item-glow-selected',
    ]) {
      expect(canvas).toMatch(new RegExp(`${local}:\\s*color-mix\\(in srgb, var\\(--board-item-n\\)`));
    }
    // The indigo that was never in the neon palette is gone for good.
    expect(canvas).not.toMatch(/#6366f1/i);
  });

  /**
   * SKY-11494 — the three named owner-fidelity gaps (BD-1/BD-2/BD-3), pinned to
   * the mockup's own values (`bdCanvasSt` script 8151, `bdCards` script 8062)
   * so a later refactor cannot quietly walk them back the way #1466 did.
   */
  describe('SKY-11494 — Boards canvas matches the owner mockup', () => {
    const canvas = () => stripComments(readBoardsCss('BoardCanvas.css'));

    it('BD-1: the canvas is a 42% scrim with a neutral hairline, not an opaque slab', () => {
      expect(canvas()).toMatch(/--board-canvas-fill:\s*rgb\(8 10 18 \/ 0\.42\)/);
      expect(canvas()).toMatch(/\.board-canvas__root\s*\{[^}]*border:[^;]*solid rgb\(255 255 255 \/ 0\.07\)/);
      // The mockup gives this container no glow: the neon here is on the cards.
      expect(canvas()).not.toMatch(/\.board-canvas__root\s*\{[^}]*box-shadow/);
    });

    it('BD-2: the dot grid is driven by the pan/zoom custom properties', () => {
      expect(canvas()).toMatch(/background-size:\s*var\(--board-grid-size/);
      expect(canvas()).toMatch(/background-position:\s*var\(--board-grid-x[^;]*var\(--board-grid-y/);
      // A literal size would be a grid that ignores zoom — the BD-2 regression.
      expect(canvas()).not.toMatch(/background-size:\s*\d/);
    });

    it('BD-3: rest wears a neutral hairline; the slot rim is reserved for selection', () => {
      expect(canvas()).toMatch(/--board-item-rim-rest:\s*rgb\(255 255 255 \/ 0\.1\)/);
      expect(canvas()).toMatch(
        /\.board-canvas__item\s*\{[^}]*box-shadow:\s*0 8px 22px rgb\(3 5 12 \/ 0\.45\)/,
      );
      expect(canvas()).toMatch(
        /\.board-canvas__item--selected\s*\{[^}]*border-color:\s*var\(--board-item-rim-selected\)/,
      );
      // Hover must not paint over the stronger selected rim.
      expect(canvas()).toMatch(/\.board-canvas__item:hover:not\(\.board-canvas__item--selected\)/);
    });
  });

  it('blurs the floating toolbar off the engine blur, not a hardcoded value', () => {
    // Drop `@supports (backdrop-filter: blur(1px))` conditions — that literal is
    // a feature probe, not a painted value.
    const canvas = stripComments(readBoardsCss('BoardCanvas.css')).replace(/@supports[^{]*/g, '');
    expect(canvas).toMatch(/backdrop-filter:\s*blur\(var\(--blur-panel-overlay/);
    expect(canvas).not.toMatch(/backdrop-filter:\s*blur\(\d/);
  });
});
