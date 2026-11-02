// Prism (#1764) — the per-book settings store (open/load, optimistic update,
// serialized saves, load-vs-update races, stable snapshots) and the live
// findings store the editor extension publishes into.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  DEFAULT_PRISM_SETTINGS,
  applyPrismPatch,
  serializePrismSettings,
  type PrismSettingsPatch,
} from './settings';
import {
  __resetPrismStoresForTests,
  prismLiveStore,
  prismSettingsStore,
  type PrismLiveSnapshot,
} from './store';
import type { PrismSettings } from './types';

const readVault = vi.fn();
const writeVault = vi.fn();

function installApi() {
  Object.defineProperty(window, 'api', {
    value: { readVault, writeVault },
    writable: true,
    configurable: true,
  });
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Let queued microtasks / promise chains settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

/** What a previously saved prism.json holds: differs from the defaults. */
function diskSettings(over: PrismSettingsPatch = {}): PrismSettings {
  return applyPrismPatch(DEFAULT_PRISM_SETTINGS, {
    proseColors: true,
    analyticsOpen: false,
    ...over,
  });
}

function writtenSettings(callIndex: number): PrismSettings {
  return JSON.parse(writeVault.mock.calls[callIndex][1] as string) as PrismSettings;
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
  __resetPrismStoresForTests();
  delete (window as { api?: unknown }).api;
  vi.restoreAllMocks();
});

describe('prismSettingsStore.get', () => {
  it('returns the defaults for unknown, null and undefined ids', () => {
    expect(prismSettingsStore.get('nope')).toEqual(DEFAULT_PRISM_SETTINGS);
    expect(prismSettingsStore.get(null)).toEqual(DEFAULT_PRISM_SETTINGS);
    expect(prismSettingsStore.get(undefined)).toEqual(DEFAULT_PRISM_SETTINGS);
  });

  it('returns one stable, frozen object for every unknown id', () => {
    const a = prismSettingsStore.get('nope');
    expect(prismSettingsStore.get('nope')).toBe(a);
    expect(prismSettingsStore.get('other')).toBe(a);
    expect(prismSettingsStore.get(null)).toBe(a);
    expect(Object.isFrozen(a)).toBe(true);
    expect(Object.isFrozen(a.checks)).toBe(true);
  });

  it('keeps the same reference between changes and swaps it on change', async () => {
    prismSettingsStore.open('s1', 'stories/s1');
    await prismSettingsStore.flush('s1');
    const a = prismSettingsStore.get('s1');
    expect(prismSettingsStore.get('s1')).toBe(a);
    prismSettingsStore.update('s1', { flags: true });
    const b = prismSettingsStore.get('s1');
    expect(b).not.toBe(a);
    expect(prismSettingsStore.get('s1')).toBe(b);
    expect(Object.isFrozen(b)).toBe(true);
  });
});

describe('prismSettingsStore.open', () => {
  it('loads <storyPath>/prism.json once and notifies', async () => {
    readVault.mockResolvedValue({ content: serializePrismSettings(diskSettings()), path: 'x' });
    const listener = vi.fn();
    const unsub = prismSettingsStore.subscribe(listener);
    prismSettingsStore.open('s1', 'stories/s1');
    prismSettingsStore.open('s1', 'stories/s1');
    await settle();
    expect(readVault).toHaveBeenCalledTimes(1);
    expect(readVault).toHaveBeenCalledWith('stories/s1/prism.json');
    expect(prismSettingsStore.get('s1')).toEqual(diskSettings());
    expect(listener).toHaveBeenCalled();
    // Opening again after the load is a no-op.
    prismSettingsStore.open('s1', 'stories/s1');
    await settle();
    expect(readVault).toHaveBeenCalledTimes(1);
    unsub();
  });

  it('keeps books separate', async () => {
    readVault.mockImplementation(async (p: string) => ({
      content: serializePrismSettings(
        p === 'stories/a/prism.json' ? diskSettings({ flags: true }) : diskSettings()
      ),
      path: p,
    }));
    prismSettingsStore.open('a', 'stories/a');
    prismSettingsStore.open('b', 'stories/b');
    await settle();
    expect(prismSettingsStore.get('a').flags).toBe(true);
    expect(prismSettingsStore.get('b').flags).toBe(false);
  });

  it('reloads when the same story id moves to a new path', async () => {
    readVault.mockImplementation(async (p: string) => ({
      content: serializePrismSettings(
        p === 'stories/new/prism.json' ? diskSettings({ flags: true }) : diskSettings()
      ),
      path: p,
    }));
    prismSettingsStore.open('s1', 'stories/old');
    await settle();
    expect(prismSettingsStore.get('s1').flags).toBe(false);
    prismSettingsStore.open('s1', 'stories/new');
    await settle();
    expect(readVault).toHaveBeenCalledTimes(2);
    expect(prismSettingsStore.get('s1').flags).toBe(true);
  });

  it('ignores a stale load from the previous path', async () => {
    const oldLoad = deferred<{ content: string; path: string }>();
    readVault.mockImplementation((p: string) =>
      p === 'stories/old/prism.json'
        ? oldLoad.promise
        : Promise.resolve({ content: serializePrismSettings(diskSettings({ flags: true })), path: p })
    );
    prismSettingsStore.open('s1', 'stories/old');
    prismSettingsStore.open('s1', 'stories/new');
    await settle();
    expect(prismSettingsStore.get('s1').flags).toBe(true);
    oldLoad.resolve({ content: serializePrismSettings(diskSettings({ flags: false })), path: 'x' });
    await settle();
    expect(prismSettingsStore.get('s1').flags).toBe(true);
  });

  it('falls back to defaults silently when the load fails', async () => {
    readVault.mockRejectedValue(new Error('EACCES'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    prismSettingsStore.open('s1', 'stories/s1');
    await settle();
    expect(prismSettingsStore.get('s1')).toEqual(DEFAULT_PRISM_SETTINGS);
    expect(error).not.toHaveBeenCalled();
  });

  it('falls back to defaults on a corrupt file', async () => {
    readVault.mockResolvedValue({ content: '{oops', path: 'x' });
    prismSettingsStore.open('s1', 'stories/s1');
    await settle();
    expect(prismSettingsStore.get('s1')).toEqual(DEFAULT_PRISM_SETTINGS);
  });

  it('works without a vault bridge', async () => {
    delete (window as { api?: unknown }).api;
    prismSettingsStore.open('s1', 'stories/s1');
    prismSettingsStore.update('s1', { flags: true });
    await prismSettingsStore.flush('s1');
    expect(prismSettingsStore.get('s1').flags).toBe(true);
  });

  it('does not notify or swap the reference when the file matches memory', async () => {
    readVault.mockResolvedValue({
      content: serializePrismSettings(DEFAULT_PRISM_SETTINGS),
      path: 'x',
    });
    const before = prismSettingsStore.get('s1');
    const listener = vi.fn();
    const unsub = prismSettingsStore.subscribe(listener);
    prismSettingsStore.open('s1', 'stories/s1');
    await settle();
    expect(prismSettingsStore.get('s1')).toBe(before);
    expect(listener).not.toHaveBeenCalled();
    unsub();
  });
});

describe('prismSettingsStore.update', () => {
  it('updates memory optimistically and notifies synchronously', async () => {
    prismSettingsStore.open('s1', 'stories/s1');
    await settle();
    const listener = vi.fn();
    const unsub = prismSettingsStore.subscribe(listener);
    prismSettingsStore.update('s1', { flags: true, checks: { adverbs: false } });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(prismSettingsStore.get('s1').flags).toBe(true);
    expect(prismSettingsStore.get('s1').checks.adverbs).toBe(false);
    expect(prismSettingsStore.get('s1').checks.dialogue).toBe(true);
    unsub();
  });

  it('persists to <storyPath>/prism.json', async () => {
    prismSettingsStore.open('s1', 'stories/abc');
    await settle();
    prismSettingsStore.update('s1', { proseColors: true });
    await prismSettingsStore.flush('s1');
    expect(writeVault).toHaveBeenCalledTimes(1);
    expect(writeVault.mock.calls[0][0]).toBe('stories/abc/prism.json');
    expect(writtenSettings(0)).toEqual(prismSettingsStore.get('s1'));
  });

  it('serializes saves: the next write waits for the previous one; last write wins', async () => {
    prismSettingsStore.open('s1', 'stories/s1');
    await settle();
    const first = deferred<{ path: string; bytes: number }>();
    writeVault.mockReturnValueOnce(first.promise);
    prismSettingsStore.update('s1', { flags: true });
    prismSettingsStore.update('s1', { proseColors: true });
    prismSettingsStore.update('s1', { thresholds: { longSentenceWords: 50 } });
    await settle();
    expect(writeVault).toHaveBeenCalledTimes(1);
    first.resolve({ path: 'x', bytes: 1 });
    await prismSettingsStore.flush('s1');
    expect(writeVault).toHaveBeenCalledTimes(3);
    expect(writtenSettings(0).flags).toBe(true);
    expect(writtenSettings(0).proseColors).toBe(false);
    expect(writtenSettings(1).proseColors).toBe(true);
    expect(writtenSettings(1).thresholds.longSentenceWords).toBe(30);
    expect(writtenSettings(2)).toEqual(prismSettingsStore.get('s1'));
    expect(writtenSettings(2)).toMatchObject({
      flags: true,
      proseColors: true,
      thresholds: { longSentenceWords: 50 },
    });
  });

  it('swallows save errors and keeps the chain alive', async () => {
    prismSettingsStore.open('s1', 'stories/s1');
    await settle();
    writeVault.mockRejectedValueOnce(new Error('disk full'));
    writeVault.mockResolvedValueOnce({ path: 'x', bytes: 0, error: 'refused' });
    prismSettingsStore.update('s1', { flags: true });
    prismSettingsStore.update('s1', { proseColors: true });
    prismSettingsStore.update('s1', { analyticsOpen: false });
    await expect(prismSettingsStore.flush('s1')).resolves.toBeUndefined();
    expect(writeVault).toHaveBeenCalledTimes(3);
    expect(prismSettingsStore.get('s1')).toMatchObject({
      flags: true,
      proseColors: true,
      analyticsOpen: false,
    });
  });

  it('skips notify and save when the patch changes nothing', async () => {
    prismSettingsStore.open('s1', 'stories/s1');
    await settle();
    const before = prismSettingsStore.get('s1');
    const listener = vi.fn();
    const unsub = prismSettingsStore.subscribe(listener);
    prismSettingsStore.update('s1', { flags: false, checks: { adverbs: true } });
    await prismSettingsStore.flush('s1');
    expect(listener).not.toHaveBeenCalled();
    expect(writeVault).not.toHaveBeenCalled();
    expect(prismSettingsStore.get('s1')).toBe(before);
    unsub();
  });

  it('updates memory for a never-opened story without saving', async () => {
    const listener = vi.fn();
    const unsub = prismSettingsStore.subscribe(listener);
    prismSettingsStore.update('ghost', { flags: true });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(prismSettingsStore.get('ghost').flags).toBe(true);
    await prismSettingsStore.flush('ghost');
    expect(writeVault).not.toHaveBeenCalled();
    unsub();
  });

  it('re-applies pre-open updates over the loaded file and then saves', async () => {
    readVault.mockResolvedValue({ content: serializePrismSettings(diskSettings()), path: 'x' });
    prismSettingsStore.update('s1', { flags: true });
    prismSettingsStore.open('s1', 'stories/s1');
    await settle();
    await prismSettingsStore.flush('s1');
    const s = prismSettingsStore.get('s1');
    expect(s.flags).toBe(true); // the user's change
    expect(s.proseColors).toBe(true); // from disk
    expect(s.analyticsOpen).toBe(false); // from disk
    expect(writeVault).toHaveBeenCalledTimes(1);
    expect(writtenSettings(0)).toEqual(s);
  });

  it('a load that resolves after an update does not clobber it', async () => {
    const load = deferred<{ content: string; path: string }>();
    readVault.mockReturnValue(load.promise);
    prismSettingsStore.open('s1', 'stories/s1');
    prismSettingsStore.update('s1', { flags: true, checks: { adverbs: false } });
    expect(prismSettingsStore.get('s1').flags).toBe(true);
    // Nothing is written while the file is still being read (a write here
    // would replace on-disk fields the user never touched).
    await settle();
    expect(writeVault).not.toHaveBeenCalled();
    load.resolve({
      content: serializePrismSettings(diskSettings({ flags: false })),
      path: 'x',
    });
    await settle();
    await prismSettingsStore.flush('s1');
    const s = prismSettingsStore.get('s1');
    expect(s.flags).toBe(true);
    expect(s.checks.adverbs).toBe(false);
    expect(s.proseColors).toBe(true);
    expect(writeVault).toHaveBeenCalledTimes(1);
    expect(writtenSettings(0)).toEqual(s);
  });

  it('a load that fails after an update keeps the update', async () => {
    const load = deferred<{ content: string; path: string }>();
    readVault.mockReturnValue(load.promise);
    prismSettingsStore.open('s1', 'stories/s1');
    prismSettingsStore.update('s1', { proseColors: true });
    load.reject(new Error('EIO'));
    await settle();
    expect(prismSettingsStore.get('s1').proseColors).toBe(true);
  });
});

describe('prismLiveStore', () => {
  function mkSnapshot(over: Partial<PrismLiveSnapshot> = {}): PrismLiveSnapshot {
    return {
      storyId: 'story-1',
      sceneId: 'scene-a',
      findings: [],
      stats: { words: 0, sentences: 0, avgSentenceWords: 0, readingEase: null },
      reveal: vi.fn(),
      ...over,
    };
  }

  it('returns null for unknown, null and undefined scenes', () => {
    expect(prismLiveStore.get('scene-a')).toBeNull();
    expect(prismLiveStore.get(null)).toBeNull();
    expect(prismLiveStore.get(undefined)).toBeNull();
  });

  it('publish stores the snapshot by scene (stable reference) and notifies', () => {
    const listener = vi.fn();
    const unsub = prismLiveStore.subscribe(listener);
    const snap = mkSnapshot();
    prismLiveStore.publish(snap);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(prismLiveStore.get('scene-a')).toBe(snap);
    expect(prismLiveStore.get('scene-a')).toBe(snap);
    expect(prismLiveStore.get('scene-b')).toBeNull();
    const next = mkSnapshot();
    prismLiveStore.publish(next);
    expect(prismLiveStore.get('scene-a')).toBe(next);
    unsub();
    prismLiveStore.publish(mkSnapshot());
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('clear without a reveal drops the scene snapshot', () => {
    prismLiveStore.publish(mkSnapshot());
    prismLiveStore.publish(mkSnapshot({ sceneId: 'scene-b' }));
    const listener = vi.fn();
    const unsub = prismLiveStore.subscribe(listener);
    prismLiveStore.clear('scene-a');
    expect(prismLiveStore.get('scene-a')).toBeNull();
    expect(prismLiveStore.get('scene-b')).not.toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
    unsub();
  });

  it('clear with a reveal only drops a snapshot from the same editor', () => {
    const oldReveal = vi.fn();
    const newReveal = vi.fn();
    prismLiveStore.publish(mkSnapshot({ reveal: oldReveal }));
    const newer = mkSnapshot({ reveal: newReveal });
    prismLiveStore.publish(newer);
    const listener = vi.fn();
    const unsub = prismLiveStore.subscribe(listener);
    // The old (remounting) editor's destroy must not wipe the newer snapshot.
    prismLiveStore.clear('scene-a', oldReveal);
    expect(prismLiveStore.get('scene-a')).toBe(newer);
    expect(listener).not.toHaveBeenCalled();
    prismLiveStore.clear('scene-a', newReveal);
    expect(prismLiveStore.get('scene-a')).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
    unsub();
  });

  it('keeps one snapshot per editor on a scene; publishing replaces only that editor\'s', () => {
    const revealA = vi.fn();
    const revealB = vi.fn();
    const a1 = mkSnapshot({ reveal: revealA });
    const b1 = mkSnapshot({ reveal: revealB });
    prismLiveStore.publish(a1);
    prismLiveStore.publish(b1);
    expect(prismLiveStore.get('scene-a')).toBe(b1);
    const a2 = mkSnapshot({ reveal: revealA });
    prismLiveStore.publish(a2);
    expect(prismLiveStore.get('scene-a')).toBe(a2);
    // B's entry survived A's republish.
    prismLiveStore.clear('scene-a', revealA);
    expect(prismLiveStore.get('scene-a')).toBe(b1);
  });

  it('clearing the current editor falls back to the remaining one and notifies', () => {
    const revealA = vi.fn();
    const revealB = vi.fn();
    const a = mkSnapshot({ reveal: revealA });
    const b = mkSnapshot({ reveal: revealB });
    prismLiveStore.publish(a);
    prismLiveStore.publish(b);
    const listener = vi.fn();
    const unsub = prismLiveStore.subscribe(listener);
    prismLiveStore.clear('scene-a', revealB);
    expect(prismLiveStore.get('scene-a')).toBe(a);
    expect(listener).toHaveBeenCalledTimes(1);
    unsub();
  });

  it('touch makes the focused editor current; a background publish does not take over', () => {
    const revealA = vi.fn();
    const revealB = vi.fn();
    const a = mkSnapshot({ reveal: revealA });
    prismLiveStore.publish(a);
    prismLiveStore.publish(mkSnapshot({ reveal: revealB }));
    const listener = vi.fn();
    const unsub = prismLiveStore.subscribe(listener);

    prismLiveStore.touch('scene-a', revealA);
    expect(prismLiveStore.get('scene-a')).toBe(a);
    expect(listener).toHaveBeenCalledTimes(1);
    // Stable reference while nothing changes.
    expect(prismLiveStore.get('scene-a')).toBe(a);

    // The unfocused editor republishes (e.g. remount / rescan): A stays current, quietly.
    prismLiveStore.publish(mkSnapshot({ reveal: revealB }));
    expect(prismLiveStore.get('scene-a')).toBe(a);
    expect(listener).toHaveBeenCalledTimes(1);

    // Focusing B hands it over.
    prismLiveStore.touch('scene-a', revealB);
    expect(prismLiveStore.get('scene-a')?.reveal).toBe(revealB);
    expect(listener).toHaveBeenCalledTimes(2);

    // Touching an editor that never published is a no-op.
    prismLiveStore.touch('scene-a', vi.fn());
    prismLiveStore.touch('scene-z', revealA);
    expect(prismLiveStore.get('scene-a')?.reveal).toBe(revealB);
    expect(prismLiveStore.get('scene-z')).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);
    unsub();
  });

  it('clear on an empty scene is a quiet no-op', () => {
    const listener = vi.fn();
    const unsub = prismLiveStore.subscribe(listener);
    prismLiveStore.clear('scene-z');
    expect(listener).not.toHaveBeenCalled();
    unsub();
  });
});

describe('prismSettingsStore current book', () => {
  it('is null until a surface claims a book; the latest live claim wins', () => {
    expect(prismSettingsStore.getCurrentBookId()).toBeNull();
    const listener = vi.fn();
    const unsub = prismSettingsStore.subscribe(listener);
    const releaseA = prismSettingsStore.claimCurrentBook('s1');
    expect(prismSettingsStore.getCurrentBookId()).toBe('s1');
    expect(listener).toHaveBeenCalledTimes(1);
    // A second surface claiming the same book changes nothing.
    const releaseA2 = prismSettingsStore.claimCurrentBook('s1');
    expect(listener).toHaveBeenCalledTimes(1);
    const releaseB = prismSettingsStore.claimCurrentBook('s2');
    expect(prismSettingsStore.getCurrentBookId()).toBe('s2');
    releaseB();
    expect(prismSettingsStore.getCurrentBookId()).toBe('s1');
    releaseA();
    expect(prismSettingsStore.getCurrentBookId()).toBe('s1');
    releaseA2();
    expect(prismSettingsStore.getCurrentBookId()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(4);
    // Releasing twice is harmless.
    releaseB();
    expect(prismSettingsStore.getCurrentBookId()).toBeNull();
    unsub();
  });

  it('is dropped by the test reset', () => {
    prismSettingsStore.claimCurrentBook('s1');
    __resetPrismStoresForTests();
    expect(prismSettingsStore.getCurrentBookId()).toBeNull();
  });
});

describe('__resetPrismStoresForTests', () => {
  it('drops settings and live snapshots', async () => {
    prismSettingsStore.update('s1', { flags: true });
    prismLiveStore.publish({
      storyId: null,
      sceneId: 'scene-a',
      findings: [],
      stats: { words: 0, sentences: 0, avgSentenceWords: 0, readingEase: null },
      reveal: () => {},
    });
    __resetPrismStoresForTests();
    expect(prismSettingsStore.get('s1')).toEqual(DEFAULT_PRISM_SETTINGS);
    expect(prismLiveStore.get('scene-a')).toBeNull();
  });

  it('stops queued saves from a previous test from writing', async () => {
    prismSettingsStore.open('s1', 'stories/s1');
    await settle();
    const first = deferred<{ path: string; bytes: number }>();
    writeVault.mockReturnValueOnce(first.promise);
    prismSettingsStore.update('s1', { flags: true });
    prismSettingsStore.update('s1', { proseColors: true });
    await settle();
    expect(writeVault).toHaveBeenCalledTimes(1);
    __resetPrismStoresForTests();
    first.resolve({ path: 'x', bytes: 1 });
    await settle();
    expect(writeVault).toHaveBeenCalledTimes(1);
  });
});
