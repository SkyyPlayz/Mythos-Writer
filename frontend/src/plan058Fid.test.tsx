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
