export type ThemeMode = 'light' | 'dark' | 'system';

export function applyTheme(theme: ThemeMode): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
}
