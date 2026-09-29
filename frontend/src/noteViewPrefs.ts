/**
 * F4#4 — note view preference helpers (shared by Settings → Editor and the
 * NoteViewer gear menu).
 *
 * Source of truth: **localStorage** (`mythos:notes:*`). Gear and Settings both
 * read/write these keys directly — there is no per-`patch()` bridge that syncs
 * every Editor control into localStorage. Settings mirrors into `editorPrefs`
 * on view-toggle change for Save; on mount, saved showMarkdown/showSource are
 * hydrated into localStorage so the gear matches after a restart.
 */

export const NOTES_DEFAULT_RICH_KEY = 'mythos:notes:defaultRich';
export const NOTES_MODE_BY_PATH_KEY = 'mythos:notes:modeByPath';
export const NOTES_SHOW_MARKDOWN_KEY = 'mythos:notes:showMarkdownView';
export const NOTES_SHOW_SOURCE_KEY = 'mythos:notes:showSourceView';
/** Versioned one-time migration flag (F4 gate: existing users → Rich). */
export const NOTES_VIEW_PREFS_VERSION_KEY = 'mythos:notes:viewPrefsV';
export const NOTES_VIEW_PREFS_VERSION = 2;

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

/**
 * One-time migration (viewPrefsV → 2): force Rich default and clear sticky
 * Source/Markdown per-note modes for EXISTING users. Idempotent — returns
 * true only when the migration actually ran.
 */
export function migrateNoteViewPrefsToV2(): boolean {
  try {
    const raw = window.localStorage.getItem(NOTES_VIEW_PREFS_VERSION_KEY);
    const v = raw == null || raw === '' ? 0 : Number(raw);
    if (Number.isFinite(v) && v >= NOTES_VIEW_PREFS_VERSION) return false;
    writeDefaultRichPref(true);
    clearAllNoteModePrefs();
    window.localStorage.setItem(NOTES_VIEW_PREFS_VERSION_KEY, String(NOTES_VIEW_PREFS_VERSION));
    return true;
  } catch {
    return false;
  }
}

/**
 * Push saved AppSettings Markdown/Source enablement into localStorage so the
 * gear matches Settings after a restart. Does not touch alwaysOpenRich
 * (localStorage is SoT after migrateNoteViewPrefsToV2).
 */
export function hydrateShowModesFromSettings(ep?: {
  showMarkdownView?: boolean;
  showSourceView?: boolean;
} | null): void {
  if (!ep) return;
  if (ep.showMarkdownView !== undefined) {
    writeShowMarkdownViewPref(!!ep.showMarkdownView);
  }
  if (ep.showSourceView !== undefined) {
    writeShowSourceViewPref(!!ep.showSourceView);
  }
}

/** Run migration then hydrate show-mode flags. Call on NoteViewer / Settings mount. */
export function ensureNoteViewPrefsReady(ep?: {
  showMarkdownView?: boolean;
  showSourceView?: boolean;
} | null): void {
  migrateNoteViewPrefsToV2();
  hydrateShowModesFromSettings(ep);
}

export const NOTE_GEAR_MODE_DEFS: Array<{ mode: NoteGearMode; label: string }> = [
  { mode: 'rich', label: 'Rich Text' },
  { mode: 'markdown', label: 'Markdown' },
  { mode: 'source', label: 'Source Mode' },
];

/** Modes shown in the gear: Rich always; Markdown/Source when enabled or current. */
export function enabledGearModes(opts?: {
  showMarkdown?: boolean;
  showSource?: boolean;
  /** Always include the mode the note is currently in (even if Settings-gated off). */
  currentMode?: NoteGearMode | 'preview' | string;
}): Array<{ mode: NoteGearMode; label: string }> {
  const showMarkdown = opts?.showMarkdown ?? readShowMarkdownViewPref();
  const showSource = opts?.showSource ?? readShowSourceViewPref();
  const current = opts?.currentMode;
  return NOTE_GEAR_MODE_DEFS.filter(({ mode }) => {
    if (mode === 'rich') return true;
    if (mode === current) return true;
    if (mode === 'markdown') return showMarkdown;
    if (mode === 'source') return showSource;
    const _exhaustive: never = mode;
    return _exhaustive;
  });
}
