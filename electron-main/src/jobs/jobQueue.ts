// Background job queue orchestrator (M12.1, SKY-10730). Main-process side.
//
// Runs one job at a time (FIFO) on a worker thread supplied by an injected
// factory — production passes electron-vite's `?nodeWorker` constructor,
// tests pass a tsc-compiled worker or a scripted fake. The queue owns ALL
// SQLite writes; workers only report over the port.
//
// Crash-resume contract: status='running' rows found at construction time are
// requeued with their last persisted checkpoint (see resumeInterrupted), so a
// job killed by a crash or hard quit continues where it left off — never from
// scratch. Non-blocking budget: no queue callback does more than a batched
// SQLite write (~25-unit batches), so the main-process event loop stays free
// while workers burn CPU. Budget + measurement: docs/jobs-background-queue.md.
//
// Dedup (M12.1 re-issue, SKY-10768 AC3): enqueue() collapses a duplicate
// submission for the same type+payload ("scope") into the job already queued
// or running for it, rather than creating a second row.

import type {
  BackgroundJobStatus,
  JobEvent,
  JobProgress,
  JobType,
  WorkerInMessage,
  WorkerInput,
  WorkerOutMessage,
} from './types.js';
import {
  findActiveJobByScope,
  getBackgroundJob,
  insertBackgroundJob,
  listBackgroundJobs,
  markJobStatus,
  nextQueuedJob,
  requeueInterruptedJobs,
  updateJobCheckpoint,
  updateJobCounters,
  updateJobTotals,
  upsertScanCoverage,
  getScanCoverageMap,
  type DbBackgroundJob,
} from './jobsDb.js';

/** Worker surface the queue needs — node:worker_threads Worker satisfies it. */
export interface SpawnedWorker {
  postMessage(msg: WorkerInMessage): void;
  terminate(): Promise<number> | void;
  on(event: 'message', listener: (msg: WorkerOutMessage) => void): void;
  on(event: 'error', listener: (err: Error) => void): void;
  on(event: 'exit', listener: (code: number) => void): void;
}

export type SpawnWorker = (input: WorkerInput) => SpawnedWorker;

export interface JobQueueOptions {
  spawnWorker: SpawnWorker;
  /** Pushed on progress/terminal transitions — jobService forwards to the
   *  renderer. Progress pushes are throttled; terminal events never dropped. */
  onEvent?: (evt: JobEvent) => void;
  /** Injectable clock for deterministic ETA tests. */
  now?: () => number;
}

/** Don't push progress events to the renderer more often than this. */
const PROGRESS_PUSH_INTERVAL_MS = 100;
/** ETA is unstable early in a run, but we must surface it soon enough for the
 *  progress row to be useful while work is still in flight. Keeping the warm-up
 *  low avoids a race where a real worker finishes before the first ETA can be
 *  displayed, while still avoiding jitter from a single checkpoint. */
const ETA_MIN_ELAPSED_MS = 250;

interface RunningJobState {
  job: DbBackgroundJob;
  worker: SpawnedWorker;
  runStartedAt: number;
  /** completed+skipped when this run began (resume baseline for rate calc). */
  baselineProcessed: number;
  completedUnits: number;
  skippedUnits: number;
  totalUnits: number | null;
  cancelRequested: boolean;
  finished: boolean;
  lastPushAt: number;
}

export class JobQueue {
  private readonly spawnWorker: SpawnWorker;
  private readonly onEvent: ((evt: JobEvent) => void) | undefined;
  private readonly now: () => number;
  private running: RunningJobState | null = null;
  private shutDown = false;

  constructor(opts: JobQueueOptions) {
    this.spawnWorker = opts.spawnWorker;
    this.onEvent = opts.onEvent;
    this.now = opts.now ?? Date.now;
  }

  /** Boot-time recovery: requeue jobs interrupted by a crash/quit, then start
   *  pumping. Returns how many jobs were requeued. */
  resumeInterrupted(): number {
    const requeued = requeueInterruptedJobs();
    this.pump();
    return requeued;
  }

  /** Queues a job, or — if a queued/running job with the same type + payload
   *  ("scope") already exists — returns that job's id unchanged (SKY-10768
   *  AC3: duplicate submissions for the same scope collapse to one job). */
  enqueue(type: JobType, payload: unknown): string {
    const payloadJson = payload == null ? null : JSON.stringify(payload);
    const existing = findActiveJobByScope(type, payloadJson);
    if (existing) return existing.id;
    const job = insertBackgroundJob({ type, payloadJson });
    this.pump();
    return job.id;
  }

  /** Cancel a queued or running job. Returns false if it isn't cancellable. */
  cancel(jobId: string): boolean {
    if (this.running && this.running.job.id === jobId && !this.running.finished) {
      this.running.cancelRequested = true;
      this.running.worker.postMessage({ kind: 'cancel' });
      return true;
    }
    const job = getBackgroundJob(jobId);
    if (job && job.status === 'queued') {
      markJobStatus(jobId, 'cancelled', { finishedAt: new Date().toISOString() });
      this.emitTerminal(jobId, 'cancelled');
      return true;
    }
    return false;
  }

  list(opts: { status?: BackgroundJobStatus; type?: JobType; limit?: number } = {}): JobProgress[] {
    return listBackgroundJobs(opts).map((row) => this.toProgress(row));
  }

  getProgress(jobId: string): JobProgress | null {
    const row = getBackgroundJob(jobId);
    return row ? this.toProgress(row) : null;
  }

  /** Stop the current worker (if any). Checkpoints are persisted continuously,
   *  so the interrupted job resumes from its last checkpoint next launch. */
  async shutdown(): Promise<void> {
    this.shutDown = true;
    const running = this.running;
    if (running && !running.finished) {
      // Mark finished BEFORE terminating so the 'exit' listener writes no
      // terminal status: the row must stay 'running' in the DB — that is the
      // exact shape resumeInterrupted() requeues on next launch.
      running.finished = true;
      this.running = null;
      await running.worker.terminate();
    }
  }

  // ─── Internals ───

  private pump(): void {
    if (this.shutDown || this.running) return;
    const job = nextQueuedJob();
    if (!job) return;

    markJobStatus(job.id, 'running', {
      startedAt: job.started_at ?? new Date().toISOString(),
    });

    const state: RunningJobState = {
      job,
      worker: null as unknown as SpawnedWorker, // assigned below, before any callback can fire
      runStartedAt: this.now(),
      baselineProcessed: job.completed_units + job.skipped_units,
      completedUnits: job.completed_units,
      skippedUnits: job.skipped_units,
      totalUnits: job.total_units,
      cancelRequested: false,
      finished: false,
      lastPushAt: 0,
    };
    this.running = state;

    let worker: SpawnedWorker;
    try {
      worker = this.spawnWorker({
        jobId: job.id,
        jobType: job.type,
        payloadJson: job.payload_json,
        checkpointJson: job.checkpoint_json,
        coverage: [...getScanCoverageMap(job.type).entries()],
      });
    } catch (err) {
      this.running = null;
      markJobStatus(job.id, 'failed', {
        error: `Failed to spawn worker: ${err instanceof Error ? err.message : String(err)}`,
        finishedAt: new Date().toISOString(),
      });
      this.emitTerminal(job.id, 'failed');
      // Unlike finish() (which the worker lifecycle always reaches), a
      // synchronous spawn failure returns before running the worker at all —
      // pump again so a job queued behind this one doesn't sit stalled until
      // the next enqueue() or app restart.
      this.pump();
      return;
    }
    state.worker = worker;

    worker.on('message', (msg) => this.handleWorkerMessage(state, msg));
    worker.on('error', (err) => {
      this.finish(state, 'failed', err.stack ?? err.message);
    });
    worker.on('exit', (code) => {
      if (state.finished) return;
      if (state.cancelRequested) {
        this.finish(state, 'cancelled');
      } else {
        // Worker died without done/error — treat as a crash; the persisted
        // checkpoint makes the job resumable, but this run failed.
        this.finish(state, 'failed', `Worker exited unexpectedly (code ${code})`);
      }
    });
  }

  private handleWorkerMessage(state: RunningJobState, msg: WorkerOutMessage): void {
    if (state.finished) return;
    try {
      this.applyWorkerMessage(state, msg);
    } catch (err) {
      // Persistence failed — most likely the vault DB closed mid-run (vault
      // switch, backup, quit). Stop the worker WITHOUT further DB writes: the
      // job row stays 'running' with its last persisted checkpoint, which is
      // exactly the crash shape resumeInterrupted() recovers on next open.
      console.error('[jobs] persist failed mid-job; leaving job resumable:', err);
      state.finished = true;
      this.running = null;
      void state.worker.terminate();
    }
  }

  private applyWorkerMessage(state: RunningJobState, msg: WorkerOutMessage): void {
    switch (msg.kind) {
      case 'total':
        state.totalUnits = msg.totalUnits;
        updateJobTotals(state.job.id, msg.totalUnits);
        this.pushProgress(state);
        break;
      case 'progress':
        state.completedUnits = msg.completedUnits;
        state.skippedUnits = msg.skippedUnits;
        this.pushProgress(state);
        break;
      case 'checkpoint':
        state.completedUnits = msg.completedUnits;
        state.skippedUnits = msg.skippedUnits;
        // Coverage first, checkpoint second: if we crash between the two, the
        // re-run wastes one batch of already-covered work instead of holding a
        // checkpoint that claims coverage which was never written.
        upsertScanCoverage(state.job.type, state.job.id, msg.coverage);
        updateJobCheckpoint(state.job.id, msg.checkpointJson, msg.completedUnits, msg.skippedUnits);
        this.pushProgress(state);
        break;
      case 'done':
        state.completedUnits = msg.completedUnits;
        state.skippedUnits = msg.skippedUnits;
        upsertScanCoverage(state.job.type, state.job.id, msg.coverage);
        updateJobCounters(state.job.id, msg.completedUnits, msg.skippedUnits);
        this.finish(state, 'completed');
        break;
      case 'error':
        this.finish(state, 'failed', msg.message);
        break;
    }
  }

  private finish(state: RunningJobState, status: BackgroundJobStatus, error?: string): void {
    if (state.finished) return;
    state.finished = true;
    markJobStatus(state.job.id, status, {
      error: error ?? null,
      finishedAt: new Date().toISOString(),
    });
    this.running = null;
    this.emitTerminal(
      state.job.id,
      status === 'completed' ? 'done' : status === 'cancelled' ? 'cancelled' : 'failed'
    );
    // Something else may already be waiting.
    this.pump();
  }

  private pushProgress(state: RunningJobState): void {
    if (!this.onEvent) return;
    const t = this.now();
    if (t - state.lastPushAt < PROGRESS_PUSH_INTERVAL_MS) return;
    state.lastPushAt = t;
    const progress = this.getProgress(state.job.id);
    if (progress) this.onEvent({ kind: 'progress', progress });
  }

  private emitTerminal(jobId: string, kind: JobEvent['kind']): void {
    if (!this.onEvent) return;
    const progress = this.getProgress(jobId);
    if (progress) this.onEvent({ kind, progress });
  }

  private toProgress(row: DbBackgroundJob): JobProgress {
    let etaMs: number | null = null;
    let ratePerSec: number | null = null;
    const live = this.running && this.running.job.id === row.id ? this.running : null;
    if (live && row.status === 'running' && live.totalUnits != null) {
      const elapsed = this.now() - live.runStartedAt;
      const processed = live.completedUnits + live.skippedUnits - live.baselineProcessed;
      if (elapsed >= ETA_MIN_ELAPSED_MS && processed > 0) {
        const rate = processed / (elapsed / 1000);
        ratePerSec = rate;
        const remaining = Math.max(0, live.totalUnits - live.completedUnits - live.skippedUnits);
        etaMs = Math.round((remaining / rate) * 1000);
      }
    }
    return {
      jobId: row.id,
      type: row.type,
      status: row.status,
      totalUnits: live?.totalUnits ?? row.total_units,
      completedUnits: live?.completedUnits ?? row.completed_units,
      skippedUnits: live?.skippedUnits ?? row.skipped_units,
      etaMs,
      ratePerSec,
      error: row.error,
      createdAt: row.created_at,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
    };
  }
}
