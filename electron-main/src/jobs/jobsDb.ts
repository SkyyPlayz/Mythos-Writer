// SQLite persistence for the background job queue + scan coverage manifest.
// Tables are created by db.ts migration v31 (M12.1, SKY-10730). All functions
// run against the currently open vault DB (see db.ts getDb()) — like search.ts
// and budget.ts, the SQL lives beside the feature, not in db.ts.
//
// Only the MAIN process calls into this module. Workers never touch the DB —
// they report over the message port and the queue persists here.

import { randomUUID } from 'crypto';
import { getDb } from '../db.js';
import type { BackgroundJobStatus, CoverageEntry, JobType } from './types.js';
import { coverageKey } from './types.js';

export interface DbBackgroundJob {
  id: string;
  type: JobType;
  payload_json: string | null;
  status: BackgroundJobStatus;
  checkpoint_json: string | null;
  total_units: number | null;
  completed_units: number;
  skipped_units: number;
  error: string | null;
  created_at: string;
  started_at: string | null;
  updated_at: string | null;
  finished_at: string | null;
}

export function insertBackgroundJob(input: {
  type: JobType;
  payloadJson: string | null;
}): DbBackgroundJob {
  const now = new Date().toISOString();
  const job: DbBackgroundJob = {
    id: randomUUID(),
    type: input.type,
    payload_json: input.payloadJson,
    status: 'queued',
    checkpoint_json: null,
    total_units: null,
    completed_units: 0,
    skipped_units: 0,
    error: null,
    created_at: now,
    started_at: null,
    updated_at: now,
    finished_at: null,
  };
  getDb()
    .prepare(
      `INSERT INTO background_jobs
         (id, type, payload_json, status, checkpoint_json, total_units,
          completed_units, skipped_units, error, created_at, started_at,
          updated_at, finished_at)
       VALUES (?, ?, ?, ?, NULL, NULL, 0, 0, NULL, ?, NULL, ?, NULL)`
    )
    .run(job.id, job.type, job.payload_json, job.status, job.created_at, job.updated_at);
  return job;
}

export function getBackgroundJob(id: string): DbBackgroundJob | null {
  const row = getDb()
    .prepare('SELECT * FROM background_jobs WHERE id = ?')
    .get(id) as DbBackgroundJob | undefined;
  return row ?? null;
}

export function listBackgroundJobs(opts: {
  status?: BackgroundJobStatus;
  type?: JobType;
  limit?: number;
} = {}): DbBackgroundJob[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (opts.status) {
    where.push('status = ?');
    params.push(opts.status);
  }
  if (opts.type) {
    where.push('type = ?');
    params.push(opts.type);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.max(1, Math.min(opts.limit ?? 100, 500));
  return getDb()
    .prepare(
      `SELECT * FROM background_jobs ${whereSql}
       ORDER BY created_at DESC, rowid DESC LIMIT ?`
    )
    .all(...params, limit) as unknown as DbBackgroundJob[];
}

/** Oldest queued job, if any — FIFO order. rowid breaks created_at ties
 *  (same-millisecond enqueues) in true insert order. */
export function nextQueuedJob(): DbBackgroundJob | null {
  const row = getDb()
    .prepare(
      "SELECT * FROM background_jobs WHERE status = 'queued' ORDER BY created_at ASC, rowid ASC LIMIT 1"
    )
    .get() as DbBackgroundJob | undefined;
  return row ?? null;
}

/** Oldest still-active (queued or running) job with the same type + payload
 *  ("scope") — lets enqueue() collapse duplicate submissions into the job
 *  already in flight instead of piling up redundant rows (SKY-10768 AC3).
 *  `IS ?` (not `=`) so two null payloads count as the same scope. */
export function findActiveJobByScope(type: JobType, payloadJson: string | null): DbBackgroundJob | null {
  const row = getDb()
    .prepare(
      `SELECT * FROM background_jobs
       WHERE type = ? AND payload_json IS ? AND status IN ('queued', 'running')
       ORDER BY created_at ASC, rowid ASC LIMIT 1`
    )
    .get(type, payloadJson) as DbBackgroundJob | undefined;
  return row ?? null;
}

export function markJobStatus(
  id: string,
  status: BackgroundJobStatus,
  opts: { error?: string | null; startedAt?: string; finishedAt?: string } = {}
): void {
  getDb()
    .prepare(
      `UPDATE background_jobs
         SET status = ?,
             error = COALESCE(?, error),
             started_at = COALESCE(?, started_at),
             finished_at = COALESCE(?, finished_at),
             updated_at = ?
       WHERE id = ?`
    )
    .run(
      status,
      opts.error ?? null,
      opts.startedAt ?? null,
      opts.finishedAt ?? null,
      new Date().toISOString(),
      id
    );
}

export function updateJobTotals(id: string, totalUnits: number): void {
  getDb()
    .prepare('UPDATE background_jobs SET total_units = ?, updated_at = ? WHERE id = ?')
    .run(totalUnits, new Date().toISOString(), id);
}

/** Persist a checkpoint + progress counters in one write. This is the crash
 *  resume point — always written together so they can never disagree. */
export function updateJobCheckpoint(
  id: string,
  checkpointJson: string,
  completedUnits: number,
  skippedUnits: number
): void {
  getDb()
    .prepare(
      `UPDATE background_jobs
         SET checkpoint_json = ?, completed_units = ?, skipped_units = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(checkpointJson, completedUnits, skippedUnits, new Date().toISOString(), id);
}

/** Update progress counters without touching the checkpoint (terminal writes). */
export function updateJobCounters(id: string, completedUnits: number, skippedUnits: number): void {
  getDb()
    .prepare(
      'UPDATE background_jobs SET completed_units = ?, skipped_units = ?, updated_at = ? WHERE id = ?'
    )
    .run(completedUnits, skippedUnits, new Date().toISOString(), id);
}

/** Boot-time recovery: any job left at 'running' by a crash or hard quit goes
 *  back to 'queued' with its checkpoint intact. Returns requeued count. */
export function requeueInterruptedJobs(): number {
  const result = getDb()
    .prepare(
      "UPDATE background_jobs SET status = 'queued', updated_at = ? WHERE status = 'running'"
    )
    .run(new Date().toISOString());
  return Number(result.changes);
}

// ─── Coverage manifest ───

export function upsertScanCoverage(
  jobType: JobType,
  jobId: string,
  entries: CoverageEntry[]
): void {
  if (entries.length === 0) return;
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO scan_coverage (id, job_type, scope_kind, scope_path, content_hash, job_id, scanned_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (job_type, scope_kind, scope_path)
     DO UPDATE SET content_hash = excluded.content_hash,
                   job_id = excluded.job_id,
                   scanned_at = excluded.scanned_at`
  );
  const now = new Date().toISOString();
  db.exec('BEGIN');
  try {
    for (const e of entries) {
      stmt.run(randomUUID(), jobType, e.scopeKind, e.scopePath, e.contentHash, jobId, now);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** Coverage for one job type, keyed by coverageKey(scopeKind, scopePath). */
export function getScanCoverageMap(jobType: JobType): Map<string, string> {
  const rows = getDb()
    .prepare('SELECT scope_kind, scope_path, content_hash FROM scan_coverage WHERE job_type = ?')
    .all(jobType) as unknown as Array<{
    scope_kind: string;
    scope_path: string;
    content_hash: string;
  }>;
  const map = new Map<string, string>();
  for (const r of rows) map.set(coverageKey(r.scope_kind, r.scope_path), r.content_hash);
  return map;
}

export function countScanCoverage(jobType: JobType): number {
  const row = getDb()
    .prepare('SELECT COUNT(*) AS n FROM scan_coverage WHERE job_type = ?')
    .get(jobType) as { n: number };
  return Number(row.n);
}
