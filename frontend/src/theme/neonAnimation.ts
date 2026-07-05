// Beta 3 "Liquid Neon" — neon animation styles (M3): the rotating window
// frame ring conic layer and the per-panel breathing border overlays.
// Exact port of the prototype's frameSpinSt (HTML 4632), borderAnim
// (4158–4160), and breathe (4161). The prototype is the spec: string
// formats below are verbatim — do not "improve" them.
import type { CSSProperties } from 'react';
import { normalizeLiquidNeonV2, type LiquidNeonV2Settings } from './liquidNeonEngine';
import { CUSTOM_SET_IDLE_ANIM, LIQUID_NEON_PRESETS, type LiquidNeonPresetKey } from './presets';

/** Panel slot 1–6 — indexes the border/glow token families --b1..6 / --gs1..6 (A–F). */
export type LiquidNeonSlot = 1 | 2 | 3 | 4 | 5 | 6;

/**
 * Verbatim frameSpinSt (prototype 4632): the 170vmax conic-gradient square
 * that spins (Cycle) or hue-shifts (Sparkle) inside each frame-ring mask.
 */
export function frameSpinStyle(
  settings: Partial<LiquidNeonV2Settings> | null | undefined,
): CSSProperties {
  const S = normalizeLiquidNeonV2(settings);
  return {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: '170vmax',
    height: '170vmax',
    marginLeft: '-85vmax',
    marginTop: '-85vmax',
    background: 'conic-gradient(var(--ring,#00f0ff,#9b5fff,#ff4dff,#ff9a3d,#2fe6c8,#3d9bff,#00f0ff))',
    animation: S.frameAnim === 'cycle' ? 'lnSpin ' + S.frameSpeed + 's linear infinite'
      : S.frameAnim === 'sparkle' ? 'lnHue ' + S.frameSpeed + 's linear infinite'
      : 'none',
  };
}

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
