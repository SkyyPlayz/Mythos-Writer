/**
 * F4#4 — note view preference helpers (shared by Settings → Editor and the
 * NoteViewer gear menu).
 *
 * Source of truth: **localStorage** (`mythos:notes:*`). Gear and Settings both
 * read/write these keys directly. Writes notify same-tab subscribers so an
 * already-open note's gear updates without remount. No editorPrefs mirror,
 * no one-time migration/wipe.
 */

export const NOTES_DEFAULT_RICH_KEY = 'mythos:notes:defaultRich';
export const NOTES_MODE_BY_PATH_KEY = 'mythos:notes:modeByPath';
export const NOTES_SHOW_MARKDOWN_KEY = 'mythos:notes:showMarkdownView';
export const NOTES_SHOW_SOURCE_KEY = 'mythos:notes:showSourceView';

/** Dispatched on `window` after any same-tab note-view pref write. */
export const NOTES_VIEW_PREFS_CHANGED_EVENT = 'mythos:notes:viewPrefsChanged';

export type StickyNoteMode = 'rich' | 'markdown' | 'source';
export type NoteGearMode = StickyNoteMode;

const STICKY_MODES: readonly StickyNoteMode[] = ['rich', 'markdown', 'source'];

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function notifyNoteViewPrefsChanged(): void {
  try {
    window.dispatchEvent(new Event(NOTES_VIEW_PREFS_CHANGED_EVENT));
  } catch {
    /* ignore */
  }
}

/** Subscribe to same-tab + cross-tab view-pref changes. Returns unsubscribe. */
export function subscribeNoteViewPrefs(listener: () => void): () => void {
  const onCustom = () => listener();
  const onStorage = (e: StorageEvent) => {
    if (
      e.key === NOTES_DEFAULT_RICH_KEY
      || e.key === NOTES_SHOW_MARKDOWN_KEY
      || e.key === NOTES_SHOW_SOURCE_KEY
      || e.key === NOTES_MODE_BY_PATH_KEY
      || e.key === null
    ) {
      listener();
    }
  };
  window.addEventListener(NOTES_VIEW_PREFS_CHANGED_EVENT, onCustom);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(NOTES_VIEW_PREFS_CHANGED_EVENT, onCustom);
    window.removeEventListener('storage', onStorage);
  };
}

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
  notifyNoteViewPrefsChanged();
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
  notifyNoteViewPrefsChanged();
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
  notifyNoteViewPrefsChanged();
}

export function readNoteModePref(path: string): StickyNoteMode | null {
  try {
    const raw = window.localStorage.getItem(NOTES_MODE_BY_PATH_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isPlainObject(parsed)) return null;
    if (!Object.prototype.hasOwnProperty.call(parsed, path)) return null;
    const v = parsed[path];
    if (typeof v !== 'string') return null;
    if (!(STICKY_MODES as readonly string[]).includes(v)) return null;
    return v as StickyNoteMode;
  } catch {
    return null;
  }
}

export function writeNoteModePref(path: string, mode: StickyNoteMode): void {
  try {
    const raw = window.localStorage.getItem(NOTES_MODE_BY_PATH_KEY);
    let map: Record<string, StickyNoteMode> = {};
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (isPlainObject(parsed)) {
        map = parsed as Record<string, StickyNoteMode>;
      }
    }
    map[path] = mode;
    window.localStorage.setItem(NOTES_MODE_BY_PATH_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
  notifyNoteViewPrefsChanged();
}

/** Clears every sticky per-note mode (legacy helper; Always-Rich no longer wipes). */
export function clearAllNoteModePrefs(): void {
  try {
    window.localStorage.removeItem(NOTES_MODE_BY_PATH_KEY);
  } catch {
    /* ignore */
  }
  notifyNoteViewPrefsChanged();
}

/**
 * Resolve the open mode for a note.
 * When Always-Rich is ON, sticky per-path modes are ignored at open (but left
 * stored so turning Always-Rich OFF restores them). Never rewrites defaultRich='0'.
 */
export function resolveNoteOpenMode(opts: {
  path: string;
  modeProp?: StickyNoteMode | 'preview' | null;
  previewMode?: boolean;
  defaultRich?: boolean;
}): StickyNoteMode | 'preview' {
  if (opts.modeProp) return opts.modeProp;
  if (opts.previewMode) return 'preview';
  const alwaysRich = opts.defaultRich ?? readDefaultRichPref();
  if (alwaysRich) return 'rich';
  const sticky = readNoteModePref(opts.path);
  return sticky ?? 'source';
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
