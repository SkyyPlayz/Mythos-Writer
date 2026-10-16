/**
 * PLAN-058 Fid-a — FD-8 setup zoom and FD-9 #10 rail width.
 * Slot-1 selected accent (Boards & Settings included) is already on main;
 * these pins only cover the rows that were missing at 55c4b7d7.
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

  it('FD-9 rail column is 58px and compacts to 44px at 900', () => {
    const rail = css('AppNavRail.css');
    expect(rail).toMatch(/\.nav-rail\s*\{[^}]*width:\s*58px/);
    expect(rail).toMatch(/\.nav-rail--collapsed\s*\{[^}]*width:\s*44px/);
    expect(rail).toMatch(
      /@media\s*\(\s*max-width:\s*900px\s*\)\s*\{[\s\S]*?\.nav-rail\s*\{[^}]*width:\s*44px/,
    );
    expect(rail).toMatch(
      /@media\s*\(\s*max-width:\s*900px\s*\)\s*\{[\s\S]*?\.nav-rail__item-label[\s\S]*?display:\s*none/,
    );
  });
});
