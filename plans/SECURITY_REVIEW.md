# IPC Surface Security Review — Mythos Writer

**Date:** 2026-05-22  
**Reviewer:** CTO (MYT-133)  
**Scope:** `electron-main/src/ipc.ts` and `electron-main/src/preload.ts`, with deep reads of `vault.ts`, `main.ts`, `db.ts`, `snapshots.ts`, and `entities.ts`.

---

## Baseline: Context Isolation Status

| Control | Status |
|---|---|
| `contextIsolation: true` | ✅ Enabled (`main.ts:569`) |
| `nodeIntegration: false` | ✅ Disabled (`main.ts:570`) |
| Renderer → Node primitives direct access | ✅ Blocked by preload bridge |
| IPC bridge via `contextBridge.exposeInMainWorld` | ✅ Correct pattern |

The app is correctly configured. The renderer cannot access `require`, `fs`, `process`, or any Node API directly.

---

## Channel-by-Channel Audit

### VAULT_READ / VAULT_WRITE / VAULT_LIST / VAULT_DELETE

| Check | Result |
|---|---|
| Writes through `vault.ts` chokepoint | ✅ Yes |
| Path traversal protection | ✅ `safePath()` called on every operation |
| Shell concatenation | ✅ None |
| SQL injection | ✅ N/A (no SQL) |
| Error leaks API key | ✅ No |
| Error leaks FS paths | ⚠️ **F5** (see below) |

**Risk: LOW.** The `safePath()` function in `vault.ts:19-25` correctly resolves and bounds-checks every path against `vaultRoot`. Path traversal (`../`) is rejected with an explicit error.

---

### VAULT_MANIFEST_READ / VAULT_MANIFEST_WRITE

| Check | Result |
|---|---|
| Writes through `vault.ts` | ✅ Yes (via `writeManifest → writeManifestAtomic`) |
| Input validation | ✅ Manifest shape validated by TypeScript types |
| Response leaks FS path | ⚠️ `VAULT_MANIFEST_WRITE` returns `getManifestPath()` (absolute path) |

**Risk: LOW.** The absolute manifest path is intentional for local desktop use. No secrets in response.

---

### VAULT_OPEN_FOLDER / VAULT_GET_ROOT / VAULT_IMPORT / VAULT_REINDEX

| Check | Result |
|---|---|
| `VAULT_OPEN_FOLDER` uses `dialog.showOpenDialog` | ✅ OS-provided picker, no free-text path |
| `VAULT_GET_ROOT` returns absolute path | ✅ Intentional, no secret exposure |
| `VAULT_IMPORT` sourcePath unconstrained | ⚠️ **F6** (see below) |
| `VAULT_REINDEX` write safety | ✅ Uses `safePath` via `writeVaultFile` |

---

### DB_QUERY / DB_WRITE

| Check | Result |
|---|---|
| Currently executes SQL | ✅ **Stubbed — ignores payload entirely** |
| Interface design | 🔴 **F1 — Dangerous design** |

**Finding F1 — HIGH: Raw SQL channels registered and exposed to renderer**

`DB_QUERY` (`db:query`) and `DB_WRITE` (`db:write`) accept arbitrary `sql: string` and `params` from the renderer. Both handlers are currently stubs that return empty results (`rows: []`, `changes: 0`). However:

- The channels are registered in `setupIpcMain()` and present in `preload.ts:31-32`
- The `DbQueryPayload` / `DbWritePayload` types make activation trivial
- If these stubs are ever activated (even partially, during future development), they would allow the renderer to execute arbitrary SQL against the internal database — reading suggestions, audit logs, generation logs, and any future sensitive tables

**Recommendation:** Remove `DB_QUERY` and `DB_WRITE` channels from `ipc.ts`, `preload.ts`, and the handlers. Domain-specific channels (suggestions, timeline, audit) already provide the required access. There is no legitimate use case for generic SQL from the renderer.  
**Owner:** CTO (architectural — cross-cutting removal across ipc.ts, preload.ts, main.ts)

---

### SNAPSHOT_SAVE / SNAPSHOT_LIST / SNAPSHOT_GET / SNAPSHOT_RESTORE

| Check | Result |
|---|---|
| `scenePath` path-traversal check | ✅ `safePath()` called in `writeVaultFile` |
| `sceneId` path-traversal check | 🔴 **F3 — Missing** |
| Snapshot content isolation | ✅ Stored in `.snapshots/<sceneId>/` subfolder |

**Finding F3 — HIGH: Path traversal via `sceneId` in snapshot operations**

`snapshots.ts:29`:
```ts
function snapshotDir(vaultRoot: string, sceneId: string): string {
  return path.join(vaultRoot, '.snapshots', sceneId);
}
```

`path.join` normalizes paths but **does not prevent `..` traversal**. A renderer (or an XSS attack on the renderer) that calls:
```ts
window.api.snapshotSave('../../etc', content)
// resolves to: <vault>/..../../etc = /etc
```
would cause `fs.mkdirSync(/etc, { recursive: true })` (likely fails on permissions) or `fs.readdirSync(/etc)` in `listSnapshots`. More critically, `saveSnapshot` writes a JSON file:
```ts
fs.writeFileSync(path.join(dir, filename), JSON.stringify(snapshot), 'utf-8')
```
If the process has write permissions to the resolved directory, this writes an arbitrary file outside the vault.

All four snapshot channels (`snapshot:save`, `snapshot:list`, `snapshot:get`, `snapshot:restore`) pass `sceneId` to `snapshotDir()` without validation.

**Fix:** Add a `safePath`-equivalent check in `snapshotDir()`, or validate that `sceneId` matches UUID format (`/^[0-9a-f-]{36}$/i`) before constructing the path.  
**Owner:** BackendDev (vault/db layer)

---

### SUGGESTIONS_LIST / SUGGESTIONS_UPSERT / SUGGESTIONS_ACCEPT / SUGGESTIONS_APPLY / SUGGESTIONS_REJECT / SUGGESTIONS_ROLLBACK

| Check | Result |
|---|---|
| DB operations parameterized | ✅ All use `better-sqlite3` prepared statements |
| `SUGGESTIONS_ACCEPT` applies payload to vault | ✅ `writeVaultFile` via `safePath` |
| `SUGGESTIONS_APPLY` `snapshotPath` stored in DB | ⚠️ **F4** |
| `SUGGESTIONS_ROLLBACK` reads from stored path | ⚠️ **F4** |

**Finding F4 — MEDIUM: Renderer-controlled `snapshotPath` stored in DB and read back in rollback**

`SUGGESTIONS_APPLY` (`main.ts:346-359`) accepts `payload.snapshotPath` from the renderer and stores it verbatim in `audit_log.snapshot_path`. `SUGGESTIONS_ROLLBACK` (`main.ts:376-408`) then:
1. Reads `applyEntry.snapshot_path` from the DB
2. Does `path.join(getVaultRoot(), applyEntry.snapshot_path)` — **no `safePath()` bounds check**
3. Reads the file: `fs.readFileSync(fullSnapshotPath, ...)`
4. Writes its content to a vault path via `writeVaultFile`

A renderer that stores `../../app-settings.json` as `snapshotPath` via `SUGGESTIONS_APPLY`, then triggers `SUGGESTIONS_ROLLBACK`, would cause main to read `app-settings.json` (which contains the API key) and write it into the vault. This is not a direct exfiltration channel (the content goes into a vault file, not back to the renderer), but it is unexpected behavior and constitutes an unintended read/write outside the vault.

**Fix:** Validate `snapshotPath` with `safePath(getVaultRoot(), payload.snapshotPath)` in `SUGGESTIONS_APPLY` before storing, and repeat in `SUGGESTIONS_ROLLBACK` before reading.  
**Owner:** BackendDev (vault/db layer)

---

### AUDIT_LIST / TIMELINE_LIST / TIMELINE_UPSERT / GENERATION_LOG_RECENT

| Check | Result |
|---|---|
| DB operations parameterized | ✅ All use prepared statements |
| No FS writes | ✅ DB-only |
| Input types constrained | ✅ Optional string filters only |

**Risk: LOW.** Clean channels with no structural concerns.

---

### SETTINGS_GET / SETTINGS_SET

| Check | Result |
|---|---|
| `SETTINGS_GET` returns full `AppSettings` | 🔴 **F2 — API key exposure** |
| `SETTINGS_SET` writes to `userData/app-settings.json` | ✅ Scoped to userData |
| No shell interpretation of settings values | ✅ |

**Finding F2 — HIGH: Full Anthropic API key returned to renderer via `SETTINGS_GET`**

`AppSettings.apiKey` (`ipc.ts:574`) holds the raw Anthropic API key. `SETTINGS_GET` returns the full settings object including the key. The preload (`preload.ts:96`) exposes `settingsGet()` as `window.api.settingsGet()`.

The API key should never leave the main process. While context isolation prevents direct JS injection, any successful XSS on the renderer (through a third-party dependency, a crafted vault file rendered in a WebView, or a future embedded editor) could call `window.api.settingsGet()` and exfiltrate the key.

The renderer's only legitimate needs are: (a) knowing whether a key is configured, and (b) a masked preview for the Settings UI.

**Fix:** 
- `SETTINGS_GET` should strip or mask `apiKey` before returning: `{ ...settings, apiKey: settings.apiKey ? '••••' + settings.apiKey.slice(-4) : '' }`
- Store the key in the OS keychain (e.g., via `keytar`) instead of a plaintext JSON file; the current `app-settings.json` is world-readable on multi-user systems
- `SETTINGS_SET` should only accept the apiKey field if it is a non-masked value (to avoid overwriting with the masked preview)

**Owner:** BackendDev (vault/db/settings) + FrontendDev (Settings UI must use masked value)

---

### AI_BRAINSTORMER / AI_WRITING_ASSISTANT / AI_ARCHIVE (Legacy stubs)

| Check | Result |
|---|---|
| Execute real API calls | ✅ No — all stubs returning hardcoded data |
| Exposing key to renderer | ✅ No |

**Risk: LOW.** Stubs only; no action needed until implemented.

---

### AGENT_WRITING_ASSISTANT / AGENT_BRAINSTORM / AGENT_VAULT_INDEX / AGENT_VAULT_CHECK

| Check | Result |
|---|---|
| API key used only in main process | ✅ `getValidatedApiKey()` called in main handlers |
| API key returned to renderer | ✅ Not in response |
| Prompt content logged | ✅ SHA-256 digest only (unless `PERSIST_PROMPTS=1`) |
| Streaming handlers abort on renderer destroy | ✅ `AbortController` correctly wired |
| User content reflected in system prompt | ⚠️ **F-low** — vault entity content included verbatim |

**Risk: LOW-MEDIUM.** The vault-agent builds a system prompt that includes entity prose from vault files (up to 400 chars each). If a vault file contains adversarial content targeting Claude (prompt injection), it could affect the agent's output. This is a product concern, not an IPC security concern, but worth noting for future hardening.

---

### ENTITY_CREATE / ENTITY_READ / ENTITY_UPDATE / ENTITY_DELETE / ENTITY_LIST / ENTITY_BACKLINKS

| Check | Result |
|---|---|
| File paths constructed from `id` | ✅ `entityRelPath(type, id)` → `entities/<type>s/<id>.md` |
| Writes go through `vault.ts` | ✅ `writeVaultFile` with `safePath` |
| `id` format validated | ⚠️ No UUID format check before path construction |

**Risk: LOW.** The `entityRelPath` output is consumed by `writeVaultFile` / `readVaultFile` which apply `safePath()`. The traversal protection is downstream. However, a crafted `id` like `../../evil` would produce `entities/characters/../../evil.md` which `safePath` would catch. Currently safe, but the defense depends on `safePath` being called every time.

---

### SYSTEM_INFO / APP_READY / APP_QUIT / VAULT_WATCH_START / VAULT_WATCH_STOP

| Check | Result |
|---|---|
| `SYSTEM_INFO` / `APP_READY` | ✅ No secrets; returns platform/version info |
| `APP_QUIT` | ✅ No payload; calls `app.quit()` |
| Watch start/stop | ✅ No payload; no secrets |

**Risk: LOW.**

---

### Error handling (cross-cutting)

**Finding F5 — MEDIUM: Filesystem paths leaked through error messages**

`setupIpcMain` (`ipc.ts:88-95`) catches all errors and returns `{ error: (error as Error).message }` to the renderer. Node.js filesystem errors include the full absolute path, e.g.:
```
ENOENT: no such file or directory, open '/Users/alice/Library/Application Support/mythos-writer/vault/secret.md'
```

This exposes the `userData` path, `vaultRoot`, and any file path involved in a failed operation to the renderer — and through it, potentially to DevTools or logs.

**Fix:** Strip or sanitize filesystem paths from error messages before returning them to the renderer. Return a generic error code + relative path only.  
**Owner:** BackendDev

---

**Finding F6 — LOW: `VAULT_IMPORT` reads from arbitrary filesystem path**

`VAULT_IMPORT` (`payload.sourcePath`) accepts any absolute path the renderer provides and reads `.md` files from it via `collectMarkdownFiles`. No restriction to trusted locations. An adversarial renderer could point `sourcePath` to e.g. `/home/user/.ssh/` (would find no `.md` files) or any directory with `.md` content, copying it into the vault.

**Fix:** Warn the user (or require a dialog confirmation) when importing from paths outside the home directory.  
**Owner:** BackendDev (low priority)

---

## Summary Table

> **Update (2026-05-22, MYT-168):** F1, F2, and F3 are now ✅ remediated — see the "F1 + F2 + F3 Remediation Status" section at the bottom of this document for fix locations, commits, and verification. F4, F5, F6 remain open.

| ID | Channel(s) | Severity | Finding | Owner | Status |
|---|---|---|---|---|---|
| F1 | `db:query`, `db:write` | **HIGH** | Raw SQL channels exposed to renderer; currently stubbed but dangerous design | CTO | ✅ Remediated (MYT-142) |
| F2 | `settings:get` | **HIGH** | Full Anthropic API key returned to renderer | BackendDev + FrontendDev | ✅ Remediated (MYT-143 + MYT-146) |
| F3 | `snapshot:save`, `snapshot:list`, `snapshot:get`, `snapshot:restore` | **HIGH** | Path traversal via unvalidated `sceneId` in `snapshotDir()` | BackendDev | ✅ Remediated (`snapshots.ts:29-36`) |
| F4 | `suggestions:apply`, `suggestions:rollback` | **MEDIUM** | Renderer-supplied `snapshotPath` stored in DB, read back without `safePath()` validation in rollback | BackendDev | ⏳ Open |
| F5 | All (via `setupIpcMain` error handler) | **MEDIUM** | Absolute filesystem paths leaked in error messages | BackendDev | ⏳ Open |
| F6 | `vault:import` | **LOW** | `sourcePath` not restricted to trusted location | BackendDev | ⏳ Open |

---

## What Is Working Well

- **Context isolation enforced:** `contextIsolation: true`, `nodeIntegration: false` — renderer has zero Node access
- **Vault chokepoint:** All disk mutations go through `vault.ts` → `safePath()` → `fs.*`; no raw `fs` calls in handlers
- **Parameterized SQL everywhere:** `better-sqlite3` prepared statements used throughout `db.ts`; no string concatenation into queries
- **API key stays in main process:** `getValidatedApiKey()` called in main handlers only; key never included in streaming responses
- **Prompt content hashed by default:** Generation log stores SHA-256 digest of prompts, not raw text (`PERSIST_PROMPTS` env flag required for raw storage)
- **Streaming abort on renderer destroy:** All three agent handlers (`brainstorm`, `writing-assistant`, `vault-check`) correctly abort the Anthropic stream when the renderer is destroyed
- **No shell execution:** No `exec`, `execSync`, `spawn`, `eval`, or `Function()` anywhere in the main process

---

## No P0 (Remote Code Execution / Secret Exfiltration) Found

No finding achieves direct remote code execution or direct exfiltration of secrets to an attacker-controlled endpoint. F2 (API key in SETTINGS_GET) is the closest to secret exfiltration, but it requires a successful XSS on the renderer first. The snapshot traversal (F3) could write files outside the vault but not execute them.

---

*This document is a point-in-time review. Follow-up issues have been opened for F1, F2, F3, and F4.*

---

## Electron Hardening (MYT-167)

**Date:** 2026-05-22
**Reviewer:** SecurityEngineer (MYT-167)
**Scope:** `BrowserWindow.webPreferences`, preload surface, renderer CSP, navigation/window-open guards, permission requests.

### Audit Checklist

| Control | Before | After | Notes |
|---|---|---|---|
| `contextIsolation: true` | ✅ Set | ✅ Set | `main.ts` `createWindow()` |
| `nodeIntegration: false` | ✅ Set | ✅ Set | `main.ts` `createWindow()` |
| `sandbox: true` | ❌ Not set (defaulted to off for windows with a preload) | ✅ **Fixed** — set explicitly | Preload only uses `contextBridge` and `ipcRenderer` from `electron`, both available in sandboxed renderers |
| `webSecurity: true` | ⚠️ Implicit default | ✅ **Set explicitly** | Locks down same-origin policy; no CORS bypass |
| `allowRunningInsecureContent: false` | ⚠️ Implicit default | ✅ **Set explicitly** | Prevents mixed content |
| `experimentalFeatures: false` | ⚠️ Implicit default | ✅ **Set explicitly** | No experimental web platform features |
| CSP header on renderer | ❌ None | ✅ **Added** via `session.defaultSession.webRequest.onHeadersReceived` | Mode-aware (strict in prod, HMR-friendly in dev) |
| `setWindowOpenHandler` | ❌ Not set | ✅ **Added** | All `window.open` / `target="_blank"` denied; `https:` routed to OS browser via `shell.openExternal` |
| `will-navigate` guard | ❌ Not set | ✅ **Added** | Renderer cannot navigate outside trusted origin (Vite dev URL or `file://`); `https:` opened externally |
| `setPermissionRequestHandler` | ❌ Default permissive | ✅ **Added** — denies all | Camera, mic, geolocation, notifications, etc. all refused |
| Preload exposes only IPC bridge | ⚠️ Two bridges (`api` + dead `mythosIPC`) | ✅ **Fixed** — `mythosIPC` removed | No raw Node/Electron APIs exposed; only `ipcRenderer.invoke` / `on` wrappers |
| Renderer can `require()` Node modules | ✅ Blocked | ✅ Blocked | Enforced by `contextIsolation` + `nodeIntegration: false` + `sandbox: true` |

### Findings & Fixes

**H1 — HIGH: `sandbox` was not enabled.** Until this audit, the renderer process ran the preload script with full Node access. With `contextIsolation: true` and `nodeIntegration: false` the renderer JS could not reach Node directly, but a compromise of the preload script (e.g. via a malicious dependency in the preload bundle) would have had unrestricted OS access. **Fixed:** `sandbox: true` is now set. The preload script keeps working because it uses only `contextBridge` and `ipcRenderer`, which Electron continues to provide in sandboxed renderers since v12.

**H2 — HIGH: No Content Security Policy on the renderer.** Without CSP, a renderer-side XSS could load arbitrary scripts and exfiltrate via `fetch`. **Fixed:** `installCspHeader()` in `main.ts` installs a strict production CSP via `session.defaultSession.webRequest.onHeadersReceived`:
```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self';
object-src 'none'; base-uri 'self'; frame-src 'none'; form-action 'none'
```
Dev mode relaxes `script-src` to include `'unsafe-inline' 'unsafe-eval'` and `connect-src` to include `ws://localhost:* http://localhost:*` so Vite HMR works. `'unsafe-inline'` is retained for `style-src` in both modes because React inline styles and CSS-in-JS libraries require it. There is no `connect-src` allowance for `api.anthropic.com` — Claude API calls are made by the main process only, not the renderer.

**M1 — MEDIUM: New windows and external navigation were allowed.** Default Electron behaviour permits `window.open` and `<a target="_blank">` to spawn new BrowserWindows that inherit the parent's `webPreferences`. **Fixed:** `setWindowOpenHandler` returns `{ action: 'deny' }` and routes `https:` URLs to `shell.openExternal` (OS browser). `will-navigate` blocks navigation away from the trusted Vite-dev / `file://` origin and opens `https:` links externally.

**M2 — MEDIUM: Permission requests defaulted to allow.** Camera, microphone, geolocation, notifications, and other web permissions could be granted automatically. **Fixed:** `setPermissionRequestHandler` denies all permission requests. Mythos Writer has no legitimate need for any of them.

**L1 — LOW: Dead `mythosIPC` legacy bridge in preload.** The preload exposed a second IPC surface (`window.mythosIPC`) for backward-compatibility, but `grep` found zero callers in `frontend/src`. **Fixed:** Removed from `preload.ts` and `frontend/src/global.d.ts`. The renderer now has a single, smaller IPC surface (`window.api`).

**L2 — LOW: `webSecurity`, `allowRunningInsecureContent`, `experimentalFeatures` were implicit defaults.** Electron's defaults are already correct, but being explicit prevents regression if defaults change between Electron versions. **Fixed:** All three set explicitly in `webPreferences`.

### Intentional Gaps

- **`sandbox: true` requires preload bundle to be ESM-compatible with no Node-only imports beyond `electron`.** Verified: `preload.ts` only imports `contextBridge` and `ipcRenderer` from `electron`.
- **Dev-mode CSP is intentionally more permissive** to support Vite HMR. Production builds use the strict policy. The dev relaxation only fires when `VITE_DEV_SERVER_URL` is set in the environment, which production binaries never have.
- **`style-src 'unsafe-inline'` is retained** because removing it breaks React inline styles, TipTap, and most CSS-in-JS libraries. The XSS risk via inline styles is significantly lower than via inline scripts; mitigating it requires a nonce-based pipeline that's out of scope here.

### Verification

The changes were made in `electron-main/src/main.ts` (CSP, sandbox, navigation guards, permission handler), `electron-main/src/preload.ts` (legacy bridge removed), and `frontend/src/global.d.ts` (type definition removed). No new IPC channels were added.

### Summary Table (Electron Hardening)

| ID | Area | Severity | Status |
|---|---|---|---|
| H1 | `sandbox: true` not set | HIGH | ✅ Fixed |
| H2 | No renderer CSP | HIGH | ✅ Fixed |
| M1 | No `setWindowOpenHandler` / `will-navigate` guard | MEDIUM | ✅ Fixed |
| M2 | Default permissive permission handler | MEDIUM | ✅ Fixed |
| L1 | Dead `mythosIPC` legacy preload bridge | LOW | ✅ Removed |
| L2 | `webSecurity` / `allowRunningInsecureContent` / `experimentalFeatures` implicit | LOW | ✅ Now explicit |

---

## F1 + F2 + F3 Remediation Status (MYT-168)

**Date:** 2026-05-22
**Reviewer:** SecurityEngineer (MYT-168)
**Scope:** Close out the three HIGH findings from the original IPC review (F1 raw-SQL channels, F2 API key exposure, F3 snapshot path traversal).

All three HIGH findings from the initial IPC audit are now remediated.

### F1 — Raw SQL channels removed (`db:query`, `db:write`)

**Original risk:** `DB_QUERY` and `DB_WRITE` accepted arbitrary SQL strings from the renderer. Although the handlers were stubbed, the channels existed in `ipc.ts`/`preload.ts` and would have allowed renderer-driven SQL against `suggestions`, `audit_log`, and `generation_log` if ever activated.

**Fix (MYT-142, commit `32c2c77`):** Both channels were removed from `electron-main/src/ipc.ts` (channel registry + types) and `electron-main/src/preload.ts` (renderer bridge). Domain-specific channels (`suggestions:*`, `timeline:*`, `audit:list`, `generation:log:recent`) provide the legitimate access patterns; no generic SQL surface remains.

**Verification:** `grep -nE "db:query|db:write|DB_QUERY|DB_WRITE" electron-main/src` returns no matches. Renderer can no longer reach a generic SQL channel even if compromised.

### F2 — API key masking (backend + frontend)

**Original risk:** `SETTINGS_GET` returned the full `AppSettings` object including the raw `apiKey` (`sk-ant-…`). Any successful renderer XSS could call `window.api.settingsGet()` and exfiltrate the key.

**Backend fix (MYT-143, commit `c21206c`):**
- `electron-main/src/main.ts:542-545` — `SETTINGS_GET` now returns `{ ...s, apiKey: maskApiKey(s.apiKey) }`. The raw key never leaves the main process.
- `electron-main/src/main.ts:546-554` — `SETTINGS_SET` compares the incoming `apiKey` against the masked preview of the stored key; if they match (renderer echoed the masked placeholder unchanged), the stored key is preserved instead of being overwritten with `sk-ant-...XXXX`.
- `electron-main/src/main.ts:724-727` — `maskApiKey(key)` returns `sk-ant-...{last4}` for non-empty keys and `''` otherwise.
- A regression test suite covering masking and the round-trip guard was added in MYT-134 (commit `a817e09`).

**Frontend fix (MYT-146, commit `880f0a0`):**
- `frontend/src/SettingsPanel.tsx` now tracks `apiKeyInput` and `apiKeyDirty` separately from `settings.apiKey`. The masked preview returned by `settingsGet` is never written into the editable `<input>`.
- On save, the panel sends the user-typed value only when `apiKeyDirty` is `true`; otherwise it echoes the masked value back so the backend guard preserves the stored key.
- The UI shows a "Key is already configured" hint and a "Key configured — enter a new key to replace" placeholder when a key is stored, eliminating the prior "saving the masked value back" footgun.

**Verification:** End-to-end behavior — `settingsGet()` returns `apiKey: 'sk-ant-...XXXX'` (or `''`); the panel never repopulates the input with that value; a save without edits leaves the stored key unchanged; a save with a new `sk-ant-…` value replaces it; clearing the input (`''`) clears the stored key. Covered by `SettingsPanel.test.tsx` (MYT-146 acceptance suite) and `api-key-leak.test.ts` (MYT-134).

### F3 — Snapshot path traversal guard (`sceneId`)

**Original risk:** `snapshots.ts` `snapshotDir(vaultRoot, sceneId)` used `path.join(vaultRoot, '.snapshots', sceneId)` without validating `sceneId`. A renderer (or XSS on the renderer) calling `snapshot:save` with `sceneId = '../../etc'` would resolve to a directory outside the vault, allowing arbitrary file writes within the process's permissions.

**Fix (in `electron-main/src/snapshots.ts:29-36`):**
```ts
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function snapshotDir(vaultRoot: string, sceneId: string): string {
  if (!UUID_RE.test(sceneId)) {
    throw new Error(`Invalid sceneId: ${sceneId}`);
  }
  return path.join(vaultRoot, '.snapshots', sceneId);
}
```

All four snapshot channels (`snapshot:save`, `snapshot:list`, `snapshot:get`, `snapshot:restore`) route through `snapshotDir()`, so the guard covers every entry point. Any non-UUID `sceneId` — including `..`-laden traversal payloads — throws before any FS call. The accompanying test fixtures in `snapshots.test.ts` were updated to use real UUIDs so the regression suite continues to validate normal behavior.

**Verification:** `snapshots.ts:32` rejects anything that does not match the canonical UUID v1–v5 hex pattern. The error is raised inside `setupIpcMain`'s catch block, returning a generic error message to the renderer (no FS path leak).

### Remediation Summary

| ID | Original Severity | Status | Reference |
|---|---|---|---|
| F1 | HIGH | ✅ **Remediated** (channels removed) | MYT-142 / commit `32c2c77` — `ipc.ts`, `preload.ts` |
| F2 | HIGH | ✅ **Remediated** (backend masks, frontend treats as placeholder) | MYT-143 / `c21206c` (backend), MYT-146 / `880f0a0` (frontend), MYT-134 / `a817e09` (tests) |
| F3 | HIGH | ✅ **Remediated** (UUID-format guard on `sceneId`) | `electron-main/src/snapshots.ts:29-36` |
| F4 | MEDIUM | ⏳ **Open** — `snapshotPath` still stored verbatim by `suggestions:apply` and read without `safePath()` in `suggestions:rollback` | Owner: BackendDev |
| F5 | MEDIUM | ⏳ **Open** — error handler still echoes raw `Error.message` (`ipc.ts` `setupIpcMain`) | Owner: BackendDev |
| F6 | LOW | ⏳ **Open** — `vault:import` `sourcePath` unrestricted | Owner: BackendDev |

No P0 (RCE / direct secret exfiltration) findings remain. The HIGH cluster from the original review is closed.

### Next Security Review — Trigger Note

**Recommended follow-up audit: after Phase 3 AI handlers are implemented.**

The original IPC review explicitly scoped agent handlers as LOW-MEDIUM because the current `AI_BRAINSTORMER` / `AI_WRITING_ASSISTANT` / `AI_ARCHIVE` legacy channels are stubs, and the live `AGENT_*` handlers route through `getValidatedApiKey()` in the main process only. Phase 3 will expand this surface materially:

- New streaming handlers that read vault content into Anthropic prompts increase the **F-low** prompt-injection surface flagged in the original review (vault-entity prose included verbatim in system prompts).
- Any new `agent:*` channel that takes free-form renderer input (model parameters, tool definitions, multi-turn message arrays) becomes a new attack-surface row that needs its own audit checklist.
- The `generation_log` already stores SHA-256 digests by default, but a `PERSIST_PROMPTS=1` deployment path must be re-evaluated for what becomes loggable under Phase 3 (e.g. tool call arguments containing secrets).
- New IPC channels added in Phase 3 must pass the same checklist this review uses: parameterized SQL, `safePath()` on any FS path, no raw `apiKey` in responses, error messages sanitized of FS paths, `AbortController` wired to renderer-destroyed.

**Trigger:** open a new Security review issue (e.g. `MYT-Security-Phase3`) when the first Phase 3 AI handler PR lands or when `electron-main/src/main.ts` gains a new `AGENT_*` or `AI_*` channel registration, whichever comes first. Reuse the channel-by-channel template from this document.

---

*F1, F2, and F3 are closed as remediated. F4, F5, F6 remain open and tracked by their original owners. Next review trigger: Phase 3 AI handler landing.*

