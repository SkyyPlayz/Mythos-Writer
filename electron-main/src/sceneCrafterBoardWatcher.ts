import path from 'path';
import chokidar from 'chokidar';
import { boardRelPath } from './sceneCrafterBoard.js';

type BoardChangeEvent = 'add' | 'change' | 'unlink';
type EmitSceneCrafterExternalEdit = (channel: 'scene-crafter:external-edit', payload: { storySlug: string }) => void;

type Watcher = {
  on(eventName: BoardChangeEvent, callback: (filePath: string) => void): Watcher;
  close(): Promise<void> | void;
};

type WatchFactory = (filePath: string) => Watcher;

interface ActiveWatch {
  filePath: string;
  watcher: Watcher;
}

export class SceneCrafterBoardWatcher {
  private activeWatch: ActiveWatch | null = null;
  private readonly mythosWritePaths = new Set<string>();

  constructor(private readonly watch: WatchFactory) {}

  watchBoard(notesVaultRoot: string, storySlug: string, emit: EmitSceneCrafterExternalEdit): void {
    const filePath = boardPath(notesVaultRoot, storySlug);
    if (this.activeWatch?.filePath === filePath) return;

    this.closeActive();

    const watcher = this.watch(filePath);
    const onExternalChange = (changedPath: string) => {
      const normalizedChangedPath = path.resolve(changedPath || filePath);
      if (normalizedChangedPath !== filePath) return;
      if (this.mythosWritePaths.has(filePath)) return;
      emit('scene-crafter:external-edit', { storySlug });
    };

    watcher
      .on('add', onExternalChange)
      .on('change', onExternalChange)
      .on('unlink', onExternalChange);

    this.activeWatch = { filePath, watcher };
  }

  closeActive(): void {
    if (!this.activeWatch) return;
    void this.activeWatch.watcher.close();
    this.activeWatch = null;
  }

  withMythosWrite<T>(notesVaultRoot: string, storySlug: string, write: () => T): T {
    const filePath = boardPath(notesVaultRoot, storySlug);
    this.mythosWritePaths.add(filePath);
    try {
      const result = write();
      if (result instanceof Promise) {
        return result.finally(() => this.mythosWritePaths.delete(filePath)) as T;
      }
      this.mythosWritePaths.delete(filePath);
      return result;
    } catch (error) {
      this.mythosWritePaths.delete(filePath);
      throw error;
    }
  }
}

export function boardPath(notesVaultRoot: string, storySlug: string): string {
  return path.resolve(notesVaultRoot, boardRelPath(storySlug));
}

export function createSceneCrafterBoardWatcher(): SceneCrafterBoardWatcher {
  return new SceneCrafterBoardWatcher((filePath) =>
    chokidar.watch(filePath, {
      awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 50 },
      ignoreInitial: true,
      persistent: true,
    }),
  );
}
