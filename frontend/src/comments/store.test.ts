// Beta 3 M11 — comments store: create/resolve, open-merge, write-chain
// persistence, UI visibility flags, and the M23 programmatic hook.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { commentsStore, createComment } from './store';
import { serializeCommentsFile } from './persistence';
import type { StoryComment } from './types';

const readVault = vi.fn();
const writeVault = vi.fn();

function installApi() {
  Object.defineProperty(window, 'api', {
    value: { readVault, writeVault },
    writable: true,
    configurable: true,
  });
}

function diskComment(over: Partial<StoryComment> = {}): StoryComment {
  return {
    id: 'disk-1',
    storyId: 'story-1',
    sceneId: 's1',
    anchor: 'from the disk',
    author: 'You',
    kind: 'user',
    text: 'persisted earlier',
    createdAt: '2026-07-06T00:00:00.000Z',
    ...over,
  };
}

beforeEach(() => {
  commentsStore.reset();
  readVault.mockReset();
  writeVault.mockReset();
  readVault.mockRejectedValue(new Error('ENOENT'));
  writeVault.mockResolvedValue({ path: 'x', bytes: 1 });
});

afterEach(() => {
  commentsStore.reset();
  delete (window as { api?: unknown }).api;
});

describe('create / list / resolve', () => {
  it('creates a comment with per-kind default author and notifies', () => {
    const listener = vi.fn();
    const unsub = commentsStore.subscribe(listener);
    const c = commentsStore.create({
      storyId: 'story-1',
      sceneId: 's1',
      anchor: 'a stolen loaf',
      text: 'keep this beat',
    });
    expect(c.kind).toBe('user');
    expect(c.author).toBe('You');
    expect(c.id).toMatch(/^c-/);
    expect(Date.parse(c.createdAt)).not.toBeNaN();
    expect(commentsStore.list('story-1')).toEqual([c]);
    expect(listener).toHaveBeenCalled();
    unsub();
  });

  it('generates unique ids across rapid creates', () => {
    const ids = new Set(
      Array.from({ length: 50 }, () =>
        commentsStore.create({ storyId: 'story-1', sceneId: 's1', anchor: 'aaaa', text: 't' }).id
      )
    );
    expect(ids.size).toBe(50);
  });

  it('respects explicit kind, author and suggestionId', () => {
    const c = commentsStore.create({
      storyId: 'story-1',
      sceneId: 's1',
      anchor: 'the lantern',
      text: 'continuity flag',
      kind: 'archive',
      suggestionId: 'sug-1',
    });
    expect(c.kind).toBe('archive');
    expect(c.author).toBe('Archive Agent');
    expect(c.suggestionId).toBe('sug-1');
  });

  it('list returns a stable snapshot between mutations and EMPTY for unknowns', () => {
    expect(commentsStore.list('nope')).toEqual([]);
    expect(commentsStore.list(null)).toBe(commentsStore.list(undefined));
    commentsStore.create({ storyId: 'story-1', sceneId: 's1', anchor: 'aaaa', text: 't' });
    const snap1 = commentsStore.list('story-1');
    expect(commentsStore.list('story-1')).toBe(snap1);
    commentsStore.create({ storyId: 'story-1', sceneId: 's1', anchor: 'bbbb', text: 't2' });
    expect(commentsStore.list('story-1')).not.toBe(snap1);
  });

  it('resolve removes by id and reports misses', () => {
    const c = commentsStore.create({ storyId: 'story-1', sceneId: 's1', anchor: 'aaaa', text: 't' });
    expect(commentsStore.resolve('story-1', 'missing')).toBe(false);
    expect(commentsStore.resolve('other-story', c.id)).toBe(false);
    expect(commentsStore.resolve('story-1', c.id)).toBe(true);
    expect(commentsStore.list('story-1')).toEqual([]);
  });

  it('createComment (the M23 hook) delegates to the store', () => {
    const c = createComment({
      storyId: 'story-1',
      sceneId: 's1',
      anchor: 'flagged span',
      text: 'Continuity: …',
      kind: 'archive',
      suggestionId: 'sug-7',
    });
    expect(commentsStore.list('story-1')).toEqual([c]);
  });
});

describe('open() — disk merge and binding', () => {
  it('loads comments.json once and merges disk before memory', async () => {
    installApi();
    readVault.mockResolvedValue({
      content: serializeCommentsFile([diskComment()]),
      path: 'stories/story-1/comments.json',
    });
    const mem = commentsStore.create({
      storyId: 'story-1',
      sceneId: 's1',
      anchor: 'created pre-open',
      text: 'agent filed this before the story was opened',
    });
    await commentsStore.open('story-1', 'stories/story-1');
    expect(commentsStore.list('story-1').map((c) => c.id)).toEqual(['disk-1', mem.id]);
    // Idempotent: second open() does not re-read.
    await commentsStore.open('story-1', 'stories/story-1');
    expect(readVault).toHaveBeenCalledTimes(1);
  });

  it('in-memory comments win on id collision', async () => {
    installApi();
    readVault.mockResolvedValue({
      content: serializeCommentsFile([diskComment({ id: 'dup', text: 'stale disk copy' })]),
      path: 'x',
    });
    commentsStore.create({ storyId: 'story-1', sceneId: 's1', anchor: 'aaaa', text: 'fresh' });
    // Force the id collision through the disk file only — create() ids are
    // unique, so simulate by loading twice with the created id.
    const created = commentsStore.list('story-1')[0];
    readVault.mockResolvedValue({
      content: serializeCommentsFile([diskComment({ id: created.id, text: 'stale disk copy' })]),
      path: 'x',
    });
    await commentsStore.open('story-1', 'stories/story-1');
    const texts = commentsStore.list('story-1').map((c) => c.text);
    expect(texts).toEqual(['fresh']);
  });

  it('flushes comments created before open() to disk after binding', async () => {
    installApi();
    commentsStore.create({ storyId: 'story-1', sceneId: 's1', anchor: 'aaaa', text: 'pre-open' });
    expect(writeVault).not.toHaveBeenCalled();
    await commentsStore.open('story-1', 'stories/story-1');
    await commentsStore.flush('story-1');
    expect(writeVault).toHaveBeenCalledWith(
      'stories/story-1/comments.json',
      expect.stringContaining('pre-open')
    );
  });

  it('marks loaded synchronously when the vault bridge is absent', async () => {
    // No window.api installed.
    await commentsStore.open('story-1', 'stories/story-1');
    expect(commentsStore.list('story-1')).toEqual([]);
  });
});

describe('persistence write chain', () => {
  it('persists each mutation with the latest snapshot', async () => {
    installApi();
    await commentsStore.open('story-1', 'stories/story-1');
    const a = commentsStore.create({ storyId: 'story-1', sceneId: 's1', anchor: 'aaaa', text: 'A' });
    commentsStore.create({ storyId: 'story-1', sceneId: 's1', anchor: 'bbbb', text: 'B' });
    commentsStore.resolve('story-1', a.id);
    await commentsStore.flush('story-1');
    const lastPayload = writeVault.mock.calls.at(-1)?.[1] as string;
    expect(lastPayload).toContain('"B"');
    expect(lastPayload).not.toContain('"A"');
  });

  it('serializes writes — a failed write does not break the chain', async () => {
    installApi();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await commentsStore.open('story-1', 'stories/story-1');
    writeVault.mockRejectedValueOnce(new Error('disk full'));
    commentsStore.create({ storyId: 'story-1', sceneId: 's1', anchor: 'aaaa', text: 'first' });
    commentsStore.create({ storyId: 'story-1', sceneId: 's1', anchor: 'bbbb', text: 'second' });
    await commentsStore.flush('story-1');
    expect(writeVault).toHaveBeenCalledTimes(2);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('does not write while the story path is unknown', async () => {
    installApi();
    commentsStore.create({ storyId: 'story-1', sceneId: 's1', anchor: 'aaaa', text: 't' });
    await commentsStore.flush('story-1');
    expect(writeVault).not.toHaveBeenCalled();
  });
});

describe('UI visibility flags', () => {
  it('defaults to showComments on / commentsInFocus off', () => {
    expect(commentsStore.uiState()).toEqual({ showComments: true, commentsInFocus: false });
  });

  it('returns a stable snapshot and only notifies on real changes', () => {
    const listener = vi.fn();
    const unsub = commentsStore.subscribe(listener);
    const before = commentsStore.uiState();
    commentsStore.setShowComments(true); // no-op
    expect(commentsStore.uiState()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
    commentsStore.setShowComments(false);
    expect(commentsStore.uiState().showComments).toBe(false);
    expect(commentsStore.uiState()).not.toBe(before);
    commentsStore.setCommentsInFocus(true);
    expect(commentsStore.uiState().commentsInFocus).toBe(true);
    expect(listener).toHaveBeenCalledTimes(2);
    unsub();
  });

  it('reset() restores the defaults', () => {
    commentsStore.setShowComments(false);
    commentsStore.setCommentsInFocus(true);
    commentsStore.reset();
    expect(commentsStore.uiState()).toEqual({ showComments: true, commentsInFocus: false });
  });
});
