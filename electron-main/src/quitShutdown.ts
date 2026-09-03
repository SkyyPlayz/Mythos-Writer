// SKY-11363: shutdown safety helpers, extracted (like quitGuard.ts /
// quitTeardown.ts) so the process-liveness logic is unit-testable without an
// Electron app instance. The owner hit an app that would not close on Windows
// and had to force-kill it from Task Manager — a data-loss risk for a writing
// app. Two independent things can keep the process alive after the user asks
// to quit: an in-flight AI stream (its fetch socket) and a wedged teardown or
// native handle. Both must be bounded here.

/** Minimal shape of an in-flight request handle we can cancel. */
export interface AbortableStream {
  abort: () => void;
}

// SKY-11363 (AC #3): any in-flight AI request must be ABORTED on quit, never
// awaited — a slow local model (LM Studio, minute-plus 35B generation) would
// otherwise hold the process open exactly when the owner has been using it
// hardest. Aborts every registered controller and clears the map so a second
// quit path can't double-abort or leak. Never throws: one controller whose
// abort() throws must not stop the rest from aborting.
export function abortInFlightAiStreams<T extends AbortableStream>(
  controllers: Map<string, T>,
  onError: (message: string) => void = (msg) => console.error(msg),
): number {
  let aborted = 0;
  for (const [requestId, controller] of controllers) {
    try {
      controller.abort();
      aborted += 1;
    } catch (err) {
      onError(
        `[quit] aborting AI stream ${requestId} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  controllers.clear();
  return aborted;
}

export interface QuitWatchdog {
  /** Arm the timer. Idempotent — arming an already-armed watchdog is a no-op. */
  arm: () => void;
  /** Cancel the timer if armed. */
  disarm: () => void;
  /** Test/inspection hook. */
  readonly armed: boolean;
}

/**
 * SKY-11363 (scope #2): a hard, bounded backstop for shutdown. Once quit is
 * committed (all windows closed), arm this; if the process has not exited by
 * `timeoutMs` — a wedged teardown step, an OS file handle that will not
 * release (the SKY-10902 Windows watcher class of bug), a native handle we do
 * not control — force-exit. A dirty exit here loses nothing a clean one
 * wouldn't: SQLite is crash-safe and job checkpoints persist continuously (see
 * the window-all-closed teardown). An unkillable app is strictly worse.
 *
 * Timers/exit are injected so the watchdog is testable with fake timers and
 * without terminating the test runner.
 */
export function createQuitWatchdog(
  timeoutMs: number,
  onExpire: () => void,
  timers: {
    setTimeout: (fn: () => void, ms: number) => unknown;
    clearTimeout: (handle: unknown) => void;
  } = {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  },
): QuitWatchdog {
  let handle: unknown = null;
  return {
    arm() {
      if (handle !== null) return;
      handle = timers.setTimeout(() => {
        handle = null;
        onExpire();
      }, timeoutMs);
      // Don't let the watchdog itself keep the event loop alive — if
      // everything else has already released, the app should exit cleanly
      // before the timer fires, not linger until it does.
      if (handle && typeof (handle as { unref?: () => void }).unref === 'function') {
        (handle as { unref: () => void }).unref();
      }
    },
    disarm() {
      if (handle === null) return;
      timers.clearTimeout(handle);
      handle = null;
    },
    get armed() {
      return handle !== null;
    },
  };
}
