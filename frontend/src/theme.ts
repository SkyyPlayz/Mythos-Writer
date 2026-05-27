/**
 * Liquid Glass Dark Neon — theme controller (phase 1 foundation, MYT-517).
 *
 * The app is DARK-ONLY. The previous dark/light/system model is gone: there is
 * a single dark theme whose look is defined entirely by the design tokens in
 * `tokens.css`. The only user-facing variant is the WCAG high-contrast
 * accessibility theme, which composes on top of the tokens (it is not a
 * separate palette — see tokens.css §5.2).
 *
 * The continuous Softness↔Contrast slider that will interpolate the
 * axis-driven tokens lives in MYT-518; this module only switches the discrete
 * accessibility overlay on/off.
 */

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

export { VALID_MODES as THEME_MODES };

// ─── Liquid Glass token customization (MYT-613) ─────────────────────────────

export const LIQUID_GLASS_DEFAULTS: LiquidGlassPrefs = {
  softnessContrast: 0.4,
  glass: 0.4,
  blur: 0.4,
  neonIntensity: 0.4,
  neonAccent: 'cyan',
  textHeader: '#edecf6',
  textBody: '#bfd6e8',
  textMuted: '#8a9bb0',
  background: 'default',
};

/** CSS multi-gradient approximating the dark space/nebula aesthetic of the example art. */
export const DEFAULT_BG_GRADIENT =
  'radial-gradient(ellipse at 68% 32%, rgba(100,20,200,0.38) 0%, transparent 55%), ' +
  'radial-gradient(ellipse at 22% 72%, rgba(0,160,225,0.22) 0%, transparent 55%), ' +
  'radial-gradient(ellipse at 85% 82%, rgba(190,0,190,0.16) 0%, transparent 45%), ' +
  'radial-gradient(ellipse at 10% 15%, rgba(55,10,110,0.28) 0%, transparent 42%), ' +
  '#08091a';

const NEON_ACCENT_MAP: Record<LiquidGlassPrefs['neonAccent'], { accent: string; accentSoft: string }> = {
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
 * Apply Liquid Glass customization tokens to :root inline styles.
 * Safe to call with a partial — missing keys fall back to LIQUID_GLASS_DEFAULTS.
 * Pass `null` or `undefined` to reset all overrides to defaults.
 */
export function applyLiquidGlassTokens(
  prefs: Partial<LiquidGlassPrefs> | null | undefined,
  bgDataUrl?: string | null,
): void {
  if (typeof document === 'undefined') return;

  const p: LiquidGlassPrefs = { ...LIQUID_GLASS_DEFAULTS, ...prefs };
  const root = document.documentElement;

  // Glass fill alpha: glass=0 → lighter (more transparent), glass=1 → darker (more opaque)
  const glassAlpha = lerp(0.15, 0.04, p.glass);
  root.style.setProperty('--glass-fill', `rgba(255,255,255,${glassAlpha.toFixed(3)})`);

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
  const intensity = lerp(1.0, 0.25, p.neonIntensity);
  root.style.setProperty('--neon-intensity', intensity.toFixed(3));

  // Neon accent
  const accentDef = NEON_ACCENT_MAP[p.neonAccent] ?? NEON_ACCENT_MAP.cyan;
  root.style.setProperty('--accent', accentDef.accent);
  root.style.setProperty('--accent-soft', accentDef.accentSoft);
  root.style.setProperty('--focus-ring', accentDef.accent);
  root.style.setProperty('--color-accent', accentDef.accent);

  // Text colors
  root.style.setProperty('--text-header',  p.textHeader);
  root.style.setProperty('--text-body',    p.textBody);
  root.style.setProperty('--text-muted',   p.textMuted);
  root.style.setProperty('--text-faint',   p.textMuted);
  root.style.setProperty('--text-primary', p.textHeader);
  root.style.setProperty('--text-secondary', p.textBody);
  root.style.setProperty('--text-tertiary', p.textMuted);

  // Background
  if (bgDataUrl) {
    root.style.setProperty('--bg-app-image', `url("${bgDataUrl}")`);
  } else if (p.background === 'default') {
    root.style.setProperty('--bg-app-image', DEFAULT_BG_GRADIENT);
  } else {
    // Path stored but dataUrl not yet loaded — keep previous value or use default
    root.style.setProperty('--bg-app-image', DEFAULT_BG_GRADIENT);
  }
}

/**
 * Reset all Liquid Glass inline style overrides (back to tokens.css defaults).
 * Called when the user selects "Reset to defaults".
 */
export function resetLiquidGlassTokens(): void {
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
  ];
  for (const v of vars) root.style.removeProperty(v);
}
