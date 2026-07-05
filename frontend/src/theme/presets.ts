// Beta 3 "Liquid Neon" — theme presets, ported VERBATIM from the approved
// prototype (design-handoff/prototype, `this.sets` HTML 2872–2883,
// `this.themeAnim` 2884, roles/swatches 2885–2886, ambience `ambConf`
// 4650–4660). Do not tweak values — the prototype is the spec.
// Map: docs/releases/LIQUID-NEON-PROTOTYPE-MAP.md §C.

export type LiquidNeonPresetKey =
  | 'classic' | 'aurora' | 'cyber' | 'sunset' | 'ice'
  | 'ember' | 'verdant' | 'royal' | 'noir' | 'winter';

export type LiquidNeonSetKey = LiquidNeonPresetKey | 'custom';

/** Ambience particle layer (two per preset). Rendered by AmbienceLayer (M2). */
export interface AmbienceLayerSpec {
  /** Falling (`lnSnow`) or rising (`lnRise`) particle keyframe. */
  anim: 'lnSnow' | 'lnRise';
  /** Animation durations for layer 1 / layer 2, seconds. */
  dur: [number, number];
  /**
   * Particle colors for layer 1 / layer 2. Literal rgba strings, or
   * `{ slot, a }` meaning hexA(slots[slot], a) resolved against the active palette.
   */
  colors: [AmbienceColor, AmbienceColor];
  /** Layer opacities. */
  op: [number, number];
  /** Particle dot size (w×h px). Cyberpunk uses tall streaks (rain). */
  dot: [number, number];
}

export type AmbienceColor = string | { slot: 0 | 1 | 2 | 3 | 4 | 5; a: number };

export interface LiquidNeonPreset {
  key: LiquidNeonPresetKey;
  name: string;
  /** Six slot colors A–F. */
  c: [string, string, string, string, string, string];
  /** Idle border animation applied to panel-border overlays when animGlow is on. */
  idleAnim: string;
  /** Two-layer ambience; `custom` set has none. */
  ambience: AmbienceLayerSpec;
}

export const LIQUID_NEON_PRESETS: Record<LiquidNeonPresetKey, LiquidNeonPreset> = {
  classic: {
    key: 'classic', name: 'Neon Classic',
    c: ['#00f0ff', '#9b5fff', '#ff4dff', '#ff9a3d', '#2fe6c8', '#3d9bff'],
    idleAnim: 'lnBreathe 4.6s ease-in-out',
    ambience: { anim: 'lnRise', dur: [46, 70], colors: ['rgba(255,255,255,.75)', { slot: 1, a: 0.5 }], op: [0.4, 0.28], dot: [1.8, 1.8] },
  },
  aurora: {
    key: 'aurora', name: 'Aurora',
    c: ['#34ffc8', '#00d4ff', '#a78bfa', '#ffd97a', '#5f8bff', '#8ad9ff'],
    idleAnim: 'lnHueSoft 9s linear',
    ambience: { anim: 'lnRise', dur: [40, 64], colors: [{ slot: 0, a: 0.55 }, { slot: 1, a: 0.45 }], op: [0.42, 0.3], dot: [2, 2] },
  },
  cyber: {
    key: 'cyber', name: 'Cyberpunk',
    c: ['#ff2d95', '#ffd319', '#00e5ff', '#b4ff39', '#8a5cff', '#ff6b4d'],
    idleAnim: 'lnFlicker 3.4s steps(1,end)',
    ambience: { anim: 'lnSnow', dur: [7, 11], colors: [{ slot: 0, a: 0.55 }, { slot: 2, a: 0.45 }], op: [0.35, 0.25], dot: [1.4, 15] },
  },
  sunset: {
    key: 'sunset', name: 'Sunset Coast',
    c: ['#ff9a3d', '#ff4d88', '#b06bff', '#ffd319', '#ff6b4d', '#ffe680'],
    idleAnim: 'lnBreathe 6.5s ease-in-out',
    ambience: { anim: 'lnRise', dur: [26, 40], colors: [{ slot: 3, a: 0.6 }, { slot: 0, a: 0.5 }], op: [0.45, 0.3], dot: [2, 2.4] },
  },
  ice: {
    key: 'ice', name: 'Ice Mono',
    c: ['#7ae7ff', '#00c8f0', '#3d9bff', '#9fd0ff', '#5f7dff', '#c9e6ff'],
    idleAnim: 'lnShimmer 5.5s ease-in-out',
    ambience: { anim: 'lnSnow', dur: [22, 34], colors: ['rgba(255,255,255,.8)', 'rgba(200,230,255,.6)'], op: [0.5, 0.35], dot: [1.8, 1.8] },
  },
  ember: {
    key: 'ember', name: 'Emberfall',
    c: ['#ff6b4d', '#ffd319', '#ff2d95', '#ff9a3d', '#b06bff', '#ffe680'],
    idleAnim: 'lnFlicker 4.6s steps(1,end)',
    ambience: { anim: 'lnRise', dur: [16, 26], colors: [{ slot: 1, a: 0.6 }, { slot: 3, a: 0.55 }], op: [0.5, 0.35], dot: [1.8, 2.6] },
  },
  verdant: {
    key: 'verdant', name: 'Verdant Reach',
    c: ['#a3ff57', '#2fe6c8', '#00d4ff', '#ffd97a', '#57ff9a', '#8ad9ff'],
    idleAnim: 'lnHueSoft 7.5s linear',
    ambience: { anim: 'lnRise', dur: [34, 52], colors: [{ slot: 0, a: 0.55 }, { slot: 4, a: 0.4 }], op: [0.4, 0.3], dot: [2, 2] },
  },
  royal: {
    key: 'royal', name: 'Royal Arcana',
    c: ['#c86bff', '#7a5cff', '#ff4dff', '#ffd319', '#5f8bff', '#ff9ad5'],
    idleAnim: 'lnBreathe 5.2s ease-in-out',
    ambience: { anim: 'lnSnow', dur: [30, 48], colors: [{ slot: 2, a: 0.5 }, 'rgba(255,255,255,.7)'], op: [0.4, 0.28], dot: [1.6, 1.6] },
  },
  noir: {
    key: 'noir', name: 'Noir Rose',
    c: ['#ff5f8f', '#8a9bff', '#ffd319', '#ff9a3d', '#5fffe0', '#c86bff'],
    idleAnim: 'lnPulse 4.4s ease-in-out',
    ambience: { anim: 'lnSnow', dur: [36, 56], colors: [{ slot: 0, a: 0.45 }, { slot: 1, a: 0.38 }], op: [0.35, 0.25], dot: [1.5, 1.5] },
  },
  winter: {
    key: 'winter', name: 'Winterlight',
    c: ['#eaf6ff', '#9fd4ff', '#6fa8ff', '#cfeaff', '#8fc0f0', '#dff0ff'],
    idleAnim: 'lnShimmer 7s ease-in-out',
    ambience: { anim: 'lnSnow', dur: [14, 24], colors: ['rgba(255,255,255,.9)', 'rgba(230,244,255,.8)'], op: [0.8, 0.55], dot: [2.2, 2.2] },
  },
};

/** Idle border animation for user-edited palettes (`custom` set; no ambience). */
export const CUSTOM_SET_IDLE_ANIM = 'lnBreathe 5s ease-in-out';

/** Slot role descriptions, shown in the Appearance settings (prototype 2885). */
export const LIQUID_NEON_SLOT_ROLES = [
  'Left panel · primary accent',
  'Center panel · wiki-links',
  'Right panel · agents',
  'Warm data · ideas & items',
  'Cool data · systems',
  'Nav rail · timeline · frame',
] as const;

/** Curated swatch strip offered per slot (prototype 2886). */
export const LIQUID_NEON_SWATCHES = [
  '#00f0ff', '#34ffc8', '#3d9bff', '#9b5fff', '#c86bff', '#ff4dff',
  '#ff2d95', '#ff6b4d', '#ffd319', '#a3ff57', '#eaf2ff',
] as const;
