/**
 * PLAN-IDLE-CATCH-UP — renderer `AppSettings.idleCatchUp` shape + defaults.
 *
 * Purpose: owns the renderer `AppSettings.idleCatchUp` merge (type
 * augmentation, defaults, clamp); never touches the jobs IPC or
 * ContinuityPanel. Mirrors `electron-main/src/idleCatchUpSettings.aug.ts`
 * (main clamps the same way on load + save).
 */

export interface IdleCatchUpSettings {
  /** Off → background scans start right away (no staging). */
  enabled: boolean;
  /** Minutes without typing before staged background work starts. */
  minutes: number;
}

declare global {
  interface AppSettings {
    /** Missing → `{ enabled: true, minutes: 2 }` (see `normalizeIdleCatchUp`). */
    idleCatchUp?: IdleCatchUpSettings;
  }
}

/** Skyy's vision: "after 2+ minutes with no typing". */
export const IDLE_CATCH_UP_DEFAULT_MINUTES = 2;
/** 1 exists for testability only; the product default stays 2. */
export const IDLE_CATCH_UP_MIN_MINUTES = 1;
export const IDLE_CATCH_UP_MAX_MINUTES = 30;

export const IDLE_CATCH_UP_DEFAULTS: Readonly<IdleCatchUpSettings> = Object.freeze({
  enabled: true,
  minutes: IDLE_CATCH_UP_DEFAULT_MINUTES,
});

/** Clamp a minutes value to a finite integer in [1, 30]; junk → default 2. */
export function clampIdleCatchUpMinutes(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return IDLE_CATCH_UP_DEFAULT_MINUTES;
  return Math.min(IDLE_CATCH_UP_MAX_MINUTES, Math.max(IDLE_CATCH_UP_MIN_MINUTES, Math.round(n)));
}

/** Missing / malformed → defaults; `enabled` is only false when explicitly false. */
export function normalizeIdleCatchUp(raw: unknown): IdleCatchUpSettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...IDLE_CATCH_UP_DEFAULTS };
  const rec = raw as Record<string, unknown>;
  return {
    enabled: rec.enabled !== false,
    minutes: clampIdleCatchUpMinutes(rec.minutes),
  };
}
