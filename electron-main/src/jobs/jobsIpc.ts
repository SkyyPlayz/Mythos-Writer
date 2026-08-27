// IPC surface for the background job queue (M12.1, SKY-10730).
// Query/enqueue/cancel over invoke; live progress is additionally pushed on
// IPC_CHANNELS.JOBS_EVENT by jobService's onEvent wiring in main.ts.

import { ipcMain } from 'electron';
import type { Manifest } from '../ipc.js';
import { IPC_CHANNELS, isFromTopFrame, UNTRUSTED_FRAME_REJECTION } from '../ipc.js';
import { wrapIpcHandler } from '../ipcErrors.js';
import type { ManuscriptScanPayload } from './handlers/manuscriptScanJob.js';
import { getJobQueue } from './jobService.js';
import { resolveScanScopeUnits } from './scanScopeResolver.js';
import {
  RENDERER_ENQUEUEABLE_JOB_TYPES,
  SCAN_SCOPE_LEVELS,
  type BackgroundJobStatus,
  type JobType,
  type ScanScopeLevel,
} from './types.js';

export interface JobsEnqueuePayload {
  type: JobType;
  /** M12.3 (SKY-10770): scope for 'manuscript-scan'. Identifiers only — the
   *  main process resolves them to scene paths from its own manifest read. */
  scope?: { level?: unknown; sceneId?: unknown };
  payload?: unknown;
}

export interface JobsListPayload {
  status?: BackgroundJobStatus;
  type?: JobType;
  limit?: number;
}

export interface JobsProgressPayload {
  jobId: string;
}

export interface JobsCancelPayload {
  jobId: string;
}

const NO_QUEUE_ERROR = { error: 'No vault open — job queue unavailable.' };

export function registerJobsIpc(
  getVaultRoot: () => string,
  getManifest?: () => Manifest | null,
): void {
  ipcMain.handle(IPC_CHANNELS.JOBS_ENQUEUE, wrapIpcHandler(IPC_CHANNELS.JOBS_ENQUEUE, (event, payload: JobsEnqueuePayload) => {
    if (!isFromTopFrame(event)) return UNTRUSTED_FRAME_REJECTION;
    const queue = getJobQueue();
    if (!queue) return NO_QUEUE_ERROR;
    if (!payload || !RENDERER_ENQUEUEABLE_JOB_TYPES.includes(payload.type)) {
      return { error: `Job type not enqueueable from the renderer: ${String(payload?.type)}` };
    }
    // SEC: the renderer never controls scan targets. vault-scan is pinned to
    // the currently open vault root; any renderer-supplied payload is dropped.
    // manuscript-scan accepts scope IDENTIFIERS only (level + anchor scene id)
    // — main resolves them to scene paths from its own manifest read
    // (scanScopeResolver.ts), so the renderer still never names a file.
    let jobPayload: unknown = null;
    if (payload.type === 'vault-scan') {
      jobPayload = { vaultRoot: getVaultRoot() };
    } else if (payload.type === 'manuscript-scan') {
      const level = payload.scope?.level;
      const sceneId = payload.scope?.sceneId;
      if (
        !SCAN_SCOPE_LEVELS.includes(level as ScanScopeLevel) ||
        typeof sceneId !== 'string' ||
        sceneId.length === 0
      ) {
        return { error: 'manuscript-scan requires scope { level: scene|chapter|part|book, sceneId }' };
      }
      const manifest = getManifest?.() ?? null;
      if (!manifest) return { error: 'No manifest available — cannot resolve scan scope.' };
      const scope = { level: level as ScanScopeLevel, sceneId };
      const units = resolveScanScopeUnits(manifest, scope);
      if (units.length === 0) {
        return { error: 'Scan scope resolved to no scenes — the anchor scene is not in the manifest.' };
      }
      jobPayload = { vaultRoot: getVaultRoot(), scope, units } satisfies ManuscriptScanPayload;
    }
    const jobId = queue.enqueue(payload.type, jobPayload);
    return { jobId };
  }));

  ipcMain.handle(IPC_CHANNELS.JOBS_LIST, wrapIpcHandler(IPC_CHANNELS.JOBS_LIST, (event, payload: JobsListPayload) => {
    if (!isFromTopFrame(event)) return UNTRUSTED_FRAME_REJECTION;
    const queue = getJobQueue();
    if (!queue) return NO_QUEUE_ERROR;
    return { jobs: queue.list(payload ?? {}) };
  }));

  ipcMain.handle(IPC_CHANNELS.JOBS_PROGRESS, wrapIpcHandler(IPC_CHANNELS.JOBS_PROGRESS, (event, payload: JobsProgressPayload) => {
    if (!isFromTopFrame(event)) return UNTRUSTED_FRAME_REJECTION;
    const queue = getJobQueue();
    if (!queue) return NO_QUEUE_ERROR;
    if (!payload || typeof payload.jobId !== 'string') return { error: 'jobId required' };
    const progress = queue.getProgress(payload.jobId);
    return progress ? { progress } : { error: 'Job not found' };
  }));

  ipcMain.handle(IPC_CHANNELS.JOBS_CANCEL, wrapIpcHandler(IPC_CHANNELS.JOBS_CANCEL, (event, payload: JobsCancelPayload) => {
    if (!isFromTopFrame(event)) return UNTRUSTED_FRAME_REJECTION;
    const queue = getJobQueue();
    if (!queue) return NO_QUEUE_ERROR;
    if (!payload || typeof payload.jobId !== 'string') return { error: 'jobId required' };
    return { cancelled: queue.cancel(payload.jobId) };
  }));
}
