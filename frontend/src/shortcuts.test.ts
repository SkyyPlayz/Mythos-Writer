import { describe, it, expect } from 'vitest';
import { buildShortcutGroups, SHORTCUT_GROUPS } from './shortcuts';

describe('buildShortcutGroups', () => {
  it('returns an array of groups', () => {
    const groups = buildShortcutGroups('Ctrl');
    expect(Array.isArray(groups)).toBe(true);
    expect(groups.length).toBeGreaterThan(0);
  });

  it('interpolates the mod key into shortcut strings', () => {
    const ctrlGroups = buildShortcutGroups('Ctrl');
    const cmdGroups = buildShortcutGroups('⌘');
    const ctrlGlobal = ctrlGroups.find((g) => g.label === 'Global')!;
    const cmdGlobal = cmdGroups.find((g) => g.label === 'Global')!;
    const ctrlN = ctrlGlobal.entries.find((e) => e.action === 'Switch to Normal mode')!;
    const cmdN = cmdGlobal.entries.find((e) => e.action === 'Switch to Normal mode')!;
    expect(ctrlN.keys[0]).toBe('Ctrl+Shift+N');
    expect(cmdN.keys[0]).toBe('⌘+Shift+N');
  });

  it('every group has a label string', () => {
    const groups = buildShortcutGroups('Ctrl');
    for (const group of groups) {
      expect(typeof group.label).toBe('string');
      expect(group.label.length).toBeGreaterThan(0);
    }
  });

  it('every entry has at least one key and a non-empty action', () => {
    const groups = buildShortcutGroups('Ctrl');
    for (const group of groups) {
      for (const entry of group.entries) {
        expect(entry.keys.length).toBeGreaterThan(0);
        expect(typeof entry.action).toBe('string');
        expect(entry.action.length).toBeGreaterThan(0);
      }
    }
  });

  it('includes expected group labels', () => {
    const labels = buildShortcutGroups('Ctrl').map((g) => g.label);
    expect(labels).toContain('Global');
    expect(labels).toContain('Editor — Navigation');
    expect(labels).toContain('Editor — Text (Tiptap)');
    expect(labels).toContain('Story Navigator');
    expect(labels).toContain('Suggestion Review');
    expect(labels).toContain('Brainstorm & Writing Coach');
    expect(labels).toContain('Search Bar');
    expect(labels).toContain('Sidebars');
  });
});

describe('SHORTCUT_GROUPS', () => {
  it('is a non-empty pre-built array', () => {
    expect(Array.isArray(SHORTCUT_GROUPS)).toBe(true);
    expect(SHORTCUT_GROUPS.length).toBeGreaterThan(0);
  });

  it('contains the Keyboard Shortcuts help entry', () => {
    const allEntries = SHORTCUT_GROUPS.flatMap((g) => g.entries);
    const helpEntry = allEntries.find((e) => e.action === 'Open Keyboard Shortcuts help');
    expect(helpEntry).toBeDefined();
    expect(helpEntry!.keys.length).toBeGreaterThanOrEqual(1);
  });
});
