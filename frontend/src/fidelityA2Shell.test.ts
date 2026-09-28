/**
 * Slice A2 — ship-set regression locks (Quick Entry gone, rail order, Demo string,
 * rounded chrome chase flags, A1 residual keep).
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { NAV_RAIL_DEFAULTS } from './components/SettingsPanel/settingsPanelTypes';

const here = path.dirname(fileURLToPath(import.meta.url));

function read(rel: string): string {
  return fs.readFileSync(path.join(here, rel), 'utf8');
}

describe('A2 — Quick Entry removed', () => {
  it('EntriesQuickAdd module is gone', () => {
    expect(fs.existsSync(path.join(here, 'EntriesQuickAdd.tsx'))).toBe(false);
    expect(fs.existsSync(path.join(here, 'EntriesQuickAdd.css'))).toBe(false);
  });

  it('BrainstormPage does not mount Quick Entry', () => {
    const src = read('BrainstormPage.tsx');
    expect(src).not.toMatch(/EntriesQuickAdd/);
    expect(src).not.toMatch(/Quick Entry/);
  });
});

describe('A2 — sidebar default order LOCKED', () => {
  it('Story Writer · Notes Editor · Boards · Scene Crafter · Partner · Timeline · Vault Graph', () => {
    expect(NAV_RAIL_DEFAULTS.items.map((i) => `${i.id}:${i.label}`)).toEqual([
      'story:Story Writer',
      'notes:Notes Editor',
      'boards:Boards',
      'crafter:Scene Crafter',
      'brainstorm:Partner',
      'timeline:Timeline',
      'vault-graph:Vault Graph',
    ]);
  });
});

describe('A2 — Timeline Demo placeholder gone', () => {
  it('TimelinePicker has no Demo badge chrome', () => {
    const src = read('TimelinePicker.tsx');
    expect(src).not.toMatch(/DemoBadge/);
    expect(src).not.toMatch(/>Demo</);
    expect(src).not.toMatch(/timeline-demo-badge/);
  });
});

describe('A2 — World Context back control', () => {
  it('TimelineRoot exposes a Back control for embedded world timelines', () => {
    const src = read('TimelineRoot.tsx');
    expect(src).toMatch(/tlr-world-context-back/);
    expect(src).toMatch(/handleWorldContextBack/);
  });
});

describe('A2 — Appearance compaction tokens', () => {
  it('defaults card pad to atlas 11×13 / gap 9', () => {
    const css = read('components/SettingsPanel/sections/LiquidNeonAppearanceSection.css');
    expect(css).toMatch(/gap:\s*9px/);
    expect(css).toMatch(/--ln-card-pad-y,\s*11px/);
    expect(css).toMatch(/--ln-card-pad-x,\s*13px/);
    const tokens = read('tokens.css');
    expect(tokens).toMatch(/--ln-card-pad-y:\s*11px/);
    expect(tokens).toMatch(/--ln-card-pad-x:\s*13px/);
  });
});

describe('A2 — rounded chrome chase', () => {
  it('main window requests roundedCorners and shell clips radius', () => {
    const main = fs.readFileSync(path.join(here, '../../electron-main/src/main.ts'), 'utf8');
    expect(main).toMatch(/roundedCorners:\s*true/);
    const shell = read('DesktopShell.css');
    expect(shell).toMatch(/border-radius:\s*12px/);
  });
});

describe('A2 — redundant Mythos brand in legacy AppMenuBar', () => {
  it('AppMenuBar no longer ships the Mythos brand span', () => {
    const src = read('DesktopShell.tsx');
    expect(src).not.toMatch(/app-menu-brand/);
  });
});

describe('A2 — A1 residual keep', () => {
  it('Welcome overlay remains; Demo toggle stays absent', () => {
    const shell = read('DesktopShell.tsx');
    expect(shell).toMatch(/WelcomeOverlay|onOpenWelcome/);
    expect(shell).not.toMatch(/onToggleDemo/);
    expect(shell).not.toMatch(/setDemoOn/);
  });
});
