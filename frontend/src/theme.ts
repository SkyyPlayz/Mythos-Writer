import defaultBg from './assets/default-bg.webp';

export function applyTheme(theme: 'light' | 'dark' | 'system'): void {
  if (theme === 'system') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = prefersDark ? 'dark' : 'light';
  } else {
    document.documentElement.dataset.theme = theme;
  }
}

export const DEFAULT_BG_GRADIENT =
  'radial-gradient(ellipse at 20% 30%, #1a0533 0%, transparent 50%), ' +
  'radial-gradient(ellipse at 75% 65%, #001833 0%, transparent 45%), ' +
  '#0a0a0a';

export const LG_DEFAULTS: LiquidGlassPrefs = {
  background: 'default',
  style: 50,
  glass: 50,
  blur: 40,
  neon: 50,
  neonAccent: 'cyan',
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

  if (prefs.background === 'default') {
    root.style.setProperty('--bg-app-image', `url(${defaultBg})`);
  } else {
    root.style.removeProperty('--bg-app-image');
  }

  const tokens = NEON_TOKENS[prefs.neonAccent];
  for (const [prop, val] of Object.entries(tokens)) {
    root.style.setProperty(prop, val);
  }

  root.style.setProperty('--lg-style', String(prefs.style / 100));
  root.style.setProperty('--lg-glass', String(prefs.glass / 100));
  root.style.setProperty('--lg-blur', `${Math.round(prefs.blur * 0.4)}px`);
  root.style.setProperty('--lg-neon', String(prefs.neon / 100));

  if (prefs.textHeader) root.style.setProperty('--text-header', prefs.textHeader);
  else root.style.removeProperty('--text-header');

  if (prefs.textBody) root.style.setProperty('--text-body', prefs.textBody);
  else root.style.removeProperty('--text-body');

  if (prefs.textMuted) root.style.setProperty('--text-muted', prefs.textMuted);
  else root.style.removeProperty('--text-muted');
}
