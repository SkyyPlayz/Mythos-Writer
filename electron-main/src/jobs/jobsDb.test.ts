// Job/coverage persistence tests — real SQLite in a temp dir, no mocks.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { openDb, closeDb } from '../db.js';
import {
  countScanCoverage,
  getBackgroundJob,
  getScanCoverageMap,
  insertBackgroundJob,
  listBackgroundJobs,
  markJobStatus,
  nextQueuedJob,
  requeueInterruptedJobs,
  updateJobCheckpoint,
  updateJobCounters,
  updateJobTotals,
  upsertScanCoverage,
} from './jobsDb.js';
import { coverageKey } from './types.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobsdb-test-'));
  openDb(tmpDir);
});

afterEach(() => {
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('background_jobs CRUD', () => {
  it('inserts queued jobs and reads them back', () => {
    const job = insertBackgroundJob({ type: 'vault-scan', payloadJson: '{"vaultRoot":"/v"}' });
    const row = getBackgroundJob(job.id);
    expect(row).not.toBeNull();
    expect(row!.status).toBe('queued');
    expect(row!.payload_json).toBe('{"vaultRoot":"/v"}');
    expect(row!.completed_units).toBe(0);
    expect(row!.checkpoint_json).toBeNull();
  });

  it('pops queued jobs FIFO', () => {
    const a = insertBackgroundJob({ type: 'vault-scan', payloadJson: null });
    const b = insertBackgroundJob({ type: 'vault-scan', payloadJson: null });
    expect(nextQueuedJob()!.id).toBe(a.id);
    markJobStatus(a.id, 'running');
    expect(nextQueuedJob()!.id).toBe(b.id);
  });

  it('persists checkpoint and counters together', () => {
    const job = insertBackgroundJob({ type: 'vault-scan', payloadJson: null });
    updateJobTotals(job.id, 100);
    updateJobCheckpoint(job.id, '{"cursor":25}', 20, 5);
    const row = getBackgroundJob(job.id)!;
    expect(row.total_units).toBe(100);
    expect(row.checkpoint_json).toBe('{"cursor":25}');
    expect(row.completed_units).toBe(20);
    expect(row.skipped_units).toBe(5);
  });

  it('updates counters without touching the checkpoint', () => {
    const job = insertBackgroundJob({ type: 'vault-scan', payloadJson: null });
    updateJobCheckpoint(job.id, '{"cursor":10}', 10, 0);
    updateJobCounters(job.id, 42, 8);
    const row = getBackgroundJob(job.id)!;
    expect(row.checkpoint_json).toBe('{"cursor":10}');
    expect(row.completed_units).toBe(42);
    expect(row.skipped_units).toBe(8);
  });

  it('requeues interrupted running jobs with checkpoint intact', () => {
    const job = insertBackgroundJob({ type: 'vault-scan', payloadJson: null });
    markJobStatus(job.id, 'running', { startedAt: new Date().toISOString() });
    updateJobCheckpoint(job.id, '{"cursor":7}', 7, 0);
    // Simulated crash: nothing else runs. Next boot:
    expect(requeueInterruptedJobs()).toBe(1);
    const row = getBackgroundJob(job.id)!;
    expect(row.status).toBe('queued');
    expect(row.checkpoint_json).toBe('{"cursor":7}');
    // Terminal jobs are never requeued.
    markJobStatus(job.id, 'completed', { finishedAt: new Date().toISOString() });
    expect(requeueInterruptedJobs()).toBe(0);
  });

  it('filters listBackgroundJobs by status and type', () => {
    const a = insertBackgroundJob({ type: 'vault-scan', payloadJson: null });
    insertBackgroundJob({ type: 'synthetic-load', payloadJson: null });
    markJobStatus(a.id, 'completed');
    expect(listBackgroundJobs({ status: 'completed' }).map((j) => j.id)).toEqual([a.id]);
    expect(listBackgroundJobs({ type: 'synthetic-load' })).toHaveLength(1);
    expect(listBackgroundJobs()).toHaveLength(2);
  });
});

describe('scan_coverage manifest', () => {
  it('upserts entries and rebuilds the lookup map', () => {
    upsertScanCoverage('vault-scan', 'job-1', [
      { scopeKind: 'file', scopePath: 'Universes/Ann.md', contentHash: 'aaa' },
      { scopeKind: 'file', scopePath: 'Stories/ch1.md', contentHash: 'bbb' },
    ]);
    expect(countScanCoverage('vault-scan')).toBe(2);
    const map = getScanCoverageMap('vault-scan');
    expect(map.get(coverageKey('file', 'Universes/Ann.md'))).toBe('aaa');
  });

  it('replaces the hash on re-scan of the same unit (no duplicate rows)', () => {
    upsertScanCoverage('vault-scan', 'job-1', [
      { scopeKind: 'file', scopePath: 'a.md', contentHash: 'v1' },
    ]);
    upsertScanCoverage('vault-scan', 'job-2', [
      { scopeKind: 'file', scopePath: 'a.md', contentHash: 'v2' },
    ]);
    expect(countScanCoverage('vault-scan')).toBe(1);
    expect(getScanCoverageMap('vault-scan').get(coverageKey('file', 'a.md'))).toBe('v2');
  });

  it('keeps coverage separate per job type', () => {
    upsertScanCoverage('vault-scan', 'j', [
      { scopeKind: 'file', scopePath: 'a.md', contentHash: 'x' },
    ]);
    expect(countScanCoverage('synthetic-load')).toBe(0);
  });
});
