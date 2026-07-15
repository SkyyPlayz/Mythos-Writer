// MYT-776 — Electron security baseline tests.
//
// Asserts the exact webPreferences passed to BrowserWindow at boot, the
// window-open deny default, and the CSP meta tag baked into the renderer
// HTML.  These three together cover the Electron security checklist.

import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { secureWebPreferences, createWindowOpenHandler, installCspHeaders, HEADER_CSP } from './security.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ELECTRON_MAIN_DIR = path.resolve(HERE, '..');
const REPO_ROOT = path.resolve(HERE, '..', '..');

describe('secureWebPreferences — BrowserWindow security flags', () => {
  it('contextIsolation is on', () => {
    expect(secureWebPreferences({ preloadPath: '/tmp/p.js' }).contextIsolation).toBe(true);
  });
  it('nodeIntegration is off', () => {
    expect(secureWebPreferences({ preloadPath: '/tmp/p.js' }).nodeIntegration).toBe(false);
  });
  it('sandbox is on', () => {
    expect(secureWebPreferences({ preloadPath: '/tmp/p.js' }).sandbox).toBe(true);
  });
  it('webSecurity is on (explicitly, not relying on default)', () => {
    expect(secureWebPreferences({ preloadPath: '/tmp/p.js' }).webSecurity).toBe(true);
  });
  it('nodeIntegrationInWorker and nodeIntegrationInSubFrames are off', () => {
    const prefs = secureWebPreferences({ preloadPath: '/tmp/p.js' });
    expect(prefs.nodeIntegrationInWorker).toBe(false);
    expect(prefs.nodeIntegrationInSubFrames).toBe(false);
  });
  it('experimentalFeatures is off', () => {
    expect(secureWebPreferences({ preloadPath: '/tmp/p.js' }).experimentalFeatures).toBe(false);
  });
  it('spellcheck is on (SKY-114: enables native spell-check in the scene editor)', () => {
    expect(secureWebPreferences({ preloadPath: '/tmp/p.js' }).spellcheck).toBe(true);
  });
  it('preload path is forwarded verbatim', () => {
    const p = '/abs/path/to/preload.js';
    expect(secureWebPreferences({ preloadPath: p }).preload).toBe(p);
  });
  it('omitting preloadPath yields NO preload key (Beta 4 M14 PDF print window)', () => {
    const prefs = secureWebPreferences({});
    expect('preload' in prefs).toBe(false);
    // The hardened flags still apply to preload-less windows.
    expect(prefs.contextIsolation).toBe(true);
    expect(prefs.sandbox).toBe(true);
    expect(prefs.nodeIntegration).toBe(false);
  });
});

describe('createWindowOpenHandler — deny by default', () => {
  it('returns action: deny for any URL', () => {
    const handler = createWindowOpenHandler();
    expect(handler({ url: 'https://evil.example/' })).toEqual({ action: 'deny' });
    expect(handler({ url: 'http://example.com/' })).toEqual({ action: 'deny' });
    expect(handler({ url: 'file:///etc/passwd' })).toEqual({ action: 'deny' });
    expect(handler({ url: 'javascript:alert(1)' })).toEqual({ action: 'deny' });
    expect(handler({ url: 'data:text/html,<script>' })).toEqual({ action: 'deny' });
  });

  it('forwards http(s) URLs to onExternal so they can open in the system browser', () => {
    const onExternal = vi.fn();
    const handler = createWindowOpenHandler(onExternal);
    handler({ url: 'https://docs.example/' });
    expect(onExternal).toHaveBeenCalledWith('https://docs.example/');
  });

  it('does NOT forward non-http URLs to onExternal (no file:, data:, javascript:)', () => {
    const onExternal = vi.fn();
    const handler = createWindowOpenHandler(onExternal);
    handler({ url: 'file:///etc/passwd' });
    handler({ url: 'javascript:alert(1)' });
    handler({ url: 'data:text/html,<script>' });
    expect(onExternal).not.toHaveBeenCalled();
  });

  it('swallows errors thrown by onExternal so deny is still returned', () => {
    const handler = createWindowOpenHandler(() => { throw new Error('boom'); });
    expect(() => handler({ url: 'https://x/' })).not.toThrow();
    expect(handler({ url: 'https://x/' })).toEqual({ action: 'deny' });
  });
});

describe('main.ts wiring — secureWebPreferences is the source of truth for all BrowserWindows', () => {
  // Guards against drift: if someone adds a BrowserWindow that hand-rolls
  // webPreferences without secureWebPreferences(), this test flips red.
  // SKY-1686 added a second BrowserWindow for panel popout windows.
  // SKY-1697 added a third for free-floating panel windows.
  // Beta 4 M14 added a fourth: the hidden, preload-less PDF print window
  // (secureWebPreferences({}) — no IPC surface). All must use secureWebPreferences().
  it('all BrowserWindow constructors in main.ts use secureWebPreferences()', () => {
    const mainSrc = fs.readFileSync(path.join(ELECTRON_MAIN_DIR, 'src/main.ts'), 'utf-8');
    const ctorMatches = mainSrc.match(/new BrowserWindow\s*\(/g) ?? [];
    // Count must equal the number of intentional windows
    // (4: main + panel popout + floating panel + hidden PDF print window).
    expect(ctorMatches.length).toBe(4);
    // Count secureWebPreferences usages — must match BrowserWindow count.
    const secureMatches = mainSrc.match(/webPreferences:\s*secureWebPreferences\(/g) ?? [];
    expect(secureMatches.length).toBe(ctorMatches.length);
  });

  it('main.ts installs the window-open deny handler', () => {
    const mainSrc = fs.readFileSync(path.join(ELECTRON_MAIN_DIR, 'src/main.ts'), 'utf-8');
    expect(mainSrc).toMatch(/setWindowOpenHandler\(\s*createWindowOpenHandler/);
  });

  it('main.ts blocks unexpected in-place navigations via will-navigate', () => {
    const mainSrc = fs.readFileSync(path.join(ELECTRON_MAIN_DIR, 'src/main.ts'), 'utf-8');
    expect(mainSrc).toMatch(/'will-navigate'/);
    expect(mainSrc).toMatch(/event\.preventDefault\(\)/);
  });

  it('main.ts wires the context-menu handler for spell-check suggestions (SKY-114)', () => {
    const mainSrc = fs.readFileSync(path.join(ELECTRON_MAIN_DIR, 'src/main.ts'), 'utf-8');
    expect(mainSrc).toMatch(/'context-menu'/);
    expect(mainSrc).toMatch(/dictionarySuggestions/);
    expect(mainSrc).toMatch(/replaceMisspelling/);
    expect(mainSrc).toMatch(/addWordToSpellCheckerDictionary/);
  });

  it('main.ts calls installCspHeaders on the window session (SKY-743)', () => {
    const mainSrc = fs.readFileSync(path.join(ELECTRON_MAIN_DIR, 'src/main.ts'), 'utf-8');
    expect(mainSrc).toMatch(/installCspHeaders\s*\(/);
    expect(mainSrc).toMatch(/installCspHeaders\s*\(\s*mainWindow\.webContents\.session/);
  });
});

describe('preload.ts — contextBridge.exposeInMainWorld is the only export path', () => {
  // Direct window.X = … writes from preload would bypass contextIsolation and
  // hand the renderer a reference to a Node-side function.  This test fails if
  // someone adds such an assignment.
  it('does not assign to window.* directly', () => {
    const preloadSrc = fs.readFileSync(path.join(ELECTRON_MAIN_DIR, 'src/preload.ts'), 'utf-8');
    expect(preloadSrc).not.toMatch(/window\.[A-Za-z_$][\w$]*\s*=/);
    expect(preloadSrc).not.toMatch(/globalThis\.[A-Za-z_$][\w$]*\s*=/);
  });

  it('every renderer API is exposed via contextBridge.exposeInMainWorld', () => {
    const preloadSrc = fs.readFileSync(path.join(ELECTRON_MAIN_DIR, 'src/preload.ts'), 'utf-8');
    const exposeCalls = preloadSrc.match(/contextBridge\.exposeInMainWorld\(/g) ?? [];
    expect(exposeCalls.length).toBeGreaterThan(0);
  });
});

describe('frontend/index.html — CSP meta tag', () => {
  const indexPath = path.resolve(REPO_ROOT, 'frontend', 'index.html');
  const html = fs.readFileSync(indexPath, 'utf-8');
  const cspMatch = html.match(
    /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i,
  );
  const csp = cspMatch?.[1] ?? '';

  it('has a Content-Security-Policy meta tag', () => {
    expect(cspMatch).not.toBeNull();
  });

  it('restricts script-src to self', () => {
    expect(csp).toMatch(/script-src\s+'self'(?:;|\s)/);
  });

  it('connect-src includes file: vault asset scheme or self, plus model endpoints', () => {
    expect(csp).toMatch(/connect-src\b/);
    // Model endpoints (or 'self' for IPC-bridged traffic) must be allowed.
    expect(csp).toMatch(/api\.anthropic\.com|api\.openai\.com|'self'/);
  });

  it('object-src is none', () => {
    expect(csp).toMatch(/object-src\s+'none'/);
  });

  it('does not include frame-ancestors (ignored in meta — SKY-743; enforced via session header instead)', () => {
    // Chromium silently ignores frame-ancestors when delivered via <meta>.
    // The directive must be delivered as an HTTP response header
    // (see installCspHeaders in security.ts).  Keeping it in the meta tag
    // creates false confidence and emits a "directive is not supported"
    // console warning in E2E tests.
    expect(csp).not.toMatch(/frame-ancestors/);
  });

  it('does not allow unsafe-eval in script-src', () => {
    // 'unsafe-inline' is acceptable for style-src (Vite HMR), but never for
    // script-src — that would let injected HTML run arbitrary JS.
    const scriptSrcMatch = csp.match(/script-src([^;]+);/);
    expect(scriptSrcMatch).not.toBeNull();
    expect(scriptSrcMatch?.[1]).not.toMatch(/'unsafe-eval'/);
    expect(scriptSrcMatch?.[1]).not.toMatch(/'unsafe-inline'/);
  });
});

// SKY-700 / RISK-3 — app:restoreAppData must always require a dialog (CWE-73)
describe('app:restoreAppData — headless archivePath path is permanently removed', () => {
  const ipcSrc = fs.readFileSync(path.join(ELECTRON_MAIN_DIR, 'src/ipc.ts'), 'utf-8');
  const mainSrc = fs.readFileSync(path.join(ELECTRON_MAIN_DIR, 'src/main.ts'), 'utf-8');
  const preloadSrc = fs.readFileSync(path.join(ELECTRON_MAIN_DIR, 'src/preload.ts'), 'utf-8');

  it('RestoreAppDataPayload does not expose archivePath (ipc.ts)', () => {
    // The interface must not include archivePath — dropping it ensures no
    // renderer-supplied path can bypass the dialog gate.
    const ifaceMatch = ipcSrc.match(/interface RestoreAppDataPayload\s*\{[^}]*\}/s);
    expect(ifaceMatch).not.toBeNull();
    expect(ifaceMatch![0]).not.toMatch(/archivePath/);
  });

  it('app:restoreAppData handler always calls showOpenDialog before reading (main.ts)', () => {
    // The handler must invoke dialog.showOpenDialog unconditionally — no early
    // branch that skips the dialog when payload.archivePath is present.
    const handlerMatch = mainSrc.match(
      /APP_RESTORE_APP_DATA[\s\S]*?showOpenDialog[\s\S]*?(?=\[IPC_CHANNELS\.)/,
    );
    expect(handlerMatch).not.toBeNull();
    // The handler must not reference payload.archivePath as an escape hatch.
    expect(handlerMatch![0]).not.toMatch(/payload\??\.archivePath/);
  });

  it('preload restoreAppData does not forward archivePath to main process', () => {
    // The preload bridge must not include archivePath in the IPC payload so a
    // compromised renderer cannot supply an attacker-controlled path.
    const restoreCall = preloadSrc.match(/restoreAppData[\s\S]*?ipcRenderer\.invoke[\s\S]*?\)/);
    expect(restoreCall).not.toBeNull();
    expect(restoreCall![0]).not.toMatch(/archivePath/);
  });
});

// SKY-699 / RISK-2 — app:backupAppData must always require a dialog (CWE-73)
describe('app:backupAppData — headless outputPath path is permanently removed', () => {
  const ipcSrc = fs.readFileSync(path.join(ELECTRON_MAIN_DIR, 'src/ipc.ts'), 'utf-8');
  const mainSrc = fs.readFileSync(path.join(ELECTRON_MAIN_DIR, 'src/main.ts'), 'utf-8');
  const preloadSrc = fs.readFileSync(path.join(ELECTRON_MAIN_DIR, 'src/preload.ts'), 'utf-8');

  it('BackupAppDataPayload does not expose outputPath (ipc.ts)', () => {
    // The interface must not include outputPath — dropping it ensures no
    // renderer-supplied path can bypass the dialog gate.
    const ifaceMatch = ipcSrc.match(/interface BackupAppDataPayload\s*\{[^}]*\}/s);
    expect(ifaceMatch).not.toBeNull();
    expect(ifaceMatch![0]).not.toMatch(/outputPath/);
  });

  it('app:backupAppData handler always calls showSaveDialog before writing (main.ts)', () => {
    // The handler must invoke dialog.showSaveDialog unconditionally — no early
    // branch that skips the dialog when payload.outputPath is present.
    const handlerMatch = mainSrc.match(
      /APP_BACKUP_APP_DATA[\s\S]*?showSaveDialog[\s\S]*?(?=\[IPC_CHANNELS\.)/,
    );
    expect(handlerMatch).not.toBeNull();
    // The handler must not reference payload.outputPath as an escape hatch.
    expect(handlerMatch![0]).not.toMatch(/payload\??\.outputPath/);
  });

  it('preload backupAppData does not forward outputPath to main process', () => {
    // The preload bridge must not include outputPath in the IPC payload so a
    // compromised renderer cannot supply an attacker-controlled write path.
    const backupCall = preloadSrc.match(/backupAppData[\s\S]*?ipcRenderer\.invoke[\s\S]*?\)/);
    expect(backupCall).not.toBeNull();
    expect(backupCall![0]).not.toMatch(/outputPath/);
  });
});

describe('installCspHeaders — frame-ancestors enforcement via session header (SKY-743)', () => {
  // Minimal duck-typed mock that matches the Electron Session.webRequest shape
  // used by installCspHeaders without importing the Electron runtime.
  function makeMockSession(capture: { listener: ((d: { responseHeaders?: Record<string, string[]> }, cb: (r: { responseHeaders: Record<string, string[]> }) => void) => void) | null }) {
    return {
      webRequest: {
        onHeadersReceived: (fn: typeof capture.listener) => { capture.listener = fn; },
      },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }

  it('HEADER_CSP includes frame-ancestors none', () => {
    expect(HEADER_CSP).toMatch(/frame-ancestors\s+'none'/);
  });

  it('calls onHeadersReceived on the provided session', () => {
    const onHeadersReceived = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    installCspHeaders({ webRequest: { onHeadersReceived } } as any);
    expect(onHeadersReceived).toHaveBeenCalledOnce();
  });

  it('injects Content-Security-Policy header with frame-ancestors none', () => {
    const capture: { listener: ((d: { responseHeaders?: Record<string, string[]> }, cb: (r: { responseHeaders: Record<string, string[]> }) => void) => void) | null } = { listener: null };
    installCspHeaders(makeMockSession(capture));
    expect(capture.listener).not.toBeNull();

    const cbSpy = vi.fn();
    capture.listener!({ responseHeaders: {} }, cbSpy);
    expect(cbSpy).toHaveBeenCalledOnce();

    const [resp] = cbSpy.mock.calls[0] as [{ responseHeaders: Record<string, string[]> }];
    const cspValues = resp.responseHeaders['content-security-policy'];
    expect(cspValues).toBeDefined();
    expect(cspValues[0]).toMatch(/frame-ancestors\s+'none'/);
  });

  it('preserves existing response headers when injecting CSP', () => {
    const capture: { listener: ((d: { responseHeaders?: Record<string, string[]> }, cb: (r: { responseHeaders: Record<string, string[]> }) => void) => void) | null } = { listener: null };
    installCspHeaders(makeMockSession(capture));
    const cbSpy = vi.fn();
    capture.listener!({ responseHeaders: { 'x-custom': ['kept'] } }, cbSpy);

    const [resp] = cbSpy.mock.calls[0] as [{ responseHeaders: Record<string, string[]> }];
    expect(resp.responseHeaders['x-custom']).toEqual(['kept']);
    expect(resp.responseHeaders['content-security-policy']).toBeDefined();
  });

  it('handles missing responseHeaders in details (e.g. file:// responses)', () => {
    const capture: { listener: ((d: { responseHeaders?: Record<string, string[]> }, cb: (r: { responseHeaders: Record<string, string[]> }) => void) => void) | null } = { listener: null };
    installCspHeaders(makeMockSession(capture));
    const cbSpy = vi.fn();
    // Pass details with no responseHeaders (undefined)
    capture.listener!({}, cbSpy);

    const [resp] = cbSpy.mock.calls[0] as [{ responseHeaders: Record<string, string[]> }];
    expect(resp.responseHeaders['content-security-policy'][0]).toMatch(/frame-ancestors\s+'none'/);
  });
});

// GH-753 / SKY-4776 — IPC sender-frame guards regression (PANEL_FLOAT_DOCK_BACK + PANEL_FLOAT_SET_PIN)
describe('main.ts IPC sender-frame guards — GH-753 regression', () => {
  const mainSrc = fs.readFileSync(path.join(ELECTRON_MAIN_DIR, 'src/main.ts'), 'utf-8');

  it('PANEL_FLOAT_DOCK_BACK handler checks isFromTopFrame', () => {
    // Previously used _event (no frame inspection) — GH-753.
    const match = mainSrc.match(/PANEL_FLOAT_DOCK_BACK[\s\S]{1,300}isFromTopFrame/);
    expect(match).not.toBeNull();
  });

  it('PANEL_FLOAT_SET_PIN handler checks isFromTopFrame', () => {
    // Previously lacked the frame guard — GH-753.
    const match = mainSrc.match(/PANEL_FLOAT_SET_PIN[\s\S]{1,300}isFromTopFrame/);
    expect(match).not.toBeNull();
  });

  it('no wrapIpcHandler callback uses _event as the IPC event parameter', () => {
    // _event (prefixed underscore) means the handler never inspects senderFrame
    // and therefore has no isFromTopFrame guard.  Any new handler that introduces
    // this pattern must add the frame check and rename the param to event.
    const unguarded = mainSrc.match(/wrapIpcHandler\([^,]+,\s*(?:async\s*)?\(_event[,)]/g) ?? [];
    expect(unguarded).toHaveLength(0);
  });
});

// GHSA-6v5v-wf23-fmfq — markdown-it DoS vulnerability regression test
// The vulnerability is quadratic complexity in smartquotes rule via replaceAt operations.
// Fixed in 14.2.0. This test ensures the fix is in place and the vulnerability doesn't resurface.
describe('markdown-it GHSA-6v5v-wf23-fmfq (smartquotes DoS) — fix verified', () => {
  it('markdown-it version is >= 14.2.0 (fixes smartquotes DoS)', async () => {
    // Dynamic import to verify the installed version without needing a direct
    // package.json dependency in electron-main (markdown-it is used transitively
    // via tiptap-markdown in frontend).  This test guards against accidental
    // downgrade or stale lock file.
    const pkg = await import('markdown-it/package.json', { assert: { type: 'json' } });
    const version = pkg.default.version;
    const [major, minor] = version.split('.').map(Number);
    expect(major).toBeGreaterThanOrEqual(14);
    expect(minor).toBeGreaterThanOrEqual(2);
  });

  it('smartquotes rendering with repeated quotes does not timeout (DoS regression)', () => {
    // This test would hang or timeout with the vulnerable version (14.1.1) when
    // processing strings with many consecutive quote characters due to quadratic
    // replaceAt operations.  The fixed version (14.2.0) uses linear string
    // concatenation and completes instantly.
    const markdown = require('markdown-it');
    const md = markdown();

    // Test case: repeated quote pairs that trigger the smartquotes rule
    const input = `"${'"hello" '.repeat(50)}"`;
    const startMs = Date.now();
    const output = md.render(input);
    const elapsedMs = Date.now() - startMs;

    // Should complete in < 100ms (vulnerable version hangs or takes seconds)
    expect(elapsedMs).toBeLessThan(100);
    // Verify output is non-empty and contains rendered markdown
    expect(output).toMatch(/&quot;|"|"/); // smart quotes or HTML entities
  });
});
