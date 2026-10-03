/**
 * Slice E — Soft-FAIL CLEAR + ship-set regression locks (SKY-11698 + leftovers).
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GHOST_TAIL_RATIO, clampVZoom } from './timeline2/axis/stamps';

const here = path.dirname(fileURLToPath(import.meta.url));

function read(rel: string): string {
  return fs.readFileSync(path.join(here, rel), 'utf8');
}

describe('E — Soft-FAIL CLEAR: Demo / TourModal / walkthrough / rail M / Quick Entry', () => {
  it('TourModal / walkthroughSteps / Demo toggle stay absent', () => {
    expect(fs.existsSync(path.join(here, 'TourModal.tsx'))).toBe(false);
    expect(fs.existsSync(path.join(here, 'walkthrough/walkthroughSteps.ts'))).toBe(false);
    const chrome = read('components/ui/WindowChrome.tsx');
    expect(chrome).not.toMatch(/Demo on/);
    expect(chrome).not.toMatch(/onToggleDemo/);
  });

  it('package is 0.5.7', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(here, '../../package.json'), 'utf8')) as {
      version: string;
    };
    expect(pkg.version).toBe('0.5.7');
  });
});

describe('E — Timeline calendars Soft-FAIL locks', () => {
  it('ghost tail ratio is 1/8 — not 34% or ~1/3', () => {
    expect(GHOST_TAIL_RATIO).toBe(1 / 8);
    expect(GHOST_TAIL_RATIO).not.toBeCloseTo(0.34, 2);
    expect(GHOST_TAIL_RATIO).not.toBeCloseTo(1 / 3, 2);
    const axis = read('timeline2/AxisView.tsx');
    expect(axis).toMatch(/GHOST_TAIL_RATIO/);
    expect(axis).not.toMatch(/0\.34/);
  });

  it('sync line is armed-only (Drop sync line + catch layer)', () => {
    const root = read('TimelineRoot.tsx');
    expect(root).toMatch(/Drop sync line/);
    expect(root).toMatch(/tlSyncArm/);
    const overlay = read('timeline2/SyncLineOverlay.tsx');
    expect(overlay).toMatch(/tl-sync-catch/);
    expect(overlay).toMatch(/armed/);
  });

  it('calendar ratio is derived — not stored', () => {
    const cem = read('timeline2/CalendarEditorModal.tsx');
    expect(cem).toMatch(/DERIVED — NOT STORED/);
    expect(cem).toMatch(/cem-ratio-input/);
    expect(cem).toMatch(/INHERITED/);
    expect(cem).toMatch(/OVERRIDDEN/);
  });

  it('vertical zoom clamps 40–160', () => {
    expect(clampVZoom(10)).toBe(40);
    expect(clampVZoom(200)).toBe(160);
    const root = read('TimelineRoot.tsx');
    expect(root).toMatch(/tl-vzoom/);
  });

  it('Timeline right tabs are Inspector · partner — no Archivist / Idea Board', () => {
    const panel = read('timeline2/panel/TimelineRightPanel.tsx');
    expect(panel).toMatch(/Inspector/);
    expect(panel).toMatch(/partnerName/);
    expect(panel).not.toMatch(/label: 'Idea Board'/);
    expect(panel).not.toMatch(/label: 'Ivy'/);
    expect(panel).not.toMatch(/value: 'archive'/);
    expect(panel).toMatch(/Idea Board lives under Boards/);
  });

  it('Today control is wired (not a dead stub)', () => {
    const root = read('TimelineRoot.tsx');
    expect(root).toMatch(/handleToday/);
    expect(root).toMatch(/setTodaySignal/);
    expect(root).toMatch(/tl-today-btn/);
  });
});

describe('E — bounded Crafter/Graph #14 Soft-FAIL (no rewrite / no open-ended atlas claim)', () => {
  it('does not delete §10 keep surfaces (Liquid Neon / Scene Crafter / Boards canvas)', () => {
    expect(fs.existsSync(path.join(here, 'theme/liquidNeonEngine.ts'))).toBe(true);
    expect(fs.existsSync(path.join(here, 'pages/SceneCrafter/SceneCrafterPage.tsx'))).toBe(true);
    expect(fs.existsSync(path.join(here, 'pages/Boards/BoardCanvas.tsx'))).toBe(true);
  });

  it('does not invent Google Fonts catalogue stub', () => {
    const theme = read('theme.ts');
    expect(theme).not.toMatch(/fonts\.google\.com/);
    expect(theme).not.toMatch(/GOOGLE_FONTS_CATALOGUE/);
  });
});

describe('E — Graph lag measure-only residual', () => {
  it('keeps Graph view core (no rewrite this tip)', () => {
    expect(fs.existsSync(path.join(here, 'VaultGraphView.css'))).toBe(true);
    // Soft-FAIL: no fidelity→FPS Graph rewrite claimed in Timeline tip.
    const axis = read('timeline2/AxisView.tsx');
    expect(axis).not.toMatch(/rewrite Graph for FPS/);
  });
});
