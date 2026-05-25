/**
 * Liquid Glass Dark Neon — Softness ↔ Contrast axis (MYT-518).
 *
 * One continuous control blends the whole dark theme along a single axis
 * `s ∈ [0,1]`: 0 = Softer (lighter, blue-tinted glass, more blur, gentler
 * neon — the `Word example 2` look), 1 = Sharper (darker base, more
 * transparent panels, tighter blur, crisper neon — the `agent chat box
 * example1` look). See MYT-520 §4.
 *
 * How it composes (the important part):
 *   This module never sets the *public* design tokens directly. It writes a
 *   set of `--axis-*` SOURCE variables into an injected <style> element, and
 *   `tokens.css` derives the public tokens from them (e.g.
 *   `--glass-fill: rgba(255,255,255, var(--axis-glass-alpha, …))`). That way
 *   the discrete WCAG high-contrast overlay (`[data-contrast="high"]`) and the
 *   `prefers-contrast` / `prefers-reduced-transparency` media queries in
 *   tokens.css — all of which override the *public* tokens — keep winning by
 *   normal cascade. The slider COMPOSES WITH those modes, it never overrides
 *   them (MYT-520 §5.2 / §4.4).
 */

/** Axis bounds and the board default (leaning soft — MYT-520 §4.5). */
export const THEME_AXIS_MIN = 0;
export const THEME_AXIS_MAX = 1;
export const THEME_AXIS_DEFAULT = 0.4;

/** When the OS asks for more contrast, the axis can't go softer than this. */
export const THEME_AXIS_OS_HC_MIN = 0.6;

/** Orientation ticks at the two reference looks (visual only, not steps). */
export const THEME_AXIS_SNAP_SOFT = 0.25;
export const THEME_AXIS_SNAP_SHARP = 0.8;

/** Hard body-text contrast floor; the guard targets a 0.1 buffer above it. */
export const CONTRAST_FLOOR = 4.5;
export const CONTRAST_GUARD_TARGET = 4.6;

const STYLE_ELEMENT_ID = 'mythos-theme-axis';

type Rgb = readonly [number, number, number];

// ── §4.2 endpoints: soft (s=0) → sharp (s=1) ──────────────────────────────
const AXIS = {
  bgBase: { soft: '#141B26', sharp: '#0B0E13' },
  vignetteStart: { soft: '#1A2230', sharp: '#11161F' },
  glassFallback: { soft: '#222A36', sharp: '#15191F' },
  textBody: { soft: '#C9DCEC', sharp: '#BFD6E8' },
  textHeader: { soft: '#EDECF6', sharp: '#FFFFFF' },
  glassAlpha: { soft: 0.13, sharp: 0.06 },
  glassRimAlpha: { soft: 0.1, sharp: 0.16 },
  neonIntensity: { soft: 0.5, sharp: 1.0 },
  blurPanel: { soft: 40, sharp: 18 },
  glowMdBlur: { soft: 34, sharp: 24 },
} as const;

// ── colour + WCAG helpers ─────────────────────────────────────────────────
function parseHex(hex: string): Rgb {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function toHex(rgb: Rgb): string {
  return (
    '#' +
    rgb
      .map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0'))
      .join('')
  );
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpColor(from: string, to: string, t: number): Rgb {
  const a = parseHex(from);
  const b = parseHex(to);
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

/** WCAG 2.x relative luminance of an sRGB colour. */
export function relativeLuminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((c) => {
    const cs = c / 255;
    return cs <= 0.03928 ? cs / 12.92 : ((cs + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two sRGB colours (order-independent). */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

function scaleRgb(rgb: Rgb, factor: number): Rgb {
  return [rgb[0] * factor, rgb[1] * factor, rgb[2] * factor];
}

/** Clamp an axis value to [0,1]; under OS increased-contrast, floor at 0.6. */
export function clampAxis(s: number, opts?: { osHighContrast?: boolean }): number {
  const min = opts?.osHighContrast ? THEME_AXIS_OS_HC_MIN : THEME_AXIS_MIN;
  if (!Number.isFinite(s)) return Math.max(THEME_AXIS_DEFAULT, min);
  return Math.min(THEME_AXIS_MAX, Math.max(min, s));
}

/** Coerce any persisted/garbage value into a valid axis position. */
export function normalizeAxis(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return THEME_AXIS_DEFAULT;
  return clampAxis(n);
}

export interface AxisTokens {
  /** Effective axis value after clamping. */
  s: number;
  /** Resolved CSS custom-property values (the `--axis-*` source set). */
  vars: Record<string, string>;
  /**
   * Worst-case body-text contrast at this position: `--text-body` over the
   * opaque `--glass-fill-fallback` (the deterministic background — MYT-520
   * §4.4). Always ≥ {@link CONTRAST_GUARD_TARGET} after the guard.
   */
  bodyContrast: number;
}

/**
 * Compute the interpolated axis tokens for position `s`, applying the §4.4
 * runtime contrast guard. Pure — does not touch the DOM.
 */
export function computeAxisTokens(s: number, opts?: { osHighContrast?: boolean }): AxisTokens {
  const clamped = clampAxis(s, opts);

  let bgBase = lerpColor(AXIS.bgBase.soft, AXIS.bgBase.sharp, clamped);
  const vignetteStart = lerpColor(AXIS.vignetteStart.soft, AXIS.vignetteStart.sharp, clamped);
  let glassFallback = lerpColor(AXIS.glassFallback.soft, AXIS.glassFallback.sharp, clamped);
  const textBody = lerpColor(AXIS.textBody.soft, AXIS.textBody.sharp, clamped);
  const textHeader = lerpColor(AXIS.textHeader.soft, AXIS.textHeader.sharp, clamped);

  const glassAlpha = lerp(AXIS.glassAlpha.soft, AXIS.glassAlpha.sharp, clamped);
  const glassRimAlpha = lerp(AXIS.glassRimAlpha.soft, AXIS.glassRimAlpha.sharp, clamped);
  const neonIntensity = lerp(AXIS.neonIntensity.soft, AXIS.neonIntensity.sharp, clamped);
  const blurPanel = lerp(AXIS.blurPanel.soft, AXIS.blurPanel.sharp, clamped);
  const glowMdBlur = lerp(AXIS.glowMdBlur.soft, AXIS.glowMdBlur.sharp, clamped);

  // §4.4 runtime guard: the endpoints are pre-verified (~8.5:1 at the softest
  // panel), but darken the fallback (and the base under it) by the minimal
  // step needed to keep body text ≥ 4.6:1 before paint. A safety net, not the
  // primary mechanism.
  let guardSteps = 0;
  while (contrastRatio(textBody, glassFallback) < CONTRAST_GUARD_TARGET && guardSteps < 64) {
    glassFallback = scaleRgb(glassFallback, 0.97);
    bgBase = scaleRgb(bgBase, 0.97);
    guardSteps += 1;
  }

  const round3 = (n: number) => Math.round(n * 1000) / 1000;

  return {
    s: clamped,
    bodyContrast: contrastRatio(textBody, glassFallback),
    vars: {
      '--axis-bg-base': toHex(bgBase),
      '--axis-vignette-start': toHex(vignetteStart),
      '--axis-glass-fallback': toHex(glassFallback),
      '--axis-text-body': toHex(textBody),
      '--axis-text-header': toHex(textHeader),
      '--axis-glass-alpha': String(round3(glassAlpha)),
      '--axis-glass-rim-alpha': String(round3(glassRimAlpha)),
      '--axis-neon-intensity': String(round3(neonIntensity)),
      '--axis-blur-panel': `${Math.round(blurPanel)}px`,
      '--axis-glow-md-blur': `${Math.round(glowMdBlur)}px`,
    },
  };
}

/** True if the OS is currently requesting increased contrast. */
export function osWantsHighContrast(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return (
    window.matchMedia('(prefers-contrast: more)').matches ||
    window.matchMedia('(forced-colors: active)').matches
  );
}

/**
 * Apply the axis at position `s` to the document by writing the `--axis-*`
 * source variables into an injected <style> element. Idempotent; safe to call
 * on every drag tick and on app load. Returns the resolved tokens (incl. the
 * measured body contrast, for the §9 acceptance evidence).
 */
export function applyThemeAxis(s: number, opts?: { osHighContrast?: boolean }): AxisTokens {
  const osHighContrast = opts?.osHighContrast ?? osWantsHighContrast();
  const tokens = computeAxisTokens(s, { osHighContrast });

  if (typeof document === 'undefined') return tokens;

  const declarations = Object.entries(tokens.vars)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join('\n');
  const css = `:root {\n${declarations}\n}`;

  let style = document.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ELEMENT_ID;
    document.head.appendChild(style);
  }
  style.textContent = css;

  return tokens;
}
