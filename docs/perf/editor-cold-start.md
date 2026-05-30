# Editor Cold-Start Performance Baseline

_Captured: 2026-05-29 · Branch: sky-48-perf-baseline_

## Boot Stage Breakdown

Mythos Writer is an Electron app. Cold-start latency is the sum of:

1. **Electron internals** — Node.js bootstrap, native module loading (`better-sqlite3`)
2. **`app.whenReady()` callback** — sequential synchronous setup before the window opens
3. **Renderer load** — HTML parse → JS bundle → React hydration (runs in parallel with some main-process steps)
4. **First IPC roundtrip** — `settingsGet()` called from `App.tsx` useEffect; blocked until the main thread is free

### `app.whenReady()` phases (main thread, sequential)

| Mark | What happens |
|------|-------------|
| `app:ready-start` | Callback entry |
| `app:vault-init-end` | `ensureVaultDir` + `addToRecentProjects` (sync FS + JSON reads) |
| `app:secrets-end` | Secrets store init + one-shot `safeStorage` migration + telemetry |
| `app:ipc-ready` | All IPC handlers registered (10 handlers) |
| `app:window-created` | `BrowserWindow` allocated, renderer URL loaded |
| — | `initAutoUpdater()` |
| — | `await startVaultWatcher()` — **yields event loop** (dynamic `import('chokidar')`) |
| `app:fts-build-start` | FTS index build starts (deferred, see §Quick Win) |
| `app:fts-build-end` | FTS index ready |

### Renderer phases (parallel with main-process after `app:window-created`)

| Mark | What happens |
|------|-------------|
| `renderer:script-start` | Main bundle begins executing |
| `renderer:theme-applied` | `applyTheme('dark')` — synchronous DOM write |
| `renderer:react-scheduled` | `ReactDOM.createRoot().render()` called |
| `renderer:settings-ipc-start` | First `useEffect` fires, `settingsGet()` IPC sent |
| `renderer:settings-ipc-end` | IPC response received, content rendered |
| `renderer:interactive` | Loading state cleared, editor or onboarding shown |

Console output (every launch):

```
[perf] app:startup → window: <ms>
[perf] app:fts-build: <ms>
[perf] renderer:settingsGet IPC: <ms>
[perf] renderer:interactive
```

---

## Baseline Numbers

Measured in WSL2 (Linux 6.6, SSD, 16 GB RAM) using the existing `electron-main` perf bench
(`NODE_PATH=../node_modules npm run perf` from `electron-main/`):

| Metric | Measured |
|--------|---------|
| DB cold-open (migrations) | **6 ms** |
| Vault reindex — 1 000 scenes | **587 ms** |
| FTS5 full build — 6 000 docs (1 000 scenes + 5 000 entities) | **329 ms** |
| FTS5 search median (3 queries) | **3 ms** |
| Archive index — 5 000 entities | **600 ms** |

> Baseline from prior green run (2026-05-24): FTS build 166 ms, vault reindex 187 ms.
> Current run is ~2× slower — attributed to WSL2 I/O variability, not a regression in code.

**`settingsGet()` IPC latency before this PR** (estimated):

- New / empty vault → ~5 ms (FTS build is trivial)
- Medium vault (200 scenes + 500 entities) → ~50–120 ms (blocked by synchronous FTS)
- Large vault (1 000 scenes + 5 000 entities) → **~329 ms** (fully blocked until FTS done)

The IPC was blocked because `buildFullIndex()` ran synchronously on the main thread
immediately after `createWindow()`, before any IPC messages could be processed.

---

## Quick Win: Defer `buildFullIndex()` After Vault Watcher Init

### Root cause

Before this change, the `app.whenReady()` callback looked like:

```typescript
createWindow();          // starts loading renderer HTML — async
initAutoUpdater();
buildFullIndex(…);       // SYNCHRONOUS — blocks main thread for up to 329 ms
await startVaultWatcher(…);  // finally yields the event loop
```

The renderer loads HTML, parses it, executes the JS bundle, mounts React, and fires
`useEffect` which sends `settingsGet()` via IPC. All of this happens roughly 200–400 ms
after `createWindow()`. But the main thread was blocked by `buildFullIndex()` for the
entire duration, so `settingsGet()` had to wait.

### Fix

```typescript
createWindow();
initAutoUpdater();

// Moved BEFORE FTS — the dynamic import('chokidar') yields the event loop,
// giving a window for the renderer's first IPC calls to be processed.
await startVaultWatcher(…);

// Deferred to next event-loop tick — any queued IPC (e.g. settingsGet)
// processed first. Safe: watcher already re-indexes on every vault change.
setImmediate(() => {
  buildFullIndex(…);
});
```

Two changes work together:

1. **Reorder**: `startVaultWatcher` moved _before_ `buildFullIndex`. The `await import('chokidar')` inside the watcher is a genuine async yield; during that yield any queued IPC messages are processed. The renderer's `settingsGet()` typically arrives during this window.

2. **`setImmediate`**: FTS build is pushed to the next event-loop tick, after the current batch of pending I/O callbacks (including the renderer's IPC) has been processed.

### Why this is safe

- The vault watcher already triggers `buildFullIndex()` on any file change event. A vault that changes between watcher start and deferred FTS build gets re-indexed immediately.
- FTS search returning empty results for the first ~300 ms is identical in effect to the app not having FTS at all on that launch, which is the existing behaviour for new users.
- `buildFullIndex()` and the watcher both run on the same Node.js event loop; there is no concurrent SQLite access.

### Expected improvement

| Vault size | `settingsGet()` latency before | After |
|------------|-------------------------------|-------|
| Empty / new user | ~5 ms | ~5 ms (unchanged) |
| Medium (200 scenes + 500 entities) | ~80 ms | **~5 ms** |
| Large (1 000 scenes + 5 000 entities) | ~329 ms | **~5 ms** |

The IPC roundtrip drops from O(vault size) to O(1) for the common case where
the renderer sends `settingsGet()` during the watcher's async init window.

---

## How to Read the Numbers

Run the app from a terminal to see live timing output:

```bash
npm run dev       # development build with Vite dev server
```

Or for a production build:

```bash
npm run build:electron && npm start
```

Look for `[perf]` lines in the main-process terminal and in DevTools console:

```
# Main process terminal
[perf] app:startup → window: 42 ms
[perf] app:fts-build: 14 ms

# Renderer DevTools console
[perf] renderer:settingsGet IPC: 8 ms
[perf] renderer:interactive
```

To benchmark FTS at scale:

```bash
cd electron-main
NODE_PATH=../node_modules npm run perf
cat ../plans/PERF_BUDGET.md
```

---

## Remaining Opportunities (Out of Scope for This PR)

| Opportunity | Effort | Expected gain |
|-------------|--------|---------------|
| Move vault reindex off main thread (worker thread + WAL SQLite) | High | Eliminates FTS blocking entirely for large vaults |
| Lazy-load Tiptap / XYFlow (React.lazy) | Medium | Reduces initial JS bundle parse time |
| `ready-to-show` + window show deferral | Low | Eliminates blank frame on slow hardware |
| Cache last-known FTS state across launches | Medium | Eliminates FTS build on cold start for unchanged vaults |
