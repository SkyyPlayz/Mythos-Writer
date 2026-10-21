// SKY-9027: on Windows, a file or directory that was just created or is being
// scanned (antivirus, search indexer, an FTS walk) can hold a transient handle
// that fails fs.renameSync with EPERM/EBUSY/EACCES even though the same rename
// succeeds a moment later. Retry briefly with backoff. Non-transient codes
// and code-less errors still throw immediately.
import fs from 'fs';

const RETRYABLE_RENAME_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);
const RENAME_RETRY_DELAYS_MS = [50, 100, 200, 400];

export function renameSyncWithRetry(from: string, to: string): void {
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? '';
      if (attempt >= RENAME_RETRY_DELAYS_MS.length || !RETRYABLE_RENAME_CODES.has(code)) {
        throw err;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, RENAME_RETRY_DELAYS_MS[attempt]);
    }
  }
}
