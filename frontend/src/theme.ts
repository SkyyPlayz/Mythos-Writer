
/** The only theme modes the app supports. */
export type ThemeMode = 'dark' | 'high-contrast';

const VALID_MODES: readonly ThemeMode[] = ['dark', 'high-contrast'];

/**
 * Coerce any persisted/legacy value into a valid {@link ThemeMode}.
 * Old installs may still have `'light'` or `'system'` stored — both collapse
 * to `'dark'` since light/system no longer exist.
 */
export function normalizeTheme(value: unknown): ThemeMode {
  return value === 'high-contrast' ? 'high-contrast' : 'dark';
}

/**
 * Apply a theme to the document. Idempotent and safe to call on every settings
 * save and on app load.
 *
 * - `data-theme` is always `"dark"` (single theme; present for CSS hooks/tests).
 * - `data-contrast` is `"high"` only for the accessibility theme; absent
 *   otherwise so the `[data-contrast="high"]` overlay in tokens.css applies.
 */
export function applyTheme(mode: ThemeMode | string | null | undefined): ThemeMode {
  const resolved = normalizeTheme(mode);
  if (typeof document === 'undefined') return resolved;

  const root = document.documentElement;
  root.setAttribute('data-theme', 'dark');

  if (resolved === 'high-contrast') {
    root.setAttribute('data-contrast', 'high');
  } else {
    root.removeAttribute('data-contrast');
  }

  return resolved;
}

export const LG_DEFAULTS: LiquidNeonPrefs = {
  background: 'default',
  style: 50,
  glass: 50,
  blur: 40,
  neon: 50,
  neonAccent: 'cyan',
  softness: 50,
};


export { VALID_MODES as THEME_MODES };

// ─── Contrast guard (MYT-716) ────────────────────────────────────────────────

/**
 * Compute WCAG relative luminance for a hex colour string (#rrggbb or #rgb).
 * Returns a value in [0, 1]. Returns 0 for unparseable input.
 */
export function relativeLuminance(hex: string): number {
  const h = hex.replace('#', '');
  const full = h.length === 3
    ? h.split('').map((c) => c + c).join('')
    : h;
  if (full.length !== 6) return 0;

  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;

  const lin = (c: number) => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * WCAG contrast ratio between two hex colours.
 * Returns a value ≥ 1.0.
 */
export function contrastRatio(fg: string, bg: string): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Lighten a hex colour until it achieves `minRatio` against `bgHex`.
 * Increments lightness in HSL space 1% at a time, up to pure white.
 * Returns the original colour if it already passes, or if bgHex is unparseable.
 */
export function enforceContrastFloor(textHex: string, bgHex: string, minRatio = 4.5): string {
  if (contrastRatio(textHex, bgHex) >= minRatio) return textHex;

  const h = textHex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  if (full.length !== 6) return textHex;

  let r = parseInt(full.slice(0, 2), 16);
  let g = parseInt(full.slice(2, 4), 16);
  let b = parseInt(full.slice(4, 6), 16);

  for (let step = 0; step < 100; step++) {
    r = Math.min(255, r + 3);
    g = Math.min(255, g + 3);
    b = Math.min(255, b + 3);
    const candidate = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    if (contrastRatio(candidate, bgHex) >= minRatio) return candidate;
  }

  return '#ffffff';
}

// ─── Liquid Neon token customization (MYT-613 / MYT-716) ────────────────────

export const LIQUID_NEON_DEFAULTS: LiquidNeonPrefs = {
  softnessContrast: 0.4,
  glass: 0.4,
  blur: 0.4,
  neonIntensity: 0.4,
  neonAccent: 'cyan',
  style: 50,
  neon: 50,
  textHeader: '#edecf6',
  textBody: '#bfd6e8',
  textMuted: '#8a9bb0',
  background: 'default',
  // Advanced defaults (MYT-716)
  advancedDecoupled: false,
  textContrast: 50,
  borderStrength: 50,
  bgMode: 'color',
  bgFit: 'cover',
  bgPosition: 'center',
  bgScrim: 40,
  bgVignette: 40,
  bgBaseColor: '#0e1116',
  accentColor: '#00f0ff',
  neonBorderColor: 'cyan',
  neonBorderColor2: 'violet',
  neonBorderColor3: 'magenta',
};

/** CSS multi-gradient approximating the dark space/nebula aesthetic of the example art. */
export const DEFAULT_BG_GRADIENT =
  'radial-gradient(ellipse at 68% 32%, rgba(100,20,200,0.38) 0%, transparent 55%), ' +
  'radial-gradient(ellipse at 22% 72%, rgba(0,160,225,0.22) 0%, transparent 55%), ' +
  'radial-gradient(ellipse at 85% 82%, rgba(190,0,190,0.16) 0%, transparent 45%), ' +
  'radial-gradient(ellipse at 10% 15%, rgba(55,10,110,0.28) 0%, transparent 42%), ' +
  '#08091a';

const NEON_ACCENT_MAP: Record<LiquidNeonPrefs['neonAccent'], { accent: string; accentSoft: string }> = {
  cyan:    { accent: '#00f0ff', accentSoft: 'rgba(0,240,255,0.18)' },
  violet:  { accent: '#9b5fff', accentSoft: 'rgba(155,95,255,0.18)' },
  magenta: { accent: '#ff4dff', accentSoft: 'rgba(255,77,255,0.18)' },
};

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

function toHex2(n: number): string {
  return Math.round(n).toString(16).padStart(2, '0');
}

/**
 * Apply Liquid Neon customization tokens to :root inline styles.
 * Safe to call with a partial — missing keys fall back to LIQUID_NEON_DEFAULTS.
 * Pass `null` or `undefined` to reset all overrides to defaults.
 */
export function applyLiquidNeonTokens(
  prefs: Partial<LiquidNeonPrefs> | null | undefined,
  bgDataUrl?: string | null,
): void {
  if (typeof document === 'undefined') return;

  const p: LiquidNeonPrefs = { ...LIQUID_NEON_DEFAULTS, ...prefs };
  const root = document.documentElement;

  // Glass fill alpha: glass=0 → lighter (more transparent), glass=1 → darker (more opaque).
  // SKY-11068: same dark base as the v2 bridge (liquidNeonEngine panelGlassTokens) and
  // tokens.css — a white-family fill here read as a milky film whenever v1 was the last
  // writer (v1-only call sites, or the v1/v2 async wallpaper race on vault load).
  // Default glass=0.4 lands at 0.71, matching the prototype rail's rgba(13,16,28,.72).
  const glassAlpha = lerp(0.55, 0.95, p.glass);
  root.style.setProperty('--glass-fill', `rgba(13,16,28,${glassAlpha.toFixed(3)})`);

  // Glass fill fallback for no-backdrop-filter (opaque interpolation)
  const fbR = Math.round(lerp(0x25, 0x0e, p.glass));
  const fbG = Math.round(lerp(0x2d, 0x11, p.glass));
  const fbB = Math.round(lerp(0x3a, 0x16, p.glass));
  root.style.setProperty('--glass-fill-fallback', `#${toHex2(fbR)}${toHex2(fbG)}${toHex2(fbB)}`);

  // Blur: blur=0 → max blur (40px), blur=1 → min blur (12px)
  root.style.setProperty('--blur-panel',   `${Math.round(lerp(40, 12, p.blur))}px`);
  root.style.setProperty('--blur-overlay', `${Math.round(lerp(44, 16, p.blur))}px`);
  root.style.setProperty('--blur-chip',    `${Math.round(lerp(24, 8,  p.blur))}px`);

  // Neon intensity: neonIntensity=0 → strong (1.0), neonIntensity=1 → soft (0.25)
  const intensity = lerp(1.0, 0.25, p.neonIntensity ?? LIQUID_NEON_DEFAULTS.neonIntensity!);
  root.style.setProperty('--neon-intensity', intensity.toFixed(3));

  // Neon accent
  const accentDef = NEON_ACCENT_MAP[p.neonAccent] ?? NEON_ACCENT_MAP.cyan;
  root.style.setProperty('--accent', accentDef.accent);
  root.style.setProperty('--accent-soft', accentDef.accentSoft);
  root.style.setProperty('--focus-ring', accentDef.accent);
  root.style.setProperty('--color-accent', accentDef.accent);

  // Text colors (enforce contrast floor ≥ 4.5:1)
  const effectiveBg = p.bgBaseColor ?? LIQUID_NEON_DEFAULTS.bgBaseColor!;
  const safeHeader = enforceContrastFloor(p.textHeader ?? LIQUID_NEON_DEFAULTS.textHeader!, effectiveBg);
  const safeBody   = enforceContrastFloor(p.textBody   ?? LIQUID_NEON_DEFAULTS.textBody!,   effectiveBg);
  const safeMuted  = enforceContrastFloor(p.textMuted  ?? LIQUID_NEON_DEFAULTS.textMuted!,  effectiveBg);

  root.style.setProperty('--text-header',  safeHeader);
  root.style.setProperty('--text-body',    safeBody);
  root.style.setProperty('--text-muted',   safeMuted);
  root.style.setProperty('--text-faint',   safeMuted);
  root.style.setProperty('--text-primary', safeHeader);
  root.style.setProperty('--text-secondary', safeBody);
  root.style.setProperty('--text-tertiary', safeMuted);

  // Accent color override (MYT-716)
  if (p.accentColor) {
    root.style.setProperty('--accent', p.accentColor);
    root.style.setProperty('--focus-ring', p.accentColor);
    root.style.setProperty('--color-accent', p.accentColor);
    root.style.setProperty('--accent-soft', hexToRgba(p.accentColor, 0.18));
  }

  // Neon color customization (SKY-127) — user-configurable RGB values for the
  // base accent palette. These resolve before we compute border slots so the
  // three border slots pick up custom hex values when a user has changed them.
  if (p.neonColorCyan) root.style.setProperty('--neon-cyan', p.neonColorCyan);
  if (p.neonColorViolet) root.style.setProperty('--neon-violet', p.neonColorViolet);
  if (p.neonColorMagenta) root.style.setProperty('--neon-magenta', p.neonColorMagenta);

  // Neon border colour slots (SKY-910 — three-stop configurable gradient).
  // Each slot picks one of cyan/violet/magenta; the picked colour resolves
  // through the user-customised palette set just above. Slot A also drives
  // the solid 2px outline that --border-neon-default composes over the
  // gradient (back-compat with the previous single-slot behaviour).
  const palette: Record<LiquidNeonPrefs['neonAccent'], string> = {
    cyan:    p.neonColorCyan    ?? NEON_ACCENT_MAP.cyan.accent,
    violet:  p.neonColorViolet  ?? NEON_ACCENT_MAP.violet.accent,
    magenta: p.neonColorMagenta ?? NEON_ACCENT_MAP.magenta.accent,
  };
  const slotA = palette[p.neonBorderColor  ?? LIQUID_NEON_DEFAULTS.neonBorderColor!];
  const slotB = palette[p.neonBorderColor2 ?? LIQUID_NEON_DEFAULTS.neonBorderColor2!];
  const slotC = palette[p.neonBorderColor3 ?? LIQUID_NEON_DEFAULTS.neonBorderColor3!];
  root.style.setProperty('--neon-border-1', slotA);
  root.style.setProperty('--neon-border-2', slotB);
  root.style.setProperty('--neon-border-3', slotC);
  root.style.setProperty(
    '--grad-neon',
    `linear-gradient(120deg, ${slotA} 0%, ${slotB} 50%, ${slotC} 100%)`,
  );
  root.style.setProperty(
    '--grad-neon-soft',
    `linear-gradient(120deg, ${hexToRgba(slotA, 0.6)} 0%, ${hexToRgba(slotB, 0.6)} 50%, ${hexToRgba(slotC, 0.6)} 100%)`,
  );
  // Solid outline colour composed over the gradient (matches pre-SKY-910 behaviour).
  root.style.setProperty('--border-neon-outline', slotA);

  // Beta 4 M1: the "Neon frame" slider (neonFrameWidth) is deleted with the
  // window frame ring — --frame-width-rest/hover stay at their tokens.css
  // defaults (they also size shared Button borders).

  // Border strength: 0–100 → alpha 0.06–0.24
  if (p.borderStrength !== undefined) {
    const t = p.borderStrength / 100;
    const alpha = lerp(0.06, 0.24, t);
    root.style.setProperty('--border-default', `rgba(255,255,255,${alpha.toFixed(3)})`);
    root.style.setProperty('--border-strong',  `rgba(255,255,255,${(alpha * 1.6).toFixed(3)})`);
  }

  // Background base color
  if (p.bgBaseColor) {
    root.style.setProperty('--bg-base', p.bgBaseColor);
    root.style.setProperty('--bg-canvas', p.bgBaseColor);
    root.style.setProperty('--bg-app', p.bgBaseColor);
  }

  // Background image + layout tokens
  if (p.bgMode === 'image') {
    // Always update scrim and layout tokens in image mode, regardless of whether
    // bgDataUrl is present. bgDataUrl may be null during async load in SettingsPanel
    // (loaded via loadBgImage after mount); the --bg-app-image CSS var was already set
    // by the startup call and must not be overwritten here when the URL is unavailable.
    const scrimAlpha = lerp(0.20, 0.85, (p.bgScrim ?? 40) / 100);
    root.style.setProperty('--bg-scrim-alpha', scrimAlpha.toFixed(3));
    const fit = p.bgFit ?? 'cover';
    root.style.setProperty('--bg-image-size',   fit === 'tile' ? 'auto' : fit);
    root.style.setProperty('--bg-image-repeat',  fit === 'tile' ? 'repeat' : 'no-repeat');
    root.style.setProperty('--bg-image-position', p.bgPosition ?? 'center');
    if (bgDataUrl) {
      root.style.setProperty('--bg-app-image', `url("${bgDataUrl}")`);
    }
  } else if (p.bgMode === 'color') {
    root.style.setProperty('--bg-app-image', DEFAULT_BG_GRADIENT);
    root.style.setProperty('--bg-scrim-alpha', '0');
  } else if (p.background === 'default') {
    root.style.setProperty('--bg-app-image', DEFAULT_BG_GRADIENT);
    root.style.setProperty('--bg-scrim-alpha', '0');
  } else {
    // SKY-3219 / GH#612: legacy settings stored a file path in background but
    // never persisted bgMode.  Apply bgDataUrl if available; otherwise preserve
    // the existing --bg-app-image so Save never resets the background.
    if (bgDataUrl) {
      root.style.setProperty('--bg-app-image', `url("${bgDataUrl}")`);
    }
  }

  // Vignette: 0–100 → 0–0.9
  if (p.bgVignette !== undefined) {
    root.style.setProperty('--bg-vignette-alpha', lerp(0, 0.9, p.bgVignette / 100).toFixed(3));
  }
}

/** Convert a hex colour to rgba(r, g, b, alpha) string. */
function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  if (full.length !== 6) return `rgba(0,240,255,${alpha})`;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ─── Page Background (SKY-2097) ──────────────────────────────────────────────

/** Base RGB components for each page background preset. */
const PAGE_BG_PRESET_RGB: Record<PageBackgroundPreset, [number, number, number]> = {
  'liquid-neon': [14,  14,  18],   // dark glass panel (matches --glass-fill base)
  'minimal':     [14,  17,  22],   // near-invisible dark
  'paper':       [240, 228, 200],  // warm parchment
  'dark-slate':  [18,  22,  30],   // deep dark slate
};

/** Presets that support backdrop-filter glass blur. */
const GLASS_PRESETS = new Set<PageBackgroundPreset>(['liquid-neon']);

/** Glow accent RGB per preset — used for the panel box-shadow glow effect. */
const PAGE_BG_GLOW_RGB: Record<PageBackgroundPreset, [number, number, number]> = {
  'liquid-neon': [0,  240, 255], // neon cyan
  'minimal':     [0,    0,   0], // no glow
  'paper':       [0,    0,   0], // no glow
  'dark-slate':  [0,    0,   0], // no glow
};

export const PAGE_BACKGROUND_DEFAULTS: PageBackgroundSettings = {
  preset: 'liquid-neon',
  opacity: 65,
  blur: 12,
  glowIntensity: 60,
  applyToBothTabs: true,
};

/**
 * Compute a contrast ratio between the page-background panel color and the current text-body
 * token, at the given opacity blended over a reference dark canvas (#0b0e13).
 */
export function pageBackgroundContrastRatio(prefs: Partial<PageBackgroundSettings> | null | undefined): number {
  const p: PageBackgroundSettings = { ...PAGE_BACKGROUND_DEFAULTS, ...prefs };
  const [pr, pg, pb] = PAGE_BG_PRESET_RGB[p.preset] ?? PAGE_BG_PRESET_RGB['liquid-neon'];
  const alpha = p.opacity / 100;
  // Blend over dark canvas (#0b0e13 = 11,14,19)
  const canvasR = 11; const canvasG = 14; const canvasB = 19;
  const blendedR = Math.round(pr * alpha + canvasR * (1 - alpha));
  const blendedG = Math.round(pg * alpha + canvasG * (1 - alpha));
  const blendedB = Math.round(pb * alpha + canvasB * (1 - alpha));
  const bgHex = `#${blendedR.toString(16).padStart(2, '0')}${blendedG.toString(16).padStart(2, '0')}${blendedB.toString(16).padStart(2, '0')}`;
  // Compare against default body text color
  return contrastRatio('#bfd6e8', bgHex);
}

/**
 * Apply writing-surface panel CSS tokens to :root.
 * Safe to call with a partial; missing keys fall back to PAGE_BACKGROUND_DEFAULTS.
 */
export function applyPageBackgroundTokens(
  prefs: Partial<PageBackgroundSettings> | null | undefined,
): void {
  if (typeof document === 'undefined') return;
  const p: PageBackgroundSettings = { ...PAGE_BACKGROUND_DEFAULTS, ...prefs };
  const root = document.documentElement;

  const [r, g, b] = PAGE_BG_PRESET_RGB[p.preset] ?? PAGE_BG_PRESET_RGB['liquid-neon'];
  const opacityFrac = (p.opacity / 100).toFixed(3);

  root.style.setProperty('--page-bg-fill', `rgba(${r},${g},${b},${opacityFrac})`);
  root.style.setProperty('--page-bg-blur', `${p.blur}px`);
  root.style.setProperty('--page-bg-glow', (p.glowIntensity / 100).toFixed(3));
  root.setAttribute('data-page-preset', p.preset);

  // Computed glow shadow color — used directly in CSS box-shadow
  const [gr, gg, gb] = PAGE_BG_GLOW_RGB[p.preset] ?? PAGE_BG_GLOW_RGB['liquid-neon'];
  const glowAlpha = (p.glowIntensity / 100 * 0.3).toFixed(3);
  root.style.setProperty('--page-bg-glow-color', `rgba(${gr},${gg},${gb},${glowAlpha})`);

  // Glass backdrop-filter: only on glass presets.
  // W0.5 (PERFORMANCE §2): the page is the single persistent surface still
  // allowed a live backdrop-filter; --page-bg-backdrop-filter collapses to
  // `none` (no backdrop root at all) whenever it would be a no-op blur.
  if (GLASS_PRESETS.has(p.preset)) {
    root.style.setProperty('--page-bg-backdrop-blur', `${p.blur}px`);
    root.style.setProperty('--page-bg-backdrop-filter', p.blur > 0 ? `blur(${p.blur}px)` : 'none');
  } else {
    root.style.setProperty('--page-bg-backdrop-blur', '0px');
    root.style.setProperty('--page-bg-backdrop-filter', 'none');
  }
}

/**
 * Reset all page-background inline style overrides (back to tokens.css defaults).
 */
export function resetPageBackgroundTokens(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.style.removeProperty('--page-bg-fill');
  root.style.removeProperty('--page-bg-blur');
  root.style.removeProperty('--page-bg-glow');
  root.style.removeProperty('--page-bg-glow-color');
  root.style.removeProperty('--page-bg-backdrop-blur');
  root.style.removeProperty('--page-bg-backdrop-filter');
  root.removeAttribute('data-page-preset');
}



// ─── Story Page Chrome (SKY-3206) ────────────────────────────────────────────

export const STORY_PAGE_PRESET_WIDTHS: Record<string, number> = {
  letter: 680,
  a4: 720,
  a5: 510,
  manuscript: 640,
};

const STORY_PAGE_FONT_STACKS: Record<string, string> = {
  serif: "Georgia, 'Times New Roman', serif",
  sans: "system-ui, -apple-system, 'Segoe UI', sans-serif",
  mono: "'Courier New', Courier, monospace",
};

/** The four manuscript font choices on the row-5 format toolbar (M1). */
export type StoryFontName = 'Lora' | 'Georgia' | 'Palatino Linotype' | 'Inter';
export const STORY_FONT_NAMES: readonly StoryFontName[] = [
  'Lora',
  'Georgia',
  'Palatino Linotype',
  'Inter',
];

export interface StoryPagePrefs {
  sizePreset: 'letter' | 'a4' | 'a5' | 'manuscript' | 'custom';
  customWidthPx?: number;
  marginVertPx: number;
  marginHorizPx: number;
  fontFamily: 'serif' | 'sans' | 'mono';
  fontSizePx: number;
  lineHeight: number;
  // M1-S3 canonical page prefs (SKY-9013): the ONE pref set shared by the
  // format toolbar, the ruler diamond pairs, and PageSetupPopover. Optional so
  // maps persisted before S3 stay valid — read through the resolve* helpers.
  // The pre-S3 fields above only feed the legacy scene branch's CSS vars and
  // are deleted with that branch (M1-S4).
  pageWidthPx?: number;
  pageMarginPx?: number;
  fontName?: StoryFontName;
  /** The toolbar's "− 12 +" number; rendered px = step × 1.42 (prototype). */
  fontSizeStep?: number;
  lineHeightX?: number;
  /** SKY-11239: manuscript drop cap on the first paragraph. Default false. */
  dropCapEnabled?: boolean;
}

export const STORY_PAGE_DEFAULTS: StoryPagePrefs = {
  sizePreset: 'letter',
  marginVertPx: 48,
  marginHorizPx: 56,
  fontFamily: 'serif',
  fontSizePx: 16,
  lineHeight: 1.7,
  dropCapEnabled: false,
};

// M1 page geometry (plan §9.5 + prototype): centered page, default 1000px,
// margins stored as absolute px and carried unchanged when the page resizes.
export const PAGE_WIDTH_MIN = 520;
export const PAGE_WIDTH_MAX = 3000;
export const PAGE_WIDTH_DEFAULT = 1000;
export const PAGE_MARGIN_MIN = 12;
export const PAGE_MARGIN_DEFAULT = 84;
export const FONT_STEP_MIN = 9;
export const FONT_STEP_MAX = 18;
export const FONT_STEP_DEFAULT = 12;
export const LINE_HEIGHT_DEFAULT = 1.85;
/** Rendered page font px per font-size step (prototype fsize × 1.42). */
export const FONT_STEP_PX_RATIO = 1.42;

export const clampPageWidth = (w: number): number =>
  Math.max(PAGE_WIDTH_MIN, Math.min(PAGE_WIDTH_MAX, Math.round(w)));

/** Widest legal margin for a page width — keeps ≥120px of text column. */
export const maxPageMargin = (widthPx: number): number => Math.floor(widthPx / 2) - 60;

export const clampPageMargin = (m: number, widthPx: number): number =>
  Math.max(PAGE_MARGIN_MIN, Math.min(maxPageMargin(widthPx), Math.round(m)));

const clampFontStep = (s: number): number =>
  Math.max(FONT_STEP_MIN, Math.min(FONT_STEP_MAX, Math.round(s)));

const legacyEffectiveWidth = (p: StoryPagePrefs): number =>
  p.sizePreset === 'custom' && p.customWidthPx != null
    ? p.customWidthPx
    : (STORY_PAGE_PRESET_WIDTHS[p.sizePreset] ?? STORY_PAGE_PRESET_WIDTHS.letter);

export const resolvePageWidth = (p?: Partial<StoryPagePrefs> | null): number =>
  clampPageWidth(p?.pageWidthPx ?? PAGE_WIDTH_DEFAULT);

export const resolvePageMargin = (p?: Partial<StoryPagePrefs> | null): number =>
  clampPageMargin(p?.pageMarginPx ?? PAGE_MARGIN_DEFAULT, resolvePageWidth(p));

export const resolveFontName = (p?: Partial<StoryPagePrefs> | null): StoryFontName =>
  p?.fontName && (STORY_FONT_NAMES as readonly string[]).includes(p.fontName)
    ? p.fontName
    : 'Lora';

export const resolveFontStep = (p?: Partial<StoryPagePrefs> | null): number =>
  clampFontStep(p?.fontSizeStep ?? FONT_STEP_DEFAULT);

export const resolveLineHeight = (p?: Partial<StoryPagePrefs> | null): number =>
  p?.lineHeightX ?? LINE_HEIGHT_DEFAULT;

export const resolveDropCapEnabled = (p?: Partial<StoryPagePrefs> | null): boolean =>
  p?.dropCapEnabled ?? false;

/** CSS stack for a manuscript font name (prototype's font select). */
export function manuscriptFontStack(font: string): string {
  if (font === 'Inter') return "'Inter',sans-serif";
  if (font === 'Lora') return "'Lora',Georgia,serif";
  return "'" + font + "',Georgia,serif";
}

/**
 * Keep the canonical M1 fields and the legacy pre-S3 fields describing the
 * same page ("two controls, one pref, always in agreement" — plan §M1 row 6).
 * Canonical edits mirror down so the legacy scene branch tracks them until
 * S4 deletes it; legacy edits (PageRuler, the chrome strip) mirror up so the
 * unified shell tracks those too. Margins are clamped against the width last —
 * the locked-pair rule: a narrower page clamps the margin down, never the
 * reverse.
 */
export function normalizeStoryPagePrefs(
  next: StoryPagePrefs,
  prev?: StoryPagePrefs | null
): StoryPagePrefs {
  const p: StoryPagePrefs = { ...next };

  // dropCapEnabled (SKY-11239) needs no normalization step — it passes
  // through unchanged via the `{ ...next }` spread above.

  // Seeding rule: a map with no canonical fields (pre-S3, prev == null) takes
  // the unified editor's defaults — the legacy fields described the legacy
  // scene sheet, which is not the surface that survives M1. Legacy→canonical
  // mirroring applies only to observed edits (prev != null: PageRuler, the
  // chrome strip) so those controls keep working until S4 deletes them.
  const canonicalWidthEdited = p.pageWidthPx != null && p.pageWidthPx !== prev?.pageWidthPx;
  const legacyWidthEdited =
    prev != null &&
    (p.sizePreset !== prev.sizePreset || p.customWidthPx !== prev.customWidthPx);
  if (p.pageWidthPx == null) {
    p.pageWidthPx = prev != null ? clampPageWidth(legacyEffectiveWidth(p)) : PAGE_WIDTH_DEFAULT;
    p.sizePreset = 'custom';
    p.customWidthPx = p.pageWidthPx;
  } else if (!canonicalWidthEdited && legacyWidthEdited) {
    p.pageWidthPx = clampPageWidth(legacyEffectiveWidth(p));
  } else {
    p.pageWidthPx = clampPageWidth(p.pageWidthPx);
    if (canonicalWidthEdited) {
      p.sizePreset = 'custom';
      p.customWidthPx = p.pageWidthPx;
    }
  }

  const canonicalMarginEdited = p.pageMarginPx != null && p.pageMarginPx !== prev?.pageMarginPx;
  const legacyMarginEdited = prev != null && p.marginHorizPx !== prev.marginHorizPx;
  if (p.pageMarginPx == null) {
    p.pageMarginPx = clampPageMargin(
      prev != null ? p.marginHorizPx : PAGE_MARGIN_DEFAULT,
      p.pageWidthPx
    );
  } else if (!canonicalMarginEdited && legacyMarginEdited) {
    p.pageMarginPx = clampPageMargin(p.marginHorizPx, p.pageWidthPx);
  } else {
    p.pageMarginPx = clampPageMargin(p.pageMarginPx, p.pageWidthPx);
  }
  p.marginHorizPx = p.pageMarginPx;
  p.marginVertPx = p.pageMarginPx;

  const canonicalFontEdited = p.fontSizeStep != null && p.fontSizeStep !== prev?.fontSizeStep;
  const legacyFontEdited = prev != null && p.fontSizePx !== prev.fontSizePx;
  if (p.fontSizeStep == null) {
    p.fontSizeStep =
      prev != null ? clampFontStep(p.fontSizePx / FONT_STEP_PX_RATIO) : FONT_STEP_DEFAULT;
  } else if (!canonicalFontEdited && legacyFontEdited) {
    p.fontSizeStep = clampFontStep(p.fontSizePx / FONT_STEP_PX_RATIO);
  } else {
    p.fontSizeStep = clampFontStep(p.fontSizeStep);
  }
  p.fontSizePx = Math.round(p.fontSizeStep * FONT_STEP_PX_RATIO);

  if (p.lineHeightX != null && p.lineHeightX !== prev?.lineHeightX) {
    p.lineHeight = p.lineHeightX;
  } else if (prev != null && p.lineHeight !== prev.lineHeight) {
    p.lineHeightX = p.lineHeight;
  } else if (p.lineHeightX == null) {
    p.lineHeightX = LINE_HEIGHT_DEFAULT;
    p.lineHeight = LINE_HEIGHT_DEFAULT;
  }

  if (p.fontName == null) p.fontName = 'Lora';
  p.fontFamily = p.fontName === 'Inter' ? 'sans' : 'serif';

  return p;
}

export function applyStoryPageTokens(prefs: Partial<StoryPagePrefs> | null | undefined): void {
  if (typeof document === 'undefined') return;
  const p: StoryPagePrefs = { ...STORY_PAGE_DEFAULTS, ...prefs };
  const root = document.documentElement;
  // Canonical M1 fields win; the pre-S3 fields are the fallback for maps
  // persisted before S3 (see normalizeStoryPagePrefs).
  const widthPx = p.pageWidthPx != null ? clampPageWidth(p.pageWidthPx) : legacyEffectiveWidth(p);
  const padHoriz = p.pageMarginPx != null ? clampPageMargin(p.pageMarginPx, widthPx) : p.marginHorizPx;
  const padVert = p.pageMarginPx != null ? padHoriz : p.marginVertPx;
  const fontFamily = p.fontName
    ? manuscriptFontStack(p.fontName)
    : (STORY_PAGE_FONT_STACKS[p.fontFamily] ?? STORY_PAGE_FONT_STACKS.serif);
  const fontSize =
    p.fontSizeStep != null
      ? `${(p.fontSizeStep * FONT_STEP_PX_RATIO).toFixed(1)}px`
      : `${p.fontSizePx}px`;
  root.style.setProperty('--page-width-story', `${widthPx}px`);
  root.style.setProperty('--story-page-pad-vert', `${padVert}px`);
  root.style.setProperty('--story-page-pad-horiz', `${padHoriz}px`);
  root.style.setProperty('--story-page-font-family', fontFamily);
  root.style.setProperty('--story-page-font-size', fontSize);
  root.style.setProperty('--story-page-line-height', String(p.lineHeightX ?? p.lineHeight));
}

export function resetStoryPageTokens(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  ['--page-width-story','--story-page-pad-vert','--story-page-pad-horiz',
   '--story-page-font-family','--story-page-font-size','--story-page-line-height'].forEach(v => root.style.removeProperty(v));
}

/**
 * Reset all Liquid Neon inline style overrides (back to tokens.css defaults).
 * Called when the user selects "Reset to defaults".
 */
export function resetLiquidNeonTokens(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const vars = [
    '--glass-fill', '--glass-fill-fallback',
    '--blur-panel', '--blur-overlay', '--blur-chip',
    '--neon-intensity',
    '--accent', '--accent-soft', '--focus-ring', '--color-accent',
    '--text-header', '--text-body', '--text-muted', '--text-faint',
    '--text-primary', '--text-secondary', '--text-tertiary',
    '--bg-app-image',
    // MYT-716 additions
    '--bg-image-size', '--bg-image-repeat', '--bg-image-position',
    '--bg-scrim-alpha', '--bg-vignette-alpha',
    '--bg-base', '--bg-canvas', '--bg-app',
    '--border-default', '--border-strong',
    '--neon-cyan', '--neon-violet', '--neon-magenta',
    // SKY-910 — three-stop configurable neon border gradient
    '--neon-border-1', '--neon-border-2', '--neon-border-3',
    '--grad-neon', '--grad-neon-soft', '--border-neon-outline',
  ];
  for (const v of vars) root.style.removeProperty(v);
}
