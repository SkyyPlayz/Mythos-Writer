// SKY-11363: renderer-side flush-before-quit registry.
//
// SKY-9973 introduced a main→renderer handshake: before the window closes, the
// main process asks the renderer to drain any pending debounced save and waits
// for a single ack. Originally only the manuscript manifest had such a writer.
// More than one component now does — the manuscript manifest (DesktopShell) and
// the brainstorm board (BrainstormPage) — and each is on its own debounce timer.
//
// A component with a debounced writer registers its flush here; the shell awaits
// ALL registered flushers before sending the single quit ack. Without this, a
// board change still inside its 400ms debounce is silently dropped on a full
// app-quit (Cmd+Q / File→Exit), because that quit path allows the unload
// without prompting and the manifest handshake never touched the board.
const flushers = new Set<() => void | Promise<void>>();

/** Register a flush to run before quit. Returns an unregister function. */
export function registerQuitFlusher(fn: () => void | Promise<void>): () => void {
  flushers.add(fn);
  return () => {
    flushers.delete(fn);
  };
}

/**
 * Run every registered flusher and wait for all to settle. Never rejects — one
 * writer's failure must not block quit or starve the others (the main-process
 * handshake is time-bounded anyway).
 */
export async function runQuitFlushers(): Promise<void> {
  await Promise.all(
    [...flushers].map((fn) => Promise.resolve().then(fn).catch(() => {})),
  );
}

/** Test-only: drop all registered flushers. */
export function __resetQuitFlushers(): void {
  flushers.clear();
}
