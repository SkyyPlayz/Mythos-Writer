/**
 * Slice C — Soft-FAIL CLEAR + ship-set regression locks.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SETTINGS_CATEGORIES } from './settingsCategories';
import { PARTNER_TEACH_OPTIONS } from './partner/partnerPersonality';
import { DEFAULT_WRITING_PARTNER } from './partner/partnerSettings';

const here = path.dirname(fileURLToPath(import.meta.url));

function read(rel: string): string {
  return fs.readFileSync(path.join(here, rel), 'utf8');
}

describe('C — Settings IA: Writing partner + Model & keys', () => {
  it('rail has Writing partner before Model & keys; no AI Agents label', () => {
    const labels = SETTINGS_CATEGORIES.map((c) => c.label);
    expect(labels).toContain('Writing partner');
    expect(labels).toContain('Model & keys');
    expect(labels).not.toContain('AI Agents');
    expect(labels.indexOf('Writing partner')).toBeLessThan(labels.indexOf('Model & keys'));
  });

  it('Teaching chips match PLAN APPROVED names', () => {
    expect([...PARTNER_TEACH_OPTIONS]).toEqual([
      'Socratic',
      'Guided practice',
      'Feynman',
      'Just tell me',
      'Adaptive',
    ]);
  });

  it('privacy default is Don’t send; web search / Claude memory OFF', () => {
    expect(DEFAULT_WRITING_PARTNER.telemetryLevel).toBe('off');
    expect(DEFAULT_WRITING_PARTNER.webSearch).toBe(false);
    expect(DEFAULT_WRITING_PARTNER.claudeMemory).toBe(false);
  });
});

describe('C — Soft-FAIL CLEAR: no Demo / TourModal / 45-step / coach-mark / four-agent primary', () => {
  it('TourModal / Demo toggle / walkthrough steps stay absent', () => {
    expect(fs.existsSync(path.join(here, 'TourModal.tsx'))).toBe(false);
    expect(fs.existsSync(path.join(here, 'walkthrough/WalkthroughOverlay.tsx'))).toBe(false);
    expect(fs.existsSync(path.join(here, 'walkthrough/walkthroughSteps.ts'))).toBe(false);
    const chrome = read('components/ui/WindowChrome.tsx');
    expect(chrome).not.toMatch(/Demo on/);
    expect(chrome).not.toMatch(/onToggleDemo/);
  });

  it('Model & keys + Writing partner mount; four-agent AgentsSection not primary', () => {
    const panel = read('SettingsPanel.tsx');
    expect(panel).toMatch(/ModelKeysSection/);
    expect(panel).toMatch(/WritingPartnerSection/);
    // Soft-FAIL: Writing partner primary is not four per-agent cards.
    expect(panel).not.toMatch(/<AgentsSection/);
  });

  it('package stays 0.5.6', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(here, '../../package.json'), 'utf8')) as {
      version: string;
    };
    expect(pkg.version).toBe('0.5.6');
  });
});

describe('C — walkthrough shell min bar z-tier 88–90', () => {
  it('exposes walkthrough z tokens without coach-mark bubble UI', () => {
    const css = read('walkthrough/walkthroughShell.css');
    expect(css).toMatch(/--z-walkthrough-dim:\s*88/);
    expect(css).toMatch(/--z-walkthrough-ring:\s*89/);
    expect(css).toMatch(/--z-walkthrough-bubble:\s*90/);
    expect(css).toMatch(/pointer-events:\s*none/);
    // No Demo / TourModal restore in shell CSS.
    expect(css).not.toMatch(/Demo on/);
    expect(css).not.toMatch(/TourModal/);
  });

  it('main imports walkthrough shell css', () => {
    expect(read('main.tsx')).toMatch(/walkthrough\/walkthroughShell\.css/);
  });
});

describe('C — Getting Started reachable; A1/A2/B keep', () => {
  it('GettingStartedPanel still exists', () => {
    expect(fs.existsSync(path.join(here, 'components/GettingStartedPanel/GettingStartedPanel.tsx'))).toBe(true);
  });

  it('Quick Entry / rail brand M stay absent', () => {
    expect(fs.existsSync(path.join(here, 'EntriesQuickAdd.tsx'))).toBe(false);
    const rail = read('AppNavRail.tsx');
    expect(rail).not.toMatch(/>M</);
  });

  it('partner shell still one face + three hands', () => {
    const hub = read('AgentHubPanel.tsx');
    expect(hub).toMatch(/data-partner-shell|ahp-partner/);
    expect(hub).toMatch(/ahp-hand-\$\{h\.id\}/);
    expect(hub).toMatch(/QUEUED/);
    expect(hub).not.toMatch(/aria-label="Agents"/);
  });
});

describe('C — copy rule: never free Claude', () => {
  it('Model & keys BYO copy never claims free Claude', () => {
    const src = read('partner/ModelKeysSection.tsx');
    expect(src).toMatch(/Bring your own AI/);
    expect(src).not.toMatch(/includes Claude for free/i);
    expect(src).not.toMatch(/Claude for free/i);
  });
});
