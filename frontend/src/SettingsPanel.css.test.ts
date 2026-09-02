import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const srcDir = __dirname;

function readSrcCss(filename: string): string {
  return readFileSync(resolve(srcDir, filename), 'utf8');
}

// SKY-10908: prefers-reduced-transparency mistakenly got bundled into the K8
// high-contrast opaque override, so turning off Windows transparency effects
// silently blanked the settings overlay and hid BackgroundStack even though
// the spec (PLAN.md §2-B) scopes the opaque override to high-contrast only.
describe('SettingsPanel overlay opacity overrides (SKY-10908)', () => {
  it('defaults the overlay to transparent so BackgroundStack reads through the glass panel', () => {
    const css = readSrcCss('SettingsPanel.css');
    const base = css.match(/\.settings-overlay\s*\{([^}]*)\}/);
    expect(base).not.toBeNull();
    expect(base![1]).toContain('background: transparent;');
  });

  it('keeps the K8 high-contrast opaque override, both the app setting and the OS preference path', () => {
    const css = readSrcCss('SettingsPanel.css');
    expect(css).toMatch(/\[data-contrast="high"\] \.settings-overlay\s*\{\s*background: var\(--bg-canvas\);/);
    expect(css).toMatch(/@media \(prefers-contrast: more\)\s*\{\s*\.settings-overlay\s*\{\s*background: var\(--bg-canvas\);/);
  });

  it('does not blank the overlay on prefers-reduced-transparency (exceeds the M4/M28 spec, SKY-10908)', () => {
    const css = readSrcCss('SettingsPanel.css');
    expect(css).not.toMatch(/@media \(prefers-reduced-transparency: reduce\)\s*\{\s*\.settings-overlay\s*\{/);
  });
});
