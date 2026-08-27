// manuscript-scan handler tests (M12.3, SKY-10770) — real fixture files,
// fake handler context, mirroring vaultScanJob.test.ts conventions.
//
// The load-bearing acceptance property is AC2/AC5: a scoped scan touches
// EXACTLY its resolved unit list — and the negative control proves the
// out-of-scope assertion can actually fail before we rely on it.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  runManuscriptScanJob,
  type ManuscriptScanCheckpoint,
  type ManuscriptScanPayload,
} from './handlers/manuscriptScanJob.js';
import { coverageKey, type CoverageEntry, type ScanUnit, type WorkerOutMessage } from './types.js';

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
}

function runScan(units: ScanUnit[], opts: {
  checkpoint?: unknown;
  coverage?: Map<string, string>;
} = {}): ScanRun {
  const msgs: WorkerOutMessage[] = [];
  const payload: ManuscriptScanPayload = {
    vaultRoot,
    scope: { level: 'scene', sceneId: units[0]?.sceneId ?? 'none' },
    units,
  };
  runManuscriptScanJob({
    payload,
    checkpoint: opts.checkpoint ?? null,
    coverage: opts.coverage ?? new Map(),
    emit: (m) => msgs.push(m),
    isCancelled: () => false,
  });
  const checkpoints = msgs.filter((m): m is Extract<WorkerOutMessage, { kind: 'checkpoint' }> => m.kind === 'checkpoint');
  const done = msgs.find((m): m is Extract<WorkerOutMessage, { kind: 'done' }> => m.kind === 'done');
  const coverage = [...checkpoints.flatMap((c) => c.coverage), ...(done?.coverage ?? [])];
  return { msgs, coverage, done };
}

const UNIT_A: ScanUnit = { sceneId: 'scene-a', path: 'stories/book/scenes/a.md' };
const UNIT_B: ScanUnit = { sceneId: 'scene-b', path: 'stories/book/scenes/b.md' };
const UNIT_OUT: ScanUnit = { sceneId: 'scene-out', path: 'stories/book/scenes/out.md' };

beforeEach(() => {
  vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'msscan-test-'));
  writeFixture(UNIT_A.path, 'Aria has green eyes.');
  writeFixture(UNIT_B.path, 'The city is oil-lit.');
  writeFixture(UNIT_OUT.path, 'OUT OF SCOPE: Aria has blue eyes.');
});

afterEach(() => {
  fs.rmSync(vaultRoot, { recursive: true, force: true });
});

describe('manuscript-scan scoped job', () => {
  it('negative control: a unit list that INCLUDES the out-of-scope scene does record it — the out-of-scope check below can fail', () => {
    const leaky = runScan([UNIT_A, UNIT_OUT]);
    expect(leaky.coverage.map((e) => e.scopePath)).toContain(UNIT_OUT.path);
  });

  it('processes exactly the resolved unit list — the out-of-scope scene file is never read into coverage (AC2/AC5)', () => {
    const run = runScan([UNIT_A, UNIT_B]);
    expect(run.msgs[0]).toEqual({ kind: 'total', totalUnits: 2 });
    expect(run.done).toBeDefined();
    expect(run.done!.completedUnits).toBe(2);
    const covered = run.coverage.map((e) => e.scopePath).sort();
    expect(covered).toEqual([UNIT_A.path, UNIT_B.path].sort());
    expect(covered).not.toContain(UNIT_OUT.path);
    for (const entry of run.coverage) expect(entry.scopeKind).toBe('scene');
  });

  it('skips units whose coverage hash is unchanged and re-scans changed ones', () => {
    const first = runScan([UNIT_A, UNIT_B]);
    const prior = new Map(first.coverage.map((e) => [coverageKey(e.scopeKind, e.scopePath), e.contentHash]));

    writeFixture(UNIT_B.path, 'The city is crystal-lit now.');
    const second = runScan([UNIT_A, UNIT_B], { coverage: prior });
    expect(second.done!.skippedUnits).toBe(1); // a.md unchanged
    expect(second.done!.completedUnits).toBe(1); // b.md re-scanned
    expect(second.coverage.map((e) => e.scopePath)).toEqual([UNIT_B.path]);
  });

  it('a vanished scene file is counted and skipped without failing the job', () => {
    fs.rmSync(path.join(vaultRoot, UNIT_B.path));
    const run = runScan([UNIT_A, UNIT_B]);
    expect(run.done!.completedUnits).toBe(2);
    expect(run.coverage.map((e) => e.scopePath)).toEqual([UNIT_A.path]);
  });

  it('resumes from a checkpoint that matches the unit list', () => {
    const cp: ManuscriptScanCheckpoint = {
      cursor: 1,
      // Same hash the handler computes for this unit list.
      unitListHash: crypto
        .createHash('sha256')
        .update([UNIT_A, UNIT_B].map((u) => `${u.sceneId}\n${u.path}`).join('\n'))
        .digest('hex'),
      completedUnits: 1,
      skippedUnits: 0,
    };
    const run = runScan([UNIT_A, UNIT_B], { checkpoint: cp });
    // Only b.md is processed on resume.
    expect(run.done!.completedUnits).toBe(2);
    expect(run.coverage.map((e) => e.scopePath)).toEqual([UNIT_B.path]);
  });

  it('SEC: rejects a payload containing traversal or absolute unit paths outright', () => {
    expect(() => runScan([UNIT_A, { sceneId: 'evil', path: '../outside.md' }])).toThrow(/unsafe unit path/);
    expect(() => runScan([{ sceneId: 'evil', path: '/etc/passwd' }])).toThrow(/unsafe unit path/);
  });

  it('rejects a payload with a relative vaultRoot or missing units', () => {
    expect(() =>
      runManuscriptScanJob({
        payload: { vaultRoot: 'relative/path', scope: { level: 'scene', sceneId: 's' }, units: [] },
        checkpoint: null,
        coverage: new Map(),
        emit: () => {},
        isCancelled: () => false,
      }),
    ).toThrow(/absolute vaultRoot/);
    expect(() =>
      runManuscriptScanJob({
        payload: { vaultRoot, scope: { level: 'scene', sceneId: 's' } },
        checkpoint: null,
        coverage: new Map(),
        emit: () => {},
        isCancelled: () => false,
      }),
    ).toThrow(/units/);
  });
});
