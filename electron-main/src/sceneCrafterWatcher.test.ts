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

  it('reuses the existing watcher on a repeat watch of the same path (audit P4: no churn)', async () => {
    const chokidar = (await import('chokidar')).default;
    const first = vi.fn();
    await watchBoardFile(BOARD_PATH, STORY_SLUG, first);
    expect(vi.mocked(chokidar.watch)).toHaveBeenCalledTimes(1);

    const second = vi.fn();
    await watchBoardFile(BOARD_PATH, STORY_SLUG, second);

    // Same path: no new chokidar watcher is created, nothing is closed…
    expect(vi.mocked(chokidar.watch)).toHaveBeenCalledTimes(1);
    expect(mockWatcher.close).not.toHaveBeenCalled();

    // …and the latest callback wins.
    mockWatcher._triggerChange();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledWith(STORY_SLUG);
  });

  it('replaces the watcher when called with a different path', async () => {
    const first = vi.fn();
    await watchBoardFile(BOARD_PATH, STORY_SLUG, first);
    const oldWatcher = mockWatcher;

    // Second call for another board replaces the watcher
    mockWatcher = makeMockWatcher();
    const second = vi.fn();
    await watchBoardFile('/vault/notes/scenes/other-story/board.md', 'other-story', second);

    // Old watcher is closed
    expect(oldWatcher.close).toHaveBeenCalled();

    // New watcher fires second callback
    mockWatcher._triggerChange();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledWith('other-story');
  });

  it('serializes concurrent same-path calls so no watcher is orphaned (audit P4)', async () => {
    const chokidar = (await import('chokidar')).default;
    const first = vi.fn();
    const second = vi.fn();

    // Fire both without awaiting — simulates GET_BOARD/CREATE_BOARD calling
    // watchBoardFile fire-and-forget back to back.
    const p1 = watchBoardFile(BOARD_PATH, STORY_SLUG, first);
    const p2 = watchBoardFile(BOARD_PATH, STORY_SLUG, second);
    await Promise.all([p1, p2]);

    // Exactly one watcher exists — the calls could not interleave and each
    // create one (which would orphan the overwritten watcher).
    expect(vi.mocked(chokidar.watch)).toHaveBeenCalledTimes(1);
    expect(mockWatcher.close).not.toHaveBeenCalled();

    mockWatcher._triggerChange();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });

  it('serializes concurrent different-path calls — the first watcher is closed, not orphaned (audit P4)', async () => {
    const chokidar = (await import('chokidar')).default;
    const firstWatcher = makeMockWatcher();
    const secondWatcher = makeMockWatcher();
    vi.mocked(chokidar.watch)
      .mockImplementationOnce(() => firstWatcher as unknown as ReturnType<typeof chokidar.watch>)
      .mockImplementationOnce(() => secondWatcher as unknown as ReturnType<typeof chokidar.watch>);

    const onFirst = vi.fn();
    const onSecond = vi.fn();
    const p1 = watchBoardFile(BOARD_PATH, STORY_SLUG, onFirst);
    const p2 = watchBoardFile('/vault/notes/scenes/other-story/board.md', 'other-story', onSecond);
    await Promise.all([p1, p2]);

    // Two watchers created, the first closed → exactly one left alive.
    expect(vi.mocked(chokidar.watch)).toHaveBeenCalledTimes(2);
    expect(firstWatcher.close).toHaveBeenCalledOnce();
    expect(secondWatcher.close).not.toHaveBeenCalled();

    secondWatcher._triggerChange();
    expect(onFirst).not.toHaveBeenCalled();
    expect(onSecond).toHaveBeenCalledWith('other-story');

    // Keep afterEach's stopBoardWatcher pointed at the live watcher.
    mockWatcher = secondWatcher;
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
