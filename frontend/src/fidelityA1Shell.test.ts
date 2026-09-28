/**
 * A1 / MW-fidelity-a1 — shell geometry + engine contracts from 09 §2–§3.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const SRC = resolve(process.cwd(), 'src');
const read = (rel: string) => readFileSync(resolve(SRC, rel), 'utf-8');

describe('A1 floating rail (09 §3.2)', () => {
  const css = read('AppNavRail.css');
  it('rail is a floating glass card (radius 18, margin-right 10, full border + glow)', () => {
    expect(css).toMatch(/\.nav-rail\s*\{[^}]*border-radius:\s*18px/s);
    expect(css).toMatch(/\.nav-rail\s*\{[^}]*margin:[^;]*10px/s);
    expect(css).toMatch(/backdrop-filter:\s*blur\(var\(--blur/);
    expect(css).toContain('var(--b6');
    expect(css).not.toMatch(/\.nav-rail\s*\{[^}]*border-radius:\s*0/s);
  });

  it('active nav items collapse to slot-1 neon (gs1 .1 / g1 .45)', () => {
    expect(css).toMatch(/\.nav-rail__item--active[\s\S]*var\(--n1/);
    expect(css).toMatch(/\.nav-rail__item--active[\s\S]*rgba\(0,\s*240,\s*255,\s*\.1\)/);
    expect(css).toMatch(/\.nav-rail__item--active[\s\S]*rgba\(0,\s*240,\s*255,\s*\.45\)/);
  });

  it('vault tiles match design (no scroll, grad active, 22×18 +, settings h50)', () => {
    expect(css).toMatch(/\.nav-rail__vaults\s*\{[^}]*overflow:\s*visible/s);
    expect(css).not.toMatch(/\.nav-rail__vaults\s*\{[^}]*max-height:\s*294px/s);
    expect(css).toMatch(/\.nav-rail__vault-tile--active\s*\{[^}]*var\(--grad/s);
    expect(css).not.toMatch(/\.nav-rail__vault-tile--active\s*\{[^}]*neon-glow-strong/s);
    expect(css).toMatch(/\.nav-rail__vault-add\s*\{[^}]*width:\s*22px/s);
    expect(css).toMatch(/\.nav-rail__vault-add\s*\{[^}]*height:\s*18px/s);
    expect(css).toMatch(/\.nav-rail__settings\s*\{[^}]*height:\s*50px/s);
    expect(css).toContain('.nav-rail__spacer');
    expect(css).toContain('.nav-rail__settings--active');
  });

  it('auto-slim formula matches prototype railNeeds', () => {
    const tsx = read('AppNavRail.tsx');
    expect(tsx).toMatch(/innerHeight\s*<\s*n\s*\*\s*64\s*\+\s*60\s*\+\s*3\s*\*\s*36\s*\+\s*90/);
  });

  it('nav group uses display:contents so items flex against the spacer', () => {
    expect(css).toMatch(/\.nav-rail__nav\s*\{[^}]*display:\s*contents/s);
  });

  it('rail--pop elevates above workspace tabs / title bar', () => {
    expect(css).toMatch(/\.nav-rail--pop\s*\{[^}]*z-index:\s*70/s);
    expect(css).toMatch(/\.nav-rail__stories\s*\{[^}]*var\(--pop/s);
  });
});

describe('A1 title bar Welcome + Demo (09 §3.1)', () => {
  const tsx = read('components/ui/WindowChrome.tsx');
  const css = read('components/ui/WindowChrome.css');
  it('exposes Welcome + Demo wiring', () => {
    expect(tsx).toContain('onOpenWelcome');
    expect(tsx).toContain('onToggleDemo');
    expect(tsx).toContain('wc-demo-btn');
    expect(css).toContain('.wc-demo-btn');
    expect(css).toContain('backdrop-filter: blur(var(--blur');
  });
});

describe('A1 workspace tab strip (09 §3.4)', () => {
  const css = read('WorkspaceTabBar.css');
  it('strip is 38px with .3 fill', () => {
    expect(css).toMatch(/\.wtb-root\.wtb-root\.wtb-root\s*\{[^}]*height:\s*38px/s);
    expect(css).toContain('rgba(8, 10, 18, .3)');
  });
});

describe('A1 engine --pop (09 §2.1)', () => {
  const eng = read('theme/liquidNeonEngine.ts');
  it('separates popGlassOpacityPercent from overlayGlassOpacityPercent', () => {
    expect(eng).toContain('export function popGlassOpacityPercent');
    expect(eng).toMatch(/Math\.min\(99,\s*Math\.max\(86/);
  });

  it('emits Settings glassA+10 as --glass-settings', () => {
    expect(eng).toContain('--glass-settings');
    expect(eng).toMatch(/glassA \+ 10/);
  });
});

describe('A1 Welcome vs Demo (09 §3.1)', () => {
  const shell = read('DesktopShell.tsx');
  it('Welcome opens onboarding wizard; Demo toggles TourModal', () => {
    expect(shell).toMatch(/onOpenWelcome=\{replayOnboardingWizard\}/);
    expect(shell).toMatch(/onToggleDemo=\{\(\) => setTourOpen/);
    expect(shell).not.toMatch(/onOpenWelcome=\{\(\) => setTourOpen\(true\)\}/);
  });
});
