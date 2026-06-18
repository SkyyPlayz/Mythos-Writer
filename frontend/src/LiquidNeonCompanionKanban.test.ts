import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const pluginDir = join(__dirname, '..', '..', 'plugin', 'Liquid-Neon-Companion');
const stylesCss = readFileSync(join(pluginDir, 'styles.css'), 'utf8');
const kanbanCss = readFileSync(join(pluginDir, 'kanban-liquid-neon.css'), 'utf8');

describe('Liquid Neon Companion Kanban CSS', () => {
  it('is bundled into the Obsidian plugin stylesheet', () => {
    expect(stylesCss).toContain('/* ===== Bundled from kanban-liquid-neon.css ===== */');
    expect(stylesCss).toContain('.theme-dark .kanban-plugin__lane');
    expect(stylesCss).toContain('.theme-dark button.kanban-plugin__new-item-button');
  });

  it('covers Kanban cards, lanes, drag state, add buttons, and settings dialogs', () => {
    expect(kanbanCss).toMatch(/\.kanban-plugin__lane[\s\S]*var\(--glass-fill/);
    expect(kanbanCss).toMatch(/\.kanban-plugin__item[\s\S]*backdrop-filter:\s*blur\(var\(--lg-blur/);
    expect(kanbanCss).toMatch(/is-dropping[\s\S]*var\(--ln-kanban-card-glass-active/);
    expect(kanbanCss).toMatch(/is-dropping[\s\S]*var\(--lg-neon/);
    expect(kanbanCss).toContain('button.kanban-plugin__new-item-button');
    expect(kanbanCss).toContain('.kanban-plugin__board-settings-modal');
  });

  it('keeps --lg-neon as an intensity token instead of using it as a color', () => {
    expect(kanbanCss).not.toContain('var(--lg-neon, var(--neon-cyan');
    expect(kanbanCss).toContain('--ln-kanban-neon-intensity: var(--lg-neon, 0.5);');
  });
});
