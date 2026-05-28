import { resolveAxisTokens, applyAxisTokens } from './themeAxis';

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

export const LG_DEFAULTS: LiquidGlassPrefs = {
  background: 'default',
  style: 50,
  glass: 50,
  blur: 40,
  neon: 50,
  neonAccent: 'cyan',
  softness: 50,
};

const NEON_TOKENS: Record<LiquidGlassPrefs['neonAccent'], Record<string, string>> = {
  cyan: {
    '--accent': '#00f0ff',
    '--accent-hover': '#00cfe0',
    '--accent-light': '#67f5ff',
    '--accent-very-light': '#a0f9ff',
    '--accent-soft': '#001c20',
    '--accent-deep': '#004a55',
  },
  violet: {
    '--accent': '#7c3aed',
    '--accent-hover': '#6d28d9',
    '--accent-light': '#a78bfa',
    '--accent-very-light': '#c4b5fd',
    '--accent-soft': '#1e1030',
    '--accent-deep': '#4c1d95',
  },
  magenta: {
    '--accent': '#e040fb',
    '--accent-hover': '#c026d3',
    '--accent-light': '#f0abfc',
    '--accent-very-light': '#f5d0fe',
    '--accent-soft': '#1a0020',
    '--accent-deep': '#6b0070',
  },
};

export function applyLiquidGlassTokens(prefs: LiquidGlassPrefs): void {
  const root = document.documentElement;

  const tokens = NEON_TOKENS[prefs.neonAccent];
  for (const [prop, val] of Object.entries(tokens)) {
    root.style.setProperty(prop, val);
  }

  // Softness↔Contrast axis (MYT-518) takes priority over legacy per-slider blur/glass
  if (prefs.softness != null) {
    applyAxisTokens(resolveAxisTokens(prefs.softness));
  } else {
    root.style.setProperty('--lg-style', String(prefs.style / 100));
    root.style.setProperty('--lg-glass', String(prefs.glass / 100));
    root.style.setProperty('--lg-blur', `${Math.round(prefs.blur * 0.4)}px`);
    root.style.setProperty('--lg-neon', String(prefs.neon / 100));
  }

  if (prefs.textHeader) root.style.setProperty('--text-header', prefs.textHeader);
  else root.style.removeProperty('--text-header');

  if (prefs.textBody) root.style.setProperty('--text-body', prefs.textBody);
  else root.style.removeProperty('--text-body');

  if (prefs.textMuted) root.style.setProperty('--text-muted', prefs.textMuted);
  else root.style.removeProperty('--text-muted');
}

export { VALID_MODES as THEME_MODES };
