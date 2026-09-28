/**
 * A1 residual Q1 — Welcome overlay contracts from 09 §7.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const SRC = resolve(process.cwd(), 'src');
const read = (rel: string) => readFileSync(resolve(SRC, rel), 'utf-8');

describe('WelcomeOverlay (09 §7)', () => {
  const tsx = read('WelcomeOverlay.tsx');
  const css = read('WelcomeOverlay.css');

  it('is z-index 70 with blur scrim', () => {
    expect(css).toMatch(/\.welcome-overlay\s*\{[^}]*z-index:\s*70/s);
    expect(css).toMatch(/backdrop-filter:\s*blur\(14px\)/);
    expect(css).toContain('rgba(5, 7, 13, 0.72)');
  });

  it('exposes five paths + Skip', () => {
    for (const id of ['template', 'blank', 'import', 'restore', 'openin'] as const) {
      expect(tsx).toContain(`id: '${id}'`);
    }
    expect(tsx).toContain('welcome-path-${card.id}');
    expect(tsx).toContain('Skip — continue to the app →');
    expect(tsx).toContain('welcome-skip');
  });
});

describe('WalkthroughOverlay (09 §7)', () => {
  const tsx = read('walkthrough/WalkthroughOverlay.tsx');
  const css = read('walkthrough/WalkthroughOverlay.css');
  const steps = read('walkthrough/walkthroughSteps.ts');

  it('ships bubble z90 + ring z89 chrome', () => {
    expect(css).toMatch(/\.walkthrough-bubble\s*\{[^}]*z-index:\s*90/s);
    expect(css).toMatch(/\.walkthrough-ring\s*\{[^}]*z-index:\s*89/s);
    expect(css).toContain('lnRing');
    expect(tsx).toContain('walkthrough-bubble');
    expect(tsx).toContain('walkthrough-ring');
  });

  it('loads seed walkthrough steps (45)', () => {
    expect(steps).toContain('WALKTHROUGH_STEPS');
    expect(steps.match(/"chapter":/g)?.length).toBe(45);
  });
});
