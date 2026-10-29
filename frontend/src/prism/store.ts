// Prism (#1764) — framework-free singletons for Prism state.
//
// Two observable stores, consumed from React through usePrism.ts
// (useSyncExternalStore), modeled on comments/store.ts:
//
// - prismSettingsStore: per-book settings, loaded once from
//   `<Story.path>/prism.json`. Updates are optimistic and synchronous;
//   persistence runs through a per-book write chain so rapid toggles can't
//   interleave partial writes. Snapshots are frozen and only replaced on a
//   real change, so `get` is a stable reference between changes.
// - prismLiveStore: the latest findings + stats the manuscript editor's
//   PrismExtension published for each open scene, plus a `reveal` callback the
//   sidebar checklist uses to jump to a finding. Each editor on a scene keeps
//   its own entry; the last-focused one is served.

import {
  DEFAULT_PRISM_SETTINGS,
  applyPrismPatch,
  loadPrismSettings,
  savePrismSettings,
  type PrismSettingsPatch,
} from './settings';
import {
  PRISM_CHECK_IDS,
  type PrismFinding,
  type PrismSettings,
  type PrismStats,
} from './types';

type Listener = () => void;

// ── Per-book settings ───────────────────────────────────────────────────────

interface BookEntry {
  /** Vault-relative story root, once known — persistence is inert without it. */
  storyPath: string | null;
  /** Frozen snapshot — replaced (never mutated) on every change. */
  settings: PrismSettings;
  status: 'idle' | 'loading' | 'loaded';
  /** In-flight read of prism.json, if any. */
  loading: Promise<void> | null;
  /** Bumped per open(); a load whose token is stale is discarded. */
  loadToken: number;
  /**
   * Patches made before the file finished loading. They are re-applied over
   * the loaded file so a slow read never clobbers what the writer just did,
   * and they are saved only after that merge (an earlier write would replace
   * on-disk fields the writer never touched).
   */
  pending: PrismSettingsPatch[];
  /** Serialized write chain — each save awaits the previous one. */
  writeChain: Promise<void>;
}

function deepFreeze(s: PrismSettings): PrismSettings {
  Object.freeze(s.checks);
  Object.freeze(s.thresholds);
  return Object.freeze(s);
}

function sameSettings(a: PrismSettings, b: PrismSettings): boolean {
  if (a === b) return true;
  return (
    a.flags === b.flags &&
    a.proseColors === b.proseColors &&
    a.analyticsOpen === b.analyticsOpen &&
    a.thresholds.longSentenceWords === b.thresholds.longSentenceWords &&
    a.thresholds.overusedMinRepeats === b.thresholds.overusedMinRepeats &&
    a.thresholds.overusedWindowWords === b.thresholds.overusedWindowWords &&
    PRISM_CHECK_IDS.every((id) => a.checks[id] === b.checks[id])
  );
}

let books = new Map<string, BookEntry>();
const settingsListeners = new Set<Listener>();

/**
 * Surfaces showing the selected book (ManuscriptView, the sidebar) claim it as
 * the "current book"; the latest live claim wins. A scene editor whose scene
 * carries no storyId (optional in older frontmatter) reads this book's
 * settings, so the sidebar's switches still reach its marks.
 */
let currentBookClaims: Array<{ token: object; storyId: string }> = [];

function currentBookId(): string | null {
  return currentBookClaims[currentBookClaims.length - 1]?.storyId ?? null;
}

function notifySettings(): void {
  for (const l of [...settingsListeners]) l();
}

function bookEntry(storyId: string): BookEntry {
  let e = books.get(storyId);
  if (!e) {
    e = {
      storyPath: null,
      settings: DEFAULT_PRISM_SETTINGS,
      status: 'idle',
      loading: null,
      loadToken: 0,
      pending: [],
      writeChain: Promise.resolve(),
    };
    books.set(storyId, e);
  }
  return e;
}

/** Swap in `next` when it differs. Returns true when something changed. */
function setSettings(e: BookEntry, next: PrismSettings): boolean {
  if (sameSettings(e.settings, next)) return false;
  e.settings = deepFreeze(next);
  return true;
}

/** Queue a save of the current snapshot onto the book's write chain (never rejects). */
function persist(storyId: string): void {
  const e = books.get(storyId);
  if (!e?.storyPath) return; // path unknown yet — open() flushes later
  const path = e.storyPath;
  const snapshot = e.settings;
  e.writeChain = e.writeChain
    .then(() => {
      // Store was reset (tests / vault switch): drop writes for the old entry.
      if (books.get(storyId) !== e) return;
      return savePrismSettings(path, snapshot);
    })
    .catch(() => {
      // Non-fatal and silent: settings stay in memory; the next change
      // retries the write with the full snapshot.
    });
}

/** Merge the patches made while loading over `loaded` and settle the entry. */
function finishLoad(storyId: string, e: BookEntry, loaded: PrismSettings): void {
  const patches = e.pending;
  e.pending = [];
  const next = patches.reduce(applyPrismPatch, loaded);
  e.status = 'loaded';
  e.loading = null;
  if (setSettings(e, next)) notifySettings();
  if (patches.length > 0) persist(storyId);
}

export const prismSettingsStore = {
  /**
   * Bind a book to its vault path and load `<storyPath>/prism.json`.
   * Idempotent per (storyId, storyPath); a new path for the same id reloads.
   * A failed or missing file leaves the defaults in place, silently.
   */
  open(storyId: string, storyPath: string): void {
    const e = bookEntry(storyId);
    if (e.storyPath === storyPath && e.status !== 'idle') return;
    e.storyPath = storyPath;
    e.loadToken += 1;
    const token = e.loadToken;
    // No vault bridge (unit tests, storybook): nothing on disk to merge —
    // settle synchronously so React tests never see async notifies.
    if (typeof window === 'undefined' || typeof window.api?.readVault !== 'function') {
      finishLoad(storyId, e, e.settings);
      return;
    }
    e.status = 'loading';
    e.loading = loadPrismSettings(storyPath)
      .catch(() => null)
      .then((fromDisk) => {
        if (books.get(storyId) !== e || e.loadToken !== token) return;
        finishLoad(storyId, e, fromDisk ?? e.settings);
      });
  },

  /** Settings snapshot: the defaults until loaded / for unknown ids. Stable between changes. */
  get(storyId: string | null | undefined): PrismSettings {
    if (!storyId) return DEFAULT_PRISM_SETTINGS;
    return books.get(storyId)?.settings ?? DEFAULT_PRISM_SETTINGS;
  },

  /**
   * Optimistic update: memory changes and subscribers hear about it
   * synchronously; the save is queued. A book that was never opened (no path)
   * changes in memory only — open() merges and saves it later.
   */
  update(storyId: string, patch: PrismSettingsPatch): void {
    const e = bookEntry(storyId);
    if (e.status !== 'loaded') e.pending.push(patch);
    if (!setSettings(e, applyPrismPatch(e.settings, patch))) return;
    notifySettings();
    if (e.status === 'loaded') persist(storyId);
  },

  /**
   * Mark `storyId` as the book the writer has selected. Returns the release
   * for this claim; the previous claim (if still held) becomes current again.
   * Subscribers hear about a change of the current book.
   */
  claimCurrentBook(storyId: string): () => void {
    const before = currentBookId();
    const token = {};
    currentBookClaims = [...currentBookClaims, { token, storyId }];
    if (currentBookId() !== before) notifySettings();
    return () => {
      const prev = currentBookId();
      currentBookClaims = currentBookClaims.filter((c) => c.token !== token);
      if (currentBookId() !== prev) notifySettings();
    };
  },

  /** The selected book's id (see claimCurrentBook), or null. */
  getCurrentBookId(): string | null {
    return currentBookId();
  },

  /** Stable-identity subscribe for useSyncExternalStore. */
  subscribe(listener: Listener): () => void {
    settingsListeners.add(listener);
    return () => {
      settingsListeners.delete(listener);
    };
  },

  /**
   * Await the book's in-flight load and every queued write — test/shutdown
   * helper so callers can assert the on-disk state deterministically.
   */
  async flush(storyId: string): Promise<void> {
    for (;;) {
      const e = books.get(storyId);
      if (!e) return;
      const { loading, writeChain } = e;
      await loading;
      await writeChain;
      if (books.get(storyId) !== e) return;
      if (e.loading === null && e.writeChain === writeChain) return;
    }
  },
};

// ── Live findings (published by PrismExtension) ─────────────────────────────

export interface PrismLiveFinding extends PrismFinding {
  /** Document positions of the finding in the live editor. */
  docFrom: number;
  docTo: number;
  /** Surrounding sentence text (≤ 80 chars) shown in the checklist. */
  snippet: string;
}

export interface PrismLiveSnapshot {
  storyId: string | null;
  sceneId: string;
  /** ALL detected findings (unfiltered by settings). */
  findings: PrismLiveFinding[];
  stats: PrismStats;
  /** Select [from,to] in the live editor, scroll it into view and focus it. Clamps to the doc. */
  reveal(from: number, to: number): void;
}

/**
 * One scene can be open in several editors at once (split view with the same
 * scene in both panes, or an editor remounting over its predecessor). Each
 * editor keeps its own entry, keyed by its stable `reveal`; the store serves
 * the one the writer used last.
 */
interface LiveEntry {
  snapshot: PrismLiveSnapshot;
  /** Sequence of the editor's last focus (0 = never focused). */
  focusSeq: number;
  /** Sequence of the editor's last publish. */
  publishSeq: number;
}

let liveScenes = new Map<string, LiveEntry[]>();
let liveSeq = 0;
const liveListeners = new Set<Listener>();

function notifyLive(): void {
  for (const l of [...liveListeners]) l();
}

/**
 * The entry `get` serves: the most recently focused editor; among editors
 * never focused, the most recent publish. Focus outranks publishing so a
 * background pane that remounts (and republishes) can't take "Go to" away
 * from the pane the writer is typing in.
 */
function currentEntry(entries: readonly LiveEntry[] | undefined): LiveEntry | null {
  if (!entries || entries.length === 0) return null;
  let best = entries[0];
  for (const e of entries) {
    if (
      e.focusSeq > best.focusSeq ||
      (e.focusSeq === best.focusSeq && e.publishSeq > best.publishSeq)
    ) {
      best = e;
    }
  }
  return best;
}

/** Run `change` on the scene's entries; notify only when `get(sceneId)` changes. */
function changeScene(sceneId: string, change: (entries: LiveEntry[]) => LiveEntry[]): void {
  const prev = currentEntry(liveScenes.get(sceneId))?.snapshot ?? null;
  const next = change([...(liveScenes.get(sceneId) ?? [])]);
  if (next.length > 0) liveScenes.set(sceneId, next);
  else liveScenes.delete(sceneId);
  if ((currentEntry(next)?.snapshot ?? null) !== prev) notifyLive();
}

export const prismLiveStore = {
  /**
   * Store an editor's snapshot for its scene (the editor publishes after
   * every scan), replacing that editor's previous one.
   */
  publish(snapshot: PrismLiveSnapshot): void {
    liveSeq += 1;
    const publishSeq = liveSeq;
    changeScene(snapshot.sceneId, (entries) => {
      const i = entries.findIndex((e) => e.snapshot.reveal === snapshot.reveal);
      if (i >= 0) {
        entries[i] = { ...entries[i], snapshot, publishSeq };
        return entries;
      }
      return [...entries, { snapshot, focusSeq: 0, publishSeq }];
    });
  },

  /**
   * The editor identified by `reveal` received focus: serve its snapshot for
   * the scene from now on. No-op if that editor has not published.
   */
  touch(sceneId: string, reveal: PrismLiveSnapshot['reveal']): void {
    if (!liveScenes.get(sceneId)?.some((e) => e.snapshot.reveal === reveal)) return;
    liveSeq += 1;
    const focusSeq = liveSeq;
    changeScene(sceneId, (entries) =>
      entries.map((e) => (e.snapshot.reveal === reveal ? { ...e, focusSeq } : e))
    );
  },

  /**
   * Drop snapshots for the scene. With `reveal`, only that editor's — a
   * remounting editor's destroy must not wipe the snapshot its replacement
   * already published, and closing one of two panes on the same scene falls
   * back to the other. Without `reveal`, every editor's.
   */
  clear(sceneId: string, reveal?: PrismLiveSnapshot['reveal']): void {
    if (!liveScenes.has(sceneId)) return;
    changeScene(sceneId, (entries) =>
      reveal ? entries.filter((e) => e.snapshot.reveal !== reveal) : []
    );
  },

  /** The scene's current snapshot, or null. Stable reference between publishes. */
  get(sceneId: string | null | undefined): PrismLiveSnapshot | null {
    if (!sceneId) return null;
    return currentEntry(liveScenes.get(sceneId))?.snapshot ?? null;
  },

  /** Stable-identity subscribe for useSyncExternalStore. */
  subscribe(listener: Listener): () => void {
    liveListeners.add(listener);
    return () => {
      liveListeners.delete(listener);
    };
  },
};

/** Test-only: drop all books and live snapshots (queued writes for dropped books are skipped). */
export function __resetPrismStoresForTests(): void {
  books = new Map();
  currentBookClaims = [];
  liveScenes = new Map();
  notifySettings();
  notifyLive();
}
