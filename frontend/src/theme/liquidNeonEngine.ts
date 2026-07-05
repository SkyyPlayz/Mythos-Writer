// Beta 3 "Liquid Neon" — token engine. Exact port of the approved prototype's
// theme computation (design-handoff/prototype, renderVals() HTML 3934–3967,
// hexA 3305–3309). The prototype is the spec: formulas, constants, and string
// formats below are verbatim — do not "improve" them.
// Map: docs/releases/LIQUID-NEON-PROTOTYPE-MAP.md §B.
import { LIQUID_NEON_PRESETS, type LiquidNeonSetKey } from './presets';

export interface LiquidNeonPageCfg {
  mode: 'neon' | 'noglow' | 'scroll' | 'off';
  bg: string;
  /** Page background opacity, 0–100. */
  op: number;
  /** Page backdrop blur, px. */
  blur: number;
}

export interface LiquidNeonTextCfg {
  head: string;
  body: string;
  /** When true, notes use their own nHead/nBody instead of head/body. */
  split: boolean;
  nHead: string;
  nBody: string;
}

export type LiquidNeonWallpaperKey = 'match' | 'aurora' | 'slate' | 'deep' | 'none' | 'custom';
export type LiquidNeonFrameAnim = 'off' | 'cycle' | 'sparkle';

export interface LiquidNeonV2Settings {
  setKey: LiquidNeonSetKey;
  /** Six slot colors A–F (hex). */
  slots: [string, string, string, string, string, string];
  /** Neon intensity 0–100 (old scale's 100% == new 50%; headroom above). */
  intensity: number;
  /** Glass opacity 0–96 (%). */
  glassA: number;
  /** Backdrop blur 0–40 (px). */
  blur: number;
  /** Wallpaper mode. */
  wp: LiquidNeonWallpaperKey;
  /** Custom wallpaper ref (app bg-image id or data/blob URL) when wp==='custom'. */
  customWp?: string;
  /** Wallpaper scrim 0–70 (%). */
  scrim: number;
  /** Accessibility: cap intensity contribution (prototype 3935). */
  reduceGlow: boolean;
  /** Master toggle for the frame ring + idle border animations. */
  animGlow: boolean;
  /** Border thickness 1–4 (px) → --bw. */
  glowW: number;
  /** Glow radius 8–160 (px) → --gr. */
  glowR: number;
  /** Neon animation mode for frame + panel borders. */
  frameAnim: LiquidNeonFrameAnim;
  /** Animation period 1–30s (quantized 0.25s in UI). */
  frameSpeed: number;
  pageCfg: LiquidNeonPageCfg;
  txtCfg: LiquidNeonTextCfg;
  /** Scroll page mode: parchment tint + opacity (prototype state 3222). */
  scrollTint: string;
  scrollOp: number;
}

/** Prototype state defaults (HTML 3212–3230). Default preset: Neon Classic. */
export const LIQUID_NEON_V2_DEFAULTS: LiquidNeonV2Settings = {
  setKey: 'classic',
  slots: [...LIQUID_NEON_PRESETS.classic.c] as LiquidNeonV2Settings['slots'],
  intensity: 50,
  glassA: 20,
  blur: 1,
  wp: 'match',
  scrim: 10,
  reduceGlow: false,
  animGlow: true,
  glowW: 1,
  glowR: 60,
  frameAnim: 'off',
  frameSpeed: 12,
  pageCfg: { mode: 'neon', bg: '#0a0d18', op: 66, blur: 0 },
  txtCfg: { head: '#f0f3fc', body: '#c8d3e7', split: false, nHead: '#f0f3fc', nBody: '#c8d3e7' },
  scrollTint: '#2b2213',
  scrollOp: 92,
};

/** Verbatim hexA (prototype 3305–3309): #rrggbb + alpha → rgba string, alpha clamped and toFixed(3). */
export function hexA(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + Math.max(0, Math.min(1, a)).toFixed(3) + ')';
}

/** Merge a partial (persisted settings) over the defaults, depth-1 for the two nested cfgs. */
export function normalizeLiquidNeonV2(partial?: Partial<LiquidNeonV2Settings> | null): LiquidNeonV2Settings {
  const d = LIQUID_NEON_V2_DEFAULTS;
  if (!partial) return { ...d, slots: [...d.slots] as LiquidNeonV2Settings['slots'], pageCfg: { ...d.pageCfg }, txtCfg: { ...d.txtCfg } };
  const slots = Array.isArray(partial.slots) && partial.slots.length === 6
    ? ([...partial.slots] as LiquidNeonV2Settings['slots'])
    : ([...d.slots] as LiquidNeonV2Settings['slots']);
  return {
    ...d,
    ...partial,
    slots,
    pageCfg: { ...d.pageCfg, ...(partial.pageCfg ?? {}) },
    txtCfg: { ...d.txtCfg, ...(partial.txtCfg ?? {}) },
  };
}

/**
 * The wallpaper CSS `background` values (prototype `wps`, HTML 3939–3947).
 * `cosmicUrl` is the bundled Neon Classic wallpaper asset URL (the prototype's
 * relative 'assets/cosmic-bg.webp'); injected so the engine stays testable.
 */
export function wallpaperCss(s: LiquidNeonV2Settings, cosmicUrl: string): string {
  const [c1, c2, c3] = s.slots;
  const c4 = s.slots[3] || '#ff9a3d';
  switch (s.wp) {
    case 'aurora':
      return 'radial-gradient(90% 70% at 15% 10%,' + hexA(c1, .14) + ',transparent 60%),radial-gradient(80% 60% at 85% 15%,' + hexA(c2, .18) + ',transparent 55%),radial-gradient(90% 80% at 55% 95%,' + hexA(c3, .1) + ',transparent 60%),linear-gradient(170deg,#0a0d18,#0b0f22 50%,#070910)';
    case 'slate':
      return 'linear-gradient(165deg,#0d1017,#121826 55%,#0b0e17)';
    case 'deep':
      return 'linear-gradient(#07080d,#07080d)';
    case 'none':
      // Prototype stand-in for a transparent window (M3 makes the Electron
      // window actually transparent; this checkerboard remains the dev fallback).
      return 'repeating-conic-gradient(#151a23 0% 25%,#0b0e14 0% 50%)';
    case 'custom':
      return s.customWp ? "url('" + s.customWp + "')" : "url('" + cosmicUrl + "')";
    case 'match':
    default:
      return s.setKey === 'classic'
        ? "url('" + cosmicUrl + "')"
        : 'radial-gradient(1.6px 1.6px at 12% 22%,rgba(255,255,255,.85),transparent 100%),radial-gradient(1.2px 1.2px at 34% 64%,rgba(255,255,255,.6),transparent 100%),radial-gradient(1.8px 1.8px at 58% 18%,rgba(255,255,255,.75),transparent 100%),radial-gradient(1.2px 1.2px at 73% 48%,rgba(255,255,255,.55),transparent 100%),radial-gradient(1.5px 1.5px at 88% 76%,rgba(255,255,255,.7),transparent 100%),radial-gradient(1.1px 1.1px at 22% 86%,rgba(255,255,255,.5),transparent 100%),radial-gradient(85% 65% at 12% 8%,' + hexA(c1, .2) + ',transparent 58%),radial-gradient(75% 60% at 88% 12%,' + hexA(c2, .24) + ',transparent 55%),radial-gradient(60% 50% at 68% 42%,' + hexA(c3, .14) + ',transparent 60%),radial-gradient(95% 85% at 50% 100%,' + hexA(c4, .1) + ',transparent 62%),linear-gradient(168deg,#0a0d16,#0b0f20 52%,#070911)';
  }
}

export interface LiquidNeonApplyOpts {
  /**
   * M3: the Electron window was actually created transparent (wp was 'none'
   * at launch). Replaces the checkerboard stand-in with a truly clear
   * wallpaper layer so the desktop shows through.
   */
  transparentWindow?: boolean;
}

/**
 * Compute every Liquid Neon CSS custom property from settings — exact port of
 * the prototype's `themeStyle` (HTML 3948–3966) plus `--ln-scrim` (3967's
 * scrim opacity, namespaced: the app already owns `--scrim` as a modal
 * backdrop color in tokens.css).
 */
export function computeLiquidNeonV2Tokens(
  settings: Partial<LiquidNeonV2Settings> | null | undefined,
  cosmicUrl: string,
  opts?: LiquidNeonApplyOpts,
): Record<string, string> {
  const S = normalizeLiquidNeonV2(settings);
  const I = S.reduceGlow ? Math.min(S.intensity, 5) / 25 : S.intensity / 25;
  const [c1, c2, c3] = S.slots;
  const c4 = S.slots[3] || '#ff9a3d', c5 = S.slots[4] || '#2fe6c8', c6 = S.slots[5] || '#3d9bff';
  const allSlots = [c1, c2, c3, c4, c5, c6];
  const tokens: Record<string, string> = {
    '--n1': c1, '--n2': c2, '--n3': c3,
    '--b1': hexA(c1, .3 + .4 * I), '--b2': hexA(c2, .3 + .4 * I), '--b3': hexA(c3, .3 + .4 * I),
    '--g1': hexA(c1, .18 + .5 * I), '--g2': hexA(c2, .18 + .5 * I), '--g3': hexA(c3, .18 + .5 * I),
    '--gs1': hexA(c1, .05 + .13 * I), '--gs2': hexA(c2, .05 + .13 * I), '--gs3': hexA(c3, .05 + .13 * I),
    '--n4': c4, '--n5': c5,
    '--b4': hexA(c4, .3 + .4 * I), '--b5': hexA(c5, .3 + .4 * I),
    '--g4': hexA(c4, .18 + .5 * I), '--g5': hexA(c5, .18 + .5 * I),
    '--gs4': hexA(c4, .05 + .13 * I), '--gs5': hexA(c5, .05 + .13 * I),
    '--n6': c6, '--b6': hexA(c6, .3 + .4 * I), '--g6': hexA(c6, .18 + .5 * I), '--gs6': hexA(c6, .05 + .13 * I),
    '--ring': allSlots.join(',') + ',' + c1,
    '--ringA': String(Math.min(1, .35 + .65 * I)),
    '--grad': 'linear-gradient(120deg,' + allSlots.join(',') + ')',
    '--glass': 'rgba(13,16,28,' + (S.glassA / 100).toFixed(2) + ')',
    '--glass2': 'rgba(21,26,45,' + Math.max(.5, Math.min(.97, S.glassA / 100 + .16)).toFixed(2) + ')',
    '--bw': (S.glowW || 1) + 'px',
    '--gr': (S.glowR || 26) + 'px',
    '--txH': S.txtCfg.head, '--txB': S.txtCfg.body,
    '--txNH': S.txtCfg.split ? S.txtCfg.nHead : S.txtCfg.head,
    '--txNB': S.txtCfg.split ? S.txtCfg.nBody : S.txtCfg.body,
    '--blur': S.blur + 'px',
    '--wp': wallpaperCss(S, cosmicUrl),
    '--wpsize': S.wp === 'none' ? '26px 26px' : 'cover',
    '--ln-scrim': String(S.scrim / 100),
  };
  if (opts?.transparentWindow && S.wp === 'none') {
    // Real transparency instead of the prototype's checkerboard stand-in.
    tokens['--wp'] = 'none';
    tokens['--wpsize'] = 'cover';
  }
  return tokens;
}

const APPLIED_KEYS: string[] = [];

/** Apply (or re-apply) the computed tokens to the document root. */
export function applyLiquidNeonV2Tokens(
  settings: Partial<LiquidNeonV2Settings> | null | undefined,
  cosmicUrl: string,
  el: HTMLElement = document.documentElement,
  opts?: LiquidNeonApplyOpts,
): Record<string, string> {
  const tokens = computeLiquidNeonV2Tokens(settings, cosmicUrl, opts);
  for (const [k, v] of Object.entries(tokens)) {
    el.style.setProperty(k, v);
    if (!APPLIED_KEYS.includes(k)) APPLIED_KEYS.push(k);
  }
  return tokens;
}

/** Remove every property this engine has applied (tests / theme reset). */
export function resetLiquidNeonV2Tokens(el: HTMLElement = document.documentElement): void {
  for (const k of APPLIED_KEYS) el.style.removeProperty(k);
  APPLIED_KEYS.length = 0;
}
