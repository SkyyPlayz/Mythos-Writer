// Worker thread entry for background jobs (M12.1, SKY-10730).
//
// Spawned by the main process via electron-vite's `?nodeWorker` import (see
// main.ts) in production, and by tests via a tsc-compiled copy. Everything
// here must stay Electron-free and DB-free — compute + fs only; results flow
// back over parentPort and the queue persists them.

import { parentPort, workerData } from 'node:worker_threads';
import { runJobWorker } from './jobWorkerCore.js';
import type { JobHandler, WorkerInput } from './types.js';
import { runVaultScanJob } from './handlers/vaultScanJob.js';
import { runManuscriptScanJob } from './handlers/manuscriptScanJob.js';
import { runSyntheticLoadJob } from './handlers/syntheticLoadJob.js';

const HANDLERS: Record<string, JobHandler> = {
  'vault-scan': runVaultScanJob,
  'manuscript-scan': runManuscriptScanJob,
  'synthetic-load': runSyntheticLoadJob,
};

if (!parentPort) {
  throw new Error('jobWorker must run as a worker thread');
}

void runJobWorker(parentPort, workerData as WorkerInput, HANDLERS).finally(() => {
  // All messages posted; let the thread exit naturally.
  parentPort?.unref();
});
