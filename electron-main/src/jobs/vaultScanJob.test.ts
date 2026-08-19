// vault-scan handler tests — real fixture files, fake handler context.
// Coverage-manifest skip behaviour (AC #4) is proven here: unchanged content
// is skipped on re-run, changed content is re-scanned.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runVaultScanJob, type VaultScanCheckpoint } from './handlers/vaultScanJob.js';
import { coverageKey, type CoverageEntry, type WorkerOutMessage } from './types.js';

let vaultRoot: string;

function writeFixture(rel: string, content: string): void {
  const full = path.join(vaultRoot, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

interface ScanRun {
  msgs: WorkerOutMessage[];
  coverage: CoverageEntry[];
  done: Extract<WorkerOutMessage, { kind: 'done' }> | undefined;
  checkpoints: Array<Extract<WorkerOutMessage, { kind: 'checkpoint' }>>;
}

function runScan(opts: {
  checkpoint?: unknown;
  coverage?: Map<string, string>;
  cancelAtEmit?: number;
} = {}): ScanRun {
  const msgs: WorkerOutMessage[] = [];
  let emits = 0;
  runVaultScanJob({
    payload: { vaultRoot },
    checkpoint: opts.checkpoint ?? null,
    coverage: opts.coverage ?? new Map(),
    emit: (m) => {
      msgs.push(m);
      emits += 1;
    },
    isCancelled: () => (opts.cancelAtEmit == null ? false : emits >= opts.cancelAtEmit),
  });
  const checkpoints = msgs.filter((m): m is Extract<WorkerOutMessage, { kind: 'checkpoint' }> => m.kind === 'checkpoint');
  const done = msgs.find((m): m is Extract<WorkerOutMessage, { kind: 'done' }> => m.kind === 'done');
  const coverage = [...checkpoints.flatMap((c) => c.coverage), ...(done?.coverage ?? [])];
  return { msgs, coverage, done, checkpoints };
}

/** Rebuild the coverage lookup a queue would persist from a prior run. */
function coverageMapOf(run: ScanRun): Map<string, string> {
  return new Map(run.coverage.map((e) => [coverageKey(e.scopeKind, e.scopePath), e.contentHash]));
}

beforeEach(() => {
  vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vaultscan-test-'));
});

afterEach(() => {
  fs.rmSync(vaultRoot, { recursive: true, force: true });
});

describe('vault-scan reference job', () => {
  it('scans every .md file recursively and reports coverage', () => {
    writeFixture('Universes/Ann.md', '# Ann\nA character.');
    writeFixture('Stories/Book One/ch1.md', 'Once upon a time.');
    writeFixture('notes.md', 'loose note');
    writeFixture('ignored.txt', 'not markdown');
    writeFixture('.mythos/state-cache.md', 'derived — never scanned');

    const run = runScan();
    expect(run.msgs[0]).toEqual({ kind: 'total', totalUnits: 3 });
    expect(run.done).toBeDefined();
    expect(run.done!.completedUnits).toBe(3);
    expect(run.done!.skippedUnits).toBe(0);
    expect(run.coverage.map((e) => e.scopePath).sort()).toEqual([
      'Stories/Book One/ch1.md',
      'Universes/Ann.md',
      'notes.md',
    ]);
    // hashes are real sha256 of content
    expect(run.coverage[0].contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('skips unchanged files on re-run and re-scans changed ones (AC #4)', () => {
    writeFixture('a.md', 'alpha');
    writeFixture('b.md', 'beta');
    writeFixture('c.md', 'gamma');
    const first = runScan();
    expect(first.done!.completedUnits).toBe(3);

    // Nothing changed → everything skipped, no new coverage.
    const second = runScan({ coverage: coverageMapOf(first) });
    expect(second.done!.completedUnits).toBe(0);
    expect(second.done!.skippedUnits).toBe(3);
    expect(second.coverage).toHaveLength(0);

    // One file edited → only that file re-scans.
    writeFixture('b.md', 'beta v2');
    const third = runScan({ coverage: coverageMapOf(first) });
    expect(third.done!.completedUnits).toBe(1);
    expect(third.done!.skippedUnits).toBe(2);
    expect(third.coverage.map((e) => e.scopePath)).toEqual(['b.md']);
  });

  it('checkpoints every batch and resumes from the cursor', () => {
    for (let i = 0; i < 30; i++) writeFixture(`f${String(i).padStart(2, '0')}.md`, `content ${i}`);

    // Interrupt right after the first 25-unit checkpoint batch: emits by then
    // are 1 total + 25 progress + 1 checkpoint = 27.
    const first = runScan({ cancelAtEmit: 27 });
    expect(first.done).toBeUndefined();
    const cp = first.checkpoints.at(-1)!;
    const parsed = JSON.parse(cp.checkpointJson) as VaultScanCheckpoint;
    expect(parsed.cursor).toBeGreaterThanOrEqual(25);
    expect(parsed.cursor).toBeLessThan(30);

    // Resume with that checkpoint: only the remaining units are processed.
    const resumed = runScan({ checkpoint: parsed });
    expect(resumed.done!.completedUnits).toBe(30);
    expect(resumed.coverage).toHaveLength(30 - parsed.cursor);
  });

  it('ignores a checkpoint whose file list no longer matches (falls back to coverage skip)', () => {
    writeFixture('a.md', 'alpha');
    writeFixture('b.md', 'beta');
    const first = runScan();

    writeFixture('new.md', 'brand new'); // list changed → cursor invalid
    const stale: VaultScanCheckpoint = {
      cursor: 2,
      unitListHash: 'not-the-real-hash',
      completedUnits: 2,
      skippedUnits: 0,
    };
    const run = runScan({ checkpoint: stale, coverage: coverageMapOf(first) });
    // restarted from 0, but a+b skip via coverage; only new.md is scanned
    expect(run.done!.completedUnits).toBe(1);
    expect(run.done!.skippedUnits).toBe(2);
    expect(run.coverage.map((e) => e.scopePath)).toEqual(['new.md']);
  });

  it('rejects a payload without an absolute vaultRoot', () => {
    expect(() =>
      runVaultScanJob({
        payload: { vaultRoot: 'relative/path' },
        checkpoint: null,
        coverage: new Map(),
        emit: () => {},
        isCancelled: () => false,
      })
    ).toThrow(/absolute vaultRoot/);
  });
});
