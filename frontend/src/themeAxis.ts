/**
 * themeAxis.ts — Softness↔Contrast axis for Liquid Neon phase-2 (MYT-518)
 *
 * Maps a single 0–100 slider value to coordinated blur/opacity/contrast
 * CSS token overrides. Also provides runtime contrast-floor measurement
 * against WCAG 2.1 AA thresholds.
 */

/** Preset names for the three named points on the axis */
export type ContrastPreset = 'soft' | 'default' | 'sharp';

/** Per-axis token values derived from a slider position (0 = soft, 100 = sharp) */
export interface AxisTokens {
  /** backdrop-filter blur in px */
  blur: number;
  /** glass fill opacity multiplier (0–1) */
  glass: number;
  /** neon glow intensity (0–1) */
  neon: number;
}

/** Minimum WCAG 2.1 AA contrast ratio for normal text */
const WCAG_AA_NORMAL = 4.5;
/** Minimum WCAG 2.1 AA contrast ratio for large/bold text */
const WCAG_AA_LARGE = 3.0;

/** Named axis presets */
export const AXIS_PRESETS: Record<ContrastPreset, AxisTokens> = {
  soft: { blur: 24, glass: 0.58, neon: 0.6 },
  default: { blur: 16, glass: 0.72, neon: 0.5 },
  sharp: { blur: 8, glass: 0.90, neon: 0.35 },
};

/** Interpolate axis tokens for any position 0–100 */
export function resolveAxisTokens(position: number): AxisTokens {
  const t = Math.max(0, Math.min(100, position)) / 100;

  if (t <= 0.5) {
    // Soft → Default
    const u = t / 0.5;
    return lerp(AXIS_PRESETS.soft, AXIS_PRESETS.default, u);
  } else {
    // Default → Sharp
    const u = (t - 0.5) / 0.5;
    return lerp(AXIS_PRESETS.default, AXIS_PRESETS.sharp, u);
  }
}

function lerp(a: AxisTokens, b: AxisTokens, t: number): AxisTokens {
  return {
    blur: a.blur + (b.blur - a.blur) * t,
    glass: a.glass + (b.glass - a.glass) * t,
    neon: a.neon + (b.neon - a.neon) * t,
  };
}

/** Apply axis tokens to the document root CSS vars */
export function applyAxisTokens(tokens: AxisTokens): void {
  const root = document.documentElement;
  root.style.setProperty('--lg-blur', `${Math.round(tokens.blur)}px`);
  root.style.setProperty('--lg-glass', String(tokens.glass));
  root.style.setProperty(
    '--glass-fill',
    `rgba(14, 14, 18, ${tokens.glass.toFixed(2)})`,
  );
  root.style.setProperty('--lg-neon', String(tokens.neon));
}

/** Relative luminance per WCAG 2.1 §1.4.3 */
function relativeLuminance(r: number, g: number, b: number): number {
  const srgb = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
}

/** Parse a CSS rgb/rgba colour string → [r, g, b] (0–255) */
function parseRgb(colour: string): [number, number, number] | null {
  const m = colour.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return null;
  return [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])];
}

/** Parse a CSS hex colour string (#rgb or #rrggbb) → [r, g, b] (0–255) */
function parseHex(colour: string): [number, number, number] | null {
  const h = colour.trim().replace(/^#/, '');
  if (h.length === 6) {
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  if (h.length === 3) {
    return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)];
  }
  return null;
}

/** Parse a CSS colour string (rgb/rgba or #hex) → [r, g, b] (0–255) */
function parseColor(colour: string): [number, number, number] | null {
  return parseRgb(colour) ?? parseHex(colour);
}

/** Alpha-composite fg RGB at fgAlpha over an opaque canvas RGB → solid [r, g, b] */
function compositeOver(
  fg: [number, number, number],
  fgAlpha: number,
  canvas: [number, number, number],
): [number, number, number] {
  return [
    Math.round(fgAlpha * fg[0] + (1 - fgAlpha) * canvas[0]),
    Math.round(fgAlpha * fg[1] + (1 - fgAlpha) * canvas[1]),
    Math.round(fgAlpha * fg[2] + (1 - fgAlpha) * canvas[2]),
  ];
}

/** Compute WCAG contrast ratio between two resolved CSS colour strings */
export function contrastRatio(fg: string, bg: string): number {
  const fgRgb = parseRgb(fg);
  const bgRgb = parseRgb(bg);
  if (!fgRgb || !bgRgb) return 0;
  const L1 = relativeLuminance(...fgRgb);
  const L2 = relativeLuminance(...bgRgb);
  const lighter = Math.max(L1, L2);
  const darker = Math.min(L1, L2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Contrast floor readings at the three named presets */
export interface ContrastFloors {
  soft: number;
  default: number;
  sharp: number;
}

/** Read resolved text/panel colours and measure contrast at each preset */
export function readContrastFloors(): ContrastFloors {
  const root = document.documentElement;
  const cs = getComputedStyle(root);
  const textHeader = cs.getPropertyValue('--text-header').trim() || '#edecf6';
  const textBody = cs.getPropertyValue('--text-body').trim() || '#bfd6e8';

  // Canvas background for compositing; fall back to --bg-base default
  const canvasStr = cs.getPropertyValue('--bg-base').trim() || '#0e1116';
  const canvasRgb = parseColor(canvasStr) ?? [14, 17, 22];

  // Glass fill base colour — matches applyAxisTokens's rgba(14, 14, 18, glass)
  const glassFill: [number, number, number] = [14, 14, 18];

  function measureAt(preset: ContrastPreset): number {
    const tokens = AXIS_PRESETS[preset];
    // Composite the semi-transparent glass fill over the canvas to get the actual
    // visible panel colour — each preset's distinct alpha produces a distinct RGB.
    const panelRgb = compositeOver(glassFill, tokens.glass, canvasRgb);
    const panelSolid = `rgb(${panelRgb[0]}, ${panelRgb[1]}, ${panelRgb[2]})`;
    // Convert text tokens (may be hex) to rgb() strings for contrastRatio
    const fgH = parseColor(textHeader);
    const fgB = parseColor(textBody);
    if (!fgH || !fgB) return 0;
    const r1 = contrastRatio(`rgb(${fgH[0]}, ${fgH[1]}, ${fgH[2]})`, panelSolid);
    const r2 = contrastRatio(`rgb(${fgB[0]}, ${fgB[1]}, ${fgB[2]})`, panelSolid);
    return Math.min(r1, r2);
  }

  return {
    soft: measureAt('soft'),
    default: measureAt('default'),
    sharp: measureAt('sharp'),
  };
}

/** True if all three floors clear WCAG AA for normal text */
export function allFloorsPass(floors: ContrastFloors): boolean {
  return (
    floors.soft >= WCAG_AA_NORMAL &&
    floors.default >= WCAG_AA_NORMAL &&
    floors.sharp >= WCAG_AA_NORMAL
  );
}

export { WCAG_AA_NORMAL, WCAG_AA_LARGE };
