// MYT-776 — Electron security baseline.
//
// Centralises the BrowserWindow webPreferences and external-navigation
// handlers so they cannot drift across windows and so a unit test can assert
// the exact options applied at boot. Aligned with
// https://www.electronjs.org/docs/latest/tutorial/security.

import type { WebPreferences } from 'electron';

export interface SecureWebPreferencesInput {
  /** Absolute path to the compiled preload bundle. */
  preloadPath: string;
}

/**
 * Returns the hardened webPreferences passed to every BrowserWindow.
 *
 * Every flag here is load-bearing — do not relax without a security review
 * and an update to docs/security/electron-baseline.md.
 */
export function secureWebPreferences(
  { preloadPath }: SecureWebPreferencesInput,
): WebPreferences {
  return {
    preload: preloadPath,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    // Defence in depth: keep the remote module disabled (already off by
    // default in modern Electron, but pinning it makes regressions visible).
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    // Allow renderer to use experimental Web APIs only when explicitly opted
    // in elsewhere; default off.
    experimentalFeatures: false,
    // SKY-114: enable Electron's built-in spell checker so the renderer
    // surfaces red underlines and the context-menu handler can read
    // dictionarySuggestions / misspelledWord from context-menu params.
    spellcheck: true,
  };
}

/**
 * Window-open handler factory — deny external popups by default.
 *
 * Returning `{ action: 'deny' }` blocks `window.open`, target=_blank links,
 * and any other renderer-initiated new-window request. External URLs are
 * still expected to open in the user's system browser via shell.openExternal,
 * which the caller can wire through `onExternal`.
 */
export function createWindowOpenHandler(
  onExternal?: (url: string) => void,
): (details: { url: string }) => { action: 'deny' } {
  return ({ url }) => {
    // Only forward http(s) URLs to the system browser; everything else (file:,
    // data:, javascript:, chrome:, etc.) is dropped silently.
    if (onExternal && /^https?:\/\//i.test(url)) {
      try { onExternal(url); } catch { /* non-fatal */ }
    }
    return { action: 'deny' };
  };
}
