import { afterEach, describe, expect, it } from 'vitest';
import {
  NOTES_DEFAULT_RICH_KEY,
  NOTES_MODE_BY_PATH_KEY,
  NOTES_SHOW_MARKDOWN_KEY,
  NOTES_SHOW_SOURCE_KEY,
  NOTES_VIEW_PREFS_VERSION,
  NOTES_VIEW_PREFS_VERSION_KEY,
  clearAllNoteModePrefs,
  enabledGearModes,
  ensureNoteViewPrefsReady,
  hydrateShowModesFromSettings,
  migrateNoteViewPrefsToV2,
  readDefaultRichPref,
  readNoteModePref,
  readShowMarkdownViewPref,
  readShowSourceViewPref,
  writeDefaultRichPref,
  writeNoteModePref,
  writeShowMarkdownViewPref,
} from './noteViewPrefs';

afterEach(() => {
  window.localStorage.removeItem(NOTES_DEFAULT_RICH_KEY);
  window.localStorage.removeItem(NOTES_MODE_BY_PATH_KEY);
  window.localStorage.removeItem(NOTES_SHOW_MARKDOWN_KEY);
  window.localStorage.removeItem(NOTES_SHOW_SOURCE_KEY);
  window.localStorage.removeItem(NOTES_VIEW_PREFS_VERSION_KEY);
});

describe('noteViewPrefs (F4#4)', () => {
  it('defaults to Rich-only gear modes (Markdown/Source hidden)', () => {
    window.localStorage.setItem(NOTES_VIEW_PREFS_VERSION_KEY, String(NOTES_VIEW_PREFS_VERSION));
    const modes = enabledGearModes();
    expect(modes.map((m) => m.mode)).toEqual(['rich']);
  });

  it('includes Markdown/Source only when enabled', () => {
    expect(enabledGearModes({ showMarkdown: true, showSource: false }).map((m) => m.mode)).toEqual([
      'rich',
      'markdown',
    ]);
    expect(enabledGearModes({ showMarkdown: true, showSource: true }).map((m) => m.mode)).toEqual([
      'rich',
      'markdown',
      'source',
    ]);
  });

  it('always includes the current mode even when Settings-gated off', () => {
    expect(
      enabledGearModes({ showMarkdown: false, showSource: false, currentMode: 'source' }).map((m) => m.mode),
    ).toEqual(['rich', 'source']);
  });

  it('Always-Rich write clears sticky; Markdown-only write does not', () => {
    writeNoteModePref('Notes/A.md', 'source');
    writeDefaultRichPref(false);
    expect(readDefaultRichPref()).toBe(false);

    writeDefaultRichPref(true);
    clearAllNoteModePrefs();
    expect(readDefaultRichPref()).toBe(true);
    expect(readNoteModePref('Notes/A.md')).toBeNull();

    writeNoteModePref('Notes/A.md', 'markdown');
    writeDefaultRichPref(false);
    writeShowMarkdownViewPref(true);
    expect(readShowMarkdownViewPref()).toBe(true);
    expect(readDefaultRichPref()).toBe(false);
    expect(readNoteModePref('Notes/A.md')).toBe('markdown');
  });

  it('clearAllNoteModePrefs wipes the sticky map', () => {
    writeNoteModePref('Notes/A.md', 'markdown');
    clearAllNoteModePrefs();
    expect(readNoteModePref('Notes/A.md')).toBeNull();
  });
});

describe('migrateNoteViewPrefsToV2 (F4 gate — existing users → Rich)', () => {
  it('seeds pre-F4 keys → Rich after migration, and runs once', () => {
    writeDefaultRichPref(false);
    writeNoteModePref('Notes/Old.md', 'source');
    expect(readDefaultRichPref()).toBe(false);
    expect(readNoteModePref('Notes/Old.md')).toBe('source');

    expect(migrateNoteViewPrefsToV2()).toBe(true);
    expect(readDefaultRichPref()).toBe(true);
    expect(readNoteModePref('Notes/Old.md')).toBeNull();
    expect(window.localStorage.getItem(NOTES_VIEW_PREFS_VERSION_KEY)).toBe(String(NOTES_VIEW_PREFS_VERSION));

    writeDefaultRichPref(false);
    writeNoteModePref('Notes/Keep.md', 'markdown');
    expect(migrateNoteViewPrefsToV2()).toBe(false);
    expect(readDefaultRichPref()).toBe(false);
    expect(readNoteModePref('Notes/Keep.md')).toBe('markdown');
  });

  it('ensureNoteViewPrefsReady hydrates showMarkdown/showSource from AppSettings', () => {
    window.localStorage.setItem(NOTES_VIEW_PREFS_VERSION_KEY, String(NOTES_VIEW_PREFS_VERSION));
    expect(readShowMarkdownViewPref()).toBe(false);
    ensureNoteViewPrefsReady({ showMarkdownView: true, showSourceView: true });
    expect(readShowMarkdownViewPref()).toBe(true);
    expect(readShowSourceViewPref()).toBe(true);
  });

  it('hydrateShowModesFromSettings does not touch alwaysOpenRich', () => {
    window.localStorage.setItem(NOTES_VIEW_PREFS_VERSION_KEY, String(NOTES_VIEW_PREFS_VERSION));
    writeDefaultRichPref(false);
    hydrateShowModesFromSettings({ showMarkdownView: true });
    expect(readDefaultRichPref()).toBe(false);
    expect(readShowMarkdownViewPref()).toBe(true);
  });
});
