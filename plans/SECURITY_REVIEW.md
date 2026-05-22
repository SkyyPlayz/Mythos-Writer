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

| ID | Channel(s) | Severity | Finding | Owner |
|---|---|---|---|---|
| F1 | `db:query`, `db:write` | **HIGH** | Raw SQL channels exposed to renderer; currently stubbed but dangerous design | CTO |
| F2 | `settings:get` | **HIGH** | Full Anthropic API key returned to renderer | BackendDev + FrontendDev |
| F3 | `snapshot:save`, `snapshot:list`, `snapshot:get`, `snapshot:restore` | **HIGH** | Path traversal via unvalidated `sceneId` in `snapshotDir()` | BackendDev |
| F4 | `suggestions:apply`, `suggestions:rollback` | **MEDIUM** | Renderer-supplied `snapshotPath` stored in DB, read back without `safePath()` validation in rollback | BackendDev |
| F5 | All (via `setupIpcMain` error handler) | **MEDIUM** | Absolute filesystem paths leaked in error messages | BackendDev |
| F6 | `vault:import` | **LOW** | `sourcePath` not restricted to trusted location | BackendDev |

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
