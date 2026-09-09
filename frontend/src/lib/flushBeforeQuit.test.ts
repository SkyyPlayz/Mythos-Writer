import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  registerQuitFlusher,
  runQuitFlushers,
  trackQuitCriticalWrite,
  __resetQuitFlushers,
} from './flushBeforeQuit';

afterEach(() => __resetQuitFlushers());

describe('flushBeforeQuit registry (SKY-11363)', () => {
  it('runs every registered flusher', async () => {
    const a = vi.fn();
    const b = vi.fn();
    registerQuitFlusher(a);
    registerQuitFlusher(b);
    await runQuitFlushers();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('awaits async flushers before resolving', async () => {
    let done = false;
    registerQuitFlusher(
      () => new Promise<void>((resolve) => setTimeout(() => { done = true; resolve(); }, 5)),
    );
    await runQuitFlushers();
    expect(done).toBe(true);
  });

  it('unregister removes the flusher', async () => {
    const a = vi.fn();
    const unregister = registerQuitFlusher(a);
    unregister();
    await runQuitFlushers();
    expect(a).not.toHaveBeenCalled();
  });

  it('one flusher throwing does not stop the others and does not reject', async () => {
    const good = vi.fn();
    registerQuitFlusher(() => { throw new Error('boom'); });
    registerQuitFlusher(good);
    await expect(runQuitFlushers()).resolves.toBeUndefined();
    expect(good).toHaveBeenCalledTimes(1);
  });

  it('is a no-op with nothing registered', async () => {
    await expect(runQuitFlushers()).resolves.toBeUndefined();
  });
});

// SKY-11646: the scene editor's change callback is synchronous and void — the
// flusher can only START its write. Awaiting the flusher alone let the window
// close mid-write, which is the reported data loss.
describe('quit-critical write tracking (SKY-11646)', () => {
  it('drains a write a synchronous flusher only started', async () => {
    let written = false;
    registerQuitFlusher(() => {
      // Fire-and-forget, exactly like persistSceneMarkdown's callers.
      void trackQuitCriticalWrite(
        new Promise<void>((resolve) => setTimeout(() => { written = true; resolve(); }, 10)),
      );
    });

    await runQuitFlushers();

    expect(written).toBe(true);
  });

  it('drains a follow-up write enqueued by the first one', async () => {
    const order: string[] = [];
    registerQuitFlusher(() => {
      void trackQuitCriticalWrite(
        new Promise<void>((resolve) => setTimeout(resolve, 5)).then(() => {
          order.push('scene');
          void trackQuitCriticalWrite(
            new Promise<void>((resolve) => setTimeout(resolve, 5)).then(() => { order.push('manifest'); }),
          );
        }),
      );
    });

    await runQuitFlushers();

    expect(order).toEqual(['scene', 'manifest']);
  });

  it('a rejected write never rejects the drain', async () => {
    const good = vi.fn();
    registerQuitFlusher(() => {
      void trackQuitCriticalWrite(Promise.reject(new Error('disk full'))).catch(() => {});
      void trackQuitCriticalWrite(Promise.resolve().then(good));
    });

    await expect(runQuitFlushers()).resolves.toBeUndefined();
    expect(good).toHaveBeenCalledTimes(1);
  });

  it('hands the original promise back so callers can await the real result', async () => {
    await expect(trackQuitCriticalWrite(Promise.resolve('ok'))).resolves.toBe('ok');
  });

  it('waits for a write that was already in flight when quit arrived', async () => {
    // The debounce fired at 799ms and the save is mid-IPC when the user hits X:
    // no flusher has anything pending, but the write still must land.
    let written = false;
    void trackQuitCriticalWrite(
      new Promise<void>((resolve) => setTimeout(() => { written = true; resolve(); }, 10)),
    );

    await runQuitFlushers();

    expect(written).toBe(true);
  });
});
