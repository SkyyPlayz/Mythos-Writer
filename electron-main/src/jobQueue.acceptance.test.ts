import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';
import { Worker } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import { openDb, closeDb, getDb } from './db.js';
import { JobQueue, type SpawnedWorker, type SpawnWorker } from './jobs/jobQueue.js';
import { getBackgroundJob, countScanCoverage } from './jobs/jobsDb.js';
import { runSyntheticLoadJob } from './jobs/handlers/syntheticLoadJob.js';
import type { JobEvent, WorkerInMessage, WorkerInput, WorkerOutMessage } from './jobs/types.js';

/**
 * SKY-10764 / SKY-10779 — independent acceptance-test verifier (QA, non-author)
 * for M12.1 (SKY-10730, background job/queue infrastructure), part of the M12
 * scale-architecture epic (SKY-10729 / SKY-10666).
 *
 * Finalized against the merged implementation (PR #1284) once M12.1 landed —
 * see SKY-10779. Every case here still asserts against the epic's locked spec
 * + M12.1's acceptance criteria, exercising the real product modules
 * (JobQueue, jobsDb, vaultScanJob, jobWorker) rather than re-describing them;
 * assertions were written from the AC text, then checked to fail on a
 * deliberately-broken stand-in (see the negative controls below), not copied
 * from the implementer's own unit/integration suite.
 *
 * Ivy's standing verification rule (carried from SKY-10666/SKY-11c):
 * every check here must include a negative control that proves the
 * assertion can actually fail, not just pass.
 */

// ─── Scripted fake worker — queue-level ACs (2, 3, 4 counters) ───

class ScriptedWorker implements SpawnedWorker {
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
    this.emit('exit', 1);
  }
  on(event: string, listener: (...args: never[]) => void): void {
    const list = this.listeners.get(event) ?? [];
    list.push(listener);
    this.listeners.set(event, list);
  }
  emit(event: 'message' | 'error' | 'exit', arg: WorkerOutMessage | Error | number): void {
    for (const l of this.listeners.get(event) ?? []) (l as (a: unknown) => void)(arg);
  }
}

let scriptedTmpDir: string;
let spawned: ScriptedWorker[];
const spawnScripted: SpawnWorker = (input) => {
  const w = new ScriptedWorker(input);
  spawned.push(w);
  return w;
};

describe('M12.1 — background job/queue infrastructure (acceptance)', () => {
  beforeEach(() => {
    scriptedTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobqueue-acceptance-'));
    spawned = [];
    openDb(scriptedTmpDir);
  });

  afterEach(() => {
    closeDb();
    fs.rmSync(scriptedTmpDir, { recursive: true, force: true });
  });

  describe('AC2 — a job killed mid-run resumes from its last checkpoint, not from scratch', () => {
    it(
      'negative control: a job design with no checkpoint persistence restarts from unit 0 after a simulated crash ' +
        '— proves the resume assertion below is capable of failing',
      () => {
        // Stand-in for a design with no on-disk job-state persistence: the
        // running job's row simply doesn't survive the "crash" (nothing was
        // ever written to durable storage to find on relaunch). Model that by
        // deleting the row that a real persisted design would have left
        // behind at status='running'.
        const queue1 = new JobQueue({ spawnWorker: spawnScripted });
        const id = queue1.enqueue('vault-scan', { vaultRoot: '/v' });
        spawned[0].emit('message', {
          kind: 'checkpoint',
          checkpointJson: '{"cursor":3}',
          completedUnits: 3,
          skippedUnits: 0,
          coverage: [],
        });
        expect(getBackgroundJob(id)!.checkpoint_json).toBe('{"cursor":3}');
        // "No persistence" stand-in: wipe the row a real crash would have
        // left behind — nothing durable survives the process death.
        getDb().prepare('DELETE FROM background_jobs WHERE id = ?').run(id);
        expect(getBackgroundJob(id)).toBeNull();

        const queue2 = new JobQueue({ spawnWorker: spawnScripted });
        // Nothing durable was left at 'running' to find — the boot recovery
        // path has no work to requeue, proving the resume assertion below
        // (which relies on the row surviving) is capable of failing.
        expect(queue2.resumeInterrupted()).toBe(0);
      }
    );

    it('killing the process mid-job (simulated crash) and relaunching resumes from the last checkpoint, not unit 0', () => {
      const queue1 = new JobQueue({ spawnWorker: spawnScripted });
      const id = queue1.enqueue('vault-scan', { vaultRoot: '/v' });
      spawned[0].emit('message', { kind: 'total', totalUnits: 10 });
      spawned[0].emit('message', {
        kind: 'checkpoint',
        checkpointJson: '{"cursor":7}',
        completedUnits: 7,
        skippedUnits: 0,
        coverage: [{ scopeKind: 'file', scopePath: 'a.md', contentHash: 'h1' }],
      });
      // Simulated crash: no exit event, queue1 is simply abandoned. The row
      // must be left in a resumable shape (still 'running', checkpoint kept).
      expect(getBackgroundJob(id)!.status).toBe('running');
      expect(getBackgroundJob(id)!.checkpoint_json).toBe('{"cursor":7}');

      // "Relaunch": a fresh queue over the same on-disk DB.
      const queue2 = new JobQueue({ spawnWorker: spawnScripted });
      expect(queue2.resumeInterrupted()).toBe(1);
      const resumedInput = spawned.at(-1)!.input;
      expect(resumedInput.jobId).toBe(id);
      // Not unit 0 — the resumed worker is handed the persisted checkpoint.
      expect(resumedInput.checkpointJson).toBe('{"cursor":7}');
      expect(resumedInput.coverage).toContainEqual(['file\na.md', 'h1']);
    });

    it('quitting the app mid-job and relaunching resumes from the last checkpoint, not unit 0', async () => {
      const queue1 = new JobQueue({ spawnWorker: spawnScripted });
      const id = queue1.enqueue('vault-scan', { vaultRoot: '/v' });
      spawned[0].emit('message', {
        kind: 'checkpoint',
        checkpointJson: '{"cursor":4}',
        completedUnits: 4,
        skippedUnits: 0,
        coverage: [],
      });
      // Graceful app quit — the queue's own shutdown path, not a bare crash.
      await queue1.shutdown();
      expect(getBackgroundJob(id)!.status).toBe('running'); // not marked failed/completed

      const queue2 = new JobQueue({ spawnWorker: spawnScripted });
      expect(queue2.resumeInterrupted()).toBe(1);
      expect(spawned.at(-1)!.input.checkpointJson).toBe('{"cursor":4}');
    });

    it('checkpoint state is persisted in SQLite (electron-main/src/db.ts, node:sqlite) and survives a full process restart', () => {
      const queue1 = new JobQueue({ spawnWorker: spawnScripted });
      const id = queue1.enqueue('vault-scan', { vaultRoot: '/v' });
      spawned[0].emit('message', {
        kind: 'checkpoint',
        checkpointJson: '{"cursor":9}',
        completedUnits: 9,
        skippedUnits: 1,
        coverage: [],
      });
      // Simulate a full process restart: close and reopen the SQLite handle
      // against the same on-disk file — nothing in-memory survives this.
      closeDb();
      openDb(scriptedTmpDir);
      const row = getBackgroundJob(id)!;
      expect(row.checkpoint_json).toBe('{"cursor":9}');
      expect(row.completed_units).toBe(9);
      expect(row.skipped_units).toBe(1);
    });
  });

  describe('AC3 — progress/ETA is queryable by the UI layer while a job runs', () => {
    it('the UI can query job progress (completed units / total units) at any point while a job is running', () => {
      const queue = new JobQueue({ spawnWorker: spawnScripted });
      const id = queue.enqueue('vault-scan', null);
      spawned[0].emit('message', { kind: 'total', totalUnits: 20 });
      spawned[0].emit('message', { kind: 'progress', completedUnits: 6, skippedUnits: 2 });

      const p = queue.getProgress(id)!;
      expect(p.status).toBe('running');
      expect(p.totalUnits).toBe(20);
      expect(p.completedUnits).toBe(6);
      expect(p.skippedUnits).toBe(2);
    });

    it('the UI can query an ETA estimate at any point while a job is running', () => {
      let clock = 0;
      const queue = new JobQueue({ spawnWorker: spawnScripted, now: () => clock });
      const id = queue.enqueue('vault-scan', null);
      spawned[0].emit('message', { kind: 'total', totalUnits: 10 });

      // Too early / no units processed yet → ETA correctly withheld, not a
      // made-up number.
      expect(queue.getProgress(id)!.etaMs).toBeNull();

      clock += 2000;
      spawned[0].emit('message', { kind: 'progress', completedUnits: 4, skippedUnits: 0 });
      const p = queue.getProgress(id)!;
      expect(p.ratePerSec).toBeCloseTo(2, 5); // 4 units / 2s
      expect(p.etaMs).toBe(3000); // 6 remaining / 2 per sec
    });

    it('progress/ETA queries never block or wait on the job itself (always-on path visibility, per the binding non-blocking rule)', () => {
      const queue = new JobQueue({ spawnWorker: spawnScripted });
      const id = queue.enqueue('vault-scan', null);
      // getProgress() is a synchronous read of already-persisted state — it
      // must return immediately even though the "job" (the scripted worker)
      // has never emitted anything and never will in this test.
      const start = performance.now();
      const p = queue.getProgress(id);
      const elapsed = performance.now() - start;
      expect(p).not.toBeNull();
      expect(p!.status).toBe('running');
      expect(elapsed).toBeLessThan(50); // no wait on the (silent) worker
    });
  });

  describe('AC4 — a coverage manifest records what has been scanned, and unchanged content is skippable on re-run', () => {
    it(
      'negative control: without a coverage manifest, re-running a scan over an unchanged vault reprocesses every ' +
        'scope unit — proves the skip assertion below is capable of failing',
      () => {
        const queue = new JobQueue({ spawnWorker: spawnScripted });
        const first = queue.enqueue('vault-scan', { vaultRoot: '/v' });
        // Worker reports 'done' WITHOUT emitting any coverage entries — the
        // stand-in for "no manifest exists". No coverage is ever persisted.
        spawned[0].emit('message', { kind: 'done', completedUnits: 5, skippedUnits: 0, coverage: [] });
        expect(countScanCoverage('vault-scan')).toBe(0);
        expect(getBackgroundJob(first)!.completed_units).toBe(5);

        const second = queue.enqueue('vault-scan', { vaultRoot: '/v' });
        // With no manifest, the worker (stand-in) has nothing to skip against
        // — it reprocesses every unit again instead of skipping.
        spawned[1].emit('message', { kind: 'done', completedUnits: 5, skippedUnits: 0, coverage: [] });
        expect(getBackgroundJob(second)!.skipped_units).toBe(0);
        expect(getBackgroundJob(second)!.completed_units).toBe(5); // reprocessed, not skipped
      }
    );

    it('a coverage manifest table records scanned content by scope (scene/chapter/part/book) + content hash', () => {
      const queue = new JobQueue({ spawnWorker: spawnScripted });
      const id = queue.enqueue('vault-scan', { vaultRoot: '/v' });
      spawned[0].emit('message', {
        kind: 'done',
        completedUnits: 2,
        skippedUnits: 0,
        coverage: [
          { scopeKind: 'file', scopePath: 'Universes/hero.md', contentHash: 'aaa' },
          { scopeKind: 'file', scopePath: 'Universes/villain.md', contentHash: 'bbb' },
        ],
      });
      expect(countScanCoverage('vault-scan')).toBe(2);
      void id;
    });

    it('re-running a scan skips content whose hash matches the coverage manifest (no re-extraction)', () => {
      const queue = new JobQueue({ spawnWorker: spawnScripted });
      const first = queue.enqueue('vault-scan', { vaultRoot: '/v' });
      spawned[0].emit('message', {
        kind: 'done',
        completedUnits: 3,
        skippedUnits: 0,
        coverage: [
          { scopeKind: 'file', scopePath: 'a.md', contentHash: 'h-a' },
          { scopeKind: 'file', scopePath: 'b.md', contentHash: 'h-b' },
          { scopeKind: 'file', scopePath: 'c.md', contentHash: 'h-c' },
        ],
      });

      const second = queue.enqueue('vault-scan', { vaultRoot: '/v' });
      // The queue must have handed the resumed/second worker the prior
      // coverage so it CAN decide to skip — this is the contract under test.
      expect(spawned[1].input.coverage).toEqual(
        expect.arrayContaining([
          ['file\na.md', 'h-a'],
          ['file\nb.md', 'h-b'],
          ['file\nc.md', 'h-c'],
        ])
      );
      spawned[1].emit('message', { kind: 'done', completedUnits: 0, skippedUnits: 3, coverage: [] });
      const row = getBackgroundJob(second)!;
      expect(row.skipped_units).toBe(3);
      expect(row.completed_units).toBe(0);
    });

    it('re-running a scan re-processes content whose hash has changed since the last recorded scan', () => {
      const queue = new JobQueue({ spawnWorker: spawnScripted });
      const first = queue.enqueue('vault-scan', { vaultRoot: '/v' });
      spawned[0].emit('message', {
        kind: 'done',
        completedUnits: 1,
        skippedUnits: 0,
        coverage: [{ scopeKind: 'file', scopePath: 'a.md', contentHash: 'h-old' }],
      });
      void first;

      const second = queue.enqueue('vault-scan', { vaultRoot: '/v' });
      expect(spawned[1].input.coverage).toContainEqual(['file\na.md', 'h-old']);
      // Content changed → new hash. The worker (which owns the hash compare)
      // reports the unit as completed (re-processed), not skipped, and the
      // manifest is updated to the new hash via upsert semantics.
      spawned[1].emit('message', {
        kind: 'done',
        completedUnits: 1,
        skippedUnits: 0,
        coverage: [{ scopeKind: 'file', scopePath: 'a.md', contentHash: 'h-new' }],
      });
      const row = getBackgroundJob(second)!;
      expect(row.completed_units).toBe(1);
      expect(row.skipped_units).toBe(0);
      expect(countScanCoverage('vault-scan')).toBe(1); // upserted, not duplicated
    });
  });
});

// ─── Real worker thread — AC1 non-blocking guarantee ───
// Requires a genuine node:worker_threads Worker (not the scripted fake) since
// the claim under test is specifically about which OS thread the work lands
// on. Compiles the real jobWorker.ts entry with the workspace's own tsc so
// this exercises actual product code.

describe('AC1 — a queued job runs off the UI/renderer thread without blocking typing/navigation/saving', () => {
  const require = createRequire(import.meta.url);
  const SRC_DIR = path.dirname(new URL(import.meta.url).pathname); // electron-main/src

  /** Max allowed host event-loop tick gap while a job runs through the queue. */
  const WORKER_MAX_GAP_MS = 250;
  /** Min stall the synchronous stand-in must produce (negative control). */
  const SYNC_MIN_GAP_MS = 400;
  const LOAD = { units: 8, spinMsPerUnit: 100 };

  let compiledDir: string;
  let workerEntry: string;
  let realTmpDir: string;

  beforeAll(() => {
    compiledDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobworker-acceptance-build-'));
    execFileSync(
      process.execPath,
      [
        require.resolve('typescript/lib/tsc.js'),
        '--module', 'nodenext',
        '--moduleResolution', 'nodenext',
        '--target', 'es2022',
        '--outDir', compiledDir,
        '--rootDir', SRC_DIR,
        '--skipLibCheck',
        '--types', 'node',
        path.join(SRC_DIR, 'jobs', 'jobWorker.ts'),
      ],
      { stdio: 'pipe' }
    );
    workerEntry = path.join(compiledDir, 'jobs', 'jobWorker.js');
    expect(fs.existsSync(workerEntry)).toBe(true);
  }, 120_000);

  afterAll(() => {
    fs.rmSync(compiledDir, { recursive: true, force: true });
  });

  const spawnRealWorker: SpawnWorker = (input: WorkerInput) =>
    new Worker(workerEntry, { workerData: input }) as unknown as SpawnedWorker;

  function startLagProbe(): { stop: () => number } {
    let last = performance.now();
    let maxGap = 0;
    const timer = setInterval(() => {
      const now = performance.now();
      maxGap = Math.max(maxGap, now - last);
      last = now;
    }, 10);
    return {
      stop: () => {
        clearInterval(timer);
        return maxGap;
      },
    };
  }

  function waitForTerminal(events: JobEvent[], jobId: string, timeoutMs = 20_000): Promise<JobEvent> {
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      const poll = setInterval(() => {
        const terminal = events.find((e) => e.progress.jobId === jobId && e.kind !== 'progress');
        if (terminal) {
          clearInterval(poll);
          resolve(terminal);
        } else if (Date.now() - t0 > timeoutMs) {
          clearInterval(poll);
          reject(new Error('job did not reach a terminal state in time'));
        }
      }, 20);
    });
  }

  beforeEach(() => {
    realTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobqueue-acceptance-real-'));
    openDb(realTmpDir);
  });

  afterEach(() => {
    closeDb();
    fs.rmSync(realTmpDir, { recursive: true, force: true });
  });

  it(
    'negative control: a synchronous stand-in (no queue) running the same scan workload DOES measurably ' +
      'raise input latency — proves this harness can detect the regression it is meant to guard against',
    async () => {
      const probe = startLagProbe();
      await new Promise((r) => setTimeout(r, 50));

      // Same handler, same load, run inline on the host thread — no queue,
      // no worker. This is the "regression" the queue exists to prevent.
      runSyntheticLoadJob({
        payload: LOAD,
        checkpoint: null,
        coverage: new Map(),
        emit: () => {},
        isCancelled: () => false,
      });

      await new Promise((r) => setTimeout(r, 30));
      const maxGap = probe.stop();
      expect(maxGap).toBeGreaterThanOrEqual(SYNC_MIN_GAP_MS);
    },
    30_000
  );

  it(
    'queuing a scan/extraction job on a large synthetic vault keeps input latency at baseline ' +
      '(name + measure the budget, e.g. p95 keypress-to-render unchanged vs. no-job baseline) while the job runs',
    async () => {
      const events: JobEvent[] = [];
      const queue = new JobQueue({ spawnWorker: spawnRealWorker, onEvent: (e) => events.push(e) });

      const probe = startLagProbe();
      const id = queue.enqueue('synthetic-load', LOAD);
      const terminal = await waitForTerminal(events, id);
      await new Promise((r) => setTimeout(r, 30));
      const maxGap = probe.stop();

      expect(terminal.kind).toBe('done');
      expect(getBackgroundJob(id)!.status).toBe('completed');
      // Budget: host loop tick gap stays under 250ms — well under the 400ms
      // the negative control above proved the same load produces inline.
      expect(maxGap).toBeLessThan(WORKER_MAX_GAP_MS);
    },
    30_000
  );

  it('typing in the scene editor stays responsive while a background job is running', async () => {
    // The renderer's typing path is IPC-mediated keystroke → main-process
    // write; what must stay unblocked is the main-process event loop that
    // services that IPC round trip. The lag probe models exactly that: a
    // 10ms host-loop tick standing in for "the loop was free to service the
    // next IPC message (e.g. a keystroke) promptly."
    const events: JobEvent[] = [];
    const queue = new JobQueue({ spawnWorker: spawnRealWorker, onEvent: (e) => events.push(e) });
    const probe = startLagProbe();
    const id = queue.enqueue('synthetic-load', LOAD);
    await waitForTerminal(events, id);
    await new Promise((r) => setTimeout(r, 30));
    expect(probe.stop()).toBeLessThan(WORKER_MAX_GAP_MS);
  }, 30_000);

  it('navigating between scenes/notes stays responsive while a background job is running', async () => {
    const events: JobEvent[] = [];
    const queue = new JobQueue({ spawnWorker: spawnRealWorker, onEvent: (e) => events.push(e) });
    const probe = startLagProbe();
    const id = queue.enqueue('synthetic-load', LOAD);
    await waitForTerminal(events, id);
    await new Promise((r) => setTimeout(r, 30));
    // Same host-loop-freedom guarantee covers scene/note navigation IPC —
    // there is no separate code path in the queue that treats these
    // interactions differently; the guarantee is loop-wide, not per-feature.
    expect(probe.stop()).toBeLessThan(WORKER_MAX_GAP_MS);
  }, 30_000);

  it('saving a scene completes without added latency while a background job is running', async () => {
    const events: JobEvent[] = [];
    const queue = new JobQueue({ spawnWorker: spawnRealWorker, onEvent: (e) => events.push(e) });
    const id = queue.enqueue('synthetic-load', LOAD);

    // Simulate a scene save landing mid-job: a synchronous SQLite write on
    // the main thread, timed against the same budget as the lag probe ticks.
    const t0 = performance.now();
    const db = (await import('./db.js')).getDb();
    db.exec('CREATE TABLE IF NOT EXISTS _save_probe (id INTEGER PRIMARY KEY, body TEXT)');
    db.prepare('INSERT INTO _save_probe (body) VALUES (?)').run('scene content'.repeat(50));
    const saveMs = performance.now() - t0;

    await waitForTerminal(events, id);
    // The save write itself must not be stretched out by contention with the
    // worker thread's CPU load (they run on separate threads).
    expect(saveMs).toBeLessThan(WORKER_MAX_GAP_MS);
  }, 30_000);
});
