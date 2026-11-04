/**
 * PLAN-IDLE-CATCH-UP — idle catch-up gate unit matrix.
 *
 * Purpose: owns gate unit matrix; never launches Electron. Every row builds
 * its own `IdleCatchUpGate` with injected fakes: a manual clock + timer queue
 * (`advance`), a manual animation-frame queue (`flushFrame`), a `vi.fn`
 * `jobs.enqueue` and a controllable vault root. Async settling is a real
 * zero-delay macrotask (`settle`), so every microtask the gate queued has run
 * before an assertion; the gate itself only sees the injected clocks.
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  IDLE_STAGE_CAP,
  IdleCatchUpGate,
  type IdleCatchUpE2EController,
  type IdleEnqueueOpts,
  type IdleEnqueueResult,
  type IdleJobType,
} from './idleCatchUpGate';

/** Default `minutes: 2`, written out on purpose. */
const IDLE_MS = 2 * 60_000;
const TYPE: IdleJobType = 'manuscript-scan';

type EnqueueResponse = { jobId?: string; error?: string };
type EnqueueFn = (type: string, opts?: IdleEnqueueOpts) => Promise<EnqueueResponse>;
type TimerHandle = ReturnType<typeof setTimeout>;

function scene(sceneId: string): IdleEnqueueOpts {
  return { scope: { level: 'scene', sceneId } };
}

/** Let every queued microtask run (one real macrotask turn). */
function settle(): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Observe a waiter without awaiting it, so "still pending" is assertable. */
function track(p: Promise<IdleEnqueueResult>) {
  const state: { settled: boolean; result: IdleEnqueueResult | undefined } = { settled: false, result: undefined };
  void p.then((r) => {
    state.settled = true;
    state.result = r;
  });
  return state;
}

function makeHarness(init: { e2e?: boolean; hidden?: boolean; jobs?: boolean; realVaultRoot?: boolean } = {}) {
  let clock = 1_000_000;
  let nextHandle = 1;
  let vault = '/vaults/A';
  let jobSeq = 0;
  const e2e = init.e2e ?? false;
  let hidden = init.hidden ?? false;
  const jobsOn = init.jobs ?? true;
  const frames = new Map<number, () => void>();
  const timers = new Map<number, { at: number; cb: () => void }>();
  /** Every delay the gate asked `setTimer` for, in order. */
  const timerDelays: number[] = [];

  const enqueue = vi.fn<EnqueueFn>(async () => {
    jobSeq += 1;
    return { jobId: `job-${jobSeq}` };
  });
  const getVaultRoot = vi.fn<() => Promise<string>>(async () => vault);
  const exposeE2E = vi.fn<(controller: IdleCatchUpE2EController) => void>();

  const gate = new IdleCatchUpGate({
    now: () => clock,
    requestFrame: (cb) => {
      const handle = nextHandle++;
      frames.set(handle, cb);
      return handle;
    },
    cancelFrame: (handle) => {
      frames.delete(handle);
    },
    setTimer: (cb, ms) => {
      const handle = nextHandle++;
      timers.set(handle, { at: clock + ms, cb });
      timerDelays.push(ms);
      return handle as unknown as TimerHandle;
    },
    clearTimer: (handle) => {
      timers.delete(handle as unknown as number);
    },
    isHidden: () => hidden,
    getJobs: () => (jobsOn ? { enqueue } : undefined),
    // `realVaultRoot` keeps the default reader (window.api.getVaultRoot).
    ...(init.realVaultRoot ? {} : { getVaultRoot }),
    isE2E: () => e2e,
    exposeE2E,
  });

  /** Move the clock forward, firing due timers in order and settling after each. */
  async function advance(ms: number): Promise<void> {
    const target = clock + ms;
    for (;;) {
      let due: { handle: number; at: number; cb: () => void } | null = null;
      for (const [handle, t] of timers) {
        if (t.at <= target && (due === null || t.at < due.at)) due = { handle, at: t.at, cb: t.cb };
      }
      if (due === null) break;
      timers.delete(due.handle);
      clock = Math.max(clock, due.at);
      due.cb();
      await settle();
    }
    clock = target;
    await settle();
  }

  /** Run every animation frame queued so far (not ones they queue), then settle. */
  async function flushFrame(): Promise<number> {
    const due = [...frames.values()];
    frames.clear();
    for (const cb of due) cb();
    await settle();
    return due.length;
  }

  /** Run frames until the flush stops asking for one. */
  async function drainFrames(): Promise<void> {
    for (let i = 0; i < 50; i += 1) {
      if ((await flushFrame()) === 0) return;
    }
    throw new Error('flush never stopped requesting frames');
  }

  /** Attach the host, then type once: the idle window starts now. */
  function attachAfterTyping(): () => void {
    const detach = gate.attach();
    gate.noteActivity();
    return detach;
  }

  return {
    gate,
    attachAfterTyping,
    enqueue,
    getVaultRoot,
    exposeE2E,
    timerDelays,
    advance,
    flushFrame,
    drainFrames,
    now: () => clock,
    pendingFrames: () => frames.size,
    pendingTimers: () => timers.size,
    setVault: (root: string) => {
      vault = root;
    },
    setHidden: (value: boolean) => {
      hidden = value;
    },
  };
}

describe('IdleCatchUpGate — staging and the idle flush', () => {
  it('stages, then submits only after a full idle window, on an animation frame', async () => {
    const h = makeHarness();
    h.attachAfterTyping();
    const onStaged = vi.fn();
    const a = track(h.gate.enqueueWhenIdle(TYPE, scene('s1'), { onStaged }));
    await settle();

    expect(onStaged).toHaveBeenCalledTimes(1);
    expect(h.gate.stagedCount()).toBe(1);
    expect(h.gate.__e2e.stagedKeys()).toEqual(['manuscript-scan|scene|s1']);
    expect(h.timerDelays).toEqual([IDLE_MS]);

    await h.advance(IDLE_MS - 1);
    expect(h.pendingFrames()).toBe(0);
    expect(h.enqueue).not.toHaveBeenCalled();
    expect(a.settled).toBe(false);

    await h.advance(1);
    // Idle reached: the flush waits for a frame instead of draining in a microtask.
    expect(h.pendingFrames()).toBe(1);
    expect(h.enqueue).not.toHaveBeenCalled();

    await h.flushFrame();
    expect(h.enqueue).toHaveBeenCalledTimes(1);
    expect(h.enqueue).toHaveBeenCalledWith('manuscript-scan', scene('s1'));
    expect(a.result).toEqual({ accepted: 'submitted', jobId: 'job-1' });
    expect(h.gate.stagedCount()).toBe(0);
  });

  it('submits one staged item per animation frame', async () => {
    const h = makeHarness();
    h.attachAfterTyping();
    const a = track(h.gate.enqueueWhenIdle(TYPE, scene('s1')));
    const b = track(h.gate.enqueueWhenIdle(TYPE, scene('s2')));
    await settle();
    await h.advance(IDLE_MS);

    await h.flushFrame();
    expect(h.enqueue).toHaveBeenCalledTimes(1);
    expect(a.result?.accepted).toBe('submitted');
    expect(b.settled).toBe(false);

    await h.flushFrame();
    expect(h.enqueue).toHaveBeenCalledTimes(2);
    expect(h.enqueue.mock.calls[1]?.[1]).toEqual(scene('s2'));
    expect(b.result).toEqual({ accepted: 'submitted', jobId: 'job-2' });
  });

  it('activity before idle keeps the item staged and waits a full window after the last activity', async () => {
    const h = makeHarness();
    h.attachAfterTyping();
    const a = track(h.gate.enqueueWhenIdle(TYPE, scene('s1')));
    await settle();

    await h.advance(60_000);
    h.gate.noteActivity();
    // The original timer fires, sees recent typing, and re-arms for the remainder.
    await h.advance(60_000);
    expect(h.timerDelays).toEqual([IDLE_MS, 60_000]);
    expect(h.pendingFrames()).toBe(0);
    await h.flushFrame();
    expect(h.enqueue).not.toHaveBeenCalled();
    expect(h.gate.stagedCount()).toBe(1);

    await h.advance(59_999);
    expect(h.pendingFrames()).toBe(0);
    expect(h.enqueue).not.toHaveBeenCalled();
    expect(a.settled).toBe(false);

    await h.advance(1);
    expect(h.pendingFrames()).toBe(1);
    await h.drainFrames();
    expect(h.enqueue).toHaveBeenCalledTimes(1);
    expect(a.result?.accepted).toBe('submitted');
  });

  it('an item staged while already idle submits on the next frame without a new window', async () => {
    const h = makeHarness();
    h.attachAfterTyping();
    await h.advance(5 * 60_000);
    // Nothing staged → no idle timer ran.
    expect(h.timerDelays).toEqual([]);

    const a = track(h.gate.enqueueWhenIdle(TYPE, scene('s1')));
    await settle();
    expect(h.timerDelays).toEqual([0]);

    const before = h.now();
    await h.advance(0);
    expect(h.pendingFrames()).toBe(1);
    await h.flushFrame();
    expect(h.now()).toBe(before);
    expect(h.enqueue).toHaveBeenCalledTimes(1);
    expect(a.result?.accepted).toBe('submitted');
  });

  it('a waiter is never resolved while its item is staged', async () => {
    const h = makeHarness();
    h.attachAfterTyping();
    const onStaged = vi.fn();
    const a = track(h.gate.enqueueWhenIdle(TYPE, scene('s1'), { onStaged }));
    await settle();

    for (let i = 0; i < 6; i += 1) {
      await h.advance(30_000);
      if (i % 2 === 1) h.gate.noteActivity();
      await h.flushFrame();
      expect(a.settled, `step ${i}`).toBe(false);
      expect(h.gate.stagedCount(), `step ${i}`).toBe(1);
    }
    expect(onStaged).toHaveBeenCalledTimes(1);
    expect(h.enqueue).not.toHaveBeenCalled();

    await h.advance(IDLE_MS);
    await h.drainFrames();
    expect(a.result?.accepted).toBe('submitted');
  });

  it('a hidden document paces the flush with a 250 ms timer instead of a frame', async () => {
    const h = makeHarness({ hidden: true });
    h.attachAfterTyping();
    const a = track(h.gate.enqueueWhenIdle(TYPE, scene('s1')));
    await settle();

    await h.advance(IDLE_MS);
    expect(h.pendingFrames()).toBe(0);
    expect(h.timerDelays).toEqual([IDLE_MS, 250]);
    expect(h.enqueue).not.toHaveBeenCalled();

    await h.advance(249);
    expect(h.enqueue).not.toHaveBeenCalled();
    await h.advance(1);
    expect(h.enqueue).toHaveBeenCalledTimes(1);
    expect(a.result?.accepted).toBe('submitted');
  });

  it('a window minimized after the frame was requested still advances within 250 ms', async () => {
    const h = makeHarness();
    h.attachAfterTyping();
    const a = track(h.gate.enqueueWhenIdle(TYPE, scene('s1')));
    await settle();
    await h.advance(IDLE_MS);
    expect(h.pendingFrames()).toBe(1);

    // Background throttling: the requested rAF never fires from here on.
    h.setHidden(true);
    await h.advance(249);
    expect(h.enqueue).not.toHaveBeenCalled();
    await h.advance(1);
    expect(h.enqueue).toHaveBeenCalledTimes(1);
    expect(a.result?.accepted).toBe('submitted');
    // The fired fallback cancelled its frame.
    expect(h.pendingFrames()).toBe(0);
  });

  it('the first attach starts idle (nothing typed yet); a re-attach restarts the window', async () => {
    const h = makeHarness();
    const detach = h.gate.attach();
    const a = track(h.gate.enqueueWhenIdle(TYPE, scene('s1')));
    await settle();
    expect(h.timerDelays).toEqual([0]);
    await h.advance(0);
    await h.flushFrame();
    expect(h.enqueue).toHaveBeenCalledTimes(1);
    expect(a.result?.accepted).toBe('submitted');

    detach();
    h.gate.attach();
    const b = track(h.gate.enqueueWhenIdle(TYPE, scene('s2')));
    await settle();
    expect(h.timerDelays.slice(-1)).toEqual([IDLE_MS]);
    await h.advance(IDLE_MS - 1);
    await h.flushFrame();
    expect(h.enqueue).toHaveBeenCalledTimes(1);
    expect(b.settled).toBe(false);
    await h.advance(1);
    await h.drainFrames();
    expect(h.enqueue).toHaveBeenCalledTimes(2);
    expect(b.result?.accepted).toBe('submitted');
  });
});

describe('IdleCatchUpGate — coalesce and the stage cap', () => {
  it('a newer request with the same type + scope replaces the older one', async () => {
    const h = makeHarness();
    h.attachAfterTyping();
    const older = track(h.gate.enqueueWhenIdle(TYPE, scene('s1')));
    await settle();
    const newerOpts = scene('s1');
    const newer = track(h.gate.enqueueWhenIdle(TYPE, newerOpts));
    await settle();

    expect(older.result).toEqual({ accepted: 'rejected', reason: 'coalesced' });
    expect(newer.settled).toBe(false);
    expect(h.gate.stagedCount()).toBe(1);

    await h.advance(IDLE_MS);
    await h.drainFrames();
    expect(h.enqueue).toHaveBeenCalledTimes(1);
    expect(h.enqueue.mock.calls[0]?.[1]).toBe(newerOpts);
    expect(newer.result?.accepted).toBe('submitted');
  });

  it('caps at 8 distinct keys: a 9th new key is buffer-full while a same-key request still coalesces', async () => {
    expect(IDLE_STAGE_CAP).toBe(8);
    const h = makeHarness();
    h.attachAfterTyping();
    const waiters = Array.from({ length: 8 }, (_, i) => track(h.gate.enqueueWhenIdle(TYPE, scene(`s${i}`))));
    await settle();
    expect(h.gate.stagedCount()).toBe(8);

    const ninth = track(h.gate.enqueueWhenIdle(TYPE, scene('s8')));
    await settle();
    expect(ninth.result).toEqual({ accepted: 'rejected', reason: 'buffer-full' });
    expect(h.gate.stagedCount()).toBe(8);

    const again = track(h.gate.enqueueWhenIdle(TYPE, scene('s3')));
    await settle();
    expect(waiters[3]?.result).toEqual({ accepted: 'rejected', reason: 'coalesced' });
    expect(again.settled).toBe(false);
    expect(h.gate.stagedCount()).toBe(8);

    await h.advance(IDLE_MS);
    await h.drainFrames();
    expect(h.enqueue).toHaveBeenCalledTimes(8);
    const submitted = h.enqueue.mock.calls.map((call) => call[1]?.scope?.sceneId);
    expect(submitted).not.toContain('s8');
    expect([...submitted].sort()).toEqual(['s0', 's1', 's2', 's3', 's4', 's5', 's6', 's7']);
    expect(again.result?.accepted).toBe('submitted');
  });
});

describe('IdleCatchUpGate — bypass and settings', () => {
  it('enabled=false submits immediately and propagates enqueue errors', async () => {
    const h = makeHarness();
    h.gate.configure({ enabled: false, minutes: 2 });
    h.attachAfterTyping();

    const ok = track(h.gate.enqueueWhenIdle(TYPE, scene('s1')));
    await settle();
    expect(h.enqueue).toHaveBeenCalledTimes(1);
    expect(ok.result).toEqual({ accepted: 'submitted', jobId: 'job-1' });

    h.enqueue.mockResolvedValueOnce({ error: 'queue full' });
    const failed = track(h.gate.enqueueWhenIdle(TYPE, scene('s2')));
    await settle();
    expect(failed.result).toEqual({ accepted: 'rejected', reason: 'enqueue-failed', error: 'queue full' });

    h.enqueue.mockRejectedValueOnce(new Error('ipc down'));
    const thrown = track(h.gate.enqueueWhenIdle(TYPE, scene('s3')));
    await settle();
    expect(thrown.result).toEqual({ accepted: 'rejected', reason: 'enqueue-failed', error: 'ipc down' });

    // Nothing waited on the idle clock.
    expect(h.getVaultRoot).not.toHaveBeenCalled();
    expect(h.timerDelays).toEqual([]);
    expect(h.gate.stagedCount()).toBe(0);
  });

  it('disabling submits staged items right away and propagates their enqueue errors', async () => {
    const h = makeHarness();
    h.attachAfterTyping();
    const onStaged = vi.fn();
    const a = track(h.gate.enqueueWhenIdle(TYPE, scene('s1'), { onStaged }));
    const b = track(h.gate.enqueueWhenIdle(TYPE, scene('s2'), { onStaged }));
    await settle();
    expect(onStaged).toHaveBeenCalledTimes(2);
    expect(h.enqueue).not.toHaveBeenCalled();

    h.enqueue.mockResolvedValueOnce({ jobId: 'job-a' }).mockResolvedValueOnce({ error: 'queue full' });
    h.gate.configure({ enabled: false, minutes: 2 });
    await settle();

    // No idle wait and no frame: the off path is immediate.
    expect(h.enqueue).toHaveBeenCalledTimes(2);
    expect(h.enqueue.mock.calls.map((call) => call[1])).toEqual([scene('s1'), scene('s2')]);
    expect(a.result).toEqual({ accepted: 'submitted', jobId: 'job-a' });
    expect(b.result).toEqual({ accepted: 'rejected', reason: 'enqueue-failed', error: 'queue full' });
    expect(h.gate.stagedCount()).toBe(0);
    expect(h.pendingFrames()).toBe(0);
    expect(h.pendingTimers()).toBe(0);
  });

  it('disabling with items staged for another vault drops them as vault-switch', async () => {
    const h = makeHarness();
    h.attachAfterTyping();
    const a = track(h.gate.enqueueWhenIdle(TYPE, scene('s1')));
    await settle();

    h.setVault('/vaults/B');
    h.gate.configure({ enabled: false, minutes: 2 });
    await settle();
    expect(h.enqueue).not.toHaveBeenCalled();
    expect(a.result).toEqual({ accepted: 'rejected', reason: 'vault-switch' });
    expect(h.gate.stagedCount()).toBe(0);
  });

  it('re-enabling restarts the countdown', async () => {
    const h = makeHarness();
    h.attachAfterTyping();
    // Long idle, then off → on: the window starts again at re-enable.
    await h.advance(10 * 60_000);
    h.gate.configure({ enabled: false, minutes: 2 });
    h.gate.configure({ enabled: true, minutes: 2 });
    const a = track(h.gate.enqueueWhenIdle(TYPE, scene('s1')));
    await settle();
    expect(h.timerDelays).toEqual([IDLE_MS]);

    await h.advance(IDLE_MS - 1);
    await h.flushFrame();
    expect(h.enqueue).not.toHaveBeenCalled();
    expect(a.settled).toBe(false);

    await h.advance(1);
    await h.drainFrames();
    expect(h.enqueue).toHaveBeenCalledTimes(1);
    expect(a.result?.accepted).toBe('submitted');
  });

  it('no host ever attached in this window → immediate submit (no staging)', async () => {
    const h = makeHarness();
    const a = track(h.gate.enqueueWhenIdle(TYPE, scene('s1')));
    await settle();
    expect(h.enqueue).toHaveBeenCalledTimes(1);
    expect(a.result).toEqual({ accepted: 'submitted', jobId: 'job-1' });
    expect(h.getVaultRoot).not.toHaveBeenCalled();
    expect(h.timerDelays).toEqual([]);
    expect(h.gate.stagedCount()).toBe(0);
  });

  it('once a host has attached, a detached window still stages and does not submit', async () => {
    const h = makeHarness();
    const detach = h.attachAfterTyping();
    detach();
    const a = track(h.gate.enqueueWhenIdle(TYPE, scene('s1')));
    await settle();
    await h.advance(IDLE_MS * 3);
    await h.flushFrame();
    expect(h.enqueue).not.toHaveBeenCalled();
    expect(a.settled).toBe(false);
    expect(h.gate.stagedCount()).toBe(1);
  });

  it('rejects a job type off the allowlist and a window without jobs', async () => {
    const h = makeHarness();
    h.attachAfterTyping();
    await expect(h.gate.enqueueWhenIdle('chat' as string as IdleJobType)).resolves.toEqual({
      accepted: 'rejected',
      reason: 'not-allowed',
    });
    expect(h.gate.stagedCount()).toBe(0);

    const noJobs = makeHarness({ jobs: false });
    noJobs.gate.attach();
    await expect(noJobs.gate.enqueueWhenIdle(TYPE)).resolves.toEqual({ accepted: 'rejected', reason: 'unavailable' });
    expect(noJobs.gate.stagedCount()).toBe(0);
    expect(h.enqueue).not.toHaveBeenCalled();
  });
});

describe('IdleCatchUpGate — typing and detach during a flush', () => {
  it('activity after the first submit leaves the second staged and pending until the next idle window', async () => {
    const h = makeHarness();
    h.attachAfterTyping();
    const a = track(h.gate.enqueueWhenIdle(TYPE, scene('s1')));
    const b = track(h.gate.enqueueWhenIdle(TYPE, scene('s2')));
    await settle();
    await h.advance(IDLE_MS);

    await h.flushFrame();
    expect(h.enqueue).toHaveBeenCalledTimes(1);
    expect(a.result?.accepted).toBe('submitted');
    expect(h.pendingFrames()).toBe(1);

    h.gate.noteActivity();
    await h.flushFrame();
    expect(h.enqueue).toHaveBeenCalledTimes(1);
    expect(b.settled).toBe(false);
    expect(h.gate.stagedCount()).toBe(1);
    expect(h.pendingFrames()).toBe(0);

    await h.advance(IDLE_MS - 1);
    await h.flushFrame();
    expect(h.enqueue).toHaveBeenCalledTimes(1);

    await h.advance(1);
    await h.drainFrames();
    expect(h.enqueue).toHaveBeenCalledTimes(2);
    expect(h.enqueue.mock.calls[1]?.[1]).toEqual(scene('s2'));
    expect(b.result?.accepted).toBe('submitted');
  });

  it('detach with a frame pending cancels the frame and keeps the item', async () => {
    const h = makeHarness();
    const detach = h.attachAfterTyping();
    const a = track(h.gate.enqueueWhenIdle(TYPE, scene('s1')));
    await settle();
    await h.advance(IDLE_MS);
    expect(h.pendingFrames()).toBe(1);

    detach();
    await settle();
    expect(h.pendingFrames()).toBe(0);
    expect(h.pendingTimers()).toBe(0);
    expect(h.enqueue).not.toHaveBeenCalled();
    expect(a.settled).toBe(false);
    expect(h.gate.stagedCount()).toBe(1);
  });
});

describe('IdleCatchUpGate — enqueue failures at flush', () => {
  it('jobs.enqueue resolving { error } settles the waiter as enqueue-failed and does not retry', async () => {
    const h = makeHarness();
    h.attachAfterTyping();
    h.enqueue.mockResolvedValueOnce({ error: 'Scan already running' });
    const a = track(h.gate.enqueueWhenIdle(TYPE, scene('s1')));
    await settle();
    await h.advance(IDLE_MS);
    await h.drainFrames();

    expect(a.result).toEqual({ accepted: 'rejected', reason: 'enqueue-failed', error: 'Scan already running' });
    expect(h.enqueue).toHaveBeenCalledTimes(1);
    expect(h.gate.stagedCount()).toBe(0);
  });

  it('jobs.enqueue throwing settles with the message and the flush moves on', async () => {
    const h = makeHarness();
    h.attachAfterTyping();
    h.enqueue.mockRejectedValueOnce(new Error('IPC channel closed')).mockRejectedValueOnce('boom');
    const a = track(h.gate.enqueueWhenIdle(TYPE, scene('s1')));
    const b = track(h.gate.enqueueWhenIdle(TYPE, scene('s2')));
    const c = track(h.gate.enqueueWhenIdle(TYPE, scene('s3')));
    await settle();
    await h.advance(IDLE_MS);
    await h.drainFrames();

    expect(a.result).toEqual({ accepted: 'rejected', reason: 'enqueue-failed', error: 'IPC channel closed' });
    expect(b.result).toEqual({ accepted: 'rejected', reason: 'enqueue-failed', error: 'boom' });
    expect(c.result?.accepted).toBe('submitted');
    expect(h.enqueue).toHaveBeenCalledTimes(3);
  });
});

describe('IdleCatchUpGate — vault binding', () => {
  it("clearStaged('vault-switch') settles every staged waiter and nothing submits later", async () => {
    const h = makeHarness();
    h.attachAfterTyping();
    const a = track(h.gate.enqueueWhenIdle(TYPE, scene('s1')));
    const b = track(h.gate.enqueueWhenIdle(TYPE, scene('s2')));
    await settle();

    h.gate.clearStaged('vault-switch');
    await settle();
    expect(a.result).toEqual({ accepted: 'rejected', reason: 'vault-switch' });
    expect(b.result).toEqual({ accepted: 'rejected', reason: 'vault-switch' });
    expect(h.gate.stagedCount()).toBe(0);

    await h.advance(IDLE_MS * 2);
    expect(h.pendingFrames()).toBe(0);
    expect(h.enqueue).not.toHaveBeenCalled();

    const c = track(h.gate.enqueueWhenIdle(TYPE, scene('s3')));
    await settle();
    h.gate.clearStaged();
    await settle();
    expect(c.result).toEqual({ accepted: 'rejected', reason: 'cleared' });
  });

  it('a vault root that changed by flush time clears the buffer with no enqueue', async () => {
    const h = makeHarness();
    h.attachAfterTyping();
    const a = track(h.gate.enqueueWhenIdle(TYPE, scene('s1')));
    const b = track(h.gate.enqueueWhenIdle(TYPE, scene('s2')));
    await settle();

    h.setVault('/vaults/B');
    await h.advance(IDLE_MS);
    await h.drainFrames();

    expect(h.enqueue).not.toHaveBeenCalled();
    expect(a.result).toEqual({ accepted: 'rejected', reason: 'vault-switch' });
    expect(b.result).toEqual({ accepted: 'rejected', reason: 'vault-switch' });
    expect(h.gate.stagedCount()).toBe(0);
    // Two stage-time reads + one flush-time read.
    expect(h.getVaultRoot).toHaveBeenCalledTimes(3);
  });

  it('a clear while a stage is still reading the vault root rejects that request as vault-switch and never stages it', async () => {
    const h = makeHarness();
    h.attachAfterTyping();
    const root = deferred<string>();
    h.getVaultRoot.mockImplementationOnce(() => root.promise);
    const onStaged = vi.fn();
    const a = track(h.gate.enqueueWhenIdle(TYPE, scene('s1'), { onStaged }));
    await settle();
    expect(a.settled).toBe(false);

    h.gate.clearStaged('vault-switch');
    root.resolve('/vaults/A');
    await settle();

    expect(a.result).toEqual({ accepted: 'rejected', reason: 'vault-switch' });
    expect(onStaged).not.toHaveBeenCalled();
    expect(h.gate.stagedCount()).toBe(0);
    await h.advance(IDLE_MS);
    expect(h.pendingFrames()).toBe(0);
    expect(h.enqueue).not.toHaveBeenCalled();
  });

  it('a switch while the first submit is in flight keeps the next item off the new vault', async () => {
    const h = makeHarness();
    h.attachAfterTyping();
    const inFlight = deferred<EnqueueResponse>();
    h.enqueue.mockImplementationOnce(() => inFlight.promise);
    const a = track(h.gate.enqueueWhenIdle(TYPE, scene('s1')));
    const b = track(h.gate.enqueueWhenIdle(TYPE, scene('s2')));
    await settle();
    await h.advance(IDLE_MS);

    await h.flushFrame();
    expect(h.enqueue).toHaveBeenCalledTimes(1);
    expect(a.settled).toBe(false);

    h.setVault('/vaults/B');
    inFlight.resolve({ jobId: 'job-A' });
    await settle();
    expect(a.result).toEqual({ accepted: 'submitted', jobId: 'job-A' });

    await h.drainFrames();
    expect(h.enqueue).toHaveBeenCalledTimes(1);
    expect(b.result).toEqual({ accepted: 'rejected', reason: 'vault-switch' });
    expect(h.gate.stagedCount()).toBe(0);

    // A fresh request bound to the new vault still goes through.
    const c = track(h.gate.enqueueWhenIdle(TYPE, scene('s2')));
    await settle();
    await h.advance(0);
    await h.drainFrames();
    expect(h.enqueue).toHaveBeenCalledTimes(2);
    expect(c.result?.accepted).toBe('submitted');
  });

  it('a vault read that fails at flush keeps the item staged and waits a full idle window before reading again', async () => {
    const h = makeHarness();
    h.attachAfterTyping();
    const a = track(h.gate.enqueueWhenIdle(TYPE, scene('s1')));
    await settle();
    expect(h.getVaultRoot).toHaveBeenCalledTimes(1);

    h.getVaultRoot.mockRejectedValueOnce(new Error('EACCES'));
    await h.advance(IDLE_MS);
    await h.flushFrame();
    expect(h.getVaultRoot).toHaveBeenCalledTimes(2);
    expect(h.enqueue).not.toHaveBeenCalled();
    expect(a.settled).toBe(false);
    expect(h.gate.stagedCount()).toBe(1);

    // No retry on the next frame or timer tick — only after a fresh window.
    await h.advance(IDLE_MS - 1);
    await h.flushFrame();
    expect(h.getVaultRoot).toHaveBeenCalledTimes(2);
    expect(a.settled).toBe(false);

    await h.advance(1);
    await h.drainFrames();
    expect(h.getVaultRoot).toHaveBeenCalledTimes(3);
    expect(h.enqueue).toHaveBeenCalledTimes(1);
    expect(a.result?.accepted).toBe('submitted');
  });
});

describe('IdleCatchUpGate — default vault reader (window.api.getVaultRoot)', () => {
  let originalApi: unknown;

  function stubVaultReader(replies: unknown[]) {
    originalApi = (window as any).api;
    const getVaultRoot = vi.fn(async () => replies.shift());
    (window as any).api = { getVaultRoot };
    return getVaultRoot;
  }

  afterEach(() => {
    (window as any).api = originalApi;
  });

  it('an { error } reply at flush is a failed read, not a vault switch: the item stays staged', async () => {
    const reader = stubVaultReader([
      { vaultRoot: '/vaults/A' },
      { error: 'App data was cleared — restart Mythos Writer to continue.' },
      { vaultRoot: '/vaults/A' },
    ]);
    const h = makeHarness({ realVaultRoot: true });
    h.attachAfterTyping();
    const a = track(h.gate.enqueueWhenIdle(TYPE, scene('s1')));
    await settle();
    expect(h.gate.stagedCount()).toBe(1);

    await h.advance(IDLE_MS);
    await h.flushFrame();
    expect(reader).toHaveBeenCalledTimes(2);
    expect(h.enqueue).not.toHaveBeenCalled();
    expect(a.settled).toBe(false);
    expect(h.gate.stagedCount()).toBe(1);

    await h.advance(IDLE_MS);
    await h.drainFrames();
    expect(reader).toHaveBeenCalledTimes(3);
    expect(a.result).toEqual({ accepted: 'submitted', jobId: 'job-1' });
  });

  it('an { error } reply at stage time takes the immediate path instead of binding to an empty vault', async () => {
    stubVaultReader([{ error: 'vault unavailable' }]);
    const h = makeHarness({ realVaultRoot: true });
    h.attachAfterTyping();
    const a = track(h.gate.enqueueWhenIdle(TYPE, scene('s1')));
    await settle();
    expect(h.enqueue).toHaveBeenCalledTimes(1);
    expect(a.result).toEqual({ accepted: 'submitted', jobId: 'job-1' });
    expect(h.gate.stagedCount()).toBe(0);
  });
});

describe('IdleCatchUpGate — e2e hold seam', () => {
  it('holds before the 2nd submit; typing then release keeps the 2nd staged until the next idle window', async () => {
    const h = makeHarness({ e2e: true });
    h.attachAfterTyping();
    expect(h.exposeE2E).toHaveBeenCalledWith(h.gate.__e2e);
    h.exposeE2E.mockClear();

    const a = track(h.gate.enqueueWhenIdle(TYPE, scene('s1')));
    const b = track(h.gate.enqueueWhenIdle(TYPE, scene('s2')));
    await settle();
    expect(h.exposeE2E).toHaveBeenCalledWith(h.gate.__e2e);

    h.gate.__e2e.armHoldBeforeSubmit(2);
    await h.advance(IDLE_MS);

    await h.flushFrame();
    expect(h.enqueue).toHaveBeenCalledTimes(1);
    expect(a.result?.accepted).toBe('submitted');
    expect(h.gate.__e2e.isHeld()).toBe(false);

    await h.flushFrame();
    expect(h.gate.__e2e.isHeld()).toBe(true);
    expect(h.enqueue).toHaveBeenCalledTimes(1);
    expect(b.settled).toBe(false);

    h.gate.noteActivity();
    h.gate.__e2e.release();
    await settle();
    expect(h.gate.__e2e.isHeld()).toBe(false);
    expect(h.enqueue).toHaveBeenCalledTimes(1);
    expect(b.settled).toBe(false);
    expect(h.gate.__e2e.stagedKeys()).toEqual(['manuscript-scan|scene|s2']);
    // Held item never reached the vault read: 2 stage reads + 1 for s1.
    expect(h.getVaultRoot).toHaveBeenCalledTimes(3);

    await h.advance(IDLE_MS - 1);
    await h.flushFrame();
    expect(h.enqueue).toHaveBeenCalledTimes(1);

    await h.advance(1);
    await h.drainFrames();
    expect(h.enqueue).toHaveBeenCalledTimes(2);
    expect(h.enqueue.mock.calls[1]?.[1]).toEqual(scene('s2'));
    expect(b.result?.accepted).toBe('submitted');
  });

  it('typing during a hold ends that run even when a full idle window passes before release', async () => {
    const h = makeHarness({ e2e: true });
    h.attachAfterTyping();
    const a = track(h.gate.enqueueWhenIdle(TYPE, scene('s1')));
    await settle();
    h.gate.__e2e.armHoldBeforeSubmit(1);
    await h.advance(IDLE_MS);
    await h.flushFrame();
    expect(h.gate.__e2e.isHeld()).toBe(true);

    h.gate.noteActivity();
    await h.advance(IDLE_MS);
    h.gate.__e2e.release();
    await settle();
    // The parked run saw typing, so it stops; it does not submit on release.
    expect(h.enqueue).not.toHaveBeenCalled();
    expect(a.settled).toBe(false);
    expect(h.pendingFrames()).toBe(0);

    // Already idle again → a fresh run starts on a 0 ms timer and submits.
    await h.advance(0);
    await h.drainFrames();
    expect(h.enqueue).toHaveBeenCalledTimes(1);
    expect(a.result?.accepted).toBe('submitted');
  });

  it('detach during a held flush: after release nothing submits; the item and its waiter are kept', async () => {
    const h = makeHarness({ e2e: true });
    const detach = h.attachAfterTyping();
    const a = track(h.gate.enqueueWhenIdle(TYPE, scene('s1')));
    await settle();
    h.gate.__e2e.armHoldBeforeSubmit(1);
    await h.advance(IDLE_MS);
    await h.flushFrame();
    expect(h.gate.__e2e.isHeld()).toBe(true);

    detach();
    h.gate.__e2e.release();
    await settle();
    expect(h.gate.__e2e.isHeld()).toBe(false);
    expect(h.enqueue).not.toHaveBeenCalled();
    expect(h.getVaultRoot).toHaveBeenCalledTimes(1);
    expect(a.settled).toBe(false);
    expect(h.gate.__e2e.stagedKeys()).toEqual(['manuscript-scan|scene|s1']);

    await h.advance(IDLE_MS * 3);
    await h.drainFrames();
    expect(h.enqueue).not.toHaveBeenCalled();

    // Re-attaching proves the item was retained, not dropped.
    h.gate.attach();
    await h.advance(IDLE_MS);
    await h.drainFrames();
    expect(h.enqueue).toHaveBeenCalledTimes(1);
    expect(a.result?.accepted).toBe('submitted');
  });

  it('detach during a held flush releases the hold, so a re-attach flushes without a manual release', async () => {
    const h = makeHarness({ e2e: true });
    const detach = h.attachAfterTyping();
    const a = track(h.gate.enqueueWhenIdle(TYPE, scene('s1')));
    await settle();
    h.gate.__e2e.armHoldBeforeSubmit(1);
    await h.advance(IDLE_MS);
    await h.flushFrame();
    expect(h.gate.__e2e.isHeld()).toBe(true);

    detach();
    await settle();
    expect(h.gate.__e2e.isHeld()).toBe(false);
    expect(h.enqueue).not.toHaveBeenCalled();
    expect(a.settled).toBe(false);

    h.gate.attach();
    await h.advance(IDLE_MS);
    await h.drainFrames();
    expect(h.enqueue).toHaveBeenCalledTimes(1);
    expect(a.result?.accepted).toBe('submitted');
  });

  it('clearStaged during a held flush releases the hold; the next staged item still flushes', async () => {
    const h = makeHarness({ e2e: true });
    h.attachAfterTyping();
    const a = track(h.gate.enqueueWhenIdle(TYPE, scene('s1')));
    await settle();
    h.gate.__e2e.armHoldBeforeSubmit(1);
    await h.advance(IDLE_MS);
    await h.flushFrame();
    expect(h.gate.__e2e.isHeld()).toBe(true);

    h.gate.clearStaged('vault-switch');
    await settle();
    expect(h.gate.__e2e.isHeld()).toBe(false);
    expect(a.result).toEqual({ accepted: 'rejected', reason: 'vault-switch' });
    expect(h.enqueue).not.toHaveBeenCalled();

    // Still idle → a new request runs on a 0 ms timer, proving the run ended.
    const b = track(h.gate.enqueueWhenIdle(TYPE, scene('s2')));
    await settle();
    await h.advance(0);
    await h.drainFrames();
    expect(h.enqueue).toHaveBeenCalledTimes(1);
    expect(b.result?.accepted).toBe('submitted');
  });

  it('without the e2e flag the hold never engages and the controller is never exposed', async () => {
    const h = makeHarness({ e2e: false });
    h.attachAfterTyping();
    h.gate.__e2e.armHoldBeforeSubmit(1);
    const a = track(h.gate.enqueueWhenIdle(TYPE, scene('s1')));
    await settle();
    await h.advance(IDLE_MS);
    await h.flushFrame();

    expect(h.gate.__e2e.isHeld()).toBe(false);
    expect(h.enqueue).toHaveBeenCalledTimes(1);
    expect(a.result?.accepted).toBe('submitted');
    expect(h.exposeE2E).not.toHaveBeenCalled();
  });
});
