/**
 * A1 residual Q1 — Welcome overlay contracts from 09 §7.
 * VERIFY also: Demo / TourModal / walkthrough chrome must not exist.
 */
import { existsSync, readFileSync } from 'node:fs';
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

  it('exposes five paths; Skip always visible (Probe #33 / main parity)', () => {
    for (const id of ['template', 'blank', 'import', 'restore', 'openin'] as const) {
      expect(tsx).toContain(`id: '${id}'`);
    }
    expect(tsx).toContain('welcome-path-${card.id}');
    expect(tsx).toContain('requireVaultSetup');
    expect(tsx).toContain('Skip — continue to the app →');
    expect(tsx).toContain('welcome-skip');
    // Skip must not be gated behind requireVaultSetup (always mounted).
    expect(tsx).not.toMatch(/\{!requireVaultSetup\s*&&/);
  });
});

describe('Demo removed (Owner clarify)', () => {
  it('TourModal and walkthrough modules are deleted', () => {
    expect(existsSync(resolve(SRC, 'TourModal.tsx'))).toBe(false);
    expect(existsSync(resolve(SRC, 'TourModal.css'))).toBe(false);
    expect(existsSync(resolve(SRC, 'walkthrough/WalkthroughOverlay.tsx'))).toBe(false);
    expect(existsSync(resolve(SRC, 'walkthrough/walkthroughSteps.ts'))).toBe(false);
  });
});
