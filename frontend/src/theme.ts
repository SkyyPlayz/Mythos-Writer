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
