// Beta 3 M11 — comments persistence: envelope round-trip, tolerant parsing,
// and the vault-IPC load/save adapters.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  COMMENTS_FILE_BASENAME,
  COMMENTS_FILE_VERSION,
  commentsFilePath,
  loadCommentsFile,
  parseCommentsFile,
  saveCommentsFile,
  serializeCommentsFile,
} from './persistence';
import type { StoryComment } from './types';

function mkComment(over: Partial<StoryComment> = {}): StoryComment {
  return {
    id: 'c1',
    storyId: 'story-1',
    sceneId: 's1',
    anchor: 'lantern cast a trembling circle of light',
    author: 'Archive Agent',
    kind: 'archive',
    text: 'Continuity: oil-lit in Ch. 1 but crystal-lit later.',
    createdAt: '2026-07-07T00:00:00.000Z',
    ...over,
  };
}

describe('commentsFilePath', () => {
  it('joins the story root with comments.json', () => {
    expect(commentsFilePath('stories/story-1')).toBe('stories/story-1/comments.json');
  });

  it('strips trailing slashes', () => {
    expect(commentsFilePath('stories/story-1///')).toBe('stories/story-1/comments.json');
  });

  it('handles an empty root', () => {
    expect(commentsFilePath('')).toBe(COMMENTS_FILE_BASENAME);
  });

  it('stays inside the vault IPC allow-list (.json, no dotfiles)', () => {
    const p = commentsFilePath('stories/story-1');
    expect(p.endsWith('.json')).toBe(true);
    expect(p.split('/').some((seg) => seg.startsWith('.'))).toBe(false);
  });
});

describe('serialize → parse round-trip', () => {
  it('preserves every field including suggestionId', () => {
    const comments = [
      mkComment({ suggestionId: 'sug-9' }),
      mkComment({ id: 'c2', kind: 'user', author: 'You', text: 'Love this beat.' }),
      mkComment({ id: 'c3', kind: 'beta', author: 'Beta Reader' }),
    ];
    expect(parseCommentsFile(serializeCommentsFile(comments))).toEqual(comments);
  });

  it('writes a versioned envelope with trailing newline', () => {
    const raw = serializeCommentsFile([mkComment()]);
    expect(raw.endsWith('\n')).toBe(true);
    const env = JSON.parse(raw) as { version: number; comments: unknown[] };
    expect(env.version).toBe(COMMENTS_FILE_VERSION);
    expect(env.comments).toHaveLength(1);
  });

  it('omits suggestionId when absent (no undefined keys on disk)', () => {
    const raw = serializeCommentsFile([mkComment()]);
    expect(raw).not.toContain('suggestionId');
  });

  it('renames legacy Writing Assistant authors to Writing Coach on read (M9)', () => {
    const raw = serializeCommentsFile([
      mkComment({ id: 'c-old', kind: 'writing', author: 'Writing Assistant' }),
      mkComment({ id: 'c-user', kind: 'user', author: 'Writing Assistant' }),
    ]);
    const parsed = parseCommentsFile(raw);
    // Agent comments never surface the stale pre-Coach name…
    expect(parsed[0].author).toBe('Writing Coach');
    // …but a user who happens to sign that way is left untouched.
    expect(parsed[1].author).toBe('Writing Assistant');
  });
});

describe('parseCommentsFile tolerance', () => {
  it('returns [] on malformed JSON', () => {
    expect(parseCommentsFile('{nope')).toEqual([]);
  });

  it('returns [] on non-object payloads', () => {
    expect(parseCommentsFile('42')).toEqual([]);
    expect(parseCommentsFile('"str"')).toEqual([]);
    expect(parseCommentsFile('null')).toEqual([]);
  });

  it('accepts a bare array (pre-envelope shape)', () => {
    const raw = JSON.stringify([mkComment()]);
    expect(parseCommentsFile(raw)).toHaveLength(1);
  });

  it('drops entries missing required string fields', () => {
    const raw = JSON.stringify({
      version: 1,
      comments: [
        mkComment(),
        { id: 'x' }, // missing everything else
        { ...mkComment({ id: 'bad-anchor' }), anchor: '' },
        { ...mkComment({ id: 'bad-id' }), id: '' },
        null,
        'string',
        7,
      ],
    });
    const out = parseCommentsFile(raw);
    expect(out.map((c) => c.id)).toEqual(['c1']);
  });

  it('defaults unknown kinds to user and fills author/createdAt', () => {
    const raw = JSON.stringify({
      version: 1,
      comments: [{ ...mkComment(), kind: 'martian', author: '', createdAt: 42 }],
    });
    const [c] = parseCommentsFile(raw);
    expect(c.kind).toBe('user');
    expect(c.author).toBe('You');
    expect(typeof c.createdAt).toBe('string');
  });

  it('drops non-string suggestionId values', () => {
    const raw = JSON.stringify({ version: 1, comments: [{ ...mkComment(), suggestionId: 9 }] });
    expect(parseCommentsFile(raw)[0].suggestionId).toBeUndefined();
  });
});

describe('vault IPC adapters', () => {
  const readVault = vi.fn();
  const writeVault = vi.fn();

  beforeEach(() => {
    readVault.mockReset();
    writeVault.mockReset();
    Object.defineProperty(window, 'api', {
      value: { readVault, writeVault },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    delete (window as { api?: unknown }).api;
  });

  it('loadCommentsFile reads <storyPath>/comments.json and parses it', async () => {
    const comments = [mkComment()];
    readVault.mockResolvedValue({
      content: serializeCommentsFile(comments),
      path: 'stories/story-1/comments.json',
    });
    await expect(loadCommentsFile('stories/story-1')).resolves.toEqual(comments);
    expect(readVault).toHaveBeenCalledWith('stories/story-1/comments.json');
  });

  it('loadCommentsFile treats a read failure (ENOENT) as empty', async () => {
    readVault.mockRejectedValue(new Error('ENOENT'));
    await expect(loadCommentsFile('stories/story-1')).resolves.toEqual([]);
  });

  it('loadCommentsFile yields [] without the bridge', async () => {
    delete (window as { api?: unknown }).api;
    await expect(loadCommentsFile('stories/story-1')).resolves.toEqual([]);
  });

  it('saveCommentsFile writes the serialized envelope through writeVault', async () => {
    writeVault.mockResolvedValue({ path: 'stories/story-1/comments.json', bytes: 10 });
    const comments = [mkComment()];
    await saveCommentsFile('stories/story-1', comments);
    expect(writeVault).toHaveBeenCalledWith(
      'stories/story-1/comments.json',
      serializeCommentsFile(comments)
    );
  });

  it('saveCommentsFile no-ops without the bridge', async () => {
    delete (window as { api?: unknown }).api;
    await expect(saveCommentsFile('stories/story-1', [mkComment()])).resolves.toBeUndefined();
  });
});
