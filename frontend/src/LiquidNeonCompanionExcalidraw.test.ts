import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const pluginDir = join(__dirname, '..', '..', 'plugin', 'Liquid-Neon-Companion');
const stylesCss = readFileSync(join(pluginDir, 'styles.css'), 'utf8');
const excalidrawCss = readFileSync(join(pluginDir, 'excalidraw-liquid-neon.css'), 'utf8');

describe('Liquid Neon Companion Excalidraw CSS', () => {
  it('is imported by the Obsidian plugin stylesheet', () => {
    expect(stylesCss).toContain("@import url('./excalidraw-liquid-neon.css')");
  });

  it('covers toolbar, color picker, Island panel, dialogs, and context menu', () => {
    expect(excalidrawCss).toMatch(/\.App-toolbar-container[\s\S]*var\(--glass-fill/);
    expect(excalidrawCss).toMatch(/\.ToolIcon[\s\S]*backdrop-filter:\s*blur\(var\(--lg-blur/);
    expect(excalidrawCss).toMatch(/\.ToolIcon\.is-selected[\s\S]*var\(--ln-ex-neon/);
    expect(excalidrawCss).toContain('.color-picker-label-swatch');
    expect(excalidrawCss).toContain('.color-picker-hex-input');
    expect(excalidrawCss).toContain('.Island');
    expect(excalidrawCss).toContain('.Dialog');
    expect(excalidrawCss).toContain('.context-menu');
    expect(excalidrawCss).toContain('.library-button');
    expect(excalidrawCss).toContain('.Tooltip');
  });

  it('keeps --lg-neon as an intensity token instead of using it as a color', () => {
    expect(excalidrawCss).not.toContain('var(--lg-neon, var(--neon-cyan');
    expect(excalidrawCss).toContain('--ln-ex-neon-intensity: var(--lg-neon, 0.5);');
  });

  it('includes reduced-motion and high-contrast media queries', () => {
    expect(excalidrawCss).toContain('@media (prefers-reduced-motion: reduce)');
    expect(excalidrawCss).toMatch(/@media \(prefers-reduced-transparency: reduce\)/);
  });

  it('uses Liquid Neon token fallbacks instead of raw Obsidian theme colors', () => {
    expect(excalidrawCss).not.toMatch(/--interactive-accent|--background-primary|--background-secondary|--text-normal/);
    expect(excalidrawCss).toMatch(/var\(--ln-ex-text\)/);
    expect(excalidrawCss).toMatch(/var\(--ln-ex-neon\)/);
  });
});
