/**
 * CSS contract: F1#13 toolbar height + F1#10 dropcap gate live in ManuscriptView.css.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(__dirname, './ManuscriptView.css'), 'utf8');

describe('F1 ManuscriptView.css gate contracts', () => {
  it('F1#13 sets height (not only min-height) to --panel-top-bar-height / 36px', () => {
    expect(css).toMatch(/\.msv-toolbar\s*\{[^}]*height:\s*var\(--panel-top-bar-height,\s*36px\)/s);
    expect(css).toMatch(/\.msv-toolbar\s*\{[^}]*max-height:\s*var\(--panel-top-bar-height,\s*36px\)/s);
    expect(css).toMatch(/\.msv-toolbar\s*\{[^}]*padding:\s*4px\s+8px/s);
  });

  it('F1#10 gates BlockEditor chromeless dropcap from msv-root', () => {
    expect(css).toMatch(
      /\.msv-root:not\(\.msv-root--dropcap\)\s+\.block-editor--chromeless[\s\S]*::first-letter/,
    );
  });

  it('H4: BoardsTabPanel has no z-index literal on nav resize (checked via Boards CSS import path)', () => {
    const boardsCss = readFileSync(
      resolve(__dirname, '../pages/Boards/BoardsTabPanel.css'),
      'utf8',
    );
    const resizeBlock = boardsCss.match(/\.boards-tab-panel__left-nav-resize\s*\{[^}]+\}/);
    expect(resizeBlock?.[0] ?? '').not.toMatch(/z-index\s*:/);
  });
});
