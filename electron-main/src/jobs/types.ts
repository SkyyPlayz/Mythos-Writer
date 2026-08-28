// Background job/queue infrastructure — shared types + worker message protocol.
// M12.1 (SKY-10730): execution substrate for whole-corpus scan/extraction passes.
//
// Ownership split (binding for every job type):
//   - The MAIN process owns SQLite. Workers never open the DB; they report
//     checkpoints/coverage over the message port and the queue persists them.
//   - Workers own compute + filesystem reads only.
// This keeps a single writer on state.db (WAL or not) and makes crash-resume
// trivial: whatever the queue last persisted IS the resume point.

/** Job types runnable in the worker. Renderer-enqueueable types are a
 *  stricter allowlist — see RENDERER_ENQUEUEABLE_JOB_TYPES. */
export type JobType = 'vault-scan' | 'manuscript-scan' | 'synthetic-load';

/** Job types the renderer may enqueue over IPC. 'synthetic-load' is a
 *  diagnostics/test-only CPU load and stays main-process-internal. */
export const RENDERER_ENQUEUEABLE_JOB_TYPES: readonly JobType[] = [
  'vault-scan',
  'manuscript-scan',
];

// ─── Scan scope (M12.3, SKY-10770) ───

/** Granularity of a manuscript scan. The renderer picks a level + anchor
 *  scene; the MAIN process resolves that to the concrete scene set from its
 *  own manifest read (the renderer never supplies file paths — see
 *  jobsIpc.ts). Extraction cost scales with the level; contradiction
 *  detection stays a global DB query regardless (SKY-10666 binding). */
export type ScanScopeLevel = 'scene' | 'chapter' | 'part' | 'book';

export const SCAN_SCOPE_LEVELS: readonly ScanScopeLevel[] = [
  'scene',
  'chapter',
  'part',
  'book',
];

/** One manuscript unit a scoped scan will process. Path is vault-relative
 *  with POSIX separators, exactly as recorded in the manifest. */
export interface ScanUnit {
  sceneId: string;
  path: string;
}

export type BackgroundJobStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** Coverage manifest entry — durable record that one content unit was scanned
 *  by one job type at one content hash. Re-runs skip unchanged units. */
export interface CoverageEntry {
  /** Granularity of the unit: 'file' today; 'scene' | 'chapter' | 'part' |
   *  'book' reserved for scoped scans (M12.3). */
  scopeKind: string;
  /** Vault-relative path (POSIX separators) identifying the unit. */
  scopePath: string;
  /** SHA-256 hex of the unit's content at scan time. */
  contentHash: string;
}

/** Everything a worker needs to run one job. Passed as workerData. */
export interface WorkerInput {
  jobId: string;
  jobType: JobType;
  /** JSON-serialised job payload (shape is per job type). */
  payloadJson: string | null;
  /** JSON-serialised checkpoint from a prior interrupted run, or null. */
  checkpointJson: string | null;
  /** Prior coverage for this job type: [coverageKey, contentHash] pairs.
   *  See coverageKey() — lets handlers skip unchanged units. */
  coverage: Array<[string, string]>;
}

/** Messages a worker posts back to the queue. */
export type WorkerOutMessage =
  | { kind: 'total'; totalUnits: number }
  | { kind: 'progress'; completedUnits: number; skippedUnits: number }
  | {
      kind: 'checkpoint';
      checkpointJson: string;
      completedUnits: number;
      skippedUnits: number;
      /** Coverage entries accumulated since the previous checkpoint. Batched
       *  with the checkpoint so a crash never persists one without the other. */
      coverage: CoverageEntry[];
    }
  | { kind: 'done'; completedUnits: number; skippedUnits: number; coverage: CoverageEntry[] }
  | { kind: 'error'; message: string };

/** Messages the queue posts into a worker. */
export type WorkerInMessage = { kind: 'cancel' };

/** Key for coverage lookups — kind + path, newline-separated (newlines cannot
 *  appear in either part). */
export function coverageKey(scopeKind: string, scopePath: string): string {
  return `${scopeKind}\n${scopePath}`;
}

/** Progress snapshot queryable by the UI layer while a job runs. */
export interface JobProgress {
  jobId: string;
  type: JobType;
  status: BackgroundJobStatus;
  totalUnits: number | null;
  completedUnits: number;
  skippedUnits: number;
  /** Estimated ms until completion. Null until enough of the current run has
   *  elapsed to compute a stable rate (or when total is unknown). */
  etaMs: number | null;
  /** Units processed per second in the current run, or null (see etaMs). */
  ratePerSec: number | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

/** Event pushed to the renderer over IPC while jobs run. */
export interface JobEvent {
  kind: 'progress' | 'done' | 'failed' | 'cancelled';
  progress: JobProgress;
}

// ─── Handler contract (worker side) ───

export interface JobHandlerContext {
  /** Parsed payload (from WorkerInput.payloadJson). */
  payload: unknown;
  /** Parsed checkpoint from a prior interrupted run, or null. */
  checkpoint: unknown;
  /** Prior coverage for this job type, keyed by coverageKey(). */
  coverage: ReadonlyMap<string, string>;
  emit: (msg: WorkerOutMessage) => void;
  /** Handlers must poll this between units and stop promptly when true.
   *  Emit a final checkpoint before returning so cancel/kill loses nothing. */
  isCancelled: () => boolean;
}

export type JobHandler = (ctx: JobHandlerContext) => void | Promise<void>;
