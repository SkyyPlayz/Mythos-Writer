import { describe, it, expect, vi } from 'vitest';
import { runQuitTeardownStep } from './quitTeardown.js';

describe('runQuitTeardownStep (SKY-10902)', () => {
  it('resolves once a sync step completes', async () => {
    const fn = vi.fn();
    await runQuitTeardownStep('sync-step', fn, 50);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('resolves once an async step settles', async () => {
    let resolved = false;
    await runQuitTeardownStep(
      'async-step',
      () => new Promise<void>((resolve) => setTimeout(() => { resolved = true; resolve(); }, 5)),
      50,
    );
    expect(resolved).toBe(true);
  });

  it('resolves (does not reject) when the step throws synchronously', async () => {
    const onError = vi.fn();
    await expect(
      runQuitTeardownStep('throwing-step', () => { throw new Error('boom'); }, 50, onError),
    ).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('throwing-step'));
  });

  it('resolves (does not reject) when the step rejects', async () => {
    const onError = vi.fn();
    await expect(
      runQuitTeardownStep('rejecting-step', () => Promise.reject(new Error('nope')), 50, onError),
    ).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('rejecting-step'));
  });

  it('times out and resolves when a step never settles — the SKY-10902 hang', async () => {
    const onError = vi.fn();
    const neverSettles = () => new Promise<void>(() => {});
    const start = Date.now();
    await runQuitTeardownStep('hanging-watcher', neverSettles, 30, onError);
    expect(Date.now() - start).toBeLessThan(1000);
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('timed out'));
  });

  it('a later step still runs after an earlier step hangs (sequential await pattern)', async () => {
    const order: string[] = [];
    await runQuitTeardownStep('hangs', () => new Promise<void>(() => {}), 20);
    order.push('after-hang');
    await runQuitTeardownStep('runs-next', () => { order.push('ran'); }, 20);
    expect(order).toEqual(['after-hang', 'ran']);
  });
});
