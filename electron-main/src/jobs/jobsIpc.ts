// IPC surface for the background job queue (M12.1, SKY-10730).
// Query/enqueue/cancel over invoke; live progress is additionally pushed on
// IPC_CHANNELS.JOBS_EVENT by jobService's onEvent wiring in main.ts.

import { ipcMain } from 'electron';
import { IPC_CHANNELS, isFromTopFrame, UNTRUSTED_FRAME_REJECTION } from '../ipc.js';
import { wrapIpcHandler } from '../ipcErrors.js';
import { getJobQueue } from './jobService.js';
import {
  RENDERER_ENQUEUEABLE_JOB_TYPES,
  type BackgroundJobStatus,
  type JobType,
} from './types.js';

export interface JobsEnqueuePayload {
  type: JobType;
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

export function registerJobsIpc(getVaultRoot: () => string): void {
  ipcMain.handle(IPC_CHANNELS.JOBS_ENQUEUE, wrapIpcHandler(IPC_CHANNELS.JOBS_ENQUEUE, (event, payload: JobsEnqueuePayload) => {
    if (!isFromTopFrame(event)) return UNTRUSTED_FRAME_REJECTION;
    const queue = getJobQueue();
    if (!queue) return NO_QUEUE_ERROR;
    if (!payload || !RENDERER_ENQUEUEABLE_JOB_TYPES.includes(payload.type)) {
      return { error: `Job type not enqueueable from the renderer: ${String(payload?.type)}` };
    }
    // SEC: the renderer never controls scan targets. vault-scan is pinned to
    // the currently open vault root; any renderer-supplied payload is dropped.
    const jobPayload = payload.type === 'vault-scan' ? { vaultRoot: getVaultRoot() } : null;
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
