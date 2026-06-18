import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(__dirname, '..', '..');
const companionDir = resolve(repoRoot, 'plugin', 'Liquid-Neon-Companion');

function readCompanionCss(filename: string): string {
  return readFileSync(resolve(companionDir, filename), 'utf8');
}

describe('Liquid Neon Companion Dataview CSS', () => {
  it('targets current Dataview table, list, and settings DOM selectors', () => {
    const css = readCompanionCss('dataview-liquid-neon.css');

    expect(css).toContain('.theme-dark table.dataview.table-view-table');
    expect(css).toContain('.theme-dark ul.dataview.list-view-ul');
    expect(css).toContain('.theme-dark .modal.mod-settings:has(.vertical-tab-nav-item[data-setting-id="dataview"].is-active) .vertical-tab-content');
    expect(css).toContain('.theme-dark .modal.mod-settings:has(.vertical-tab-nav-item[data-setting-id="dataview"].is-active) .setting-item-heading');
    expect(css).toContain('.theme-dark .modal.mod-settings:has(.vertical-tab-nav-item[data-setting-id="dataview"].is-active) .setting-item-heading .setting-item-name');
  });

  it('keeps the main companion stylesheet importing all plugin CSS modules and bundles Dataview rules for live Obsidian injection', () => {
    const css = readCompanionCss('styles.css');

    expect(css).toContain("@import url('./dataview-liquid-neon.css');");
    expect(css).toContain("@import url('./kanban-liquid-neon.css');");
    expect(css).toContain("@import url('./calendar-liquid-neon.css');");
    expect(css).toContain("@import url('./advanced-tables-liquid-neon.css');");
    expect(css).toContain('Obsidian injects community plugin styles.css as an inline stylesheet');
    expect(css).toContain('.theme-dark table.dataview.table-view-table');
    expect(css).toContain('.theme-dark .modal.mod-settings:has(.vertical-tab-nav-item[data-setting-id="dataview"].is-active) .setting-item-heading .setting-item-name');
  });
});
