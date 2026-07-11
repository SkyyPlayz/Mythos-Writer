// Beta 3 "Liquid Neon" — token engine. Exact port of the approved prototype's
// theme computation (design-handoff/prototype, renderVals() HTML 3934–3967,
// hexA 3305–3309). The prototype is the spec: formulas, constants, and string
// formats below are verbatim — do not "improve" them.
// Map: docs/releases/LIQUID-NEON-PROTOTYPE-MAP.md §B.
import { LIQUID_NEON_PRESETS, type LiquidNeonPresetKey, type LiquidNeonSetKey } from './presets';
import { schedulePreBlurredWallpaper } from './preBlurWallpaper';
// Resolves to frontend/src/theme.ts (file wins over this directory's index-less
// folder). CF-6: the body-text contrast clamp is shared with the v1 engine.
import { enforceContrastFloor } from '../theme';

export interface LiquidNeonPageCfg {
  /** Manuscript page mode. 'default' is the "No glow" option (prototype key, 4619). */
  mode: 'neon' | 'default' | 'scroll' | 'off';
  bg: string;
  /** Page background opacity, 0–100. */
  op: number;
  /** Page backdrop blur, px. */
  blur: number;
  /** Scroll mode: glowing archaic edge symbols (prototype pc.sym, 4622). */
  sym?: boolean;
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
/** Background ambience mode (prototype ambMode, HTML 6793–6798). */
export type LiquidNeonAmbMode = 'match' | 'snow' | 'rise' | 'off';
/** Interface density (prototype uiDensity, 7020). */
export type LiquidNeonDensity = 'comfortable' | 'cozy' | 'compact';

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
  /** Master toggle for the idle panel-border animations (B4-1: ring removed). */
  animGlow: boolean;
  /** Border thickness 1–4 (px) → --bw. */
  glowW: number;
  /** Glow radius 8–160 (px) → --gr. */
  glowR: number;
  /** Neon animation mode for panel borders (B4-1: ring removed). */
  frameAnim: LiquidNeonFrameAnim;
  /** Animation period 1–30s (quantized 0.25s in UI). */
  frameSpeed: number;
  pageCfg: LiquidNeonPageCfg;
  txtCfg: LiquidNeonTextCfg;
  /** Scroll page mode: parchment tint + opacity (prototype state 3222). */
  scrollTint: string;
  scrollOp: number;
  /** Beta 4 M1 — Background animation mode (prototype ambMode, 6793). */
  ambMode: LiquidNeonAmbMode;
  /** Ambience drift speed % (prototype ambSpeedPct, 7024): 50–200, 100 = preset speed. */
  ambSpeed: number;
  /** Particle color override; null/absent = theme-matched (prototype ambColor, 7025–7028). */
  ambColor?: string | null;
  /** Beta 4 M1 — Interface density; changes spacing tokens live (prototype uiDensity). */
  density: LiquidNeonDensity;
  /** Beta 4 M1 — Reduce motion: one switch stops motes + neon animation (§14.9 #9). */
  reduceMotion: boolean;
  /** App (UI chrome) text color — separate from manuscript txtCfg (prototype uiTextCol, 7189). */
  uiTextCol: string;
  /** Button/chip text color (prototype uiBtnCol, 7190). */
  uiBtnCol: string;
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
  ambMode: 'match',
  ambSpeed: 100,
  ambColor: null,
  density: 'comfortable',
  reduceMotion: false,
  uiTextCol: '#c8d3e7',
  uiBtnCol: '#cdd8ea',
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
      // Beta 4 W0.5 (B4-2): window transparency is removed — `No background`
      // renders a plain dark backdrop instead of the desktop showing through.
      return 'linear-gradient(#07090f,#07090f)';
    case 'custom':
      return s.customWp ? "url('" + s.customWp + "')" : "url('" + cosmicUrl + "')";
    case 'match':
    default:
      return s.setKey === 'classic'
        ? "url('" + cosmicUrl + "')"
        : 'radial-gradient(1.6px 1.6px at 12% 22%,rgba(255,255,255,.85),transparent 100%),radial-gradient(1.2px 1.2px at 34% 64%,rgba(255,255,255,.6),transparent 100%),radial-gradient(1.8px 1.8px at 58% 18%,rgba(255,255,255,.75),transparent 100%),radial-gradient(1.2px 1.2px at 73% 48%,rgba(255,255,255,.55),transparent 100%),radial-gradient(1.5px 1.5px at 88% 76%,rgba(255,255,255,.7),transparent 100%),radial-gradient(1.1px 1.1px at 22% 86%,rgba(255,255,255,.5),transparent 100%),radial-gradient(85% 65% at 12% 8%,' + hexA(c1, .2) + ',transparent 58%),radial-gradient(75% 60% at 88% 12%,' + hexA(c2, .24) + ',transparent 55%),radial-gradient(60% 50% at 68% 42%,' + hexA(c3, .14) + ',transparent 60%),radial-gradient(95% 85% at 50% 100%,' + hexA(c4, .1) + ',transparent 62%),linear-gradient(168deg,#0a0d16,#0b0f20 52%,#070911)';
  }
}

// ── Beta 4 M1: per-vault default theme (§3; prototype cardH/switchH 7111–7121) ──

/**
 * Compute the `liquidNeonV2` patch to apply when switching to `vaultRoot`:
 * the vault's stored preset key becomes setKey + slots, and the wallpaper
 * resets to `match` (prototype 7111). Returns null when the vault has no
 * stored default or the stored key is not a known preset.
 */
export function vaultDefaultThemePatch(
  vaultThemes: Record<string, string> | undefined,
  current: Partial<LiquidNeonV2Settings> | null | undefined,
  vaultRoot: string,
): { liquidNeonV2: LiquidNeonV2Settings; presetName: string } | null {
  const key = vaultThemes?.[vaultRoot];
  if (!key) return null;
  const preset = LIQUID_NEON_PRESETS[key as LiquidNeonPresetKey];
  if (!preset) return null;
  const S = normalizeLiquidNeonV2(current);
  return {
    liquidNeonV2: {
      ...S,
      setKey: preset.key,
      slots: [...preset.c] as LiquidNeonV2Settings['slots'],
      wp: 'match',
    },
    presetName: preset.name,
  };
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
    '--wpsize': 'cover',
    '--ln-scrim': String(S.scrim / 100),
  };
  // Beta 4 M1 — Interface card color wheels. Only emitted when customized so
  // the v1 engine's clamped defaults keep owning the tokens otherwise.
  // CF-6: app body text stays hard-clamped ≥ 4.5:1 against the darkest glass
  // fill base (rgba(13,16,28) → #0d101c) at every wheel position.
  if (S.uiTextCol.toLowerCase() !== LIQUID_NEON_V2_DEFAULTS.uiTextCol) {
    const safe = enforceContrastFloor(S.uiTextCol, '#0d101c');
    tokens['--text-body'] = safe;
    tokens['--text-secondary'] = safe;
  }
  if (S.uiBtnCol.toLowerCase() !== LIQUID_NEON_V2_DEFAULTS.uiBtnCol) {
    tokens['--btn-text'] = S.uiBtnCol;
  }
  return tokens;
}

// ── Beta 4 M1: preset import/export (§3; prototype 7191–7192) ────────────────

/** The shareable preset payload: `{slots, setKey, wp, ambMode, frameAnim}`. */
export interface LiquidNeonPresetFile {
  slots: LiquidNeonV2Settings['slots'];
  setKey: LiquidNeonSetKey;
  wp: LiquidNeonWallpaperKey;
  ambMode: LiquidNeonAmbMode;
  frameAnim: LiquidNeonFrameAnim;
}

/** Serialize the current theme as a shareable JSON preset (prototype 7191). */
export function exportLiquidNeonPreset(settings: Partial<LiquidNeonV2Settings> | null | undefined): string {
  const S = normalizeLiquidNeonV2(settings);
  const file: LiquidNeonPresetFile = {
    slots: [...S.slots] as LiquidNeonV2Settings['slots'],
    setKey: S.setKey,
    wp: S.wp,
    ambMode: S.ambMode,
    frameAnim: S.frameAnim,
  };
  return JSON.stringify(file, null, 2);
}

const HEX_RE = /^#[0-9a-f]{6}$/i;
const SET_KEYS: readonly string[] = [...(Object.keys(LIQUID_NEON_PRESETS) as LiquidNeonPresetKey[]), 'custom'];
const WP_KEYS: readonly string[] = ['match', 'aurora', 'slate', 'deep', 'none', 'custom'];
const AMB_MODES: readonly string[] = ['match', 'snow', 'rise', 'off'];
const FRAME_ANIMS: readonly string[] = ['off', 'cycle', 'sparkle'];

/**
 * Parse a preset JSON string. Returns the recognized subset of
 * `{slots,setKey,wp,ambMode,frameAnim}` (prototype 7192 copies each key that
 * is present), or `null` when the text isn't valid preset JSON — the caller
 * toasts `Not a valid theme preset file` and must not crash.
 */
export function parseLiquidNeonPreset(text: string): Partial<LiquidNeonV2Settings> | null {
  let d: unknown;
  try {
    d = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof d !== 'object' || d === null || Array.isArray(d)) return null;
  const o = d as Record<string, unknown>;
  const out: Partial<LiquidNeonV2Settings> = {};
  if (Array.isArray(o.slots) && o.slots.length === 6 && o.slots.every((c) => typeof c === 'string' && HEX_RE.test(c))) {
    out.slots = [...o.slots] as LiquidNeonV2Settings['slots'];
  }
  if (typeof o.setKey === 'string' && SET_KEYS.includes(o.setKey)) out.setKey = o.setKey as LiquidNeonSetKey;
  if (typeof o.wp === 'string' && WP_KEYS.includes(o.wp)) out.wp = o.wp as LiquidNeonWallpaperKey;
  if (typeof o.ambMode === 'string' && AMB_MODES.includes(o.ambMode)) out.ambMode = o.ambMode as LiquidNeonAmbMode;
  if (typeof o.frameAnim === 'string' && FRAME_ANIMS.includes(o.frameAnim)) out.frameAnim = o.frameAnim as LiquidNeonFrameAnim;
  return Object.keys(out).length > 0 ? out : null;
}

const APPLIED_KEYS: string[] = [];

/** Apply (or re-apply) the computed tokens to the document root. */
export function applyLiquidNeonV2Tokens(
  settings: Partial<LiquidNeonV2Settings> | null | undefined,
  cosmicUrl: string,
  el: HTMLElement = document.documentElement,
): Record<string, string> {
  const S = normalizeLiquidNeonV2(settings);
  const tokens = computeLiquidNeonV2Tokens(settings, cosmicUrl);
  for (const [k, v] of Object.entries(tokens)) {
    el.style.setProperty(k, v);
    if (!APPLIED_KEYS.includes(k)) APPLIED_KEYS.push(k);
  }
  // Customized button text was previously applied but is now default again —
  // clear the stale inline token so Button.css variants take back over.
  if (!tokens['--btn-text']) el.style.removeProperty('--btn-text');
  // Beta 4 M1 — Interface density: tokens.css shrinks the --space-* /
  // --ln-card-pad-* scales off this attribute, so paddings change live.
  if (S.density === 'comfortable') el.removeAttribute('data-ln-density');
  else el.setAttribute('data-ln-density', S.density);
  // Beta 4 M1 — Button text color opt-in hook for Button.css (only when customized).
  if (tokens['--btn-text']) el.setAttribute('data-ln-btn-text', '');
  else el.removeAttribute('data-ln-btn-text');
  // Beta 4 M1 — Reduce motion (§14.9 #9): one class stops the motes, wallpaper
  // drift, and every neon border animation (rule in liquidNeon.css).
  el.classList.toggle('ln-reduce-motion', S.reduceMotion === true);
  // Beta 4 M1 — Background animation Off must be LIVE from the settings panel:
  // the BackgroundStack layers re-render from persisted settings on Save, so
  // the engine stamps the mode and liquidNeon.css hides the layers meanwhile.
  // (Snowfall/Rising direction + drift speed re-render through BackgroundStack.)
  if (S.ambMode === 'off') el.setAttribute('data-ln-amb', 'off');
  else el.removeAttribute('data-ln-amb');
  // W0.5 (PERFORMANCE §2): regenerate the pre-blurred wallpaper copy exactly
  // when the wallpaper or blur radius changes — the panels' faked glass reads
  // it through `--wp-blur` instead of stacking live backdrop-filters.
  schedulePreBlurredWallpaper(tokens['--wp'], parseFloat(tokens['--blur']) || 0, el);
  return tokens;
}

/** Remove every property this engine has applied (tests / theme reset). */
export function resetLiquidNeonV2Tokens(el: HTMLElement = document.documentElement): void {
  for (const k of APPLIED_KEYS) el.style.removeProperty(k);
  APPLIED_KEYS.length = 0;
  el.removeAttribute('data-ln-density');
  el.removeAttribute('data-ln-btn-text');
  el.removeAttribute('data-ln-amb');
  el.classList.remove('ln-reduce-motion');
}
