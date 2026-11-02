// Prism (#1764) — React bindings: usePrismBook opens the book's prism.json and
// writes through the store; usePrismSettingsById / usePrismLive are read-only
// subscriptions that re-render on change.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup, waitFor } from '@testing-library/react';
import { DEFAULT_PRISM_SETTINGS, applyPrismPatch, serializePrismSettings } from './settings';
import {
  __resetPrismStoresForTests,
  prismLiveStore,
  prismSettingsStore,
  type PrismLiveSnapshot,
} from './store';
import {
  usePrismBook,
  usePrismBookForScene,
  usePrismCurrentBookId,
  usePrismLive,
  usePrismOpenBook,
  usePrismSettingsById,
} from './usePrism';

const readVault = vi.fn();
const writeVault = vi.fn();

function installApi() {
  Object.defineProperty(window, 'api', {
    value: { readVault, writeVault },
    writable: true,
    configurable: true,
  });
}

function mkSnapshot(over: Partial<PrismLiveSnapshot> = {}): PrismLiveSnapshot {
  return {
    storyId: 'story-1',
    sceneId: 'scene-a',
    findings: [],
    stats: { words: 12, sentences: 2, avgSentenceWords: 6, readingEase: 80 },
    reveal: vi.fn(),
    ...over,
  };
}

beforeEach(() => {
  __resetPrismStoresForTests();
  readVault.mockReset();
  writeVault.mockReset();
  readVault.mockRejectedValue(new Error('ENOENT'));
  writeVault.mockResolvedValue({ path: 'x', bytes: 1 });
  installApi();
});

afterEach(() => {
  // Unmount first: resetting notifies subscribers, which would re-render a
  // still-mounted hook outside act().
  cleanup();
  __resetPrismStoresForTests();
  delete (window as { api?: unknown }).api;
});

describe('usePrismBook', () => {
  it('returns the defaults without a story and never touches the vault', () => {
    const { result } = renderHook(() => usePrismBook(null));
    expect(result.current[0]).toEqual(DEFAULT_PRISM_SETTINGS);
    act(() => result.current[1]({ flags: true }));
    expect(result.current[0].flags).toBe(false);
    expect(readVault).not.toHaveBeenCalled();
    expect(writeVault).not.toHaveBeenCalled();
  });

  it("opens the book's prism.json and re-renders when it loads", async () => {
    readVault.mockResolvedValue({
      content: serializePrismSettings(applyPrismPatch(DEFAULT_PRISM_SETTINGS, { flags: true })),
      path: 'stories/abc/prism.json',
    });
    const { result } = renderHook(() => usePrismBook({ id: 'story-1', path: 'stories/abc' }));
    expect(result.current[0].flags).toBe(false);
    await waitFor(() => expect(result.current[0].flags).toBe(true));
    expect(readVault).toHaveBeenCalledWith('stories/abc/prism.json');
  });

  it('update re-renders with the new settings and persists them', async () => {
    const { result } = renderHook(() => usePrismBook({ id: 'story-1', path: 'stories/abc' }));
    await act(async () => {
      await prismSettingsStore.flush('story-1');
    });
    act(() => result.current[1]({ proseColors: true, checks: { narrator: true } }));
    expect(result.current[0].proseColors).toBe(true);
    expect(result.current[0].checks.narrator).toBe(true);
    await act(async () => {
      await prismSettingsStore.flush('story-1');
    });
    expect(writeVault).toHaveBeenCalledTimes(1);
    expect(writeVault.mock.calls[0][0]).toBe('stories/abc/prism.json');
  });

  it('keeps a stable settings reference across unrelated re-renders', () => {
    const story = { id: 'story-1', path: 'stories/abc' };
    const { result, rerender } = renderHook(() => usePrismBook(story));
    const first = result.current[0];
    const firstUpdate = result.current[1];
    rerender();
    expect(result.current[0]).toBe(first);
    expect(result.current[1]).toBe(firstUpdate);
  });

  it('re-opens when the story path changes', async () => {
    readVault.mockImplementation(async (p: string) => ({
      content: serializePrismSettings(
        applyPrismPatch(DEFAULT_PRISM_SETTINGS, { flags: p === 'stories/new/prism.json' })
      ),
      path: p,
    }));
    const { result, rerender } = renderHook(
      ({ path }: { path: string }) => usePrismBook({ id: 'story-1', path }),
      { initialProps: { path: 'stories/old' } }
    );
    await waitFor(() => expect(readVault).toHaveBeenCalledWith('stories/old/prism.json'));
    expect(result.current[0].flags).toBe(false);
    rerender({ path: 'stories/new' });
    await waitFor(() => expect(result.current[0].flags).toBe(true));
  });

  it('follows the selected book', async () => {
    prismSettingsStore.update('story-2', { analyticsOpen: false });
    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => usePrismBook({ id, path: `stories/${id}` }),
      { initialProps: { id: 'story-1' } }
    );
    expect(result.current[0].analyticsOpen).toBe(true);
    rerender({ id: 'story-2' });
    expect(result.current[0].analyticsOpen).toBe(false);
    await act(async () => {
      await prismSettingsStore.flush('story-2');
    });
  });
});

describe('current book', () => {
  it('usePrismBook claims the selected book while mounted and follows it', () => {
    const current = renderHook(() => usePrismCurrentBookId());
    expect(current.result.current).toBeNull();
    const book = renderHook(({ story }) => usePrismBook(story), {
      initialProps: { story: { id: 'story-1', path: 'stories/story-1' } as { id: string; path: string } | null },
    });
    expect(current.result.current).toBe('story-1');
    book.rerender({ story: { id: 'story-2', path: 'stories/story-2' } });
    expect(current.result.current).toBe('story-2');
    book.rerender({ story: null });
    expect(current.result.current).toBeNull();
    book.rerender({ story: { id: 'story-1', path: 'stories/story-1' } });
    book.unmount();
    expect(current.result.current).toBeNull();
  });

  it('usePrismOpenBook loads the file but does not change the current book', async () => {
    renderHook(() => usePrismBook({ id: 'story-1', path: 'stories/story-1' }));
    readVault.mockResolvedValueOnce({
      content: serializePrismSettings(applyPrismPatch(DEFAULT_PRISM_SETTINGS, { flags: true })),
    });
    renderHook(() => usePrismOpenBook({ id: 'story-2', path: 'stories/story-2' }));
    expect(readVault).toHaveBeenCalledWith('stories/story-2/prism.json');
    const current = renderHook(() => usePrismCurrentBookId());
    expect(current.result.current).toBe('story-1');
    const other = renderHook(() => usePrismSettingsById('story-2'));
    await waitFor(() => expect(other.result.current.flags).toBe(true));
  });
});

describe('usePrismSettingsById', () => {
  it('reads without opening the file', () => {
    const { result } = renderHook(() => usePrismSettingsById('story-1'));
    expect(result.current).toEqual(DEFAULT_PRISM_SETTINGS);
    expect(readVault).not.toHaveBeenCalled();
  });

  it('re-renders when another surface updates the book', () => {
    const { result } = renderHook(() => usePrismSettingsById('story-1'));
    act(() => prismSettingsStore.update('story-1', { flags: true }));
    expect(result.current.flags).toBe(true);
  });

  it('returns the defaults for a null id', () => {
    const { result } = renderHook(() => usePrismSettingsById(null));
    expect(result.current).toBe(prismSettingsStore.get(null));
  });
});

describe('usePrismLive', () => {
  it('is null until the editor publishes, then follows publish / clear', () => {
    const { result } = renderHook(() => usePrismLive('scene-a'));
    expect(result.current).toBeNull();
    const snap = mkSnapshot();
    act(() => prismLiveStore.publish(snap));
    expect(result.current).toBe(snap);
    act(() => prismLiveStore.publish(mkSnapshot({ sceneId: 'scene-b' })));
    expect(result.current).toBe(snap);
    act(() => prismLiveStore.clear('scene-a', snap.reveal));
    expect(result.current).toBeNull();
  });

  it('returns null for a null scene id', () => {
    act(() => prismLiveStore.publish(mkSnapshot()));
    const { result } = renderHook(() => usePrismLive(null));
    expect(result.current).toBeNull();
  });
});

describe('scene ownership (usePrismOpenBook / usePrismBookForScene)', () => {
  beforeEach(() => {
    __resetPrismStoresForTests();
    installApi();
    readVault.mockRejectedValue(new Error('ENOENT'));
  });
  afterEach(() => {
    cleanup();
    __resetPrismStoresForTests();
  });

  const book = {
    id: 'book-1',
    path: 'stories/book-1',
    chapters: [{ scenes: [{ id: 'sc-ch' }] }],
    parts: [{ chapters: [{ scenes: [{ id: 'sc-part' }] }] }],
  };

  it('registers the scenes in chapters and parts, and releases them on unmount', () => {
    const owner = renderHook(() => usePrismBookForScene('sc-part'));
    expect(owner.result.current).toBeNull();
    const opened = renderHook(() => usePrismOpenBook(book));
    expect(owner.result.current).toBe('book-1');
    expect(prismSettingsStore.getBookForScene('sc-ch')).toBe('book-1');
    expect(prismSettingsStore.getBookForScene('elsewhere')).toBeNull();
    opened.unmount();
    expect(owner.result.current).toBeNull();
  });

  it('keeps one registration across new story objects with the same scenes', () => {
    const register = vi.spyOn(prismSettingsStore, 'registerBookScenes');
    const { rerender } = renderHook(({ story }) => usePrismOpenBook(story), {
      initialProps: { story: book },
    });
    rerender({ story: { ...book, chapters: [{ scenes: [{ id: 'sc-ch' }] }] } });
    expect(register).toHaveBeenCalledTimes(1);
    rerender({ story: { ...book, chapters: [{ scenes: [{ id: 'sc-ch' }, { id: 'sc-new' }] }] } });
    expect(register).toHaveBeenCalledTimes(2);
    expect(prismSettingsStore.getBookForScene('sc-new')).toBe('book-1');
    register.mockRestore();
  });
});
