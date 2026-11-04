/**
 * PLAN-IDLE-CATCH-UP — idle catch-up staging gate (renderer only).
 *
 * Purpose: owns the idle timer, the staging buffer, the paced flush and the
 * vaultKey binding; never calls LLM APIs and never edits the main job pump.
 *
 * Contract (Critic r2 builder notes):
 * - `enqueueWhenIdle` returns ONE promise that stays pending until a terminal
 *   outcome: submit success, submit `{ error }` / throw, reject at stage,
 *   coalesce-replace, or `clearStaged`. Being staged is never terminal —
 *   `hooks.onStaged` is the only (optional, synchronous) staged signal.
 * - Typing (editable `input` / `beforeinput` / `keydown`) stops FURTHER
 *   submissions. A job already handed to `window.api.jobs.enqueue` may still
 *   finish in main; this module cannot and does not pause it.
 * - Flush order per item (pinned, e2e-proven): (1) await the e2e hold when
 *   the flag is set → (2) recheck generation / enabled / idle / active →
 *   await `getVaultRoot` → (3) recheck again + vaultKey compare →
 *   (4) `jobs.enqueue`. One item per animation frame — never a microtask
 *   drain. Activity / `active=false` aborts the rest; items stay staged.
 *   Turning the feature off instead submits staged items right away.
 * - A failed vault read is never treated as a vault switch.
 * - Hot path: activity is one timestamp write + one integer bump. Timers run
 *   only while something is staged.
 */

import { IDLE_CATCH_UP_DEFAULTS, normalizeIdleCatchUp, type IdleCatchUpSettings } from './settings.aug';

/** Job kinds allowed through the gate. Add a kind here only with its consumer. */
export const IDLE_CATCH_UP_ALLOWED_TYPES = ['manuscript-scan'] as const;
export type IdleJobType = (typeof IDLE_CATCH_UP_ALLOWED_TYPES)[number];

/** Max distinct staged items (coalesced by type + scope). */
export const IDLE_STAGE_CAP = 8;

export interface IdleEnqueueOpts {
  scope?: { level: 'scene' | 'chapter' | 'part' | 'book'; sceneId: string };
}

export type IdleRejectReason =
  /** A new type+scope key arrived while 8 distinct keys were staged. */
  | 'buffer-full'
  /** A newer request with the same type+scope replaced this one. */
  | 'coalesced'
  /** The project / vault changed before this item was submitted. */
  | 'vault-switch'
  /** `clearStaged()` without a more specific reason. */
  | 'cleared'
  /** `jobs.enqueue` resolved `{ error }` or threw — see `error`. */
  | 'enqueue-failed'
  /** No `window.api.jobs` in this window. */
  | 'unavailable'
  /** Job type is not on the allowlist. */
  | 'not-allowed';

/** Terminal outcome for one `enqueueWhenIdle` call. Never "staged". */
export interface IdleEnqueueResult {
  accepted: 'submitted' | 'rejected';
  jobId?: string;
  /** Human-readable enqueue failure (submit `{ error }` or a throw). */
  error?: string;
  reason?: IdleRejectReason;
}

export interface IdleEnqueueHooks {
  /** Called synchronously when the request lands in the staging buffer. */
  onStaged?: () => void;
}

type JobsApi = {
  enqueue: (type: string, opts?: IdleEnqueueOpts) => Promise<{ jobId?: string; error?: string }>;
};

export interface IdleCatchUpGateDeps {
  now: () => number;
  requestFrame: (cb: () => void) => number;
  cancelFrame: (handle: number) => void;
  setTimer: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer: (handle: ReturnType<typeof setTimeout>) => void;
  /** True while the document is hidden (rAF does not fire there). */
  isHidden: () => boolean;
  getJobs: () => JobsApi | undefined;
  getVaultRoot: () => Promise<string>;
  /** E2E hold seam — production never sets `window.__E2E_IDLE_CATCHUP__`. */
  isE2E: () => boolean;
  exposeE2E: (controller: IdleCatchUpE2EController) => void;
}

/** Hold-only e2e seam. Reachable only while the e2e flag is set. */
export interface IdleCatchUpE2EController {
  /** Park the next flush right before its `n`th submit (1-based). */
  armHoldBeforeSubmit: (n: number) => void;
  isHeld: () => boolean;
  release: () => void;
  stagedKeys: () => string[];
}

interface StagedItem {
  key: string;
  type: IdleJobType;
  opts: IdleEnqueueOpts | undefined;
  vaultKey: string;
  settle: (result: IdleEnqueueResult) => void;
}

/**
 * Slow pacing timer: the only pace while hidden, and the fallback when the
 * window is minimized after rAF was requested (background throttling stops
 * rAF), so a minimized app still catches up.
 */
const HIDDEN_FRAME_MS = 250;

export function idleStageKey(type: string, opts: IdleEnqueueOpts | undefined): string {
  const scope = opts?.scope;
  return scope ? `${type}|${scope.level}|${scope.sceneId}` : `${type}|`;
}

function errorText(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err) return err;
  return 'unknown error';
}

function defaultDeps(): IdleCatchUpGateDeps {
  const w = (typeof window !== 'undefined' ? window : undefined) as
    | (Window & { __E2E_IDLE_CATCHUP__?: unknown; __E2E_IDLE_CATCHUP_GATE__?: IdleCatchUpE2EController })
    | undefined;
  return {
    now: () => Date.now(),
    requestFrame: (cb) => (w?.requestAnimationFrame ? w.requestAnimationFrame(() => cb()) : (setTimeout(cb, 16) as unknown as number)),
    cancelFrame: (h) => {
      if (w?.cancelAnimationFrame) w.cancelAnimationFrame(h);
      else clearTimeout(h as unknown as ReturnType<typeof setTimeout>);
    },
    setTimer: (cb, ms) => setTimeout(cb, ms),
    clearTimer: (h) => clearTimeout(h),
    isHidden: () => typeof document !== 'undefined' && document.visibilityState === 'hidden',
    getJobs: () => w?.api?.jobs as JobsApi | undefined,
    getVaultRoot: async () => {
      // main resolves `{ error }` when the handler throws — that is a failed
      // read, not an empty vault, so it must throw (never compare as '').
      const res = (await w?.api?.getVaultRoot?.()) as { vaultRoot?: unknown; error?: unknown } | undefined;
      if (typeof res?.vaultRoot === 'string' && res.vaultRoot) return res.vaultRoot;
      throw new Error(typeof res?.error === 'string' && res.error ? res.error : 'vault root unavailable');
    },
    isE2E: () => Boolean(w?.__E2E_IDLE_CATCHUP__),
    exposeE2E: (controller) => {
      if (w) w.__E2E_IDLE_CATCHUP_GATE__ = controller;
    },
  };
}

export class IdleCatchUpGate {
  private readonly deps: IdleCatchUpGateDeps;
  private settings: IdleCatchUpSettings = { ...IDLE_CATCH_UP_DEFAULTS };
  private readonly buffer = new Map<string, StagedItem>();
  /** Bumped by every activity; a flush aborts when it moves. */
  private generation = 0;
  /** Bumped by every `clearStaged`; a stage that straddles a clear is dropped. */
  private clearEpoch = 0;
  private lastActivity: number;
  private hosts = 0;
  private everHosted = false;
  private flushing = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** The pending paced frame; `resolve` also cancels its rAF + slow timer. */
  private frame: { resolve: () => void } | null = null;
  private e2eHoldAt: number | null = null;
  private e2eRelease: (() => void) | null = null;
  readonly __e2e: IdleCatchUpE2EController;

  constructor(deps?: Partial<IdleCatchUpGateDeps>) {
    this.deps = { ...defaultDeps(), ...deps };
    this.lastActivity = this.deps.now();
    this.__e2e = {
      armHoldBeforeSubmit: (n) => {
        this.e2eHoldAt = Number.isInteger(n) && n > 0 ? n : null;
      },
      isHeld: () => this.e2eRelease !== null,
      release: () => this.releaseE2EHold(),
      stagedKeys: () => [...this.buffer.keys()],
    };
  }

  // ── host lifecycle (useIdleCatchUp) ───────────────────────────────────────

  /**
   * Apply settings. Re-enable restarts the idle countdown; a minutes change
   * re-arms it. Turning the feature off sends anything already staged down
   * the immediate path, the same as a new request while off.
   */
  configure(raw: unknown): void {
    const next = normalizeIdleCatchUp(raw);
    const wasEnabled = this.settings.enabled;
    this.settings = next;
    if (!next.enabled) {
      this.abortRun();
      this.drainStaged();
      return;
    }
    if (!wasEnabled) this.lastActivity = this.deps.now();
    this.schedule();
  }

  getSettings(): IdleCatchUpSettings {
    return { ...this.settings };
  }

  /**
   * A mounted, active host (the shell). Returns the detach function: detach
   * cancels the timer + pending frame but RETAINS staged items (and their
   * pending waiters) so leaving and re-entering the shell keeps the work.
   */
  attach(): () => void {
    this.hosts += 1;
    // First host in this window: nothing has been typed yet, so the session
    // starts idle. A re-attach restarts the window, because typing while
    // detached is not observed.
    this.lastActivity = this.everHosted ? this.deps.now() : Number.NEGATIVE_INFINITY;
    this.everHosted = true;
    this.exposeE2EIfFlagged();
    this.schedule();
    let detached = false;
    return () => {
      if (detached) return;
      detached = true;
      this.hosts = Math.max(0, this.hosts - 1);
      if (this.hosts === 0) this.abortRun();
    };
  }

  /** Hot path: called for editable input / beforeinput / keydown. O(1), no timers. */
  noteActivity(): void {
    this.lastActivity = this.deps.now();
    this.generation += 1;
  }

  // ── staging ───────────────────────────────────────────────────────────────

  enqueueWhenIdle(type: IdleJobType, opts?: IdleEnqueueOpts, hooks?: IdleEnqueueHooks): Promise<IdleEnqueueResult> {
    if (!(IDLE_CATCH_UP_ALLOWED_TYPES as readonly string[]).includes(type)) {
      return Promise.resolve({ accepted: 'rejected', reason: 'not-allowed' });
    }
    if (!this.deps.getJobs()) return Promise.resolve({ accepted: 'rejected', reason: 'unavailable' });
    // Feature off, or no shell host in this window (floating panels): the
    // old immediate path, errors still propagated.
    if (!this.settings.enabled || !this.everHosted) return this.submitBypass(type, opts);
    this.exposeE2EIfFlagged();
    return this.stage(type, opts, hooks);
  }

  /** Settle every staged waiter as rejected and empty the buffer. */
  clearStaged(reason: Extract<IdleRejectReason, 'vault-switch' | 'cleared'> = 'cleared'): void {
    this.clearEpoch += 1;
    const items = [...this.buffer.values()];
    this.buffer.clear();
    this.cancelTimer();
    // A parked e2e hold resumes, fails its buffer recheck and ends the run.
    this.releaseE2EHold();
    for (const item of items) item.settle({ accepted: 'rejected', reason });
  }

  stagedCount(): number {
    return this.buffer.size;
  }

  private async stage(type: IdleJobType, opts: IdleEnqueueOpts | undefined, hooks?: IdleEnqueueHooks): Promise<IdleEnqueueResult> {
    const epoch = this.clearEpoch;
    let vaultKey: string;
    try {
      vaultKey = await this.deps.getVaultRoot();
    } catch {
      // Without a vault key the item can't be bound safely — fall back to the
      // immediate path (main stamps vaultRoot at enqueue as it always has).
      return this.submitBypass(type, opts);
    }
    // A project switch landed while we read the root: never stage for the old vault.
    if (epoch !== this.clearEpoch) return { accepted: 'rejected', reason: 'vault-switch' };
    if (!this.settings.enabled) return this.submitBypass(type, opts);

    const key = idleStageKey(type, opts);
    const existing = this.buffer.get(key);
    if (!existing && this.buffer.size >= IDLE_STAGE_CAP) {
      return { accepted: 'rejected', reason: 'buffer-full' };
    }
    return new Promise<IdleEnqueueResult>((resolve) => {
      let settled = false;
      const item: StagedItem = {
        key,
        type,
        opts,
        vaultKey,
        settle: (result) => {
          if (settled) return;
          settled = true;
          resolve(result);
        },
      };
      if (existing) {
        this.buffer.delete(key);
        existing.settle({ accepted: 'rejected', reason: 'coalesced' });
      }
      this.buffer.set(key, item);
      hooks?.onStaged?.();
      this.schedule();
    });
  }

  /** Empty the buffer through the immediate path (feature turned off). */
  private drainStaged(): void {
    if (this.buffer.size === 0) return;
    const items = [...this.buffer.values()];
    this.buffer.clear();
    void this.submitDrained(items);
  }

  private async submitDrained(items: StagedItem[]): Promise<void> {
    const epoch = this.clearEpoch;
    let currentVault: string | null;
    try {
      currentVault = await this.deps.getVaultRoot();
    } catch {
      // Same fallback as a stage without a vault key: main stamps vaultRoot.
      currentVault = null;
    }
    // A project switch during the read: these items belong to the old vault.
    const switched = epoch !== this.clearEpoch;
    for (const item of items) {
      if (switched || (currentVault !== null && currentVault !== item.vaultKey)) {
        item.settle({ accepted: 'rejected', reason: 'vault-switch' });
      } else {
        void this.submit(item.type, item.opts).then(item.settle);
      }
    }
  }

  private async submitBypass(type: IdleJobType, opts: IdleEnqueueOpts | undefined): Promise<IdleEnqueueResult> {
    // A direct submit supersedes a staged twin so it can't run twice later.
    const key = idleStageKey(type, opts);
    const twin = this.buffer.get(key);
    if (twin) {
      this.buffer.delete(key);
      twin.settle({ accepted: 'rejected', reason: 'coalesced' });
    }
    return this.submit(type, opts);
  }

  private async submit(type: IdleJobType, opts: IdleEnqueueOpts | undefined): Promise<IdleEnqueueResult> {
    const jobs = this.deps.getJobs();
    if (!jobs) return { accepted: 'rejected', reason: 'unavailable' };
    try {
      const res = await jobs.enqueue(type, opts);
      if (res?.error) return { accepted: 'rejected', reason: 'enqueue-failed', error: res.error };
      return { accepted: 'submitted', ...(res?.jobId ? { jobId: res.jobId } : {}) };
    } catch (err) {
      return { accepted: 'rejected', reason: 'enqueue-failed', error: errorText(err) };
    }
  }

  // ── idle timer + paced flush ──────────────────────────────────────────────

  private idleMs(): number {
    return this.settings.minutes * 60_000;
  }

  private isIdle(): boolean {
    return this.deps.now() - this.lastActivity >= this.idleMs();
  }

  private canRun(): boolean {
    return this.settings.enabled && this.hosts > 0;
  }

  /** Arm (or re-arm) the single idle timer. No-op while flushing or empty. */
  private schedule(): void {
    this.cancelTimer();
    if (this.flushing || !this.canRun() || this.buffer.size === 0) return;
    const wait = Math.max(0, this.lastActivity + this.idleMs() - this.deps.now());
    this.timer = this.deps.setTimer(() => {
      this.timer = null;
      if (!this.canRun() || this.buffer.size === 0) return;
      if (this.isIdle()) this.startFlush();
      else this.schedule(); // typed since the timer was armed — wait the remainder
    }, wait);
  }

  private cancelTimer(): void {
    if (this.timer !== null) {
      this.deps.clearTimer(this.timer);
      this.timer = null;
    }
  }

  /** Stop the timer + pending frame. Staged items and their waiters stay. */
  private abortRun(): void {
    this.cancelTimer();
    const frame = this.frame;
    if (frame) {
      this.frame = null;
      frame.resolve();
    }
    // Bump so a flush parked in an await sees the stop on its next recheck.
    this.generation += 1;
    // A parked e2e hold resumes and fails that recheck, so `flushing` resets.
    this.releaseE2EHold();
  }

  private releaseE2EHold(): void {
    const release = this.e2eRelease;
    this.e2eRelease = null;
    release?.();
  }

  /**
   * One paced step. While visible, rAF races the slow timer (whichever fires
   * first wins and cancels the other), so a window minimized after the
   * request still advances; while hidden, only the slow timer runs.
   */
  private nextFrame(): Promise<void> {
    return new Promise<void>((resolve) => {
      let rafHandle: number | null = null;
      let slowTimer: ReturnType<typeof setTimeout> | null = null;
      const done = () => {
        if (rafHandle !== null) this.deps.cancelFrame(rafHandle);
        if (slowTimer !== null) this.deps.clearTimer(slowTimer);
        rafHandle = null;
        slowTimer = null;
        if (this.frame?.resolve === done) this.frame = null;
        resolve();
      };
      slowTimer = this.deps.setTimer(() => {
        slowTimer = null;
        done();
      }, HIDDEN_FRAME_MS);
      if (!this.deps.isHidden()) {
        rafHandle = this.deps.requestFrame(() => {
          rafHandle = null;
          done();
        });
      }
      this.frame = { resolve: done };
    });
  }

  private startFlush(): void {
    if (this.flushing) return;
    this.flushing = true;
    const startGen = this.generation;
    void this.runFlush(startGen).finally(() => {
      this.flushing = false;
      this.e2eRelease = null;
      this.schedule();
    });
  }

  private stillOk(startGen: number): boolean {
    return this.generation === startGen && this.canRun() && this.isIdle();
  }

  private async runFlush(startGen: number): Promise<void> {
    let submitIndex = 0;
    for (;;) {
      await this.nextFrame();
      if (!this.stillOk(startGen)) return;
      const item = this.buffer.values().next().value as StagedItem | undefined;
      if (!item) return;

      // (1) e2e hold — only while the flag is set (production-dead).
      if (this.deps.isE2E() && this.e2eHoldAt === submitIndex + 1) {
        this.e2eHoldAt = null;
        await new Promise<void>((release) => {
          this.e2eRelease = release;
        });
      }
      // (2) recheck before touching the vault.
      if (!this.stillOk(startGen) || this.buffer.get(item.key) !== item) return;

      let currentVault: string;
      try {
        currentVault = await this.deps.getVaultRoot();
      } catch {
        // Keep staged and wait a full idle window before the next read, so a
        // failing read can't repeat once per frame.
        this.lastActivity = this.deps.now();
        return;
      }
      // (3) recheck again after the async vault read, right before enqueue.
      if (!this.stillOk(startGen) || this.buffer.get(item.key) !== item) return;
      if (currentVault !== item.vaultKey) {
        this.clearStaged('vault-switch');
        return;
      }

      // (4) submit. Remove first so a same-key stage during the await is a
      // fresh item that this submit's outcome never touches.
      this.buffer.delete(item.key);
      submitIndex += 1;
      item.settle(await this.submit(item.type, item.opts));
    }
  }

  private exposeE2EIfFlagged(): void {
    if (this.deps.isE2E()) this.deps.exposeE2E(this.__e2e);
  }
}

/** The one gate per renderer window. */
export const idleCatchUpGate = new IdleCatchUpGate();
