// Beta 3 M11 — the comments store (framework-free singleton).
//
// One observable store holds every open story's comments; React consumes it
// through useStoryComments.ts (useSyncExternalStore), and NON-React callers
// (the M23 archive plumbing, the M22 Beta Reader) create comments through
// `createComment(...)` below. State updates are synchronous; persistence to
// `<Story.path>/comments.json` runs through a per-story write chain so
// concurrent mutations can't interleave partial writes.
//
// ── M23 HOOK — programmatic comment creation ────────────────────────────────
//
// The archive flags→comments pipeline (and any other agent) files a
// manuscript comment like this:
//
//   import { createComment } from '../comments';
//
//   createComment({
//     storyId: story.id,
//     storyPath: story.path,          // binds persistence if the story isn't open yet
//     sceneId: scene.id,
//     anchor: 'lantern cast a trembling circle of light',  // exact scene substring
//     text: 'Continuity: this lantern is oil-lit in Ch. 1 …',
//     kind: 'archive',                // colors + enables the 3 agent actions
//     suggestionId: suggestion.id,    // REQUIRED for live agent actions — the
//                                     // buttons dispatch archiveConfirm(suggestionId, action)
//   });
//
// The comment appears in the manuscript gutter immediately (subscribers are
// notified synchronously), persists across restarts, and — because
// `suggestionId` is set — its "Edit notes to match / Suggest story change /
// Ignore" buttons are live, wired to the existing `archive:confirm` IPC
// (see agentActions.ts). Omit `suggestionId` for informational comments
// (Beta Reader reactions): the action row renders disabled.

import { loadCommentsFile, saveCommentsFile } from './persistence';
import { COMMENT_KIND_META, type CreateCommentInput, type StoryComment } from './types';

interface StoryEntry {
  /** Vault-relative story root, once known — persistence is inert without it. */
  storyPath: string | null;
  /** Immutable snapshot array — replaced (never mutated) on every change. */
  comments: StoryComment[];
  /** Set once the on-disk file has been merged in. */
  loaded: boolean;
  loading: Promise<void> | null;
  /** Serialized write chain — each save awaits the previous one. */
  writeChain: Promise<void>;
}

type Listener = () => void;

/**
 * Session-scoped visibility flags (prototype state 3242:
 * `showComments:true / commentsInFocus:false`). Deliberately NOT persisted —
 * the prototype resets them per session and they are pure view preferences.
 */
export interface CommentsUiState {
  /** Master toggle — the doc-header/zoombar comments chip. */
  showComments: boolean;
  /** Focus-mode override: keep comments visible while panels are hidden. */
  commentsInFocus: boolean;
}

const DEFAULT_UI: CommentsUiState = Object.freeze({
  showComments: true,
  commentsInFocus: false,
});

const EMPTY: readonly StoryComment[] = Object.freeze([]);

function newEntry(): StoryEntry {
  return { storyPath: null, comments: [], loaded: false, loading: null, writeChain: Promise.resolve() };
}

let idCounter = 0;
function generateCommentId(): string {
  idCounter += 1;
  return `c-${Date.now().toString(36)}-${idCounter.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

class CommentsStore {
  private entries = new Map<string, StoryEntry>();
  private listeners = new Set<Listener>();
  private ui: CommentsUiState = DEFAULT_UI;

  /** Stable-identity subscribe for useSyncExternalStore. */
  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private notify(): void {
    for (const l of [...this.listeners]) l();
  }

  private entry(storyId: string): StoryEntry {
    let e = this.entries.get(storyId);
    if (!e) {
      e = newEntry();
      this.entries.set(storyId, e);
    }
    return e;
  }

  /** Snapshot of a story's comments (stable reference between mutations). */
  list(storyId: string | null | undefined): readonly StoryComment[] {
    if (!storyId) return EMPTY;
    return this.entries.get(storyId)?.comments ?? EMPTY;
  }

  /** Visibility flags snapshot (stable reference — useSyncExternalStore-safe). */
  uiState = (): CommentsUiState => this.ui;

  setShowComments(value: boolean): void {
    if (this.ui.showComments === value) return;
    this.ui = { ...this.ui, showComments: value };
    this.notify();
  }

  setCommentsInFocus(value: boolean): void {
    if (this.ui.commentsInFocus === value) return;
    this.ui = { ...this.ui, commentsInFocus: value };
    this.notify();
  }

  /**
   * Bind a story to its vault path and load `<storyPath>/comments.json`.
   * Idempotent; safe to call on every story selection. Comments created
   * before open() (e.g. by an agent) survive the merge — in-memory entries
   * win on id collision.
   */
  async open(storyId: string, storyPath: string): Promise<void> {
    const e = this.entry(storyId);
    e.storyPath = storyPath;
    if (e.loaded) return;
    // No vault bridge (unit tests, storybook): nothing on disk to merge —
    // mark loaded synchronously so React tests never see async notifies.
    if (typeof window === 'undefined' || typeof window.api?.readVault !== 'function') {
      e.loaded = true;
      return;
    }
    if (!e.loading) {
      e.loading = (async () => {
        const fromDisk = await loadCommentsFile(storyPath);
        const memIds = new Set(e.comments.map((c) => c.id));
        const merged = [...fromDisk.filter((c) => !memIds.has(c.id)), ...e.comments];
        const hadUnsaved = e.comments.length > 0;
        e.comments = merged;
        e.loaded = true;
        e.loading = null;
        this.notify();
        // Flush comments that were created before the path was known.
        if (hadUnsaved) this.persist(storyId);
      })();
    }
    return e.loading;
  }

  /**
   * Create a comment (THE M23 hook — see the module doc-comment above).
   * Synchronous state update; persistence is queued. Returns the created
   * comment.
   */
  create(input: CreateCommentInput): StoryComment {
    const kind = input.kind ?? 'user';
    const comment: StoryComment = {
      id: generateCommentId(),
      storyId: input.storyId,
      sceneId: input.sceneId,
      anchor: input.anchor,
      text: input.text,
      kind,
      author: input.author ?? COMMENT_KIND_META[kind].defaultAuthor,
      createdAt: new Date().toISOString(),
      ...(input.suggestionId ? { suggestionId: input.suggestionId } : {}),
    };
    const e = this.entry(input.storyId);
    if (input.storyPath && !e.storyPath) e.storyPath = input.storyPath;
    e.comments = [...e.comments, comment];
    this.notify();
    this.persist(input.storyId);
    return comment;
  }

  /** Remove (resolve) a comment. Returns true when something was removed. */
  resolve(storyId: string, commentId: string): boolean {
    const e = this.entries.get(storyId);
    if (!e) return false;
    const next = e.comments.filter((c) => c.id !== commentId);
    if (next.length === e.comments.length) return false;
    e.comments = next;
    this.notify();
    this.persist(storyId);
    return true;
  }

  /** Queue a save onto the story's write chain (never rejects). */
  private persist(storyId: string): void {
    const e = this.entries.get(storyId);
    if (!e?.storyPath) return; // path unknown yet — open() will flush later
    const path = e.storyPath;
    e.writeChain = e.writeChain
      .then(() => saveCommentsFile(path, this.entries.get(storyId)?.comments ?? []))
      .catch((err) => {
        // Non-fatal: comments stay in memory; next mutation retries the write.
        console.error('Failed to persist comments:', err);
      });
  }

  /**
   * Await all pending writes for a story — test/shutdown helper so callers
   * can assert the on-disk state deterministically.
   */
  async flush(storyId: string): Promise<void> {
    const e = this.entries.get(storyId);
    if (e) await e.writeChain;
  }

  /** Drop all state (unit tests / vault switches that recycle story ids). */
  reset(): void {
    this.entries.clear();
    this.ui = DEFAULT_UI;
    this.notify();
  }
}

/** The app-wide singleton. */
export const commentsStore = new CommentsStore();

/**
 * Convenience export of the M23 hook — creates a comment programmatically.
 * See the module doc-comment for the full contract and an example.
 */
export function createComment(input: CreateCommentInput): StoryComment {
  return commentsStore.create(input);
}
