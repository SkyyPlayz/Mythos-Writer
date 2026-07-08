// Beta 3 M11 — comment persistence through the existing vault IPC.
//
// Comments persist per-story as `<Story.path>/comments.json` in the Story
// Vault, written through the same `window.api.readVault` / `writeVault`
// channels the scene editor uses (electron-main enforces the .md/.json +
// no-dotfile allow-list at the IPC boundary — safeVaultIpcJoin). The file is
// a versioned envelope so later milestones can migrate the shape without
// guessing.

import { isCommentKind, type StoryComment } from './types';

export const COMMENTS_FILE_VERSION = 1;
export const COMMENTS_FILE_BASENAME = 'comments.json';

interface CommentsFileEnvelope {
  version: number;
  comments: StoryComment[];
}

/** Vault-relative path of a story's comments file (`stories/<id>/comments.json`). */
export function commentsFilePath(storyPath: string): string {
  const trimmed = storyPath.replace(/\/+$/, '');
  return trimmed ? `${trimmed}/${COMMENTS_FILE_BASENAME}` : COMMENTS_FILE_BASENAME;
}

function sanitizeComment(raw: unknown): StoryComment | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (
    typeof r.id !== 'string' ||
    typeof r.storyId !== 'string' ||
    typeof r.sceneId !== 'string' ||
    typeof r.anchor !== 'string' ||
    typeof r.text !== 'string' ||
    r.id === '' ||
    r.anchor === ''
  ) {
    return null;
  }
  const kind = isCommentKind(r.kind) ? r.kind : 'user';
  return {
    id: r.id,
    storyId: r.storyId,
    sceneId: r.sceneId,
    anchor: r.anchor,
    text: r.text,
    kind,
    author: typeof r.author === 'string' && r.author ? r.author : 'You',
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : new Date(0).toISOString(),
    ...(typeof r.suggestionId === 'string' && r.suggestionId
      ? { suggestionId: r.suggestionId }
      : {}),
  };
}

/**
 * Parse a comments.json payload. Tolerant by design: malformed JSON, a wrong
 * envelope, or invalid entries degrade to "fewer comments", never a throw —
 * a corrupt sidecar file must not take the manuscript down with it.
 */
export function parseCommentsFile(rawText: string): StoryComment[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return [];
  }
  if (typeof parsed !== 'object' || parsed === null) return [];
  const list = Array.isArray((parsed as CommentsFileEnvelope).comments)
    ? (parsed as CommentsFileEnvelope).comments
    : Array.isArray(parsed)
      ? (parsed as unknown[])
      : [];
  const out: StoryComment[] = [];
  for (const entry of list) {
    const c = sanitizeComment(entry);
    if (c) out.push(c);
  }
  return out;
}

export function serializeCommentsFile(comments: readonly StoryComment[]): string {
  const envelope: CommentsFileEnvelope = {
    version: COMMENTS_FILE_VERSION,
    comments: [...comments],
  };
  return `${JSON.stringify(envelope, null, 2)}\n`;
}

/**
 * Load a story's comments from the vault. A missing file (first run) or an
 * unavailable IPC bridge (unit tests, storybook) yields [].
 */
export async function loadCommentsFile(storyPath: string): Promise<StoryComment[]> {
  const api = window.api;
  if (typeof api?.readVault !== 'function') return [];
  try {
    const res = await api.readVault(commentsFilePath(storyPath));
    return parseCommentsFile(res.content);
  } catch {
    // ENOENT before the first comment is saved — treat as empty.
    return [];
  }
}

/** Persist a story's comments. No-ops (resolved) when the bridge is absent. */
export async function saveCommentsFile(
  storyPath: string,
  comments: readonly StoryComment[]
): Promise<void> {
  const api = window.api;
  if (typeof api?.writeVault !== 'function') return;
  await api.writeVault(commentsFilePath(storyPath), serializeCommentsFile(comments));
}
