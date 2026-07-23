/**
 * idleCpu.ts — SKY-8217 metric 2: "Idle CPU ~= 0%".
 *
 * Samples real OS-level CPU ticks for the Electron main process and the
 * renderer process (via `/proc/<pid>/stat`) across a wall-clock window in
 * which the harness performs no interaction whatsoever — no keystrokes, no
 * injected activity, nothing. The delta in utime+stime ticks over that
 * window, converted to a percentage of wall time, is the real idle-CPU
 * signal PERFORMANCE.md §3 target 2 asks for. This is Linux-only (the CI
 * target per PERFORMANCE.md §1's xvfb-run procedure) because `/proc` is a
 * Linux-specific interface; there is no macOS/Windows equivalent wired up
 * here, and this module refuses to fabricate a number on those platforms.
 */
import fs from 'fs';
import type { ElectronApplication } from '@playwright/test';
import { mainOsPid, rendererOsPid } from './launch';

/**
 * Conventional Linux clock ticks per second (`getconf CLK_TCK`). This value
 * has been 100 on every mainstream Linux kernel/libc combination for
 * decades and is the standard assumption used by tools like `top` and `ps`
 * when they don't query `sysconf(_SC_CLK_TCK)` directly.
 */
const CLK_TCK_HZ = 100;

export interface IdleCpuResult {
  mainCpuPct: number;
  rendererCpuPct: number;
  totalCpuPct: number;
  windowMs: number;
}

interface ProcStatTicks {
  utime: number;
  stime: number;
}

/**
 * Reads and parses `/proc/<pid>/stat`, returning the utime (field 14) and
 * stime (field 15) tick counts.
 *
 * The comm field (field 2, the process name) is wrapped in parens but can
 * itself contain spaces or parens, so the fields cannot be recovered by
 * naively splitting the whole line on whitespace and indexing from the
 * start. Instead we find the LAST ')' in the line (comm can't contain a
 * ')' that isn't itself, per the kernel's own escaping, and there is no
 * legitimate ')' after the real comm field) and split only the remainder.
 * After that split, index 0 is `state` (field 3), so utime (field 14) and
 * stime (field 15) land at indices 11 and 12.
 */
function readProcStatTicks(pid: number): ProcStatTicks {
  let raw: string;
  try {
    raw = fs.readFileSync(`/proc/${pid}/stat`, 'utf-8');
  } catch (err) {
    throw new Error(
      `SKY-8217: failed to read /proc/${pid}/stat — the process may have exited mid-measurement ` +
        `(${err instanceof Error ? err.message : String(err)})`,
    );
  }
  const lastParen = raw.lastIndexOf(')');
  if (lastParen === -1) {
    throw new Error(`SKY-8217: /proc/${pid}/stat did not contain a ')' — unexpected format: ${raw}`);
  }
  const rest = raw.slice(lastParen + 1).trim().split(/\s+/);
  const utime = Number(rest[11]);
  const stime = Number(rest[12]);
  if (!Number.isFinite(utime) || !Number.isFinite(stime)) {
    throw new Error(`SKY-8217: could not parse utime/stime out of /proc/${pid}/stat: ${raw}`);
  }
  return { utime, stime };
}

/** utime+stime ticks, in CLK_TCK units, converted to a wall-clock CPU percentage. */
function ticksToPct(deltaTicks: number, elapsedWallSeconds: number): number {
  return ((deltaTicks / CLK_TCK_HZ) / elapsedWallSeconds) * 100;
}

/**
 * Measures real idle CPU usage of the main and renderer processes over a
 * `windowMs` window of pure wall-clock waiting — no interaction, no
 * injected activity. Caller is responsible for having already brought the
 * app to whatever "idle" state should be measured (e.g. via
 * `openSeededScene`) before calling this.
 */
export async function measureIdleCpu(app: ElectronApplication, windowMs = 5000): Promise<IdleCpuResult> {
  if (process.platform !== 'linux') {
    throw new Error(
      `SKY-8217: measureIdleCpu only supports Linux /proc sampling (got '${process.platform}') — ` +
        'refusing to fabricate a CPU percentage on a platform without a real signal source.',
    );
  }

  const mainPid = mainOsPid(app);
  const rendererPid = await rendererOsPid(app);

  const t0 = Date.now();
  const mainStart = readProcStatTicks(mainPid);
  const rendererStart = readProcStatTicks(rendererPid);

  await new Promise((resolve) => setTimeout(resolve, windowMs));

  const mainEnd = readProcStatTicks(mainPid);
  const rendererEnd = readProcStatTicks(rendererPid);
  const t1 = Date.now();

  const elapsedWallSeconds = (t1 - t0) / 1000;

  const mainDeltaTicks = mainEnd.utime - mainStart.utime + (mainEnd.stime - mainStart.stime);
  const rendererDeltaTicks =
    rendererEnd.utime - rendererStart.utime + (rendererEnd.stime - rendererStart.stime);

  const mainCpuPct = ticksToPct(mainDeltaTicks, elapsedWallSeconds);
  const rendererCpuPct = ticksToPct(rendererDeltaTicks, elapsedWallSeconds);

  return {
    mainCpuPct,
    rendererCpuPct,
    totalCpuPct: mainCpuPct + rendererCpuPct,
    windowMs: t1 - t0,
  };
}
