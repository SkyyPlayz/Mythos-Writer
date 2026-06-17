import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const pluginDir = join(__dirname, '..', '..', 'plugin', 'Liquid-Neon-Companion');
const stylesCss = readFileSync(join(pluginDir, 'styles.css'), 'utf8');
const calendarCss = readFileSync(join(pluginDir, 'calendar-liquid-neon.css'), 'utf8');

describe('Liquid Neon Companion Calendar CSS', () => {
  it('is imported by the Obsidian plugin stylesheet', () => {
    expect(stylesCss).toContain("@import url('./calendar-liquid-neon.css')");
  });

  it('covers nav bar, day cells, today indicator, week numbers, dots, and modal', () => {
    expect(calendarCss).toMatch(/\.calendar[\s\S]*var\(--glass-fill/);
    expect(calendarCss).toMatch(/\.calendar td\.day[\s\S]*backdrop-filter:\s*blur\(var\(--lg-blur/);
    expect(calendarCss).toMatch(/\.today[\s\S]*var\(--ln-cal-neon\)/);
    expect(calendarCss).toContain('button.arrow');
    expect(calendarCss).toContain('button.title');
    expect(calendarCss).toContain('button.reset-button');
    expect(calendarCss).toContain('th.week-num');
    expect(calendarCss).toContain('td.week-num');
    expect(calendarCss).toContain('.dots');
    expect(calendarCss).toContain('.dot');
    expect(calendarCss).toContain('.modal:has(.calendar)');
    expect(calendarCss).toContain('.modal.calendar-modal');
  });

  it('keeps --lg-neon as an intensity token instead of using it as a color', () => {
    expect(calendarCss).not.toContain('var(--lg-neon, var(--neon-cyan');
    expect(calendarCss).toContain('--ln-cal-neon-intensity: var(--lg-neon, 0.5);');
  });

  it('includes reduced-motion and high-contrast media queries', () => {
    expect(calendarCss).toContain('@media (prefers-reduced-motion: reduce)');
    expect(calendarCss).toMatch(/@media \(prefers-reduced-transparency: reduce\)/);
  });

  it('uses Liquid Neon token fallbacks instead of raw Obsidian theme colors', () => {
    expect(calendarCss).not.toMatch(/--interactive-accent|--background-primary|--background-secondary|--text-normal/);
    expect(calendarCss).toMatch(/var\(--ln-cal-text\)/);
    expect(calendarCss).toMatch(/var\(--ln-cal-neon\)/);
  });
});
