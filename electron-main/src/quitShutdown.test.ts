import { describe, it, expect, vi } from 'vitest';
import { abortInFlightAiStreams, createQuitWatchdog } from './quitShutdown.js';

describe('abortInFlightAiStreams (SKY-11363)', () => {
  it('aborts every registered controller and clears the map', () => {
    const a = { abort: vi.fn() };
    const b = { abort: vi.fn() };
    const controllers = new Map([['req-a', a], ['req-b', b]]);

    const count = abortInFlightAiStreams(controllers);

    expect(count).toBe(2);
    expect(a.abort).toHaveBeenCalledTimes(1);
    expect(b.abort).toHaveBeenCalledTimes(1);
    expect(controllers.size).toBe(0);
  });

  it('is a no-op on an empty map', () => {
    const controllers = new Map();
    expect(abortInFlightAiStreams(controllers)).toBe(0);
  });

  it('keeps aborting the rest when one controller throws', () => {
    const onError = vi.fn();
    const bad = { abort: () => { throw new Error('already aborted'); } };
    const good = { abort: vi.fn() };
    const controllers = new Map<string, { abort: () => void }>([['bad', bad], ['good', good]]);

    const count = abortInFlightAiStreams(controllers, onError);

    expect(good.abort).toHaveBeenCalledTimes(1);
    expect(count).toBe(1); // only the successful abort is counted
    expect(controllers.size).toBe(0);
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('bad'));
  });

  it('a second quit path finds an empty map — no double-abort', () => {
    const a = { abort: vi.fn() };
    const controllers = new Map([['req-a', a]]);
    abortInFlightAiStreams(controllers);
    abortInFlightAiStreams(controllers);
    expect(a.abort).toHaveBeenCalledTimes(1);
  });
});

describe('createQuitWatchdog (SKY-11363)', () => {
  const fakeTimers = () => {
    let armed: { fn: () => void } | null = null;
    return {
      api: {
        setTimeout: (fn: () => void) => {
          armed = { fn };
          return armed;
        },
        clearTimeout: () => { armed = null; },
      },
      fire: () => armed?.fn(),
      isArmed: () => armed !== null,
    };
  };

  it('force-exits once the timeout elapses', () => {
    const onExpire = vi.fn();
    const t = fakeTimers();
    const wd = createQuitWatchdog(8000, onExpire, t.api);

    wd.arm();
    expect(wd.armed).toBe(true);
    t.fire();

    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(wd.armed).toBe(false); // cleared itself on expiry
  });

  it('does not fire after being disarmed', () => {
    const onExpire = vi.fn();
    const t = fakeTimers();
    const wd = createQuitWatchdog(8000, onExpire, t.api);

    wd.arm();
    wd.disarm();
    expect(wd.armed).toBe(false);
    t.fire(); // no-op: cleared
    expect(onExpire).not.toHaveBeenCalled();
  });

  it('arm is idempotent — a second arm does not schedule a second timer', () => {
    const onExpire = vi.fn();
    let scheduled = 0;
    const wd = createQuitWatchdog(8000, onExpire, {
      setTimeout: () => { scheduled += 1; return { id: scheduled }; },
      clearTimeout: () => {},
    });
    wd.arm();
    wd.arm();
    expect(scheduled).toBe(1);
  });

  it('unrefs the handle so it cannot itself keep the process alive', () => {
    const unref = vi.fn();
    const wd = createQuitWatchdog(8000, () => {}, {
      setTimeout: () => ({ unref }),
      clearTimeout: () => {},
    });
    wd.arm();
    expect(unref).toHaveBeenCalledTimes(1);
  });
});
