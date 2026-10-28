// Push theme custom properties into artifact frames as data. Leading edge, then a 100ms coalesce.

import { artifactsEngine } from './featureFlags';

export interface ThemePushInput {
  vars: Record<string, string>;
  typing: boolean;
  themeChanged: boolean;
}

const COLOR_RE = /^(?:#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\))$/;
const LENGTH_RE = /^-?\d+(?:\.\d+)?(?:px|rem)$/;
const FONT_ALLOW = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'inherit',
  'Lora',
  'Inter',
  'Georgia',
  'system-ui',
]);

let typing = false;

export function setArtifactThemeTyping(value: boolean): void {
  typing = value;
}

export function sanitizeThemeValue(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 80) return null;
  if (/[;{}]|url\s*\(|expression\s*\(/i.test(trimmed)) return null;
  if (COLOR_RE.test(trimmed) || LENGTH_RE.test(trimmed) || FONT_ALLOW.has(trimmed)) return trimmed;
  return null;
}

export function sanitizeThemeVars(vars: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(vars)) {
    if (!/^--[a-z0-9-]+$/i.test(key)) continue;
    const safe = sanitizeThemeValue(value);
    if (safe !== null) out[key] = safe;
  }
  return out;
}

export function readThemeVars(root: Element): Record<string, string> {
  const style = root.getAttribute('style') ?? '';
  const out: Record<string, string> = {};
  for (const part of style.split(';')) {
    const idx = part.indexOf(':');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key.startsWith('--')) out[key] = value;
  }
  return sanitizeThemeVars(out);
}

export interface ThemeFrame {
  contentWindow: { postMessage: (data: unknown, origin: string) => void } | null;
}

export function deliverThemeVars(frames: readonly ThemeFrame[], vars: Record<string, string>): void {
  const message = { type: 'theme' as const, vars };
  for (const frame of frames) {
    frame.contentWindow?.postMessage(message, '*');
  }
}

export interface ThemeScheduler {
  push: (input: ThemePushInput) => void;
  pending: () => boolean;
}

export function createThemeScheduler(deliver: (vars: Record<string, string>) => void): ThemeScheduler {
  let trailing: ReturnType<typeof setTimeout> | null = null;
  let leadingOpen = true;
  let lastSent = '';
  let latest: Record<string, string> = {};

  const send = (vars: Record<string, string>): void => {
    deliver(vars);
    lastSent = JSON.stringify(vars);
  };

  return {
    pending: () => trailing !== null,
    push(input: ThemePushInput): void {
      if (input.typing && !input.themeChanged) return;
      const vars = sanitizeThemeVars(input.vars);
      latest = vars;
      const encoded = JSON.stringify(vars);
      if (leadingOpen) {
        leadingOpen = false;
        if (encoded !== lastSent) send(vars);
        setTimeout(() => {
          leadingOpen = true;
        }, 50);
      }
      if (trailing) clearTimeout(trailing);
      trailing = setTimeout(() => {
        trailing = null;
        const next = JSON.stringify(latest);
        if (next !== lastSent) send(latest);
      }, 100);
    },
  };
}

const scheduler = createThemeScheduler((vars) => {
  if (typeof document === 'undefined') return;
  const frames = [...document.querySelectorAll('iframe')].map((frame) => ({
    contentWindow: frame.contentWindow,
  }));
  deliverThemeVars(frames, vars);
});

/** Called from theme.ts after a token write. No-op while artifactsEngine is off. */
export function notifyArtifactThemeChange(themeChanged = true): void {
  if (!artifactsEngine) return;
  const vars = typeof document === 'undefined' ? {} : readThemeVars(document.documentElement);
  scheduler.push({ vars, typing, themeChanged });
}
