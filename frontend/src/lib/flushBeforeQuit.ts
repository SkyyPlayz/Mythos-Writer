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

/**
 * SKY-11646: writes a flusher only *starts*.
 *
 * Some flushers cannot hand back a promise. The scene editor's debounced change
 * callback is a plain `(markdown: string) => void` threaded through two wrapper
 * components; firing it synchronously kicks off a fire-and-forget `writeVault`
 * IPC and returns immediately. Awaiting the flusher therefore proves nothing —
 * the window can still close with the write in flight, which is the silent
 * data loss this ticket reports.
 *
 * Such writers register their promise here instead, and `runQuitFlushers`
 * drains the set after the flushers themselves have settled.
 */
const trackedWrites = new Set<Promise<unknown>>();

/** Register a flush to run before quit. Returns an unregister function. */
export function registerQuitFlusher(fn: () => void | Promise<void>): () => void {
  flushers.add(fn);
  return () => {
    flushers.delete(fn);
  };
}

/**
 * Track a save that must complete before the window closes. Returns the same
 * promise so callers can `await trackQuitCriticalWrite(save())` inline.
 */
export function trackQuitCriticalWrite<T>(write: Promise<T>): Promise<T> {
  const settled = write.catch(() => {}).finally(() => { trackedWrites.delete(settled); });
  trackedWrites.add(settled);
  return write;
}

/**
 * Run every registered flusher and wait for all to settle, then drain any
 * writes those flushers started. Never rejects — one writer's failure must not
 * block quit or starve the others (the main-process handshake is time-bounded
 * anyway).
 */
export async function runQuitFlushers(): Promise<void> {
  await Promise.all(
    [...flushers].map((fn) => Promise.resolve().then(fn).catch(() => {})),
  );
  // A drained write can schedule a follow-up write (the manuscript manifest
  // trails the scene body), so loop until the set stays empty. Bounded by the
  // main process's own flush timeout, and each pass strictly shrinks unless a
  // writer is actively enqueuing more work.
  for (let pass = 0; pass < 5 && trackedWrites.size > 0; pass += 1) {
    await Promise.all([...trackedWrites]);
  }
}

/** Test-only: drop all registered flushers and tracked writes. */
export function __resetQuitFlushers(): void {
  flushers.clear();
  trackedWrites.clear();
}
