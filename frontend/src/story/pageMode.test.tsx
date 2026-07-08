// Beta 3 M10 — pageMode unit tests: sheetBoxSt port per mode (prototype
// 4607–4617), padding opt-out, scroll parchment tint math, rune overlays.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  PageModeRunes,
  RUNE_ROWS,
  pageModeChrome,
  runeColStyle,
  runeRowStyle,
} from './pageMode';
import type { LiquidNeonV2Settings } from '../theme/liquidNeonEngine';

function cfg(pageCfg: Partial<LiquidNeonV2Settings['pageCfg']>, extra: Partial<LiquidNeonV2Settings> = {}) {
  return { pageCfg: { mode: 'neon', bg: '#0a0d18', op: 66, blur: 0, ...pageCfg }, ...extra } as Partial<LiquidNeonV2Settings>;
}

describe('pageModeChrome', () => {
  it('defaults to the neon sheet (prototype sheetBoxSt neon branch, 4616)', () => {
    const c = pageModeChrome(undefined);
    expect(c.mode).toBe('neon');
    expect(c.sym).toBe(false);
    expect(c.sheetStyle.background).toBe('rgba(10,13,24,0.660)');
    expect(c.sheetStyle.border).toBe('var(--bw,1px) solid var(--b2,rgba(155,95,255,.5))');
    expect(c.sheetStyle.borderRadius).toBe('12px');
    expect(c.sheetStyle.padding).toBe('64px 84px 90px');
  });

  it("renders the 'default' (No glow) branch with a plain border", () => {
    const c = pageModeChrome(cfg({ mode: 'default', op: 50, blur: 4 }));
    expect(c.mode).toBe('default');
    expect(c.sheetStyle.background).toBe('rgba(10,13,24,0.500)');
    expect(c.sheetStyle.backdropFilter).toBe('blur(4px)');
    expect(c.sheetStyle.border).toBe('1px solid rgba(255,255,255,.06)');
    expect(String(c.sheetStyle.boxShadow)).toContain('inset 0 1px 0 rgba(255,255,255,.04)');
  });

  it("renders the 'off' branch fully transparent and chromeless", () => {
    const c = pageModeChrome(cfg({ mode: 'off' }));
    expect(c.sheetStyle.background).toBe('transparent');
    expect(c.sheetStyle.border).toBe('none');
    expect(c.sheetStyle.boxShadow).toBe('none');
    expect(c.sheetStyle.padding).toBe('10px 8px 80px');
  });

  it('builds the scroll parchment from scrollTint/scrollOp (prototype 4610–4615)', () => {
    const c = pageModeChrome(cfg({ mode: 'scroll', sym: true }, { scrollTint: '#2b2213', scrollOp: 92 }));
    expect(c.mode).toBe('scroll');
    expect(c.sym).toBe(true);
    const bg = String(c.sheetStyle.background);
    expect(bg).toContain('rgba(43,34,19,0.920)'); // #2b2213 @ .92
    expect(bg).toContain('rgba(43,34,19,0.740)'); // .92 − .18
    expect(bg).toContain('rgba(15,10,2,0.920)'); // #0f0a02 base
    expect(c.sheetStyle.border).toBe('var(--bw,1px) solid rgba(214,183,121,.45)');
    expect(c.sheetStyle.borderRadius).toBe('10px');
    expect(c.sheetStyle.padding).toBe('76px 96px 96px');
  });

  it('omits the per-mode padding when includePadding is false (scene page keeps its own)', () => {
    const c = pageModeChrome(cfg({ mode: 'scroll' }), { includePadding: false });
    expect(c.sheetStyle.padding).toBeUndefined();
    expect(pageModeChrome(undefined, { includePadding: false }).sheetStyle.padding).toBeUndefined();
  });
});

describe('rune styles', () => {
  it('glows and brightens when sym is on (prototype runeSt 4623 / runeVSt 4818)', () => {
    expect(runeRowStyle(true).color).toBe('rgba(214,183,121,.85)');
    expect(runeRowStyle(true).textShadow).toContain('var(--g4');
    expect(runeRowStyle(false).color).toBe('rgba(214,183,121,.4)');
    expect(runeRowStyle(false).textShadow).toBeUndefined();
    expect(runeColStyle(true).color).toBe('rgba(214,183,121,.85)');
    expect(runeColStyle(false).color).toBe('rgba(214,183,121,.38)');
  });
});

describe('PageModeRunes', () => {
  it('renders three rune bands + two columns, hidden from the a11y tree', () => {
    render(<PageModeRunes sym={false} />);
    const wrap = screen.getByTestId('lnpm-runes');
    expect(wrap.getAttribute('aria-hidden')).toBe('true');
    expect(wrap.children).toHaveLength(5);
    expect(wrap.textContent).toContain(RUNE_ROWS[0]);
    expect(wrap.textContent).toContain(RUNE_ROWS[2]);
  });
});
