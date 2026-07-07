// Beta 3 M11 — Comments data model (types).
//
// The comment shape is a direct port of the Liquid Neon prototype
// (design-handoff/prototype/"Mythos Writer - Liquid Neon.dc.html" 3237–3241:
// `{id, scene, anchor, author, kind, text}`) mapped onto the app's real
// Story/Scene ids and extended with the fields the M23 archive plumbing and
// M22 Beta Reader need (`suggestionId`, `createdAt`, kind `'beta'`).
//
// This module is the single source of truth for manuscript comments — the
// M13 reader gutter and the M23 flags→comments pipeline both consume it.

/**
 * Who left the comment.
 * - `user`    — the writer (prototype color #ffd319).
 * - `writing` — Writing Assistant agent (slot-A neon, `--n1`).
 * - `archive` — Archive Agent continuity flag (prototype color #ff5f8f);
 *               carries the 3 actions (edit notes / suggest change / ignore).
 * - `beta`    — Beta Reader agent reactions (M22; slot-C neon, `--n3`).
 */
export type CommentKind = 'user' | 'writing' | 'archive' | 'beta';

export interface StoryComment {
  /** Unique id (`c-…`). */
  id: string;
  /** Owning story (manifest Story.id). */
  storyId: string;
  /** Owning scene (manifest Scene.id) — the anchor lives in this scene's text. */
  sceneId: string;
  /**
   * Exact substring of the scene text the comment is attached to. Underlines
   * are recomputed by substring search (prototype segsFor 3601–3615), so if
   * the text is edited past recognition the underline disappears while the
   * gutter card survives.
   */
  anchor: string;
  /** Display name shown on the gutter card ("You", "Archive Agent", …). */
  author: string;
  kind: CommentKind;
  /** The comment body. */
  text: string;
  /** ISO timestamp. */
  createdAt: string;
  /**
   * M23 hook: the archive/continuity Suggestion this comment surfaces.
   * When present, the three agent actions are enabled and dispatch through
   * the existing `window.api.archiveConfirm(suggestionId, action)` IPC
   * (see agentActions.ts). Without it the action buttons render as
   * clearly-marked disabled affordances.
   */
  suggestionId?: string;
}

/** Input for creating a comment. See store.ts `createComment` (the M23 hook). */
export interface CreateCommentInput {
  storyId: string;
  sceneId: string;
  anchor: string;
  text: string;
  /** Defaults to `'user'`. */
  kind?: CommentKind;
  /** Defaults per kind (see COMMENT_KIND_META). */
  author?: string;
  /** Attach an archive suggestion so the 3 agent actions are live (M23). */
  suggestionId?: string;
  /**
   * Vault-relative story root (Story.path, e.g. `stories/<id>`). Optional —
   * pass it when creating comments for a story the UI has not opened yet so
   * persistence can bind to `<storyPath>/comments.json` immediately.
   */
  storyPath?: string;
}

/** Display metadata per kind (prototype kMeta 4515 / kMeta2 4633). */
export const COMMENT_KIND_META: Record<CommentKind, { label: string; defaultAuthor: string }> = {
  user: { label: 'Comment', defaultAuthor: 'You' },
  writing: { label: 'Writing Assistant', defaultAuthor: 'Writing Assistant' },
  archive: { label: 'Archive Agent — continuity', defaultAuthor: 'Archive Agent' },
  beta: { label: 'Beta Reader', defaultAuthor: 'Beta Reader' },
};

const KINDS: readonly CommentKind[] = ['user', 'writing', 'archive', 'beta'];

export function isCommentKind(value: unknown): value is CommentKind {
  return typeof value === 'string' && (KINDS as readonly string[]).includes(value);
}

/** Selection length gate from the prototype pageMouseUp (3616–3620). */
export const MIN_ANCHOR_LENGTH = 4;
export const MAX_ANCHOR_LENGTH = 219;

export function isValidAnchor(text: string): boolean {
  return text.length >= MIN_ANCHOR_LENGTH && text.length <= MAX_ANCHOR_LENGTH;
}
