// Reference whole-vault scan job (M12.1). Walks every .md file under the
// vault root, hashes content, and reports coverage. This is the execution
// substrate — fact extraction plugs into scanUnit() in M12.2 (SKY-10731).
//
// Runs inside the worker thread: filesystem reads + hashing only, no DB.

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { CoverageEntry, JobHandlerContext } from '../types.js';
import { coverageKey } from '../types.js';

export interface VaultScanPayload {
  /** Absolute path of the vault root to scan. */
  vaultRoot: string;
}

export interface VaultScanCheckpoint {
  /** Index of the next unit to process in the enumerated (sorted) file list. */
  cursor: number;
  /** Hash of the enumerated file list the cursor refers to. If the list has
   *  changed since the checkpoint, the cursor is invalid and the scan restarts
   *  at 0 — the coverage manifest still skips all unchanged files, so a stale
   *  checkpoint costs re-hashing, never redundant extraction. */
  unitListHash: string;
  /** Counters at the checkpoint, carried across resumes so the completed vs.
   *  skipped split stays truthful (cursor alone can't distinguish them). */
  completedUnits: number;
  skippedUnits: number;
}

/** Units per checkpoint batch. Also the coverage-entry flush size — the two
 *  are emitted together so the persisted resume point never claims coverage
 *  that wasn't recorded. */
const CHECKPOINT_EVERY = 25;

/** Directories never scanned: derived state, VCS, hidden dirs. */
const SKIP_DIRS = new Set(['.mythos', '.git', 'node_modules']);

function listMdFilesSorted(root: string): string[] {
  const results: string[] = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // unreadable dir — skip, don't fail the whole scan
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.md')) results.push(full);
    }
  };
  walk(root);
  return results.sort();
}

function sha256(text: string | Buffer): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

export function runVaultScanJob(ctx: JobHandlerContext): void {
  const payload = ctx.payload as VaultScanPayload | null;
  if (!payload || typeof payload.vaultRoot !== 'string' || !path.isAbsolute(payload.vaultRoot)) {
    throw new Error('vault-scan requires an absolute vaultRoot payload');
  }

  const files = listMdFilesSorted(payload.vaultRoot);
  const relPaths = files.map((f) =>
    path.relative(payload.vaultRoot, f).split(path.sep).join('/')
  );
  const unitListHash = sha256(relPaths.join('\n'));

  ctx.emit({ kind: 'total', totalUnits: files.length });

  // Resume from checkpoint only if it refers to this exact file list.
  const cp = ctx.checkpoint as VaultScanCheckpoint | null;
  let start = 0;
  let completed = 0;
  let skipped = 0;
  if (cp && typeof cp.cursor === 'number' && cp.unitListHash === unitListHash) {
    start = Math.min(Math.max(0, cp.cursor), files.length);
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
      } satisfies VaultScanCheckpoint),
      completedUnits: completed,
      skippedUnits: skipped,
      coverage: pendingCoverage,
    });
    pendingCoverage = [];
  };

  for (let i = start; i < files.length; i++) {
    if (ctx.isCancelled()) {
      flush(i);
      return; // no 'done' — the queue records the cancel
    }

    const relPath = relPaths[i];
    let content: Buffer;
    try {
      content = fs.readFileSync(files[i]);
    } catch {
      completed += 1; // vanished/unreadable mid-scan — count it and move on
      continue;
    }
    const hash = sha256(content);

    if (ctx.coverage.get(coverageKey('file', relPath)) === hash) {
      skipped += 1;
    } else {
      scanUnit(content.toString('utf-8'));
      pendingCoverage.push({ scopeKind: 'file', scopePath: relPath, contentHash: hash });
      completed += 1;
    }

    ctx.emit({ kind: 'progress', completedUnits: completed, skippedUnits: skipped });
    if ((i + 1 - start) % CHECKPOINT_EVERY === 0) flush(i + 1);
  }

  ctx.emit({ kind: 'done', completedUnits: completed, skippedUnits: skipped, coverage: pendingCoverage });
}

/** The per-unit scan pass. Today: a parse that exercises realistic CPU cost
 *  (word segmentation). M12.2 replaces this with fact extraction. */
function scanUnit(content: string): { wordCount: number } {
  const wordCount = content.split(/\s+/).filter(Boolean).length;
  return { wordCount };
}
