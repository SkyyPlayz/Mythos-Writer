// SKY-1759: Scene Crafter file-watcher conflict detection.
// Watches a single board.md for external edits; suppresses events from
// Mythos-own writes via a write-lock set.
import type { FSWatcher } from 'chokidar';

// Paths currently being written by Mythos — watcher ignores events for these.
const writingPaths = new Set<string>();

let boardWatcher: FSWatcher | null = null;

/**
 * Start watching `boardAbsPath` for external changes. Replaces any prior watch.
 * `onExternalEdit` is NOT called while a matching `beginBoardWrite` is in flight.
 */
export async function watchBoardFile(
  boardAbsPath: string,
  storySlug: string,
  onExternalEdit: (storySlug: string) => void,
): Promise<void> {
  await stopBoardWatcher();

  const { default: chokidar } = await import('chokidar');
  boardWatcher = chokidar.watch(boardAbsPath, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
    followSymlinks: false,
  });

  boardWatcher.on('change', () => {
    if (!writingPaths.has(boardAbsPath)) {
      onExternalEdit(storySlug);
    }
  });
}

/** Stop the active board watcher and clear any pending write-locks. */
export async function stopBoardWatcher(): Promise<void> {
  if (boardWatcher) {
    await boardWatcher.close();
    boardWatcher = null;
  }
  writingPaths.clear();
}

/**
 * Mark `boardAbsPath` as being written by Mythos. Call before any fs.writeFile.
 * Use `endBoardWrite` to release — always via a timeout so the lock outlasts
 * chokidar's awaitWriteFinish window (~300 ms).
 */
export function beginBoardWrite(boardAbsPath: string): void {
  writingPaths.add(boardAbsPath);
}

/**
 * Release the write-lock for `boardAbsPath`.
 * Callers in sceneCrafterIpc.ts defer this by 600 ms so the lock outlasts the
 * watcher's awaitWriteFinish stabilityThreshold (300 ms).
 */
export function endBoardWrite(boardAbsPath: string): void {
  writingPaths.delete(boardAbsPath);
}
