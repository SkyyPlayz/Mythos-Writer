import { afterEach, describe, expect, it } from 'vitest';
import {
  NOTES_DEFAULT_RICH_KEY,
  NOTES_MODE_BY_PATH_KEY,
  NOTES_SHOW_MARKDOWN_KEY,
  NOTES_SHOW_SOURCE_KEY,
  clearAllNoteModePrefs,
  enabledGearModes,
  readDefaultRichPref,
  readNoteModePref,
  readShowMarkdownViewPref,
  readShowSourceViewPref,
  syncNoteViewPrefsFromSettings,
  writeDefaultRichPref,
  writeNoteModePref,
} from './noteViewPrefs';

afterEach(() => {
  window.localStorage.removeItem(NOTES_DEFAULT_RICH_KEY);
  window.localStorage.removeItem(NOTES_MODE_BY_PATH_KEY);
  window.localStorage.removeItem(NOTES_SHOW_MARKDOWN_KEY);
  window.localStorage.removeItem(NOTES_SHOW_SOURCE_KEY);
});

describe('noteViewPrefs (F4#4)', () => {
  it('defaults to Rich-only gear modes (Markdown/Source hidden)', () => {
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

  it('syncNoteViewPrefsFromSettings writes bridge keys and clears sticky when Always-Rich turns on', () => {
    writeNoteModePref('Notes/A.md', 'source');
    writeDefaultRichPref(false);
    expect(readDefaultRichPref()).toBe(false);
    expect(readNoteModePref('Notes/A.md')).toBe('source');

    syncNoteViewPrefsFromSettings({
      alwaysOpenRich: true,
      showMarkdownView: true,
      showSourceView: false,
    });

    expect(readDefaultRichPref()).toBe(true);
    expect(readShowMarkdownViewPref()).toBe(true);
    expect(readShowSourceViewPref()).toBe(false);
    expect(readNoteModePref('Notes/A.md')).toBeNull();
  });

  it('clearAllNoteModePrefs wipes the sticky map', () => {
    writeNoteModePref('Notes/A.md', 'markdown');
    clearAllNoteModePrefs();
    expect(readNoteModePref('Notes/A.md')).toBeNull();
  });
});
