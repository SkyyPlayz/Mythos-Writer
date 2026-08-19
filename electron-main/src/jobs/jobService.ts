// Per-vault job queue singleton — mirrors db.ts's openDb() lifecycle.
// Initialised right after openDb() for a vault root; idempotent per root.
// On vault switch the previous queue's worker is terminated; its interrupted
// job stays checkpointed in that vault's own state.db and resumes the next
// time that vault opens.

import type { JobEvent } from './types.js';
import { JobQueue, type SpawnWorker } from './jobQueue.js';

let _queue: JobQueue | null = null;
let _root: string | null = null;

export function initJobService(
  vaultRoot: string,
  spawnWorker: SpawnWorker,
  onEvent?: (evt: JobEvent) => void
): JobQueue {
  if (_queue && _root === vaultRoot) return _queue;
  if (_queue) void _queue.shutdown();
  _queue = new JobQueue({ spawnWorker, onEvent });
  _root = vaultRoot;
  _queue.resumeInterrupted();
  return _queue;
}

export function getJobQueue(): JobQueue | null {
  return _queue;
}

export async function shutdownJobService(): Promise<void> {
  if (_queue) {
    await _queue.shutdown();
    _queue = null;
    _root = null;
  }
}
