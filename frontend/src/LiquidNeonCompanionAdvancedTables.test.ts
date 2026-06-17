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

  it('covers toolbar, formula bar, control rows, and source-mode table elements', () => {
    // Advanced Tables uses its own class names; source-mode uses CodeMirror classes
    expect(atCss).toContain('.advanced-tables-toolbar');
    expect(atCss).toContain('.advanced-tables-formula-bar');
    expect(atCss).toContain('.advanced-tables-control-bar');
    expect(atCss).toContain('.clickable-icon');
    expect(atCss).toContain('.cm-hmd-table-sep');
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

  it('uses accessible focus ring on toolbar buttons (2px outline, neon)', () => {
    // Toolbar buttons use focus-visible outline; formula bar uses focus-within ring on the wrapper
    expect(atCss).toMatch(/advanced-tables-toolbar button:focus-visible[\s\S]*outline:\s*2px solid var\(--ln-at-neon\)/);
  });

  it('styles context menu with Liquid Neon glass and neon hover', () => {
    expect(atCss).toContain('.theme-dark .menu');
    expect(atCss).toContain('.theme-dark .menu-item');
    // Menu hover uses --neon-cyan directly (not the scoped --ln-at-neon token)
    expect(atCss).toMatch(/\.theme-dark \.menu-item:hover[\s\S]*color:\s*var\(--neon-cyan/);
  });
});
