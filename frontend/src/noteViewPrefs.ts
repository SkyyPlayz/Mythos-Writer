/**
 * F4#4 — note view preference helpers (shared by Settings → Editor and the
 * NoteViewer gear menu). Persistence is dual-written:
 *   · editorPrefs (AppSettings) — Settings SoT
 *   · localStorage — NoteViewer reads without a shell prop chain (F2 owns
 *     DesktopShell; F4 must not add mounts there)
 */

export const NOTES_DEFAULT_RICH_KEY = 'mythos:notes:defaultRich';
export const NOTES_MODE_BY_PATH_KEY = 'mythos:notes:modeByPath';
export const NOTES_SHOW_MARKDOWN_KEY = 'mythos:notes:showMarkdownView';
export const NOTES_SHOW_SOURCE_KEY = 'mythos:notes:showSourceView';

export type StickyNoteMode = 'rich' | 'markdown' | 'source';
export type NoteGearMode = StickyNoteMode;

export function readDefaultRichPref(): boolean {
  try {
    // Explicit '0' is the only opt-out; missing → Rich (default on).
    return window.localStorage.getItem(NOTES_DEFAULT_RICH_KEY) !== '0';
  } catch {
    return true;
  }
}

export function writeDefaultRichPref(on: boolean): void {
  try {
    if (on) window.localStorage.removeItem(NOTES_DEFAULT_RICH_KEY);
    else window.localStorage.setItem(NOTES_DEFAULT_RICH_KEY, '0');
  } catch {
    // storage unavailable — session toggle still works via React state
  }
}

export function readShowMarkdownViewPref(): boolean {
  try {
    return window.localStorage.getItem(NOTES_SHOW_MARKDOWN_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeShowMarkdownViewPref(on: boolean): void {
  try {
    if (on) window.localStorage.setItem(NOTES_SHOW_MARKDOWN_KEY, '1');
    else window.localStorage.removeItem(NOTES_SHOW_MARKDOWN_KEY);
  } catch {
    /* ignore */
  }
}

export function readShowSourceViewPref(): boolean {
  try {
    return window.localStorage.getItem(NOTES_SHOW_SOURCE_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeShowSourceViewPref(on: boolean): void {
  try {
    if (on) window.localStorage.setItem(NOTES_SHOW_SOURCE_KEY, '1');
    else window.localStorage.removeItem(NOTES_SHOW_SOURCE_KEY);
  } catch {
    /* ignore */
  }
}

export function readNoteModePref(path: string): StickyNoteMode | null {
  try {
    const raw = window.localStorage.getItem(NOTES_MODE_BY_PATH_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, StickyNoteMode>;
    return map[path] ?? null;
  } catch {
    return null;
  }
}

export function writeNoteModePref(path: string, mode: StickyNoteMode): void {
  try {
    const raw = window.localStorage.getItem(NOTES_MODE_BY_PATH_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, StickyNoteMode>) : {};
    map[path] = mode;
    window.localStorage.setItem(NOTES_MODE_BY_PATH_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

/** Clears every sticky per-note mode so "Always open in Rich" can apply. */
export function clearAllNoteModePrefs(): void {
  try {
    window.localStorage.removeItem(NOTES_MODE_BY_PATH_KEY);
  } catch {
    /* ignore */
  }
}

export const NOTE_GEAR_MODE_DEFS: Array<{ mode: NoteGearMode; label: string }> = [
  { mode: 'rich', label: 'Rich Text' },
  { mode: 'markdown', label: 'Markdown' },
  { mode: 'source', label: 'Source Mode' },
];

/** Modes shown in the gear: Rich always; Markdown/Source only when enabled. */
export function enabledGearModes(opts?: {
  showMarkdown?: boolean;
  showSource?: boolean;
}): Array<{ mode: NoteGearMode; label: string }> {
  const showMarkdown = opts?.showMarkdown ?? readShowMarkdownViewPref();
  const showSource = opts?.showSource ?? readShowSourceViewPref();
  return NOTE_GEAR_MODE_DEFS.filter(({ mode }) => {
    if (mode === 'rich') return true;
    if (mode === 'markdown') return showMarkdown;
    if (mode === 'source') return showSource;
    const _exhaustive: never = mode;
    return _exhaustive;
  });
}

/**
 * Sync Settings editorPrefs → localStorage bridge (and optionally clear
 * sticky modes when Always-open-Rich is turned on so the setting applies).
 */
export function syncNoteViewPrefsFromSettings(prefs: {
  alwaysOpenRich?: boolean;
  showMarkdownView?: boolean;
  showSourceView?: boolean;
}): void {
  if (prefs.alwaysOpenRich !== undefined) {
    writeDefaultRichPref(prefs.alwaysOpenRich);
    if (prefs.alwaysOpenRich) clearAllNoteModePrefs();
  }
  if (prefs.showMarkdownView !== undefined) {
    writeShowMarkdownViewPref(prefs.showMarkdownView);
  }
  if (prefs.showSourceView !== undefined) {
    writeShowSourceViewPref(prefs.showSourceView);
  }
}
