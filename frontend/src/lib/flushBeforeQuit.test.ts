import { describe, it, expect, vi, afterEach } from 'vitest';
import { registerQuitFlusher, runQuitFlushers, __resetQuitFlushers } from './flushBeforeQuit';

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
