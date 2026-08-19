// Worker-side job loop, extracted from the thread entry (jobWorker.ts) so it
// can be unit-tested with a fake port. Runs entirely inside the worker thread
// in production — no Electron, no SQLite, no imports from db.ts.

import type {
  JobHandler,
  WorkerInMessage,
  WorkerInput,
  WorkerOutMessage,
} from './types.js';

/** Minimal MessagePort surface the loop needs (parentPort satisfies it). */
export interface WorkerPortLike {
  postMessage(msg: WorkerOutMessage): void;
  on(event: 'message', listener: (msg: WorkerInMessage) => void): void;
}

export async function runJobWorker(
  port: WorkerPortLike,
  input: WorkerInput,
  handlers: Record<string, JobHandler>
): Promise<void> {
  let cancelled = false;
  port.on('message', (msg) => {
    if (msg && msg.kind === 'cancel') cancelled = true;
  });

  const handler = handlers[input.jobType];
  if (!handler) {
    port.postMessage({ kind: 'error', message: `Unknown job type: ${input.jobType}` });
    return;
  }

  let payload: unknown = null;
  let checkpoint: unknown = null;
  try {
    if (input.payloadJson != null) payload = JSON.parse(input.payloadJson);
    if (input.checkpointJson != null) checkpoint = JSON.parse(input.checkpointJson);
  } catch (err) {
    port.postMessage({
      kind: 'error',
      message: `Malformed job payload/checkpoint JSON: ${err instanceof Error ? err.message : String(err)}`,
    });
    return;
  }

  try {
    await handler({
      payload,
      checkpoint,
      coverage: new Map(input.coverage),
      emit: (msg) => port.postMessage(msg),
      isCancelled: () => cancelled,
    });
  } catch (err) {
    port.postMessage({
      kind: 'error',
      message: err instanceof Error ? (err.stack ?? err.message) : String(err),
    });
  }
}
