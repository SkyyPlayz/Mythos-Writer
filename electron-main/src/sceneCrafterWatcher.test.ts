// SKY-1759: Unit tests for the Scene Crafter file-watcher conflict detection.
// Chokidar is mocked — tests verify the push-event / write-lock logic without
// touching the filesystem.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  watchBoardFile,
  stopBoardWatcher,
  beginBoardWrite,
  endBoardWrite,
} from './sceneCrafterWatcher.js';

// ─── Chokidar mock ────────────────────────────────────────────────────────────

type ChokidarEventMap = { change: (() => void)[] };

interface MockWatcher {
  _handlers: ChokidarEventMap;
  on(event: string, cb: () => void): MockWatcher;
  close(): Promise<void>;
  _triggerChange(): void;
}

function makeMockWatcher(): MockWatcher {
  const watcher: MockWatcher = {
    _handlers: { change: [] },
    on(event, cb) {
      if (event === 'change') watcher._handlers.change.push(cb);
      return watcher;
    },
    close: vi.fn().mockResolvedValue(undefined),
    _triggerChange() {
      for (const cb of watcher._handlers.change) cb();
    },
  };
  return watcher;
}

let mockWatcher: MockWatcher;

vi.mock('chokidar', () => ({
  default: {
    watch: vi.fn(() => mockWatcher),
  },
}));

// ─── Test helpers ─────────────────────────────────────────────────────────────

const BOARD_PATH = '/vault/notes/scenes/test-story/board.md';
const STORY_SLUG = 'test-story';

beforeEach(() => {
  mockWatcher = makeMockWatcher();
});

afterEach(async () => {
  await stopBoardWatcher();
  vi.clearAllMocks();
});

// ─── watchBoardFile ────────────────────────────────────────────────────────────

describe('watchBoardFile', () => {
  it('calls onExternalEdit when an external change event fires', async () => {
    const onExternalEdit = vi.fn();
    await watchBoardFile(BOARD_PATH, STORY_SLUG, onExternalEdit);

    mockWatcher._triggerChange();

    expect(onExternalEdit).toHaveBeenCalledOnce();
    expect(onExternalEdit).toHaveBeenCalledWith(STORY_SLUG);
  });

  it('does NOT call onExternalEdit when a write-lock is active', async () => {
    const onExternalEdit = vi.fn();
    await watchBoardFile(BOARD_PATH, STORY_SLUG, onExternalEdit);

    beginBoardWrite(BOARD_PATH);
    mockWatcher._triggerChange();

    expect(onExternalEdit).not.toHaveBeenCalled();
  });

  it('calls onExternalEdit again after the write-lock is released', async () => {
    const onExternalEdit = vi.fn();
    await watchBoardFile(BOARD_PATH, STORY_SLUG, onExternalEdit);

    beginBoardWrite(BOARD_PATH);
    mockWatcher._triggerChange();
    expect(onExternalEdit).not.toHaveBeenCalled();

    endBoardWrite(BOARD_PATH);
    mockWatcher._triggerChange();
    expect(onExternalEdit).toHaveBeenCalledOnce();
    expect(onExternalEdit).toHaveBeenCalledWith(STORY_SLUG);
  });

  it('passes the correct storySlug to onExternalEdit', async () => {
    const onExternalEdit = vi.fn();
    const slug = 'my-story';
    const boardPath = `/vault/notes/scenes/${slug}/board.md`;
    await watchBoardFile(boardPath, slug, onExternalEdit);

    mockWatcher._triggerChange();

    expect(onExternalEdit).toHaveBeenCalledWith(slug);
  });

  it('replaces a prior watcher when called again', async () => {
    const first = vi.fn();
    await watchBoardFile(BOARD_PATH, STORY_SLUG, first);
    const oldWatcher = mockWatcher;

    // Second call replaces the watcher
    mockWatcher = makeMockWatcher();
    const second = vi.fn();
    await watchBoardFile(BOARD_PATH, STORY_SLUG, second);

    // Old watcher is closed
    expect(oldWatcher.close).toHaveBeenCalled();

    // New watcher fires second callback
    mockWatcher._triggerChange();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });
});

// ─── stopBoardWatcher ─────────────────────────────────────────────────────────

describe('stopBoardWatcher', () => {
  it('closes the underlying chokidar watcher', async () => {
    await watchBoardFile(BOARD_PATH, STORY_SLUG, vi.fn());
    await stopBoardWatcher();

    expect(mockWatcher.close).toHaveBeenCalled();
  });

  it('is a no-op when no watcher is active', async () => {
    await expect(stopBoardWatcher()).resolves.toBeUndefined();
  });

  it('clears the write-lock set so previously locked paths are unlocked', async () => {
    const onExternalEdit = vi.fn();
    await watchBoardFile(BOARD_PATH, STORY_SLUG, onExternalEdit);

    beginBoardWrite(BOARD_PATH);
    await stopBoardWatcher();

    // Start a fresh watcher — the old lock should be gone
    mockWatcher = makeMockWatcher();
    await watchBoardFile(BOARD_PATH, STORY_SLUG, onExternalEdit);
    mockWatcher._triggerChange();

    expect(onExternalEdit).toHaveBeenCalledOnce();
  });
});

// ─── write-lock guard ─────────────────────────────────────────────────────────

describe('write-lock (beginBoardWrite / endBoardWrite)', () => {
  it('suppresses events for locked path but not for a different path', async () => {
    const OTHER_PATH = '/vault/notes/scenes/other-story/board.md';
    const onExternal = vi.fn();

    // Watch only the test path; simulate a second watcher for "other" manually
    const otherCb = vi.fn();
    await watchBoardFile(BOARD_PATH, STORY_SLUG, onExternal);

    beginBoardWrite(BOARD_PATH); // lock only BOARD_PATH

    mockWatcher._triggerChange();
    expect(onExternal).not.toHaveBeenCalled(); // suppressed

    // Direct endBoardWrite for a different path has no effect on BOARD_PATH lock
    endBoardWrite(OTHER_PATH);
    mockWatcher._triggerChange();
    expect(onExternal).not.toHaveBeenCalled(); // still suppressed

    endBoardWrite(BOARD_PATH);
    mockWatcher._triggerChange();
    expect(onExternal).toHaveBeenCalledOnce(); // now fires

    expect(otherCb).not.toHaveBeenCalled();
  });

  it('handles multiple beginBoardWrite / endBoardWrite calls independently', async () => {
    const onExternal = vi.fn();
    await watchBoardFile(BOARD_PATH, STORY_SLUG, onExternal);

    // Two concurrent writes
    beginBoardWrite(BOARD_PATH);
    beginBoardWrite(BOARD_PATH); // idempotent add on a Set

    endBoardWrite(BOARD_PATH); // one release
    mockWatcher._triggerChange();
    // Set.delete removes the single entry — lock is released after first endBoardWrite
    expect(onExternal).toHaveBeenCalledOnce();
  });
});
