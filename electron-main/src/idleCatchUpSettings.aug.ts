/**
 * PLAN-IDLE-CATCH-UP — main-process `AppSettings.idleCatchUp` augmentation.
 *
 * Purpose: owns the main `AppSettings.idleCatchUp` augmentation + clamp;
 * never edits `ipc.ts`. Mirrors `frontend/src/idleCatchUp/settings.aug.ts`
 * so load and save agree with what the Settings card shows.
 */

declare module './ipc.js' {
  interface AppSettings {
    /** Missing → renderer treats as `{ enabled: true, minutes: 2 }`. */
    idleCatchUp?: { enabled: boolean; minutes: number };
  }
}

export const IDLE_CATCH_UP_DEFAULT_MINUTES = 2;
export const IDLE_CATCH_UP_MIN_MINUTES = 1;
export const IDLE_CATCH_UP_MAX_MINUTES = 30;

/** Missing / malformed → `{ enabled: true, minutes: 2 }`; minutes clamp to a finite int 1..30. */
export function normalizeIdleCatchUpSettings(raw: unknown): { enabled: boolean; minutes: number } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { enabled: true, minutes: IDLE_CATCH_UP_DEFAULT_MINUTES };
  }
  const rec = raw as Record<string, unknown>;
  const n = typeof rec.minutes === 'number'
    ? rec.minutes
    : typeof rec.minutes === 'string' && rec.minutes.trim() !== '' ? Number(rec.minutes) : NaN;
  const minutes = Number.isFinite(n)
    ? Math.min(IDLE_CATCH_UP_MAX_MINUTES, Math.max(IDLE_CATCH_UP_MIN_MINUTES, Math.round(n)))
    : IDLE_CATCH_UP_DEFAULT_MINUTES;
  return { enabled: rec.enabled !== false, minutes };
}
