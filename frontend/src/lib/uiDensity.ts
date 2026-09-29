/**
 * Shared UI-density setter for Settings slider (F2#9) and Ctrl+wheel (F2#17).
 * One path only: rAF-throttled preview while dragging/wheeling, commit on release/idle.
 */
import {
  applyLiquidNeonV2Tokens,
  type LiquidNeonV2Settings,
} from '../theme/liquidNeonEngine';

export const UI_DENS_MIN = 0.82;
export const UI_DENS_MAX = 1.18;

export type UiDensityLabel = 'compact' | 'cozy' | 'comfortable';

export function clampUiDens(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(UI_DENS_MAX, Math.max(UI_DENS_MIN, n));
}

export function densLabel(uiDens: number): UiDensityLabel {
  const d = clampUiDens(uiDens);
  if (d <= 0.88) return 'compact';
  if (d <= 0.96) return 'cozy';
  return 'comfortable';
}

/** Wheel delta → density step (~2% per notch). */
export function densFromWheelDelta(current: number, deltaY: number): number {
  const step = deltaY > 0 ? -0.02 : 0.02;
  return clampUiDens(current + step);
}

export interface DensityBridge {
  /** Latest committed settings (React state). */
  getSettings: () => LiquidNeonV2Settings;
  /** Persist + notify React (commit path). */
  commit: (next: LiquidNeonV2Settings) => void;
  /** Cosmic wallpaper URL for the token engine. */
  cosmicBgUrl: string;
}

let bridge: DensityBridge | null = null;
let previewRaf = 0;
let pendingPreview: number | null = null;
let commitTimer = 0;
let pendingCommit: number | null = null;

export function registerDensityBridge(next: DensityBridge | null): void {
  bridge = next;
}

export function getRegisteredDensity(): number {
  return clampUiDens(bridge?.getSettings().uiDens ?? 1);
}

function applyPreviewTokens(uiDens: number): void {
  if (!bridge) return;
  const base = bridge.getSettings();
  const next: LiquidNeonV2Settings = {
    ...base,
    uiDens: clampUiDens(uiDens),
    density: densLabel(uiDens),
  };
  applyLiquidNeonV2Tokens(next, bridge.cosmicBgUrl);
}

/**
 * rAF-throttled live preview (slider drag / continuous wheel). Does not commit
 * React state — call `commitUiDensity` on release / idle.
 */
export function previewUiDensity(uiDens: number): void {
  pendingPreview = clampUiDens(uiDens);
  if (previewRaf) return;
  previewRaf = requestAnimationFrame(() => {
    previewRaf = 0;
    if (pendingPreview == null) return;
    applyPreviewTokens(pendingPreview);
  });
}

/** Immediate commit through the registered bridge (one setter). */
export function commitUiDensity(uiDens: number): void {
  if (!bridge) return;
  const clamped = clampUiDens(uiDens);
  const base = bridge.getSettings();
  const next: LiquidNeonV2Settings = {
    ...base,
    uiDens: clamped,
    density: densLabel(clamped),
  };
  applyLiquidNeonV2Tokens(next, bridge.cosmicBgUrl);
  bridge.commit(next);
  pendingPreview = null;
  pendingCommit = null;
  if (previewRaf) {
    cancelAnimationFrame(previewRaf);
    previewRaf = 0;
  }
  if (commitTimer) {
    clearTimeout(commitTimer);
    commitTimer = 0;
  }
}

/**
 * Preview now + schedule commit after idle (Ctrl+wheel continuous).
 * Reuses the same commit setter as the slider.
 */
export function previewAndScheduleCommit(uiDens: number, idleMs = 120): void {
  previewUiDensity(uiDens);
  pendingCommit = clampUiDens(uiDens);
  if (commitTimer) clearTimeout(commitTimer);
  commitTimer = window.setTimeout(() => {
    commitTimer = 0;
    if (pendingCommit == null) return;
    commitUiDensity(pendingCommit);
  }, idleMs);
}

/** Test helper — clear module timers between tests. */
export function resetDensityControlForTests(): void {
  if (previewRaf) cancelAnimationFrame(previewRaf);
  if (commitTimer) clearTimeout(commitTimer);
  previewRaf = 0;
  commitTimer = 0;
  pendingPreview = null;
  pendingCommit = null;
  bridge = null;
}
