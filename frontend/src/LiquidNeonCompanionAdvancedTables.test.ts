import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const pluginDir = join(__dirname, '..', '..', 'plugin', 'Liquid-Neon-Companion');
const stylesCss = readFileSync(join(pluginDir, 'styles.css'), 'utf8');
const atCss = readFileSync(join(pluginDir, 'advanced-tables-liquid-neon.css'), 'utf8');

describe('Liquid Neon Companion Advanced Tables CSS', () => {
  it('is imported by the Obsidian plugin stylesheet', () => {
    expect(stylesCss).toContain("@import url('./advanced-tables-liquid-neon.css')");
  });

  it('covers table container, cells, editing input, controls, and resize handles', () => {
    expect(atCss).toContain('.table-editor-table');
    expect(atCss).toContain('.table-editor-cell-input');
    expect(atCss).toContain('.tablecontrols');
    expect(atCss).toContain('.table-editor-btn');
    expect(atCss).toContain('.table-editor-resizer');
  });

  it('uses glass-fill and neon-cyan tokens for backgrounds and accents', () => {
    expect(atCss).toContain('var(--glass-fill');
    expect(atCss).toContain('var(--neon-cyan');
    expect(atCss).toContain('var(--lg-blur');
  });

  it('keeps neon as an intensity multiplier, not a raw color', () => {
    expect(atCss).toContain('--ln-at-neon-intensity: var(--lg-neon, 0.5)');
    expect(atCss).not.toContain('color: var(--lg-neon');
  });

  it('uses accessible focus ring on cell input (2px solid neon)', () => {
    expect(atCss).toMatch(/table-editor-cell-input:focus[\s\S]*box-shadow:[\s\S]*0 0 0 2px var\(--ln-at-neon\)/);
  });

  it('styles context menu with inherited Liquid Neon tokens and neon hover', () => {
    expect(atCss).toContain('.menu');
    expect(atCss).toContain('.menu-item');
    expect(atCss).toMatch(/\.theme-dark \.table-editor-table,\s*\.theme-dark \.tablecontrols,\s*\.theme-dark \.menu \{/);
    expect(atCss).toMatch(/\.menu-item:hover[\s\S]*color:\s*var\(--ln-at-neon\)/);
  });
});
