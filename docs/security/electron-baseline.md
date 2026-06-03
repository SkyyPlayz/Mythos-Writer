# Electron Security Baseline (MYT-776)

Reference: <https://www.electronjs.org/docs/latest/tutorial/security>

This document tracks the per-item status of the Electron Security Checklist for
Mythos-Writer. Every item is enforced in code *and* covered by
[`electron-main/src/security.test.ts`](../../electron-main/src/security.test.ts).
If you change any item below, update both this checklist and the corresponding
test so drift is caught at boot of CI.

## Single source of truth

All `webPreferences` flow through
[`secureWebPreferences()`](../../electron-main/src/security.ts). The
`main.ts` `createWindow()` is the **only** `new BrowserWindow(...)` call in the
codebase — a unit test asserts there is exactly one constructor and it routes
through `secureWebPreferences()`.

## Checklist

| # | Checklist item | Status | Where it lives | Test |
|---|---|---|---|---|
| 1 | `contextIsolation: true` | PASS | `secureWebPreferences()` | `secureWebPreferences — BrowserWindow security flags` |
| 2 | `nodeIntegration: false` | PASS | `secureWebPreferences()` | same |
| 3 | `sandbox: true` | PASS | `secureWebPreferences()` | same |
| 4 | `webSecurity: true` (explicit) | PASS | `secureWebPreferences()` | same |
| 5 | `nodeIntegrationInWorker: false` | PASS | `secureWebPreferences()` | same |
| 6 | `nodeIntegrationInSubFrames: false` | PASS | `secureWebPreferences()` | same |
| 7 | `experimentalFeatures: false` | PASS | `secureWebPreferences()` | same |
| 8 | CSP meta tag in renderer HTML | PASS | `frontend/index.html` | `frontend/index.html — CSP meta tag` |
| 9 | `script-src 'self'` (no inline / no eval) | PASS | `frontend/index.html` | `restricts script-src to self`, `does not allow unsafe-eval in script-src` |
| 10 | `connect-src` restricted (model endpoints + self) | PASS | `frontend/index.html` | `connect-src includes file: vault asset scheme or self, plus model endpoints` |
| 11 | `object-src 'none'` | PASS | `frontend/index.html` | same |
| 12 | `frame-ancestors 'none'` via **HTTP response header** | PASS | `installCspHeaders()` wired in `main.ts` via `session.webRequest.onHeadersReceived` | `installCspHeaders — frame-ancestors via session response header` |
| 13 | `setWindowOpenHandler` denies external popups | PASS | `createWindowOpenHandler()` wired in `main.ts` | `createWindowOpenHandler — deny by default`, `main.ts installs the window-open deny handler` |
| 14 | `will-navigate` blocks unexpected navigations | PASS | `main.ts createWindow()` | `main.ts blocks unexpected in-place navigations via will-navigate` |
| 15 | Preload uses `contextBridge.exposeInMainWorld` only | PASS | `electron-main/src/preload.ts` | `preload.ts — contextBridge.exposeInMainWorld is the only export path` |

> **SKY-743 — why `frame-ancestors` is not in the meta tag:** Chromium (and all
> standards-compliant browsers) ignore `frame-ancestors` when it appears in a
> `<meta http-equiv="Content-Security-Policy">` element. The directive is only
> honoured when delivered as an HTTP response header. Listing it in the meta tag
> creates false confidence and emits an "unsupported directive" console warning.
> As of SKY-743 it is delivered exclusively via `installCspHeaders()` in
> `electron-main/src/security.ts`.

## Content-Security-Policy in detail

CSP is delivered in two complementary layers:

### Layer 1 — meta tag (`frontend/index.html`)

The renderer is loaded as `file://` in production and from
`http://localhost:5173` in development.  A meta tag covers both modes for
directives that browsers honour in meta elements:

```text
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: file:;
media-src 'self' data: blob: file:;
font-src 'self' data:;
connect-src 'self' https://api.anthropic.com https://api.openai.com
            ws://localhost:* http://localhost:*;
object-src 'none';
base-uri 'self';
worker-src 'self' blob:;
```

`frame-ancestors` is intentionally absent — see Layer 2.

### Layer 2 — HTTP response header (`installCspHeaders` in `security.ts`)

`installCspHeaders()` installs `session.webRequest.onHeadersReceived` in
`createWindow()` and injects a `Content-Security-Policy` response header
covering all directives, including `frame-ancestors 'none'`.  The canonical
string is exported as `HEADER_CSP` from `security.ts`.

**Why the split?** The W3C CSP spec (and Chromium's implementation) explicitly
disallows `frame-ancestors` in meta elements — the directive is silently dropped
and Chromium emits a console warning.  The only compliant delivery path is the
HTTP response header.  Meta and header together provide defence in depth: the
meta tag constrains script, style, and resource loading in all environments; the
session header enforces framing protection.

Notes on each directive:

- **`script-src 'self'`** — no inline scripts, no remote scripts, no `eval`.
  Vite emits external module scripts only, so this works in dev and prod.
- **`style-src 'self' 'unsafe-inline'`** — Vite HMR and CSS-in-JS (Tailwind /
  Emotion / Radix) inject `<style>` tags at runtime.  `'unsafe-inline'` is
  acceptable for styles because style injection cannot execute JS.
- **`img-src` / `media-src` allow `file:`, `blob:`, `data:`** — vault assets
  render directly from `file://` URLs, voice recordings come back as `Blob`
  object URLs, and many UI assets are inlined as `data:` URIs.
- **`connect-src`** — `'self'` covers the dev origin and `file:` IPC traffic.
  `api.anthropic.com` and `api.openai.com` are listed for forward-compat in
  case a future flow needs to stream from the renderer instead of the main
  process; today, all model traffic is brokered via IPC and never touches the
  renderer's `connect-src`.  `ws://localhost:*` and `http://localhost:*` are
  needed by Vite HMR; their presence in production is benign because no
  attacker can reach the user's localhost services through the renderer.
- **`object-src 'none'`** — blocks `<object>`, `<embed>`, and `<applet>`.
- **`frame-ancestors 'none'`** — delivered via HTTP response header only
  (`installCspHeaders`).  The renderer is never embedded in another context;
  this is the enforced protection against framing/clickjacking attacks.
- **`worker-src 'self' blob:`** — bundled Web Workers are typically shipped as
  blob URLs by Vite.

## Window-open + navigation policy

`setWindowOpenHandler` returns `{ action: 'deny' }` for every URL, then
forwards http(s) URLs to `shell.openExternal` so the user's system browser —
not an Electron window with preload privileges — handles them.  Non-http
schemes (`file:`, `data:`, `javascript:`, `chrome:`, …) are dropped silently.

`will-navigate` is wired on the main window's `webContents` and rejects any
URL that is not the configured Vite dev server or a `file://` URL inside the
app bundle.  This prevents a compromised renderer from redirecting itself to a
remote origin that would then inherit the preload bridge.

## Preload exposure

`electron-main/src/preload.ts` uses **only** `contextBridge.exposeInMainWorld`
to expose APIs to the renderer.  Direct `window.X = ...` writes are forbidden:
they would bypass context isolation and hand the renderer a live reference to a
Node-side function.  A regression test asserts there are zero `window.*` or
`globalThis.*` assignments in `preload.ts`.

## When to revisit

- A new BrowserWindow constructor is introduced (e.g. for an "About" window or
  detached editor) → it must call `secureWebPreferences()`.  The unit test
  fails otherwise.
- A new model endpoint is added that the renderer must reach directly →
  extend the `connect-src` allow-list in `frontend/index.html` and the test in
  `security.test.ts`.
- An external library demands `'unsafe-eval'` or remote scripts → push back.
  Bundle the dependency, ship it with the app, and keep `script-src 'self'`.
