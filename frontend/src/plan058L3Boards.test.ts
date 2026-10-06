/**
 * PLAN-058 L3 — red-on-revert pins for Boards canvas chrome.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BOARD_CANVAS_TOOLS, BOARD_ACCENT_PALETTE } from './pages/Boards/boardTools';
import { FURNITURE_SEEDS } from './pages/Boards/BoardsTabPanel';

describe('PLAN-058 L3 boards pins', () => {
  it('ships pan + select tools with icons (75:08)', () => {
    const ids = BOARD_CANVAS_TOOLS.map((t) => t.id);
    expect(ids).toContain('pan');
    expect(ids).toContain('select');
    expect(ids).toContain('line');
    for (const tool of BOARD_CANVAS_TOOLS) {
      expect(tool.icon).toBeTruthy();
      expect(tool.label.length).toBeGreaterThan(0);
    }
  });

  it('to-do furniture starts blank (78:02 / 78:12)', () => {
    expect(FURNITURE_SEEDS.check.items).toEqual([]);
  });

  it('exposes accent palette for colour switch (72:28)', () => {
    expect(BOARD_ACCENT_PALETTE.length).toBeGreaterThanOrEqual(4);
  });

  it('loads Store B colours in useVaultBoard (72:28)', () => {
    const src = readFileSync(resolve(__dirname, 'pages/Boards/useVaultBoard.ts'), 'utf8');
    expect(src).toContain('itemColorsByPath');
    expect(src).toContain('meta.colors');
    expect(src).toContain('notesBoardPatchColors');
  });

  it('vertical tool rail + full-width furniture toolbar (FD-7 / 72:16)', () => {
    const css = readFileSync(resolve(__dirname, 'pages/Boards/BoardsTabPanel.css'), 'utf8');
    expect(css).toContain('boards-tab-panel__tool-rail');
    expect(css).toContain('boards-tab-panel__canvas-workspace');
  });

});
