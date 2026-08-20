// JobQueue orchestration tests — real SQLite, scripted fake workers.
// The kill-mid-job → resume-from-checkpoint contract (AC #2 of SKY-10730) is
// covered here at the queue level and again in jobNonBlocking.integration.test.ts
// with a real worker thread.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { openDb, closeDb } from '../db.js';
import { JobQueue, type SpawnedWorker } from './jobQueue.js';
import { getBackgroundJob, insertBackgroundJob } from './jobsDb.js';
import type { JobEvent, WorkerInMessage, WorkerInput, WorkerOutMessage } from './types.js';

class FakeWorker implements SpawnedWorker {
  input: WorkerInput;
  received: WorkerInMessage[] = [];
  private listeners = new Map<string, Array<(...args: never[]) => void>>();

  constructor(input: WorkerInput) {
    this.input = input;
  }
  postMessage(msg: WorkerInMessage): void {
    this.received.push(msg);
  }
  terminate(): void {
    this.emitEvent('exit', 1);
  }
  on(event: string, listener: (...args: never[]) => void): void {
    const list = this.listeners.get(event) ?? [];
    list.push(listener);
    this.listeners.set(event, list);
  }
  emitEvent(event: 'message' | 'error' | 'exit', arg: WorkerOutMessage | Error | number): void {
    for (const l of this.listeners.get(event) ?? []) (l as (a: unknown) => void)(arg);
  }
}

let tmpDir: string;
let spawned: FakeWorker[];

const spawnFake = (input: WorkerInput): FakeWorker => {
  const w = new FakeWorker(input);
  spawned.push(w);
  return w;
};

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobqueue-test-'));
  spawned = [];
  openDb(tmpDir);
});

afterEach(() => {
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('JobQueue lifecycle', () => {
  it('runs a queued job to completion and persists terminal state', () => {
    const events: JobEvent[] = [];
    const queue = new JobQueue({ spawnWorker: spawnFake, onEvent: (e) => events.push(e) });
    const id = queue.enqueue('vault-scan', { vaultRoot: '/v' });

    expect(spawned).toHaveLength(1);
    expect(spawned[0].input.jobId).toBe(id);
    expect(spawned[0].input.payloadJson).toBe('{"vaultRoot":"/v"}');
    expect(getBackgroundJob(id)!.status).toBe('running');

    spawned[0].emitEvent('message', { kind: 'total', totalUnits: 3 });
    spawned[0].emitEvent('message', { kind: 'done', completedUnits: 3, skippedUnits: 0, coverage: [] });
    spawned[0].emitEvent('exit', 0);

    const row = getBackgroundJob(id)!;
    expect(row.status).toBe('completed');
    expect(row.completed_units).toBe(3);
    expect(row.finished_at).not.toBeNull();
    expect(events.at(-1)?.kind).toBe('done');
  });

  it('runs jobs one at a time, FIFO', () => {
    const queue = new JobQueue({ spawnWorker: spawnFake });
    // Distinct payloads (distinct scopes) — same-scope enqueues collapse
    // instead of queuing (see the dedup describe block below).
    const first = queue.enqueue('vault-scan', { vaultRoot: '/a' });
    const second = queue.enqueue('vault-scan', { vaultRoot: '/b' });
    expect(spawned).toHaveLength(1);
    expect(getBackgroundJob(second)!.status).toBe('queued');

    spawned[0].emitEvent('message', { kind: 'done', completedUnits: 0, skippedUnits: 0, coverage: [] });
    expect(getBackgroundJob(first)!.status).toBe('completed');
    // finishing the first pumps the second
    expect(spawned).toHaveLength(2);
    expect(spawned[1].input.jobId).toBe(second);
  });

  it('marks a job failed when the worker reports an error', () => {
    const queue = new JobQueue({ spawnWorker: spawnFake });
    const id = queue.enqueue('vault-scan', null);
    spawned[0].emitEvent('message', { kind: 'error', message: 'boom' });
    const row = getBackgroundJob(id)!;
    expect(row.status).toBe('failed');
    expect(row.error).toBe('boom');
  });

  it('marks a job failed when the worker dies without reporting', () => {
    const queue = new JobQueue({ spawnWorker: spawnFake });
    const id = queue.enqueue('vault-scan', null);
    spawned[0].emitEvent('exit', 7);
    const row = getBackgroundJob(id)!;
    expect(row.status).toBe('failed');
    expect(row.error).toContain('code 7');
  });

  it('pumps the next queued job when spawnWorker throws synchronously', () => {
    // Seed two already-queued jobs directly (mirrors resumeInterrupted()
    // requeuing several interrupted jobs at boot) so a single pump() cycle
    // has to get through both, instead of relying on a fresh enqueue() call
    // to kick the second one loose.
    const first = insertBackgroundJob({ type: 'vault-scan', payloadJson: '{"vaultRoot":"/a"}' }).id;
    const second = insertBackgroundJob({ type: 'vault-scan', payloadJson: '{"vaultRoot":"/b"}' }).id;

    let throwNext = true;
    const flakySpawn = (input: WorkerInput): FakeWorker => {
      if (throwNext) {
        throwNext = false;
        throw new Error('worker bundle failed to load');
      }
      return spawnFake(input);
    };
    const queue = new JobQueue({ spawnWorker: flakySpawn });
    queue.resumeInterrupted();

    expect(getBackgroundJob(first)!.status).toBe('failed');
    // Must not stall: the second job should already be running in the same
    // pump cycle, not left 'queued' until another enqueue() or app restart.
    expect(getBackgroundJob(second)!.status).toBe('running');
    expect(spawned).toHaveLength(1);
    expect(spawned[0].input.jobId).toBe(second);
  });

  it('cancels a running job cooperatively', () => {
    const queue = new JobQueue({ spawnWorker: spawnFake });
    const id = queue.enqueue('vault-scan', null);
    expect(queue.cancel(id)).toBe(true);
    expect(spawned[0].received).toEqual([{ kind: 'cancel' }]);
    // worker checkpoints and exits cleanly
    spawned[0].emitEvent('message', {
      kind: 'checkpoint',
      checkpointJson: '{"cursor":2}',
      completedUnits: 2,
      skippedUnits: 0,
      coverage: [],
    });
    spawned[0].emitEvent('exit', 0);
    const row = getBackgroundJob(id)!;
    expect(row.status).toBe('cancelled');
    expect(row.checkpoint_json).toBe('{"cursor":2}');
  });

  it('cancels a queued job directly', () => {
    const queue = new JobQueue({ spawnWorker: spawnFake });
    const running = queue.enqueue('vault-scan', { vaultRoot: '/a' });
    const waiting = queue.enqueue('vault-scan', { vaultRoot: '/b' });
    expect(queue.cancel(waiting)).toBe(true);
    expect(getBackgroundJob(waiting)!.status).toBe('cancelled');
    expect(queue.cancel('nonexistent')).toBe(false);
    expect(getBackgroundJob(running)!.status).toBe('running');
  });
});

describe('kill-mid-job → resume from checkpoint (AC #2)', () => {
  it('a job interrupted by a crash resumes from its last persisted checkpoint', () => {
    // Run 1: worker checkpoints at cursor 3, then the "process dies" — no
    // exit event, no terminal status, the queue object is simply abandoned.
    const queue1 = new JobQueue({ spawnWorker: spawnFake });
    const id = queue1.enqueue('vault-scan', { vaultRoot: '/v' });
    spawned[0].emitEvent('message', { kind: 'total', totalUnits: 10 });
    spawned[0].emitEvent('message', {
      kind: 'checkpoint',
      checkpointJson: '{"cursor":3}',
      completedUnits: 3,
      skippedUnits: 0,
      coverage: [{ scopeKind: 'file', scopePath: 'a.md', contentHash: 'h1' }],
    });
    expect(getBackgroundJob(id)!.status).toBe('running'); // crash shape

    // Run 2 ("next launch"): a fresh queue over the same DB requeues and
    // hands the worker the checkpoint — not a from-scratch start.
    const queue2 = new JobQueue({ spawnWorker: spawnFake });
    expect(queue2.resumeInterrupted()).toBe(1);
    expect(spawned).toHaveLength(2);
    expect(spawned[1].input.jobId).toBe(id);
    expect(spawned[1].input.checkpointJson).toBe('{"cursor":3}');
    // coverage persisted by run 1 is replayed to the resumed worker
    expect(spawned[1].input.coverage).toContainEqual(['file\na.md', 'h1']);

    spawned[1].emitEvent('message', { kind: 'done', completedUnits: 10, skippedUnits: 0, coverage: [] });
    expect(getBackgroundJob(id)!.status).toBe('completed');
  });

  it('shutdown() leaves the running job resumable, not failed', async () => {
    const queue = new JobQueue({ spawnWorker: spawnFake });
    const id = queue.enqueue('vault-scan', null);
    spawned[0].emitEvent('message', {
      kind: 'checkpoint',
      checkpointJson: '{"cursor":5}',
      completedUnits: 5,
      skippedUnits: 0,
      coverage: [],
    });
    await queue.shutdown(); // app quit — FakeWorker.terminate fires 'exit'
    const row = getBackgroundJob(id)!;
    expect(row.status).toBe('running'); // resumeInterrupted() requeues this next boot
    expect(row.checkpoint_json).toBe('{"cursor":5}');
  });
});

describe('progress + ETA (AC #3)', () => {
  it('computes rate and ETA from the current run, resume-aware', () => {
    let clock = 1_000_000;
    const queue = new JobQueue({ spawnWorker: spawnFake, now: () => clock });
    const id = queue.enqueue('vault-scan', null);
    spawned[0].emitEvent('message', { kind: 'total', totalUnits: 10 });

    // Too early for a stable rate → ETA withheld.
    spawned[0].emitEvent('message', { kind: 'progress', completedUnits: 1, skippedUnits: 0 });
    expect(queue.getProgress(id)!.etaMs).toBeNull();

    clock += 2000; // 2s in: 4 units processed → 2/s → 6 remaining → 3s ETA
    spawned[0].emitEvent('message', { kind: 'progress', completedUnits: 3, skippedUnits: 1 });
    const p = queue.getProgress(id)!;
    expect(p.status).toBe('running');
    expect(p.totalUnits).toBe(10);
    expect(p.completedUnits).toBe(3);
    expect(p.skippedUnits).toBe(1);
    expect(p.ratePerSec).toBeCloseTo(2, 5);
    expect(p.etaMs).toBe(3000);
  });

  it('list() and getProgress() reflect persisted state for finished jobs', () => {
    const queue = new JobQueue({ spawnWorker: spawnFake });
    const id = queue.enqueue('vault-scan', null);
    spawned[0].emitEvent('message', { kind: 'done', completedUnits: 4, skippedUnits: 2, coverage: [] });
    const p = queue.getProgress(id)!;
    expect(p.status).toBe('completed');
    expect(p.completedUnits).toBe(4);
    expect(p.skippedUnits).toBe(2);
    expect(p.etaMs).toBeNull();
    expect(queue.list({ status: 'completed' }).map((j) => j.jobId)).toEqual([id]);
  });
});

describe('duplicate-scope collapsing (SKY-10768 AC3)', () => {
  it('NEGATIVE CONTROL: two different scopes do NOT collapse — proves collapsing is scope-aware, not a no-op', () => {
    const queue = new JobQueue({ spawnWorker: spawnFake });
    const a = queue.enqueue('vault-scan', { vaultRoot: '/a' });
    const b = queue.enqueue('vault-scan', { vaultRoot: '/b' });
    expect(a).not.toBe(b);
    expect(queue.list({}).map((j) => j.jobId).sort()).toEqual([a, b].sort());
  });

  it('a second submission for the same scope while one is queued returns the existing job id', () => {
    const queue = new JobQueue({ spawnWorker: spawnFake });
    const first = queue.enqueue('vault-scan', { vaultRoot: '/v' });
    const second = queue.enqueue('vault-scan', { vaultRoot: '/v' }); // still queued/running — same scope
    expect(second).toBe(first);
    // No second row was created, and no second worker was spawned.
    expect(queue.list({}).map((j) => j.jobId)).toEqual([first]);
    expect(spawned).toHaveLength(1);
  });

  it('a second submission for the same scope while the job is running also collapses', () => {
    const queue = new JobQueue({ spawnWorker: spawnFake });
    const first = queue.enqueue('vault-scan', { vaultRoot: '/v' });
    expect(getBackgroundJob(first)!.status).toBe('running');
    const second = queue.enqueue('vault-scan', { vaultRoot: '/v' });
    expect(second).toBe(first);
    expect(spawned).toHaveLength(1);
  });

  it('a submission for a scope that already finished starts a fresh job (no collapse against terminal state)', () => {
    const queue = new JobQueue({ spawnWorker: spawnFake });
    const first = queue.enqueue('vault-scan', { vaultRoot: '/v' });
    spawned[0].emitEvent('message', { kind: 'done', completedUnits: 1, skippedUnits: 0, coverage: [] });
    expect(getBackgroundJob(first)!.status).toBe('completed');

    const second = queue.enqueue('vault-scan', { vaultRoot: '/v' });
    expect(second).not.toBe(first);
    expect(spawned).toHaveLength(2);
  });

  it('null-payload submissions for the same job type also collapse to one job', () => {
    const queue = new JobQueue({ spawnWorker: spawnFake });
    const first = queue.enqueue('vault-scan', null);
    const second = queue.enqueue('vault-scan', null);
    expect(second).toBe(first);
    expect(spawned).toHaveLength(1);
  });
});
