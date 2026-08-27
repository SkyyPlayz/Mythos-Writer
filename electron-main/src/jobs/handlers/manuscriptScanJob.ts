// Scoped manuscript scan job (M12.3, SKY-10770). Processes EXACTLY the scene
// units resolved by scanScopeResolver in the main process — never enumerates
// the vault itself, so a scene-scoped scan cannot touch text outside its
// scope. Extraction cost scales with the scope; contradiction detection is a
// separate global DB query (contradictionQuery.ts) and never runs here.
//
// Runs inside the worker thread: filesystem reads + hashing only, no DB.

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { CoverageEntry, JobHandlerContext, ScanScopeLevel, ScanUnit } from '../types.js';
import { coverageKey } from '../types.js';

export interface ManuscriptScanPayload {
  /** Absolute path of the vault root the units are relative to. */
  vaultRoot: string;
  /** What the user picked — carried for progress display and job dedup. */
  scope: { level: ScanScopeLevel; sceneId: string };
  /** The resolved scene set. Built by the MAIN process from its own manifest
   *  read (jobsIpc.ts); the renderer never supplies paths. */
  units: ScanUnit[];
}

export interface ManuscriptScanCheckpoint {
  /** Index of the next unit to process in the payload's unit list. */
  cursor: number;
  /** Hash of the unit list the cursor refers to — a stale checkpoint restarts
   *  at 0; the coverage manifest still skips unchanged scenes. */
  unitListHash: string;
  completedUnits: number;
  skippedUnits: number;
}

/** Units per checkpoint batch — matches vaultScanJob so the persisted resume
 *  point never claims coverage that wasn't recorded. */
const CHECKPOINT_EVERY = 25;

function sha256(text: string | Buffer): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

/** Worker-side re-validation of a unit path (defense in depth on top of the
 *  resolver): vault-relative, POSIX separators, no traversal. */
function isSafeUnitPath(p: unknown): p is string {
  if (typeof p !== 'string' || p.length === 0) return false;
  if (p.startsWith('/') || /^[a-zA-Z]:/.test(p) || p.includes('\\')) return false;
  return !p.split('/').includes('..');
}

export function runManuscriptScanJob(ctx: JobHandlerContext): void {
  const payload = ctx.payload as ManuscriptScanPayload | null;
  if (!payload || typeof payload.vaultRoot !== 'string' || !path.isAbsolute(payload.vaultRoot)) {
    throw new Error('manuscript-scan requires an absolute vaultRoot payload');
  }
  if (!Array.isArray(payload.units)) {
    throw new Error('manuscript-scan requires a resolved units list');
  }
  const units = payload.units.filter(
    (u): u is ScanUnit => !!u && typeof u.sceneId === 'string' && isSafeUnitPath(u.path)
  );
  if (units.length !== payload.units.length) {
    throw new Error('manuscript-scan payload contained an unsafe unit path');
  }

  const unitListHash = sha256(units.map((u) => `${u.sceneId}\n${u.path}`).join('\n'));

  ctx.emit({ kind: 'total', totalUnits: units.length });

  const cp = ctx.checkpoint as ManuscriptScanCheckpoint | null;
  let start = 0;
  let completed = 0;
  let skipped = 0;
  if (cp && typeof cp.cursor === 'number' && cp.unitListHash === unitListHash) {
    start = Math.min(Math.max(0, cp.cursor), units.length);
    completed = typeof cp.completedUnits === 'number' ? cp.completedUnits : start;
    skipped = typeof cp.skippedUnits === 'number' ? cp.skippedUnits : 0;
  }

  let pendingCoverage: CoverageEntry[] = [];

  const flush = (cursor: number): void => {
    ctx.emit({
      kind: 'checkpoint',
      checkpointJson: JSON.stringify({
        cursor,
        unitListHash,
        completedUnits: completed,
        skippedUnits: skipped,
      } satisfies ManuscriptScanCheckpoint),
      completedUnits: completed,
      skippedUnits: skipped,
      coverage: pendingCoverage,
    });
    pendingCoverage = [];
  };

  for (let i = start; i < units.length; i++) {
    if (ctx.isCancelled()) {
      flush(i);
      return; // no 'done' — the queue records the cancel
    }

    const unit = units[i];
    let content: Buffer;
    try {
      content = fs.readFileSync(path.join(payload.vaultRoot, ...unit.path.split('/')));
    } catch {
      completed += 1; // scene file missing/unreadable — count it and move on
      continue;
    }
    const hash = sha256(content);

    if (ctx.coverage.get(coverageKey('scene', unit.path)) === hash) {
      skipped += 1;
    } else {
      scanUnit(content.toString('utf-8'));
      pendingCoverage.push({ scopeKind: 'scene', scopePath: unit.path, contentHash: hash });
      completed += 1;
    }

    ctx.emit({ kind: 'progress', completedUnits: completed, skippedUnits: skipped });
    if ((i + 1 - start) % CHECKPOINT_EVERY === 0) flush(i + 1);
  }

  ctx.emit({ kind: 'done', completedUnits: completed, skippedUnits: skipped, coverage: pendingCoverage });
}

/** The per-unit scan pass. Same realistic-CPU placeholder as vaultScanJob —
 *  manuscript fact extraction plugs in here once the manuscript-side fact
 *  ledger lands (SKY-11035). */
function scanUnit(content: string): { wordCount: number } {
  const wordCount = content.split(/\s+/).filter(Boolean).length;
  return { wordCount };
}
