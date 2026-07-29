import fs from 'fs';
import type { ChildProcess } from 'child_process';
import type { ElectronApplication } from '@playwright/test';

/**
 * Close an Electron app and remove its temp directories, tolerant of the
 * ENOTEMPTY race (SKY-8623 / GH #1113): background writers (SQLite WAL,
 * autosave, etc.) can still hold file handles open for a beat after the
 * process is killed, so a synchronous rmSync run immediately after
 * `proc.kill('SIGKILL')` intermittently races an in-flight write.
 *
 * - Tries a graceful app.close(), falling back to SIGKILL after `closeTimeoutMs`.
 * - After SIGKILL, waits for the OS to actually report the process as exited
 *   (its 'exit' event) instead of assuming the kill was instantaneous.
 * - Never throws — a hung close/kill degrades to "best effort" so it can't
 *   mask a real test failure upstream.
 */
export async function closeElectronApp(
  app: ElectronApplication | undefined,
  opts: { closeTimeoutMs?: number; exitTimeoutMs?: number } = {},
): Promise<void> {
  const { closeTimeoutMs = 5_000, exitTimeoutMs = 5_000 } = opts;
  const proc = app?.process();

  await Promise.race([
    app?.close().catch(() => undefined) ?? Promise.resolve(),
    new Promise<void>((r) => setTimeout(r, closeTimeoutMs)),
  ]);

  if (proc && !proc.killed && proc.exitCode === null) {
    try {
      proc.kill('SIGKILL');
    } catch {
      /* already exited */
    }
  }

  if (proc) {
    await waitForExit(proc, exitTimeoutMs);
  }
}

function waitForExit(proc: ChildProcess, timeoutMs: number): Promise<void> {
  if (proc.exitCode !== null || proc.signalCode !== null) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      proc.removeListener('exit', onExit);
      resolve();
    }, timeoutMs);
    function onExit(): void {
      clearTimeout(timer);
      resolve();
    }
    proc.once('exit', onExit);
  });
}

/**
 * Remove E2E temp directories with a bounded retry/backoff for the transient
 * EBUSY/ENOTEMPTY/EPERM races fs.rmSync is documented to hit when a sibling
 * process (or this OS's own async cleanup) still has a handle open. Never
 * throws: a leftover temp dir under os.tmpdir() is cleaned up by the OS and
 * must not fail the test run or mask a real assertion failure above it.
 */
export function removeTempDirs(...dirs: Array<string | undefined>): void {
  for (const dir of dirs) {
    if (!dir) continue;
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[e2e teardown] failed to remove temp dir ${dir}:`, err);
    }
  }
}
