/**
 * PLAN-058 Fid-a — FD-8 setup zoom.
 * Slot-1 selected accent is already on main. FD-9 #10 rail width is dropped
 * for this tip: a 44px rail at 900 widens the notes body past pins this
 * allowlist cannot edit.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = (rel: string) => readFileSync(resolve(process.cwd(), 'src', rel), 'utf-8');

describe('PLAN-058 Fid-a', () => {
  it('FD-8 setup column is zoom .9 and header plus board picker stay at 100%', () => {
    const sc = css('pages/SceneCrafter/SceneCrafterPage.css');
    expect(sc).toMatch(/\.sc-col-setup\s*\{[^}]*zoom:\s*\.9\b/);
    expect(sc).toMatch(/\.scene-crafter-header\s*\{[^}]*zoom:\s*1\b/);
    expect(sc).toMatch(/\.sc-board-list\s*\{[^}]*zoom:\s*calc\(1\s*\/\s*\.9\)/);
  });
});

describe('PLAN-058 Fid-b', () => {
  it('FD-9 #15 Synced chip has border, radius, and padding', () => {
    const bar = css('BottomBar.css');
    expect(bar).toMatch(/\.bottom-synced\s*\{[^}]*border:\s*1px solid rgba\(255,\s*255,\s*255,\s*\.1\)/);
    expect(bar).toMatch(/\.bottom-synced\s*\{[^}]*border-radius:\s*7px/);
    expect(bar).toMatch(/\.bottom-synced\s*\{[^}]*padding:\s*2px 8px/);
    const tsx = readFileSync(resolve(process.cwd(), 'src', 'BottomBar.tsx'), 'utf-8');
    expect(tsx).toMatch(/className="bottom-synced"[^>]*>\s*Synced\s*</);
  });
});
