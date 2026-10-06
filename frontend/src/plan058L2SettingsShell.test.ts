/**
 * PLAN-058 L2 — red-on-revert pins for Settings shell chrome.
 * Each assertion fails if the named chrome is reverted.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { SETTINGS_CATEGORIES } from './settingsCategories';

const src = (rel: string) => readFileSync(resolve(__dirname, rel), 'utf-8');

describe('PLAN-058 L2 settings shell pins', () => {
  it('45:11 / 18:03: Vault & Files is second and Voice is above Writing partner', () => {
    const ids = SETTINGS_CATEGORIES.map((c) => c.id);
    expect(ids[0]).toBe('appearance');
    expect(ids[1]).toBe('vaults');
    expect(ids[2]).toBe('voice');
    expect(ids.indexOf('writingPartner')).toBeLessThan(ids.indexOf('agents'));
    expect(ids.at(-1)).toBe('account');
  });

  it('06:55: title bar is a full-width sibling above the nav rail', () => {
    const shell = src('DesktopShell.tsx');
    const css = src('DesktopShell.css');
    const bar = shell.indexOf('<WindowChrome');
    const body = shell.indexOf('className="desktop-shell__body"');
    expect(bar).toBeGreaterThan(-1);
    expect(body).toBeGreaterThan(bar);
    expect(css).toContain('.desktop-shell > .wc-bar');
    expect(css).toContain('--shell-titlebar-height: 0px');
  });

  it('03:36 / 09:46 / 10:20 / 18:22 / 48:47: centered column, glass inputs, overflow', () => {
    const css = src('SettingsPanel.css');
    expect(css).toContain('.settings-content-column');
    expect(css).toContain('width: min(880px, 100%)');
    expect(css).toContain('background-color: rgba(255, 255, 255, 0.05)');
    expect(css).toContain('.settings-section:not(.m24-root)');
    expect(css).toContain('overflow-x: hidden');
    expect(src('partner/WritingPartnerSection.css')).toContain('max-width: none');
  });

  it('10:00: category switch resets the settings body scroll', () => {
    const panel = src('SettingsPanel.tsx');
    expect(panel).toContain('settingsBodyRef.current.scrollTop = 0');
  });

  it('12:23 / 12:44: Agent transcript and Provider Configuration are unmounted', () => {
    const panel = src('SettingsPanel.tsx');
    const master = src('components/SettingsPanel/sections/AiMasterSection.tsx');
    expect(panel).not.toContain('<ProviderSection');
    expect(master).not.toContain('agent-transcript-placement');
    expect(master).not.toContain('Dump into chat');
  });

  it('15:00 / 15:22: memory list and red Format vault', () => {
    expect(src('partner/WritingPartnerSection.tsx')).toContain('wp-memory-list');
    expect(src('components/SettingsPanel/sections/VaultAutoLinkerSection.tsx')).toContain('settings-btn-danger');
    expect(src('components/SettingsPanel/sections/VaultAutoLinkerSection.tsx')).toContain('format-vault-now');
  });

  it('21:16 / 21:49: dictation is a static offline line; defaults are dropdowns', () => {
    const editor = src('components/SettingsPanel/sections/EditorSettingsSection.tsx');
    expect(editor).toContain('data-testid="editor-dictation-offline"');
    expect(editor).not.toContain("key: 'dictation'");
    expect(editor).toContain('aria-label="Default note view"');
    expect(editor).toContain('aria-label="Default manuscript zoom"');
    const start = editor.indexOf('export const EDITOR_PREFS_DEFAULTS');
    const bodyStart = editor.indexOf('= {', start);
    const bodyEnd = editor.indexOf('};', bodyStart);
    expect(editor.slice(bodyStart, bodyEnd)).not.toContain('defaultZoom');
  });
});
