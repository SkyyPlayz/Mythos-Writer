import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * 0.5.4.5 UI refine (MW-0545-ui) — static chrome contracts from PLAN §6 /
 * HOLD §3 / Lens refs. Proof-first; no perf-rewrite epic.
 */

const SRC = resolve(process.cwd(), 'src');
const read = (rel: string) => readFileSync(resolve(SRC, rel), 'utf-8');

describe('0.5.4.5 chrome tokens (MW-0545-ui)', () => {
  const tokens = read('tokens.css');

  it('defines concentric nested radius tokens (inner ≈ outer − gap)', () => {
    expect(tokens).toContain('--radius-nested-gap');
    expect(tokens).toContain('--radius-nested-md: calc(var(--radius-md) - var(--radius-nested-gap))');
    expect(tokens).toContain('--radius-nested-lg: calc(var(--radius-lg) - var(--radius-nested-gap))');
  });

  it('defines press / enter / chrome duration tokens within Lens caps', () => {
    expect(tokens).toContain('--scale-press:');
    expect(tokens).toContain('--scale-enter-min:');
    expect(tokens).toContain('--dur-chrome:');
    expect(tokens).toContain('--dur-popover:');
    expect(tokens).toContain('--ease-drawer:');
    expect(tokens).toContain('--ease-in-out:');
  });
});

describe('0.5.4.5 dialog / palette motion gates', () => {
  it('modal enter uses lnFadeUp translateY (09 §2.2) or center-origin scale ≥ enter-min', () => {
    const css = read('components/ui/Dialog.css');
    const hasFade = /lnFadeUp|translateY\(6px\)/.test(css);
    const hasScale = css.includes('transform-origin: center center') && css.includes('scale(var(--scale-enter-min');
    expect(hasFade || hasScale).toBe(true);
    expect(css).not.toMatch(/ln-dialog-enter[\s\S]*scale\(0\)/);
  });

  it('command palette (GlobalSearch) has no enter/exit animation', () => {
    const gsp = read('GlobalSearchPanel.css');
    const chrome = read('chrome-0545.css');
    expect(gsp).toMatch(/\.gsp-panel[\s\S]*animation:\s*none/);
    expect(chrome).toMatch(/\.gsp-backdrop[\s\S]*animation:\s*none/);
  });

  it('pressable chrome uses --scale-press (Button + chrome-0545)', () => {
    const btn = read('components/ui/Button.css');
    const chrome = read('chrome-0545.css');
    expect(btn).toContain('scale(var(--scale-press');
    expect(chrome).toContain('--scale-press');
  });
});
