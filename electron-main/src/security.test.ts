// MYT-776 — Electron security baseline tests.
//
// Asserts the exact webPreferences passed to BrowserWindow at boot, the
// window-open deny default, and the CSP meta tag baked into the renderer
// HTML.  These three together cover the Electron security checklist.

import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { secureWebPreferences, createWindowOpenHandler } from './security.js';

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

describe('main.ts wiring — secureWebPreferences is the source of truth for the only BrowserWindow', () => {
  // Guards against drift: if someone adds a second BrowserWindow or hand-rolls
  // webPreferences, this test flips red and forces them to route through
  // secureWebPreferences().
  it('the only BrowserWindow constructor in main.ts uses secureWebPreferences()', () => {
    const mainSrc = fs.readFileSync(path.join(ELECTRON_MAIN_DIR, 'src/main.ts'), 'utf-8');
    const ctorMatches = mainSrc.match(/new BrowserWindow\s*\(/g) ?? [];
    expect(ctorMatches.length).toBe(1);
    // The constructor must reference secureWebPreferences in its options block.
    expect(mainSrc).toMatch(/new BrowserWindow\(\{[\s\S]*?webPreferences:\s*secureWebPreferences\(/);
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

  it('frame-ancestors is none (renderer is never iframed)', () => {
    expect(csp).toMatch(/frame-ancestors\s+'none'/);
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
