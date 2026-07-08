// SKY-1759: Scene Crafter file-watcher conflict detection.
// Watches a single board.md for external edits; suppresses events from
// Mythos-own writes via a write-lock set.
import type { FSWatcher } from 'chokidar';

// Paths currently being written by Mythos — watcher ignores events for these.
const writingPaths = new Set<string>();

let boardWatcher: FSWatcher | null = null;
// Absolute path the active watcher is bound to (null when no watcher).
let watchedPath: string | null = null;
// Latest onExternalEdit/slug — the change handler reads through these so a
// repeat watch of the same path can refresh the callback without recreating
// (and churning) the chokidar watcher.
let currentStorySlug: string | null = null;
let currentOnExternalEdit: ((storySlug: string) => void) | null = null;

// Audit P4: watchBoardFile is called fire-and-forget on every GET_BOARD /
// CREATE_BOARD, so two overlapping calls could each create a watcher and
// orphan one (module-level boardWatcher overwritten without close). All
// watcher swaps are serialized behind this in-flight promise chain.
let watcherOp: Promise<void> = Promise.resolve();

function enqueueWatcherOp(task: () => Promise<void>): Promise<void> {
  const run = watcherOp.then(task);
  // Keep the chain alive even if a task rejects; the caller still sees it.
  watcherOp = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function closeActiveWatcher(): Promise<void> {
  if (!boardWatcher) return;
  const watcher = boardWatcher;
  boardWatcher = null;
  watchedPath = null;
  currentStorySlug = null;
  currentOnExternalEdit = null;
  await watcher.close();
}

/**
 * Start watching `boardAbsPath` for external changes. Replaces any prior watch
 * of a different path; a repeat call for the same path reuses the existing
 * watcher (only the callback is refreshed). Concurrent calls are serialized so
 * an interleaved stop/create can never orphan a watcher.
 * `onExternalEdit` is NOT called while a matching `beginBoardWrite` is in flight.
 */
export async function watchBoardFile(
  boardAbsPath: string,
  storySlug: string,
  onExternalEdit: (storySlug: string) => void,
): Promise<void> {
  return enqueueWatcherOp(async () => {
    if (boardWatcher && watchedPath === boardAbsPath) {
      // Already watching this exact file — just adopt the latest callback.
      currentStorySlug = storySlug;
      currentOnExternalEdit = onExternalEdit;
      return;
    }

    await closeActiveWatcher();

    const { default: chokidar } = await import('chokidar');
    const watcher = chokidar.watch(boardAbsPath, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
      followSymlinks: false,
    });

    watcher.on('change', () => {
      // Read through the module-level refs so the newest callback wins even
      // when the watcher object itself was reused.
      if (watcher === boardWatcher && !writingPaths.has(boardAbsPath) && currentOnExternalEdit && currentStorySlug !== null) {
        currentOnExternalEdit(currentStorySlug);
      }
    });

    boardWatcher = watcher;
    watchedPath = boardAbsPath;
    currentStorySlug = storySlug;
    currentOnExternalEdit = onExternalEdit;
  });
}

/** Stop the active board watcher and clear any pending write-locks. */
export async function stopBoardWatcher(): Promise<void> {
  return enqueueWatcherOp(async () => {
    await closeActiveWatcher();
    writingPaths.clear();
  });
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
