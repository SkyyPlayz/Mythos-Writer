/**
 * SKY-11186 — noteThumbnails: batched resolve, memo + invalidation, the
 * derivative cache (LRU, in-flight dedupe, decode queue) and the two hooks
 * (BOARDS-SPEC v2 §6/§9).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import {
  __resetThumbnailCachesForTests,
  derivativeSize,
  invalidateNoteThumbs,
  invalidateThumbnails,
  loadThumbnail,
  markThumbnailUnavailable,
  NONE_THUMB_INFO,
  resolveNoteThumbs,
  setDerivativeGeneratorForTests,
  THUMB_CACHE_MAX,
  thumbCacheKey,
  useNoteThumbInfo,
  useThumbnail,
  type NoteThumbInfo,
} from './noteThumbnails';

type AnyFn = (...args: any[]) => any;

const info = (src: string, extra: Partial<NoteThumbInfo> = {}): NoteThumbInfo => ({
  mode: 'auto',
  src,
  version: 'v1',
  missing: false,
  caption: '',
  ...extra,
});

/** Default bridge: every note shows `<path>.png`, every source is a cached derivative. */
function installApi<O extends Record<string, AnyFn>>(overrides: O = {} as O) {
  const api = {
    notesThumbResolve: vi.fn(async (paths: string[]) => ({
      thumbs: Object.fromEntries(paths.map((p) => [p, info(`${p}.png`)])),
    })),
    notesThumbGet: vi.fn(async (src: string) => ({
      status: 'ready' as const,
      dataUrl: `data:image/webp;base64,${btoa(src)}`,
      version: 'v1',
    })),
    notesThumbPut: vi.fn(async () => ({ ok: true })),
    ...overrides,
  };
  (window as unknown as { api: unknown }).api = api;
  return api;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Timers fire in order, so this lands after any batch flush queued before it. */
const nextMacrotask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  __resetThumbnailCachesForTests();
});

afterEach(() => {
  __resetThumbnailCachesForTests();
  delete (window as unknown as { api?: unknown }).api;
});

// ─── resolveNoteThumbs ────────────────────────────────────────────────────────

describe('resolveNoteThumbs', () => {
  it('coalesces every call made in one macrotask into a single deduped IPC', async () => {
    const api = installApi();
    const [a, b, c] = await Promise.all([
      resolveNoteThumbs(['Notes/a.md', 'Notes/b.md']),
      resolveNoteThumbs(['Notes/b.md', 'Notes/c.md']),
      resolveNoteThumbs(['Notes/a.md', 'Notes/a.md']),
    ]);
    expect(api.notesThumbResolve).toHaveBeenCalledTimes(1);
    expect(api.notesThumbResolve).toHaveBeenCalledWith(['Notes/a.md', 'Notes/b.md', 'Notes/c.md']);
    expect(a['Notes/a.md'].src).toBe('Notes/a.md.png');
    expect(b['Notes/c.md'].src).toBe('Notes/c.md.png');
    expect(Object.keys(c)).toEqual(['Notes/a.md']);
  });

  it('serves memoised paths without a second IPC, with a stable identity', async () => {
    const api = installApi();
    const first = await resolveNoteThumbs(['Notes/a.md']);
    const second = await resolveNoteThumbs(['Notes/a.md']);
    expect(api.notesThumbResolve).toHaveBeenCalledTimes(1);
    expect(second['Notes/a.md']).toBe(first['Notes/a.md']);
  });

  it('only asks again for paths that were invalidated', async () => {
    const api = installApi();
    await resolveNoteThumbs(['Notes/a.md', 'Notes/b.md']);
    invalidateNoteThumbs(['Notes/a.md']);
    await resolveNoteThumbs(['Notes/a.md', 'Notes/b.md']);
    expect(api.notesThumbResolve).toHaveBeenCalledTimes(2);
    expect(api.notesThumbResolve).toHaveBeenLastCalledWith(['Notes/a.md']);

    invalidateNoteThumbs();
    await resolveNoteThumbs(['Notes/b.md', 'Notes/a.md']);
    expect(api.notesThumbResolve).toHaveBeenCalledTimes(3);
    expect(api.notesThumbResolve).toHaveBeenLastCalledWith(['Notes/b.md', 'Notes/a.md']);
  });

  it('memoises "none" for paths main omits and for a failed IPC', async () => {
    const api = installApi({
      notesThumbResolve: vi.fn(async () => ({ thumbs: {} })),
    });
    const omitted = await resolveNoteThumbs(['Notes/a.md']);
    expect(omitted['Notes/a.md']).toBe(NONE_THUMB_INFO);

    api.notesThumbResolve.mockRejectedValueOnce(new Error('bridge down'));
    const failed = await resolveNoteThumbs(['Notes/b.md']);
    expect(failed['Notes/b.md']).toBe(NONE_THUMB_INFO);

    await resolveNoteThumbs(['Notes/a.md', 'Notes/b.md']);
    expect(api.notesThumbResolve).toHaveBeenCalledTimes(2);
  });

  it('answers "none" without throwing when the bridge is absent', async () => {
    const result = await resolveNoteThumbs(['Notes/a.md']);
    expect(result['Notes/a.md']).toBe(NONE_THUMB_INFO);
  });

  it('dedupes against a batch that is already in flight', async () => {
    const pending = deferred<{ thumbs: Record<string, NoteThumbInfo> }>();
    const api = installApi({ notesThumbResolve: vi.fn(() => pending.promise) });
    const first = resolveNoteThumbs(['Notes/a.md']);
    await nextMacrotask();
    expect(api.notesThumbResolve).toHaveBeenCalledTimes(1);

    const second = resolveNoteThumbs(['Notes/a.md']);
    await nextMacrotask();
    expect(api.notesThumbResolve).toHaveBeenCalledTimes(1);

    pending.resolve({ thumbs: { 'Notes/a.md': info('Notes/a.md.png') } });
    const [r1, r2] = await Promise.all([first, second]);
    expect(r2['Notes/a.md']).toBe(r1['Notes/a.md']);
  });

  it('re-asks for a path invalidated while its batch was in flight before answering', async () => {
    const pending = deferred<{ thumbs: Record<string, NoteThumbInfo> }>();
    const api = installApi();
    api.notesThumbResolve.mockImplementationOnce(() => pending.promise);

    const first = resolveNoteThumbs(['Notes/a.md']);
    await nextMacrotask();
    invalidateNoteThumbs(['Notes/a.md']);
    pending.resolve({ thumbs: { 'Notes/a.md': info('stale.png') } });

    const result = await first;
    expect(result['Notes/a.md'].src).toBe('Notes/a.md.png');
    expect(api.notesThumbResolve).toHaveBeenCalledTimes(2);
    expect(api.notesThumbResolve).toHaveBeenLastCalledWith(['Notes/a.md']);
  });

  it('subscribes to vault events once and invalidates from them', async () => {
    let notesUpdated: ((data: { count: number; path?: string }) => void) | undefined;
    let assetChanged: ((data: { path: string }) => void) | undefined;
    const api = installApi({
      onVaultNotesUpdated: vi.fn((cb: typeof notesUpdated) => {
        notesUpdated = cb;
        return () => {};
      }),
      onVaultNotesAssetChanged: vi.fn((cb: typeof assetChanged) => {
        assetChanged = cb;
        return () => {};
      }),
    });
    await resolveNoteThumbs(['Notes/a.md', 'Notes/b.md']);
    await resolveNoteThumbs(['Notes/a.md']);
    expect(api.onVaultNotesUpdated).toHaveBeenCalledTimes(1);
    expect(api.onVaultNotesAssetChanged).toHaveBeenCalledTimes(1);

    // The note itself changed (OS separators are normalised defensively).
    notesUpdated!({ count: 1, path: 'Notes\\a.md' });
    await resolveNoteThumbs(['Notes/a.md', 'Notes/b.md']);
    expect(api.notesThumbResolve).toHaveBeenLastCalledWith(['Notes/a.md']);

    // The image a note shows was deleted (a notes-updated with its path):
    // that note is re-asked and its cached derivative dropped.
    await loadThumbnail('Notes/b.md.png', 'v1');
    notesUpdated!({ count: 1, path: 'Notes/b.md.png' });
    await resolveNoteThumbs(['Notes/a.md', 'Notes/b.md']);
    expect(api.notesThumbResolve).toHaveBeenLastCalledWith(['Notes/b.md']);
    await loadThumbnail('Notes/b.md.png', 'v1');
    expect(api.notesThumbGet).toHaveBeenCalledTimes(2);

    // The image was rewritten in place (asset event): same targeted refresh.
    assetChanged!({ path: 'Notes/a.md.png' });
    await resolveNoteThumbs(['Notes/a.md', 'Notes/b.md']);
    expect(api.notesThumbResolve).toHaveBeenLastCalledWith(['Notes/a.md']);

    // A notes-vault update without a path re-asks everything.
    notesUpdated!({ count: 1 });
    await resolveNoteThumbs(['Notes/a.md', 'Notes/b.md']);
    expect(api.notesThumbResolve).toHaveBeenLastCalledWith(['Notes/a.md', 'Notes/b.md']);
  });
});

// ─── useNoteThumbInfo ─────────────────────────────────────────────────────────

describe('useNoteThumbInfo', () => {
  it('resolves on mount, then keeps the last answer on screen across an invalidation', async () => {
    const api = installApi();
    const { result } = renderHook(() => useNoteThumbInfo('Notes/a.md'));
    expect(result.current).toBeUndefined();
    await waitFor(() => expect(result.current?.src).toBe('Notes/a.md.png'));
    expect(api.notesThumbResolve).toHaveBeenCalledTimes(1);

    api.notesThumbResolve.mockImplementation(async (paths: string[]) => ({
      thumbs: Object.fromEntries(paths.map((p) => [p, info('fresh.png')])),
    }));
    act(() => invalidateNoteThumbs());
    expect(result.current?.src).toBe('Notes/a.md.png');
    await waitFor(() => expect(result.current?.src).toBe('fresh.png'));
    expect(api.notesThumbResolve).toHaveBeenCalledTimes(2);
  });

  it('returns undefined for a null path and asks nothing', async () => {
    const api = installApi();
    const { result } = renderHook(() => useNoteThumbInfo(null));
    expect(result.current).toBeUndefined();
    await nextMacrotask();
    expect(api.notesThumbResolve).not.toHaveBeenCalled();
  });
});

// ─── derivativeSize / thumbCacheKey ───────────────────────────────────────────

describe('derivativeSize', () => {
  it.each([
    ['landscape', 4000, 3000, 341, 256],
    ['portrait', 2000, 3000, 256, 384],
    ['wide', 6000, 1000, 512, 85],
    ['small (never upscaled)', 100, 80, 100, 80],
    ['exactly at the caps', 512, 256, 512, 256],
  ])('%s %dx%d → %dx%d', (_label, w, h, width, height) => {
    expect(derivativeSize(w, h)).toEqual({ width, height });
  });

  it('gives an image with no intrinsic size the short-edge square', () => {
    expect(derivativeSize(0, 0)).toEqual({ width: 256, height: 256 });
    expect(derivativeSize(Number.NaN, 300)).toEqual({ width: 256, height: 256 });
  });
});

describe('thumbCacheKey', () => {
  it('joins source and version', () => {
    expect(thumbCacheKey('Notes/a.png', '123-456')).toBe('Notes/a.png@123-456');
  });
});

// ─── loadThumbnail ────────────────────────────────────────────────────────────

describe('loadThumbnail', () => {
  it('caches a ready derivative so the second load skips the IPC', async () => {
    const api = installApi();
    const first = await loadThumbnail('Notes/a.png', 'v1');
    const second = await loadThumbnail('Notes/a.png', 'v1');
    expect(first).toEqual({ status: 'ready', dataUrl: `data:image/webp;base64,${btoa('Notes/a.png')}` });
    expect(second).toBe(first);
    expect(api.notesThumbGet).toHaveBeenCalledTimes(1);
  });

  it('generates a derivative from source bytes, persists it, and serves it as a webp data URL', async () => {
    const source = new Uint8Array([1, 2, 3]);
    const api = installApi({
      notesThumbGet: vi.fn(async () => ({ status: 'source' as const, mime: 'image/jpeg', bytes: source, version: 'v1' })),
    });
    // Larger than one base64 chunk so the chunked encoder is exercised.
    const generated = new Uint8Array(70_000).map((_, i) => (i * 7) % 256);
    const generate = vi.fn(async () => generated);
    setDerivativeGeneratorForTests(generate);

    const state = await loadThumbnail('Notes/a.jpg', 'v1');
    expect(generate).toHaveBeenCalledWith(source, 'image/jpeg');
    expect(api.notesThumbPut).toHaveBeenCalledWith('Notes/a.jpg', 'v1', generated);
    expect(state).toEqual({
      status: 'ready',
      dataUrl: `data:image/webp;base64,${Buffer.from(generated).toString('base64')}`,
    });
  });

  it('labels a PNG-fallback derivative honestly', async () => {
    installApi({
      notesThumbGet: vi.fn(async () => ({ status: 'source' as const, mime: 'image/jpeg', bytes: new Uint8Array(1), version: 'v1' })),
    });
    setDerivativeGeneratorForTests(async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const state = await loadThumbnail('Notes/a.jpg', 'v1');
    expect(state.status === 'ready' && state.dataUrl.startsWith('data:image/png;base64,')).toBe(true);
  });

  it.each([
    ['missing', async () => ({ status: 'missing' as const })],
    ['unsupported', async () => ({ status: 'unsupported' as const })],
    ['a throwing bridge', async () => { throw new Error('boom'); }],
  ])('answers unavailable for %s and caches that', async (_label, impl) => {
    const api = installApi({ notesThumbGet: vi.fn(impl) });
    expect(await loadThumbnail('Notes/a.png', 'v1')).toEqual({ status: 'unavailable' });
    expect(await loadThumbnail('Notes/a.png', 'v1')).toEqual({ status: 'unavailable' });
    expect(api.notesThumbGet).toHaveBeenCalledTimes(1);
  });

  it('answers unavailable when the derivative cannot be generated', async () => {
    installApi({
      notesThumbGet: vi.fn(async () => ({ status: 'source' as const, mime: 'image/x-odd', bytes: new Uint8Array(1), version: 'v1' })),
    });
    setDerivativeGeneratorForTests(async () => { throw new Error('undecodable'); });
    expect(await loadThumbnail('Notes/a.odd', 'v1')).toEqual({ status: 'unavailable' });
  });

  it('shares one in-flight promise per key', async () => {
    const pending = deferred<{ status: 'ready'; dataUrl: string; version: string }>();
    const api = installApi({ notesThumbGet: vi.fn(() => pending.promise) });
    const p1 = loadThumbnail('Notes/a.png', 'v1');
    const p2 = loadThumbnail('Notes/a.png', 'v1');
    expect(p2).toBe(p1);
    expect(api.notesThumbGet).toHaveBeenCalledTimes(1);
    pending.resolve({ status: 'ready', dataUrl: 'data:x', version: 'v1' });
    expect(await p2).toEqual({ status: 'ready', dataUrl: 'data:x' });
  });

  it('also caches under the version main reports when it differs from the one asked for', async () => {
    const api = installApi({
      notesThumbGet: vi.fn(async () => ({ status: 'ready' as const, dataUrl: 'data:x', version: 'v2' })),
    });
    await loadThumbnail('Notes/a.png', 'v1');
    expect(await loadThumbnail('Notes/a.png', 'v2')).toEqual({ status: 'ready', dataUrl: 'data:x' });
    expect(api.notesThumbGet).toHaveBeenCalledTimes(1);
  });

  it('runs at most three derivative generations at once', async () => {
    installApi({
      notesThumbGet: vi.fn(async () => ({ status: 'source' as const, mime: 'image/png', bytes: new Uint8Array(1), version: 'v1' })),
    });
    const slots: Array<ReturnType<typeof deferred<Uint8Array>>> = [];
    const generate = vi.fn(() => {
      const slot = deferred<Uint8Array>();
      slots.push(slot);
      return slot.promise;
    });
    setDerivativeGeneratorForTests(generate);

    const loads = ['a', 'b', 'c', 'd', 'e'].map((n) => loadThumbnail(`Notes/${n}.png`, 'v1'));
    await nextMacrotask();
    expect(generate).toHaveBeenCalledTimes(3);

    slots[0].resolve(new Uint8Array([1]));
    await nextMacrotask();
    expect(generate).toHaveBeenCalledTimes(4);

    slots[1].resolve(new Uint8Array([1]));
    await nextMacrotask();
    expect(generate).toHaveBeenCalledTimes(5);

    for (const slot of slots.slice(2)) slot.resolve(new Uint8Array([1]));
    const states = await Promise.all(loads);
    expect(states.every((s) => s.status === 'ready')).toBe(true);
  });

  it('evicts the least recently used entry past the cap', async () => {
    const api = installApi();
    for (let i = 0; i < THUMB_CACHE_MAX; i += 1) await loadThumbnail(`Notes/${i}.png`, 'v1');
    expect(api.notesThumbGet).toHaveBeenCalledTimes(THUMB_CACHE_MAX);

    // A hit on the oldest entry makes it the newest, so the NEXT-oldest goes.
    await loadThumbnail('Notes/0.png', 'v1');
    await loadThumbnail('Notes/overflow.png', 'v1');
    expect(api.notesThumbGet).toHaveBeenCalledTimes(THUMB_CACHE_MAX + 1);

    await loadThumbnail('Notes/0.png', 'v1');
    expect(api.notesThumbGet).toHaveBeenCalledTimes(THUMB_CACHE_MAX + 1);
    await loadThumbnail('Notes/1.png', 'v1');
    expect(api.notesThumbGet).toHaveBeenCalledTimes(THUMB_CACHE_MAX + 2);
  });

  it('invalidateThumbnails drops one source or everything; markThumbnailUnavailable overrides a hit', async () => {
    const api = installApi();
    await loadThumbnail('Notes/a.png', 'v1');
    await loadThumbnail('Notes/a.png', 'v2');
    await loadThumbnail('Notes/b.png', 'v1');

    invalidateThumbnails('Notes/a.png');
    await loadThumbnail('Notes/b.png', 'v1');
    expect(api.notesThumbGet).toHaveBeenCalledTimes(3);
    await loadThumbnail('Notes/a.png', 'v1');
    await loadThumbnail('Notes/a.png', 'v2');
    expect(api.notesThumbGet).toHaveBeenCalledTimes(5);

    markThumbnailUnavailable('Notes/b.png', 'v1');
    expect(await loadThumbnail('Notes/b.png', 'v1')).toEqual({ status: 'unavailable' });

    invalidateThumbnails();
    await loadThumbnail('Notes/b.png', 'v1');
    expect(api.notesThumbGet).toHaveBeenCalledTimes(6);
  });
});

// ─── useThumbnail ─────────────────────────────────────────────────────────────

describe('useThumbnail', () => {
  it('is unavailable without a source or version', () => {
    installApi();
    const { result } = renderHook(() => useThumbnail(null, 'v1'));
    expect(result.current).toEqual({ status: 'unavailable' });
    const { result: noVersion } = renderHook(() => useThumbnail('Notes/a.png', null));
    expect(noVersion.current).toEqual({ status: 'unavailable' });
  });

  it('returns a cached derivative synchronously', async () => {
    const api = installApi();
    const cached = await loadThumbnail('Notes/a.png', 'v1');
    const { result } = renderHook(() => useThumbnail('Notes/a.png', 'v1'));
    expect(result.current).toBe(cached);
    expect(api.notesThumbGet).toHaveBeenCalledTimes(1);
  });

  it('loads on mount and re-renders when the derivative lands', async () => {
    installApi();
    const { result } = renderHook(() => useThumbnail('Notes/a.png', 'v1'));
    expect(result.current).toEqual({ status: 'loading' });
    await waitFor(() => expect(result.current.status).toBe('ready'));
  });

  it('follows the source it is asked for', async () => {
    installApi();
    const { result, rerender } = renderHook(({ src }: { src: string }) => useThumbnail(src, 'v1'), {
      initialProps: { src: 'Notes/a.png' },
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    rerender({ src: 'Notes/b.png' });
    expect(result.current).toEqual({ status: 'loading' });
    await waitFor(() => expect(result.current).toEqual({
      status: 'ready',
      dataUrl: `data:image/webp;base64,${btoa('Notes/b.png')}`,
    }));
  });
});
