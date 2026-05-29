import { describe, it, expect } from 'vitest';
import MANIFEST from './manifest';

describe('shortcuts manifest', () => {
  it('has at least one entry', () => {
    expect(MANIFEST.length).toBeGreaterThan(0);
  });

  it('every entry has a unique id', () => {
    const ids = MANIFEST.map((e) => e.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('every entry has a valid group', () => {
    const validGroups = new Set(['modes', 'vault', 'editor', 'brainstorm', 'navigation', 'dialogs', 'help']);
    for (const entry of MANIFEST) {
      expect(validGroups.has(entry.group), `entry "${entry.id}" has unknown group "${entry.group}"`).toBe(true);
    }
  });

  it('every entry has a valid scope', () => {
    const validScopes = new Set(['global', 'editor', 'list', 'dialog', 'tree']);
    for (const entry of MANIFEST) {
      expect(validScopes.has(entry.scope), `entry "${entry.id}" has unknown scope "${entry.scope}"`).toBe(true);
    }
  });

  it('every entry has at least one key combo', () => {
    for (const entry of MANIFEST) {
      expect(entry.keys.length, `entry "${entry.id}" has no key combos`).toBeGreaterThan(0);
    }
  });

  it('every key combo has a non-empty key', () => {
    for (const entry of MANIFEST) {
      for (const combo of entry.keys) {
        expect(combo.key.length, `entry "${entry.id}" has empty key string`).toBeGreaterThan(0);
      }
    }
  });

  it('help group contains the ? shortcut', () => {
    const helpEntries = MANIFEST.filter((e) => e.group === 'help');
    expect(helpEntries.length).toBeGreaterThan(0);
    const questionMark = helpEntries.find((e) => e.keys.some((k) => k.key === '?'));
    expect(questionMark).toBeDefined();
  });

  it('global scope entries have Escape or modifier keys (collision sanity)', () => {
    // Verify no bare unmodified alpha key fires globally (would steal from editor)
    const bareGlobalAlpha = MANIFEST.filter(
      (e) =>
        e.scope === 'global' &&
        e.keys.some(
          (k) =>
            !k.mod &&
            k.key.length === 1 &&
            /[a-zA-Z]/.test(k.key) &&
            k.key !== '?',
        ),
    );
    expect(
      bareGlobalAlpha.map((e) => e.id),
      'Global shortcuts with bare alpha keys would steal from the editor',
    ).toHaveLength(0);
  });
});
