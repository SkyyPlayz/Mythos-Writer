/**
 * PLAN-058 NW — narrow-width layout pins (red-on-revert).
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => fs.readFileSync(path.join(here, rel), 'utf8');

describe('PLAN-058 NW — Notes narrow-width pins', () => {
  const notesCss = read('NotesTabPanel.css');
  const notesTsx = read('NotesTabPanel.tsx');
  const shellTsx = read('DesktopShell.tsx');

  it('NW-3: right sidebar header uses grid so Collapse cannot overlap tabs', () => {
    expect(notesCss).toMatch(/\.notes-right-sidebar-header\s*\{[\s\S]*display:\s*grid/);
    expect(notesCss).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s*auto/);
    expect(notesCss).toMatch(/\.notes-right-sidebar-header\s+\.notes-sidebar-collapse-btn[\s\S]*grid-column:\s*2/);
  });

  it('NW-1: compact composer stacks in narrow notes-right-pane container', () => {
    expect(notesCss).toMatch(
      /@container\s+notes-right-pane\s*\(max-width:\s*280px\)[\s\S]*\.brainstorm-input-area[\s\S]*flex-direction:\s*column/,
    );
  });

  it('NW-2: Properties tab exposes Props short label for narrow pane floor', () => {
    expect(notesTsx).toMatch(/notes-right-tab-label--narrow[\s\S]*Props/);
    expect(notesCss).toMatch(/@container\s+notes-right-pane\s*\(max-width:\s*210px\)/);
  });

  it('NW-5: no notes sidebar auto-shrink on window resize in DesktopShell', () => {
    expect(shellTsx).not.toMatch(/notesSidebarWidth[\s\S]{0,120}computeClampedSidebarWidths/);
    expect(shellTsx).not.toMatch(/SET_NOTES_SIDEBAR_WIDTH[\s\S]{0,80}windowInnerWidth/);
  });
});
