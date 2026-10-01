/**
 * Probe #17/#19 — left sidebar order + proto glass card.
 * RED if Navigator/tree/New/focus/Edit calendar order or glass styles regress.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const SRC = resolve(process.cwd(), 'src');
const read = (rel: string) => readFileSync(resolve(SRC, rel), 'utf-8');

describe('Timeline left sidebar (#17/#19)', () => {
  it('orders Navigator → tree → dashed New → focusSection → Edit calendar', () => {
    const tsx = read('TimelineTreeSidebar.tsx');
    const nav = tsx.indexOf('data-testid="tl-navigator-head"');
    const tree = tsx.indexOf('data-testid="tl-tree"');
    const neu = tsx.indexOf('data-testid="timeline-new"');
    const focus = tsx.indexOf('{focusSection}');
    const edit = tsx.indexOf('data-testid="timeline-edit-calendar"');
    expect(nav).toBeGreaterThan(-1);
    expect(tree).toBeGreaterThan(nav);
    expect(neu).toBeGreaterThan(tree);
    expect(focus).toBeGreaterThan(neu);
    expect(edit).toBeGreaterThan(focus);
    expect(tsx).toContain('tlpicker__new-dashed');
    expect(tsx).toContain('+ New');
  });

  it('glass card uses proto fill, purple border, radius 18', () => {
    const css = read('TimelineRoot.css');
    expect(css).toMatch(/\.tlr-left-sidebar\s*\{[^}]*background:\s*rgba\(13,\s*16,\s*28,\s*0\.2\)/s);
    expect(css).toMatch(/\.tlr-left-sidebar\s*\{[^}]*border:\s*1px solid rgba\(155,\s*95,\s*255/s);
    expect(css).toMatch(/\.tlr-left-sidebar\s*\{[^}]*border-radius:\s*18px/s);
  });

  it('focusSection starts with Overview and ends with Plotlines (no calendar card here)', () => {
    const root = read('TimelineRoot.tsx');
    const overview = root.indexOf('data-testid="tl-overview-card"');
    const plot = root.indexOf('PLOTLINES');
    expect(overview).toBeGreaterThan(-1);
    expect(plot).toBeGreaterThan(overview);
    // Universal calendar card / span chips are follow-ups — not in this rail.
    expect(root).not.toMatch(/data-testid="tl-calendar-card"/);
  });
});
