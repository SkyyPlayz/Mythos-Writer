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
  resolveNoteOpenMode,
  subscribeNoteViewPrefs,
  writeDefaultRichPref,
  writeNoteModePref,
  writeShowMarkdownViewPref,
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

  it('always includes the current mode even when Settings-gated off', () => {
    expect(
      enabledGearModes({ showMarkdown: false, showSource: false, currentMode: 'source' }).map((m) => m.mode),
    ).toEqual(['rich', 'source']);
  });

  it('seeded modeByPath and defaultRich=0 survive (no migration wipe)', () => {
    writeDefaultRichPref(false);
    writeNoteModePref('Notes/Old.md', 'source');
    expect(readDefaultRichPref()).toBe(false);
    expect(readNoteModePref('Notes/Old.md')).toBe('source');
    // Re-read after a "fresh session" simulation — nothing rewrites prefs.
    expect(readDefaultRichPref()).toBe(false);
    expect(readNoteModePref('Notes/Old.md')).toBe('source');
  });

  it('Always-Rich ON opens Rich ignoring sticky; sticky stays stored', () => {
    writeNoteModePref('Notes/A.md', 'source');
    writeDefaultRichPref(true);
    expect(resolveNoteOpenMode({ path: 'Notes/A.md', defaultRich: true })).toBe('rich');
    expect(readNoteModePref('Notes/A.md')).toBe('source');
  });

  it('Always-Rich OFF restores sticky Source', () => {
    writeNoteModePref('Notes/A.md', 'source');
    writeDefaultRichPref(false);
    expect(resolveNoteOpenMode({ path: 'Notes/A.md', defaultRich: false })).toBe('source');
    expect(readNoteModePref('Notes/A.md')).toBe('source');
  });

  it('Markdown-only write does not clear sticky or overwrite Rich opt-out', () => {
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

  it('subscribeNoteViewPrefs fires on same-tab writes', () => {
    let n = 0;
    const unsub = subscribeNoteViewPrefs(() => { n += 1; });
    writeShowMarkdownViewPref(true);
    writeDefaultRichPref(false);
    expect(n).toBeGreaterThanOrEqual(2);
    unsub();
  });
});
