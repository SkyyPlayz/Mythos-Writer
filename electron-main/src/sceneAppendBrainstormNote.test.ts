// Unit tests for SCENE_APPEND_BRAINSTORM_NOTE (SKY-1391)
//
// Covers:
//   §1  Happy path — append with existing note content (separator inserted)
//   §2  Happy path — append with empty note (no separator)
//   §3  Empty content payload → no-op success, note unchanged
//   §4  Invalid sceneId → throws Error('Scene not found: ...')
//   §5  Frame guard — setupIpcMain rejects nested-frame invocations
//   §6  savedPath→sceneId mapping documentation assertion
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { openDb, closeDb, getNoteBySceneId } from './db.js';
import { defaultManifest } from './vault.js';
import { appendBrainstormNote } from './sceneAppendBrainstormNote.js';
import type { Manifest, SceneEntry, ChapterEntry } from './ipc.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeManifestWithScene(tmpDir: string): { manifest: Manifest; sceneId: string } {
  const manifest = defaultManifest(tmpDir);
  const now = new Date().toISOString();
  const sceneId = 'test-scene-uuid-001';

  const scene: SceneEntry = {
    id: sceneId,
    title: 'Opening',
    path: 'Manuscript/my-story/chapter-one/opening.md',
    order: 0,
    chapterId: 'ch-001',
    storyId: 'story-001',
    blocks: [],
    createdAt: now,
    updatedAt: now,
  };

  const chapter: ChapterEntry = {
    id: 'ch-001',
    title: 'Chapter One',
    path: 'Manuscript/my-story/chapter-one',
    order: 0,
    scenes: [scene],
    createdAt: now,
    updatedAt: now,
  };

  manifest.stories.push({
    id: 'story-001',
    title: 'My Story',
    path: 'Manuscript/my-story',
    chapters: [chapter],
    createdAt: now,
    updatedAt: now,
  });

  return { manifest, sceneId };
}

// ─── §1–§4: Business logic (real DB, no Electron mocks) ──────────────────────

describe('appendBrainstormNote', () => {
  let tmpDir: string;
  let manifest: Manifest;
  let sceneId: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-append-brainstorm-'));
    openDb(tmpDir);
    ({ manifest, sceneId } = makeManifestWithScene(tmpDir));
  });

  afterEach(() => {
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // §1 — append to existing note inserts separator
  it('appends with \\n---\\n separator when note already has content', () => {
    appendBrainstormNote(manifest, sceneId, 'First note');
    const result = appendBrainstormNote(manifest, sceneId, 'Second note');

    expect(result).toEqual({ appended: true });
    const stored = getNoteBySceneId(sceneId);
    expect(stored).toBe('First note\n---\nSecond note');
  });

  // §2 — first append to empty note has no separator
  it('stores content directly when note is empty (no leading separator)', () => {
    const result = appendBrainstormNote(manifest, sceneId, 'Brand new note');

    expect(result).toEqual({ appended: true });
    const stored = getNoteBySceneId(sceneId);
    expect(stored).toBe('Brand new note');
  });

  // §2 — multiple appends accumulate correctly
  it('accumulates three appends with separators', () => {
    appendBrainstormNote(manifest, sceneId, 'A');
    appendBrainstormNote(manifest, sceneId, 'B');
    appendBrainstormNote(manifest, sceneId, 'C');

    expect(getNoteBySceneId(sceneId)).toBe('A\n---\nB\n---\nC');
  });

  // §3 — empty content is a no-op
  it('returns { appended: false } and leaves note unchanged when content is empty', () => {
    appendBrainstormNote(manifest, sceneId, 'existing note');

    const result = appendBrainstormNote(manifest, sceneId, '');

    expect(result).toEqual({ appended: false });
    expect(getNoteBySceneId(sceneId)).toBe('existing note');
  });

  // §3 — empty content on a pristine scene also no-ops
  it('returns { appended: false } when content is empty and note has no prior content', () => {
    const result = appendBrainstormNote(manifest, sceneId, '');

    expect(result).toEqual({ appended: false });
    expect(getNoteBySceneId(sceneId)).toBe('');
  });

  // §4 — invalid sceneId throws descriptive error
  it('throws "Scene not found" error for an unknown sceneId', () => {
    expect(() =>
      appendBrainstormNote(manifest, 'nonexistent-scene-uuid', 'some content'),
    ).toThrow('Scene not found: nonexistent-scene-uuid');
  });

  // §4 — error message does not contain absolute path (safe to forward via sanitizeIpcError)
  it('error message contains only the sceneId, no filesystem path', () => {
    let msg = '';
    try {
      appendBrainstormNote(manifest, 'bad-id', 'x');
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toBe('Scene not found: bad-id');
    expect(msg).not.toMatch(/\//);
  });

  // §6 — savedPath documentation: scene UUID is the sceneId (no normalization)
  it('accepts the scene UUID from SceneEntry.id as sceneId (savedPath mapping)', () => {
    const firstScene = manifest.stories[0].chapters[0].scenes[0];
    const result = appendBrainstormNote(manifest, firstScene.id, 'Linked idea');

    expect(result).toEqual({ appended: true });
    expect(getNoteBySceneId(firstScene.id)).toBe('Linked idea');
  });
});

// ─── §5: Frame guard via setupIpcMain ────────────────────────────────────────

// Electron is mocked so we can register and invoke handlers without a real app.
type Handler = (...args: unknown[]) => unknown;
const handleMap = new Map<string, Handler>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: Handler) => { handleMap.set(channel, fn); },
    on: vi.fn(),
    off: vi.fn(),
  },
}));

describe('SCENE_APPEND_BRAINSTORM_NOTE frame guard (via setupIpcMain)', () => {
  beforeEach(() => { handleMap.clear(); });

  function makeTopFrame(): unknown {
    const f: { top: unknown } = { top: null };
    f.top = f;
    return f;
  }

  function makeNestedFrame(): unknown {
    const top: { top: unknown } = { top: null };
    top.top = top;
    return { top };
  }

  it('rejects nested-frame invocations with UNTRUSTED_FRAME_REJECTION', async () => {
    const { setupIpcMain, IPC_CHANNELS, UNTRUSTED_FRAME_REJECTION } = await import('./ipc.js');
    const stub = vi.fn().mockReturnValue({ appended: true });

    setupIpcMain({ [IPC_CHANNELS.SCENE_APPEND_BRAINSTORM_NOTE]: stub } as unknown as Parameters<typeof setupIpcMain>[0]);

    const fn = handleMap.get(IPC_CHANNELS.SCENE_APPEND_BRAINSTORM_NOTE)!;
    const result = await fn({ senderFrame: makeNestedFrame() }, { sceneId: 'x', content: 'y' });

    expect(result).toBe(UNTRUSTED_FRAME_REJECTION);
    expect(stub).not.toHaveBeenCalled();
  });

  it('forwards to the inner handler for top-frame invocations', async () => {
    const { setupIpcMain, IPC_CHANNELS } = await import('./ipc.js');
    const stub = vi.fn().mockReturnValue({ appended: true });

    setupIpcMain({ [IPC_CHANNELS.SCENE_APPEND_BRAINSTORM_NOTE]: stub } as unknown as Parameters<typeof setupIpcMain>[0]);

    const fn = handleMap.get(IPC_CHANNELS.SCENE_APPEND_BRAINSTORM_NOTE)!;
    const result = await fn(
      { senderFrame: makeTopFrame() },
      { sceneId: 'test-id', content: 'hello' },
    );

    expect(result).toEqual({ appended: true });
    expect(stub).toHaveBeenCalledWith({ sceneId: 'test-id', content: 'hello' });
  });
});
