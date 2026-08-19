// Synthetic CPU-load job — diagnostics and tests only (never enqueueable from
// the renderer; see RENDERER_ENQUEUEABLE_JOB_TYPES). Burns a configurable
// amount of CPU per unit so the non-blocking guarantee can be proven: run it
// inline and the host event loop stalls; run it through the queue and it
// must not (SKY-10730 negative-control test).

import type { JobHandlerContext } from '../types.js';

export interface SyntheticLoadPayload {
  units: number;
  spinMsPerUnit: number;
}

export interface SyntheticLoadCheckpoint {
  cursor: number;
}

/** Hard caps so a malformed payload can't wedge a worker for minutes. */
const MAX_UNITS = 1000;
const MAX_SPIN_MS = 1000;

function spin(ms: number): void {
  const end = Date.now() + ms;
  // Busy-wait on purpose — this job exists to occupy a thread with CPU work.
  let sink = 0;
  while (Date.now() < end) sink = (sink + 1) % 1024;
}

export function runSyntheticLoadJob(ctx: JobHandlerContext): void {
  const payload = ctx.payload as SyntheticLoadPayload | null;
  const units = Math.min(Math.max(1, Math.floor(payload?.units ?? 1)), MAX_UNITS);
  const spinMs = Math.min(Math.max(1, Math.floor(payload?.spinMsPerUnit ?? 1)), MAX_SPIN_MS);

  const cp = ctx.checkpoint as SyntheticLoadCheckpoint | null;
  const start = cp && typeof cp.cursor === 'number' ? Math.min(Math.max(0, cp.cursor), units) : 0;

  ctx.emit({ kind: 'total', totalUnits: units });

  for (let i = start; i < units; i++) {
    if (ctx.isCancelled()) {
      ctx.emit({
        kind: 'checkpoint',
        checkpointJson: JSON.stringify({ cursor: i } satisfies SyntheticLoadCheckpoint),
        completedUnits: i,
        skippedUnits: 0,
        coverage: [],
      });
      return;
    }
    spin(spinMs);
    ctx.emit({
      kind: 'checkpoint',
      checkpointJson: JSON.stringify({ cursor: i + 1 } satisfies SyntheticLoadCheckpoint),
      completedUnits: i + 1,
      skippedUnits: 0,
      coverage: [],
    });
  }

  ctx.emit({ kind: 'done', completedUnits: units, skippedUnits: 0, coverage: [] });
}
