// Part H design-system ratchet — these files were migrated off bare hex colors
// onto Liquid Neon tokens (tokens.css) and must stay hex-free. Colors belong in
// tokens (or local custom properties derived from tokens); var(--x, #hex)
// fallbacks are allowed because the token wins at runtime. Scoped to EXACTLY
// these files so unrelated changes elsewhere never trip this test.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const srcDir = __dirname;

const AUDITED_FILES = [
  'ProgressDashboard.css',
  'BottomBar.css',
  'SuggestionReview.css',
  'components/ContinuityPanel/ContinuityPanel.css',
  'UpdateBanner.css',
  'SuggestionDetailPane.css',
  'WorkspaceTabBar.css',
] as const;

/** Replace a matched span with spaces, preserving newlines so reported line
 *  numbers still point into the real file. */
const blank = (match: string): string => match.replace(/[^\n]/g, ' ');

function stripNonAuthoritativeColorText(css: string): string {
  // Comments — a hex inside a comment is documentation, not a rendered color.
  let out = css.replace(/\/\*[\s\S]*?\*\//g, blank);
  // var() fallbacks — var(--token, #hex) resolves to the token at runtime; the
  // literal only fires if tokens.css failed to load entirely. The pattern
  // allows one nesting level for fallbacks like var(--a, rgba(0, 0, 0, 0.5)).
  out = out.replace(/var\([^()]*(?:\([^()]*\)[^()]*)*\)/g, blank);
  return out;
}

const BARE_HEX = /#[0-9a-fA-F]{3,8}\b/;

describe('design-token ratchet — no bare hex colors (roadmap Part H)', () => {
  it.each(AUDITED_FILES)('%s has no bare hex literals outside var() fallbacks', (relPath) => {
    const css = readFileSync(resolve(srcDir, relPath), 'utf8');
    const originalLines = css.split('\n');
    const offending = stripNonAuthoritativeColorText(css)
      .split('\n')
      .flatMap((line, i) => (BARE_HEX.test(line) ? [`  ${relPath}:${i + 1}: ${originalLines[i].trim()}`] : []));

    expect(
      offending,
      'Bare hex color literal(s) found. Use a tokens.css variable, or a local '
        + 'custom property derived from tokens (see the heatmap scale in '
        + `ProgressDashboard.css for the data-viz pattern):\n${offending.join('\n')}`,
    ).toEqual([]);
  });
});
