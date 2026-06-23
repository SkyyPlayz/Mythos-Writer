// SKY-3618: Unit tests for the responsive sidebar width clamping logic.
import { describe, it, expect } from 'vitest';
import { computeClampedSidebarWidths, CENTER_MIN_WIDTH } from './DesktopShell';

const PANEL_MIN = 160;
const DIVIDERS = 8; // two 4px dividers when both sidebars visible

describe('computeClampedSidebarWidths', () => {
  it('returns stored widths unchanged when space is sufficient', () => {
    // 1200px panels available — plenty of room for 240+300=540 sidebars
    const result = computeClampedSidebarWidths(240, 300, true, true, 1200);
    expect(result.left).toBe(240);
    expect(result.right).toBe(300);
  });

  it('clamps proportionally when both sidebars exceed available space', () => {
    // 700px available; max for sidebars = 700 - 280 - 8 = 412; stored = 240+300 = 540
    const result = computeClampedSidebarWidths(240, 300, true, true, 700);
    expect(result.left).toBeLessThan(240);
    expect(result.right).toBeLessThan(300);
    // Clamped sidebars leave room for the center column
    expect(result.left + result.right).toBeLessThanOrEqual(700 - CENTER_MIN_WIDTH - DIVIDERS);
  });

  it('never returns widths below PANEL_MIN_WIDTH', () => {
    // Extremely narrow window
    const result = computeClampedSidebarWidths(400, 400, true, true, 400);
    expect(result.left).toBeGreaterThanOrEqual(PANEL_MIN);
    expect(result.right).toBeGreaterThanOrEqual(PANEL_MIN);
  });

  it('only accounts for visible sidebars when computing headroom', () => {
    // Right hidden: only left divider (4px), max = 700 - 280 - 4 = 416 > left=400 → no clamp
    const result = computeClampedSidebarWidths(400, 300, true, false, 700);
    expect(result.left).toBe(400);
    expect(result.right).toBe(300); // unchanged even when hidden
  });

  it('does not clamp the hidden sidebar stored width', () => {
    // Left hidden, right=250, available=600; max = 600 - 280 - 4 = 316 > 250 → no clamp
    const result = computeClampedSidebarWidths(300, 250, false, true, 600);
    expect(result.left).toBe(300); // hidden, untouched
    expect(result.right).toBe(250);
  });

  it('clamps correctly when only one sidebar is shown', () => {
    // Only left visible, stored=450, available=700; max = 700 - 280 - 4 = 416 < 450 → clamp
    const result = computeClampedSidebarWidths(450, 300, true, false, 700);
    expect(result.left).toBeLessThanOrEqual(416);
    expect(result.left).toBeGreaterThanOrEqual(PANEL_MIN);
    expect(result.right).toBe(300); // hidden, unchanged
  });

  it('guarantees center has at least CENTER_MIN_WIDTH when both sidebars clamped', () => {
    // 800px, both sidebars 350+350=700; max = 800 - 280 - 8 = 512
    const result = computeClampedSidebarWidths(350, 350, true, true, 800);
    expect(result.left + result.right).toBeLessThanOrEqual(800 - CENTER_MIN_WIDTH - DIVIDERS);
  });

  it('handles zero available width gracefully (returns stored values)', () => {
    const result = computeClampedSidebarWidths(240, 300, true, true, 0);
    expect(result.left).toBe(240);
    expect(result.right).toBe(300);
  });
});
