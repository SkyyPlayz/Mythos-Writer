import path from 'path';
import { describe, expect, it, vi } from 'vitest';
import { boardRelPath } from './sceneCrafterBoard.js';
import { SceneCrafterBoardWatcher } from './sceneCrafterBoardWatcher.js';

interface FakeWatcher {
  callbacks: Map<string, Array<(filePath: string) => void>>;
  close: ReturnType<typeof vi.fn>;
}

function makeWatcherHarness() {
  const watchedPaths: string[] = [];
  const watchers: FakeWatcher[] = [];
  const watch = vi.fn((filePath: string) => {
    watchedPaths.push(filePath);
    const fake: FakeWatcher = {
      callbacks: new Map(),
      close: vi.fn(() => undefined),
    };
    watchers.push(fake);
    return {
      on(eventName: string, callback: (changedPath: string) => void) {
        const callbacks = fake.callbacks.get(eventName) ?? [];
        callbacks.push(callback);
        fake.callbacks.set(eventName, callbacks);
        return this;
      },
      close: fake.close as () => void,
    };
  });
  const emitted: Array<{ channel: string; payload: unknown }> = [];
  const emit = (channel: string, payload: unknown) => emitted.push({ channel, payload });
  return { watch, watchedPaths, watchers, emitted, emit };
}

function fire(watcher: FakeWatcher, eventName: string, filePath: string) {
  for (const callback of watcher.callbacks.get(eventName) ?? []) callback(filePath);
}

describe('SceneCrafterBoardWatcher', () => {
  const notesVaultRoot = path.join(path.sep, 'vault');
  const storySlug = 'the-lost-heir';
  const boardPath = path.join(notesVaultRoot, boardRelPath(storySlug));

  it('watches the active board file and emits scene-crafter:external-edit on external changes', () => {
    const harness = makeWatcherHarness();
    const registry = new SceneCrafterBoardWatcher(harness.watch);

    registry.watchBoard(notesVaultRoot, storySlug, harness.emit);
    fire(harness.watchers[0], 'change', boardPath);

    expect(harness.watchedPaths).toEqual([boardPath]);
    expect(harness.emitted).toEqual([{ channel: 'scene-crafter:external-edit', payload: { storySlug } }]);
  });

  it('does not emit external-edit while a Mythos write lock is active for the board', () => {
    const harness = makeWatcherHarness();
    const registry = new SceneCrafterBoardWatcher(harness.watch);

    registry.watchBoard(notesVaultRoot, storySlug, harness.emit);
    registry.withMythosWrite(notesVaultRoot, storySlug, () => {
      fire(harness.watchers[0], 'change', boardPath);
    });

    expect(harness.emitted).toEqual([]);
  });

  it('closes the previous board watcher when switching stories', () => {
    const harness = makeWatcherHarness();
    const registry = new SceneCrafterBoardWatcher(harness.watch);

    registry.watchBoard(notesVaultRoot, storySlug, harness.emit);
    registry.watchBoard(notesVaultRoot, 'second-story', harness.emit);

    expect(harness.watchers[0].close).toHaveBeenCalledTimes(1);
    expect(harness.watchedPaths).toEqual([
      boardPath,
      path.join(notesVaultRoot, boardRelPath('second-story')),
    ]);
  });

  it('closes the active watcher when closeActive is called', () => {
    const harness = makeWatcherHarness();
    const registry = new SceneCrafterBoardWatcher(harness.watch);

    registry.watchBoard(notesVaultRoot, storySlug, harness.emit);
    registry.closeActive();

    expect(harness.watchers[0].close).toHaveBeenCalledTimes(1);
  });
});
