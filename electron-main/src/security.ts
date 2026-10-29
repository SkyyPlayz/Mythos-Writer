// MYT-776 — Electron security baseline.
//
// Centralises the BrowserWindow webPreferences and external-navigation
// handlers so they cannot drift across windows and so a unit test can assert
// the exact options applied at boot. Aligned with
// https://www.electronjs.org/docs/latest/tutorial/security.

import type { Session, WebPreferences } from 'electron';

export interface SecureWebPreferencesInput {
  /**
   * Absolute path to the compiled preload bundle. Omit for windows that must
   * not expose ANY IPC surface (e.g. the hidden Beta 4 M14 PDF print window,
   * which only renders static compiled HTML).
   */
  preloadPath?: string;
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
    ...(preloadPath ? { preload: preloadPath } : {}),
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
 * Content-Security-Policy string delivered as an HTTP response header.
 *
 * frame-ancestors MUST be here, not in the HTML meta tag: Chromium silently
 * ignores frame-ancestors when it arrives via <meta http-equiv="Content-
 * Security-Policy">. Delivering it as a header is the only way to enforce
 * the framing restriction (SKY-743).
 *
 * Keep in sync with the meta-tag directives in frontend/index.html — the
 * meta tag omits frame-ancestors (it would be ignored) and this constant
 * carries it.
 */
export const HEADER_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob: file:; media-src 'self' data: blob: file:; " +
  "font-src 'self' data:; " +
  "connect-src 'self' https://api.anthropic.com https://api.openai.com " +
  "ws://localhost:* http://localhost:*; " +
  "object-src 'none'; base-uri 'self'; frame-ancestors 'none'; worker-src 'self' blob:;";

/**
 * Install Content-Security-Policy as a response header on every request
 * served by the given session.
 *
 * This is required for frame-ancestors enforcement — Chromium ignores
 * frame-ancestors when delivered via a <meta> element (SKY-743). Wiring
 * it here means the header is present whether the renderer loads from
 * file:// (production) or http://localhost (dev).
 */
export function installCspHeaders(session: Session): void {
  session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'content-security-policy': [HEADER_CSP],
      },
    });
  });
}

/**
 * Electron 44 fires `select-client-certificate` for `net` and utility-process
 * requests too, with `webContents === null`. An unhandled event auto-picks the
 * first matching certificate. Decline every request: no certificate, and no
 * cert subject, path, or query in the log (host only).
 *
 * Call once, at main-process module load, before `app.whenReady()`.
 */
export function installClientCertPolicy(electronApp: {
  on: (
    event: 'select-client-certificate',
    listener: (
      event: { preventDefault: () => void },
      webContents: unknown,
      url: string,
      certificateList: readonly unknown[],
      callback: () => void,
    ) => void,
  ) => void;
}): void {
  electronApp.on('select-client-certificate', (event, _webContents, url, _list, callback) => {
    event.preventDefault();
    console.info(`[client-cert] declined ${clientCertHost(url)}`);
    callback();
  });
}

/** URL host only. A value that is not a URL contributes nothing — never the raw string. */
export function clientCertHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
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

/**
 * #1765: may a window that holds the preload bridge navigate in place to
 * `url`? Only to its own renderer — the dev server in development, or the
 * bundled `index.html` itself (any hash/query). Any other `file://` page is
 * refused: a document dropped on the window (Blink's default drop action) or
 * a link a compromised renderer follows must never load with `window.api`.
 */
export function isAllowedRendererNavigation(
  url: string,
  opts: { devServerUrl?: string; rendererIndexPath: string; platform?: NodeJS.Platform },
): boolean {
  if (opts.devServerUrl && url.startsWith(opts.devServerUrl)) return true;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'file:') return false;
  let target: string;
  try {
    target = decodeURIComponent(parsed.pathname);
  } catch {
    return false;
  }
  const platform = opts.platform ?? process.platform;
  const norm = (p: string) => {
    let s = p.replace(/\\/g, '/');
    // file:///C:/x → "/C:/x" on Windows
    if (platform === 'win32' && /^\/[A-Za-z]:\//.test(s)) s = s.slice(1);
    s = s.replace(/\/{2,}/g, '/');
    return platform === 'win32' || platform === 'darwin' ? s.toLowerCase() : s;
  };
  return parsed.host === '' && norm(target) === norm(opts.rendererIndexPath);
}
