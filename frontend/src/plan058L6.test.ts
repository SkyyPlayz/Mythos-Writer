/**
 * PLAN-058 L6 — red-on-revert pins (Notes + Graph).
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

describe('PLAN-058 L6 pins', () => {
  it('graph truncation banner is not a drag region (82:47)', () => {
    const css = readFileSync(resolve(__dirname, 'VaultGraphView.css'), 'utf-8');
    const block = css.match(/\.vgv-truncation-banner\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(block).toContain('-webkit-app-region: no-drag');
  });

  it('notes sub-header Editor toggle removed (83:08)', () => {
    const src = readFileSync(resolve(__dirname, 'NotesTabPanel.tsx'), 'utf-8');
    expect(src).not.toContain('notes-subview-toggle');
    expect(src).not.toContain('notes-subview-editor');
  });

  it('workspace split pane drops duplicate module sub-header (83:18)', () => {
    const src = readFileSync(resolve(__dirname, 'WorkspaceSplitPane.tsx'), 'utf-8');
    expect(src).not.toContain('workspace-split-pane__header');
    expect(src).toContain('workspace-split-pane__close-floating');
  });

  it('M4: node drag does not clear dragMovedRef mid-drag via setTimeout(50)', () => {
    const src = readFileSync(resolve(__dirname, 'VaultGraphView.tsx'), 'utf-8');
    const begin = src.match(/function beginNodeDrag[\s\S]*?^ {2}\}/m)?.[0] ?? '';
    expect(begin).not.toMatch(/setTimeout\(\(\) => \{ dragMovedRef\.current = false; \}, 50\)/);
    expect(begin).toContain('dragMovedRef.current = true');
  });
});
