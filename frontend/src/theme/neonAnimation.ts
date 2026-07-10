// Beta 3 "Liquid Neon" — per-panel breathing border overlays (M3). Exact port
// of the prototype's borderAnim (4158–4160) and breathe (4161). The prototype
// is the spec: string formats below are verbatim — do not "improve" them.
// Beta 4 W0.5 (B4-1): the window frame ring (frameSpinSt) is deleted.
import type { CSSProperties } from 'react';
import { normalizeLiquidNeonV2, type LiquidNeonV2Settings } from './liquidNeonEngine';
import { CUSTOM_SET_IDLE_ANIM, LIQUID_NEON_PRESETS, type LiquidNeonPresetKey } from './presets';

/** Panel slot 1–6 — indexes the border/glow token families --b1..6 / --gs1..6 (A–F). */
export type LiquidNeonSlot = 1 | 2 | 3 | 4 | 5 | 6;

/**
 * Verbatim borderAnim (prototype 4158–4160): the animation shorthand for a
 * panel border overlay. Cycle/Sparkle override the preset's idle animation;
 * otherwise the preset idles (lnBreathe/lnHueSoft/lnFlicker/lnShimmer/
 * lnPulse) unless animGlow is off.
 */
export function borderAnimation(
  settings: Partial<LiquidNeonV2Settings> | null | undefined,
  delay: number,
): string {
  const S = normalizeLiquidNeonV2(settings);
  const themeAnimStr = LIQUID_NEON_PRESETS[S.setKey as LiquidNeonPresetKey]?.idleAnim || CUSTOM_SET_IDLE_ANIM;
  return S.frameAnim === 'cycle' ? 'lnHue ' + S.frameSpeed + 's linear ' + delay + 's infinite'
    : S.frameAnim === 'sparkle' ? 'lnFlicker ' + Math.max(.25, S.frameSpeed * .5).toFixed(2) + 's steps(1,end) ' + delay + 's infinite'
    : (S.animGlow === false ? 'none' : themeAnimStr + ' ' + delay + 's infinite');
}

/**
 * Verbatim breathe (prototype 4161): inset border + double inner glow overlay
 * for a panel, tinted by its slot's --b/--gs tokens. Prototype delays:
 * left 0 · center .8 · right 1.6 · nav rail 2.2 (renderVals 4961).
 */
export function breatheOverlayStyle(
  settings: Partial<LiquidNeonV2Settings> | null | undefined,
  slot: LiquidNeonSlot,
  delay: number,
): CSSProperties {
  return {
    position: 'absolute',
    inset: 0,
    borderRadius: 'inherit',
    pointerEvents: 'none',
    border: 'var(--bw,1px) solid var(--b' + slot + ')',
    boxShadow: 'inset 0 0 28px var(--gs' + slot + '), inset 0 0 4px var(--gs' + slot + ')',
    animation: borderAnimation(settings, delay),
  };
}
