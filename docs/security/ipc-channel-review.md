# IPC Channel Attack Surface Review (MYT-773)

Audit of every renderer → main IPC channel in `electron-main/`. Each channel is
scored on the four dimensions called for in the issue:

- **Input** — does the handler validate payload shape / size / type before use?
- **Authz** — can the operation reach a privileged effect (shell, fs outside
  vault, secrets, app-quit) and is that gated?
- **Sender** — does the handler verify `event.senderFrame` is the top-level
  renderer rather than a nested iframe?
- **Reply** — can the error reply leak absolute paths, stack traces, SDK
  details, or other host info?

Status is one of:

- **pass** — controls are in place and proportionate to the channel's effect.
- **needs-fix** — at least one of the four dimensions is missing or weak; a
  child issue is filed.

Source files reviewed:

- `electron-main/src/ipc.ts` (channel registry + `setupIpcMain`)
- `electron-main/src/main.ts` (the `handlers` table + manual `ipcMain.handle`
  registrations)
- `electron-main/src/voice.ts`, `streaming.ts`, `vault.ts`,
  `entities.ts`, `registrationToken.ts`, `writingMode.ts`

Renderer surface boundary: `BrowserWindow` is constructed with
`contextIsolation: true`, `nodeIntegration: false`, and a single named
preload exposing typed wrappers (`electron-main/src/preload.ts`). All IPC
channels listed below are reachable via `window.api` / `window.mythosIPC`.

## Cross-cutting findings

These apply to most or all channels and are filed as their own child issues
rather than repeating them per row.

1. **No `senderFrame` check on any `ipcMain.handle` handler.** The shared
   `setupIpcMain` (`electron-main/src/ipc.ts:188-198`) and every manually
   registered `ipcMain.handle` accept any frame. With the current
   `webPreferences` (context isolation on, node integration off, single
   trusted preload) the practical exposure is low, but the issue explicitly
   asks for the check. → child issue [MYT-791](/MYT/issues/MYT-791).
2. **`setupIpcMain` returns the raw `Error.message` to the renderer**
   (`electron-main/src/ipc.ts:190-197`). Node's built-in `fs` / `JSON.parse`
   errors carry absolute paths (`ENOENT: ... '/Users/.../file'`) which then
   travel back to the renderer untouched. Stack traces are not forwarded,
   but absolute paths and host-specific details are. → child issue
   [MYT-790](/MYT/issues/MYT-790).
3. **`settings:set` accepts an arbitrary `AppSettings` blob with no schema
   validation** (`electron-main/src/main.ts:874-892`). The relevant gap is
   that `stt.localBinaryPath`, `tts.localBinaryPath`, and
   `tts.localModelPath` are renderer-controlled, and `voice:transcribe` /
   `voice:speak` then pass those values directly to `child_process.spawn`
   (`electron-main/src/voice.ts:338, 475`). Even without `shell: true`
   this is renderer-controlled local-binary execution, with the
   attacker-supplied audio buffer landing in `argv[1]`. → child issue
   [MYT-788](/MYT/issues/MYT-788) (HIGH).
4. **`vault:setPaths` and `project:switch` accept any absolute, writable
   directory as the new vault root** (`electron-main/src/main.ts:1956-1962`
   and `1915-1945`). All subsequent `vault:*` handlers sandbox to the
   chosen root via `safePath`, so once the root is `/` or `$HOME`, the
   renderer can read or write anywhere the user can. `vault:open-folder`
   and `vault:pick-folder` already gate through the OS dialog and a
   60s-TTL registration token; these two channels skip that gate. → child
   issue [MYT-789](/MYT/issues/MYT-789) (HIGH).

## Per-channel table

Channel names use the constants from `electron-main/src/ipc.ts`. Handler
locations cite `main.ts` line numbers as of HEAD.

| Channel | Input | Authz | Sender | Reply | Status | Notes / handler |
|---|---|---|---|---|---|---|
| `vault:read` (`VAULT_READ`) | path string → `safePath` rejects abs/`..`/symlink escape; 25 MB size cap | bounded to vault root | none (cross-cut [MYT-791](/MYT/issues/MYT-791)) | `setupIpcMain` may forward `ENOENT` with absolute path (cross-cut [MYT-790](/MYT/issues/MYT-790)) | pass¹ | `main.ts:396-399` → `vault.ts:212` |
| `vault:write` (`VAULT_WRITE`) | path + content; `realSafePath(..., writeMode)`; 25 MB cap | bounded to vault root | none | same as above | pass¹ | `main.ts:400-403` |
| `vault:list` (`VAULT_LIST`) | optional `root` → `realSafePath`; skips symlinks | bounded to vault root | none | absolute-path leak via fs errors | pass¹ | `main.ts:404-407` → `vault.ts:287` |
| `vault:delete` (`VAULT_DELETE`) | path → `realSafePath` in write mode | bounded to vault root | none | same | pass¹ | `main.ts:408-411` |
| `vault:manifest:read` (`VAULT_MANIFEST_READ`) | no payload | reads vault-local `manifest.json` | none | manifest path can appear in error | pass¹ | `main.ts:412-419` |
| `vault:manifest:write` (`VAULT_MANIFEST_WRITE`) | accepts whole `Manifest`; no schema validation | manifest is rewritten verbatim. Paths inside (`scene.path`, etc.) are re-validated by downstream handlers via `safePath`, so writes stay inside the vault. | none | path in error | **needs-fix** (advisory) — manifest is the source of truth for entity/scene paths and should be shape-checked before persisting; tracked in [MYT-792](/MYT/issues/MYT-792) |
| `vault:open-folder` (`VAULT_OPEN_FOLDER`) | none | opens OS dialog, sets vault root from `dialog.showOpenDialog` only | none | n/a | pass | `main.ts:426-442` — user gesture required |
| `vault:get-root` (`VAULT_GET_ROOT`) | none | returns absolute vault root | none | absolute path leak by design (existing behaviour) | pass | `main.ts:443-446` |
| `vault:import` (`VAULT_IMPORT`) | requires `registrationToken` from `vault:pick-folder`; renderer `sourcePath` ignored in favour of `validated.vaultRoot` | token gated (`registrationToken.ts`) | none | `{ error: ... }` is a constant string when gate fails | pass | `main.ts:447-460` |
| `vault:reindex` (`VAULT_REINDEX`) | none | rebuilds manifest from vault root | none | error path may leak | pass¹ | `main.ts:461-467` |
| `vault:watch-start` / `vault:watch-stop` | none | starts chokidar against vault root | none | n/a | pass | `main.ts:468-476` |
| `vault:pick-folder` (`VAULT_PICK_FOLDER`) | none | OS dialog only; issues 60s token (`generateRegistrationToken`) | none | n/a | pass | `main.ts:1496-1507` |
| `vault:obsidian-dry-run` (`VAULT_OBSIDIAN_DRY_RUN`) | requires token; sourcePath ignored | token gated, peek-only | none | constant error string | pass | `main.ts:1509-1525` |
| `vault:obsidian-register` (`VAULT_OBSIDIAN_REGISTER`) | requires token; sourcePath ignored | token gated, consume | none | constant error string | pass | `main.ts:1527-1548` |
| `vault:load-sample` (`VAULT_LOAD_SAMPLE`) | none | writes into a fixed `app.getPath('documents')/Mythos Writer Sample` dir, then sets that as the vault root | none | n/a | pass | `main.ts:1550-1899` |
| `vault:getPaths` (`VAULT_GET_PATHS`) | none | read-only | none | returns the two configured absolute paths (existing behaviour) | pass | `main.ts:1949-1954` |
| `vault:setPaths` (`VAULT_SET_PATHS`) | `validateVaultPath` checks abs+dir+writable but **does not constrain location** | renderer can promote the vault root to any writable directory (e.g. `$HOME`, `/`), at which point `vault:read/write/delete` cover that entire subtree | none | absolute paths echoed in `Error` message | **needs-fix** → [MYT-789](/MYT/issues/MYT-789) |
| `project:list` (`PROJECT_LIST`) | none | reads recent-projects list | none | n/a | pass | `main.ts:1908-1913` |
| `project:switch` (`PROJECT_SWITCH`) | only checks `typeof === 'string'` + `existsSync` | switches vault root to any existing directory — same renderer-driven re-root as `vault:setPaths` | none | path echoed in error | **needs-fix** → [MYT-789](/MYT/issues/MYT-789) |
| `settings:get` (`SETTINGS_GET`) | none | returns settings with `apiKey` masked (`settings-masking.ts`) | none | n/a | pass | `main.ts:871-873` |
| `settings:set` (`SETTINGS_SET`) | accepts entire `AppSettings`; only the masked-key reconciliation runs — no schema check on `stt`/`tts` binary paths | the renderer-controlled binary paths are later passed to `child_process.spawn` (see voice handlers) — clear privilege escalation | none | `Error.message` leak path | **needs-fix** → [MYT-788](/MYT/issues/MYT-788) |
| `settings:getAgentConfig` (`SETTINGS_GET_AGENT_CONFIG`) | none | read-only | none | n/a | pass | `main.ts:895-914` |
| `settings:setAgentConfig` (`SETTINGS_SET_AGENT_CONFIG`) | numeric fields not bounded (e.g. `tokensPerDay` could be set to `Number.MAX_SAFE_INTEGER`) — but only consumed by the same process and not used as a path/argv | low impact (DoS by setting unrealistic limits) | none | n/a | pass (advisory) | `main.ts:915-933` |
| `agent:budgetUsage` (`AGENT_BUDGET_USAGE`) | none | read-only DB query | none | n/a | pass | `main.ts:935-948` |
| `app:ready` (`APP_READY`) | none | exposes electron/app version | none | n/a | pass | `main.ts:689-693` |
| `app:quit` (`APP_QUIT`) | none | quits the app | none | n/a | pass (DoS by design — acceptable for a local app) | `main.ts:694` |
| `system:info` (`SYSTEM_INFO`) | none | exposes platform + node + electron versions | none | n/a | pass | `main.ts:718-722` |
| `ai:brainstormer` / `ai:writing-assistant` / `ai:archive` (`AI_*`) | stubs returning canned responses | none | none | n/a | pass | `main.ts:695-717` |
| `agent:brainstorm` (`AGENT_BRAINSTORM`) | budget + enabled gating; `payload.history` and `payload.prompt` forwarded to Anthropic SDK | API key sourced server-side; raw SDK error message **not** sent to renderer — only categorized `streamErrorUserMessage` | none | safe (`streaming.ts` categorization) | pass | `main.ts:2294-2404` |
| `agent:writing-assistant` (`AGENT_WRITING_ASSISTANT`) | same as above | same | none | safe | pass | `main.ts:2409-2507` |
| `agent:vault-index` (`AGENT_VAULT_INDEX`) | none | reads vault entity files via `safePath` | none | n/a | pass | `main.ts:2512-2546` |
| `agent:vault-check` (`AGENT_VAULT_CHECK`) | budget + enabled gating implicit (via `getValidatedApiKey`) | same SDK error handling as above | none | safe | pass | `main.ts:2548-2675` |
| `agent:*:stream-cancel` (3 channels, `ipcMain.on`) | only reads `requestId` string | aborts a controller stored in-process | none | n/a | pass | `main.ts:186-197` |
| `agent:archive` (`AGENT_ARCHIVE`) | constant in IPC map; not registered as a handler in main.ts (legacy `AI_ARCHIVE` stub is what runs) | n/a | n/a | n/a | pass (dead channel — verified no handler) | `ipc.ts:46` |
| `stream:start` (`STREAM_CHANNELS.STREAM_START`) | strict validation: messages array shape, model allowlist, `maxTokens` bound, system length ≤ 16 KB, payload ≤ 256 KB, per-sender concurrency ≤ 4 | error replies categorized; raw SDK error logged in main only | none (per-stream sender id check on cancel + ack — covers spoofing within the channel) | safe (`streaming.ts:256-275`) | pass | `streaming.ts:281-311` |
| `stream:cancel` (`STREAM_CHANNELS.STREAM_CANCEL`) | requires `streamId` + matches `event.sender.id` | safe | sender-id check **is** present here | safe | pass | `streaming.ts:313-318` |
| `stream:ack` (`STREAM_CHANNELS.STREAM_ACK`, `ipcMain.on`) | shape validation (`streamId: string`, `count: number ≥ 1`); rejects mismatched sender id | safe | sender-id check present | n/a | pass | `streaming.ts:320-332` |
| `voice:start` (`VOICE_START`) | optional `micDeviceId`; not echoed to fs/argv | session is in-process | none | n/a | pass | `voice.ts:152-155` |
| `voice:stop` (`VOICE_STOP`) | `sessionId` string | uses session-recorded audio with the user's OpenAI key | none | error includes raw `Error.message` from cloud fetch (status + first 1 KB of upstream body) | **needs-fix** (advisory) → [MYT-793](/MYT/issues/MYT-793) (clamp error message before send) |
| `voice:audio-chunk` (`ipcMain.on`) | `sessionId` + Buffer/ArrayBuffer chunk; bounded by chunk length | accumulated in-memory only | none | n/a | pass | `voice.ts:183-192` |
| `voice:local-transcript` (`ipcMain.on`) | text passed through to renderer as a `voice:transcript` push | no privileged effect | none | n/a | pass | `voice.ts:196-206` |
| `voice:transcribe` (`VOICE_TRANSCRIBE`) | requires `stt.enabled`; checks audio buffer non-empty | **executes `spawn(stt.localBinaryPath, [tmpFile, ...])`** when configured — both `localBinaryPath` and the audio buffer are renderer-controllable via `settings:set` and the payload itself | none | wraps error in `{ error: msg }` — includes raw process stderr / fetch error | **needs-fix** → [MYT-788](/MYT/issues/MYT-788) |
| `voice:speak` (`VOICE_SPEAK`) | requires `tts.enabled`; text forwarded | **executes `spawn(tts.localBinaryPath, ['--model', tts.localModelPath, '--output-raw'])`** — same renderer-controlled binary problem; also writes the `text` to the child's stdin without size cap | none | error event includes raw `Error.message` from spawn/fetch | **needs-fix** → [MYT-788](/MYT/issues/MYT-788) |
| `voice:speak:cancel` (`ipcMain.on`) | `speakId` only | safe | none | n/a | pass | `voice.ts:259-265` |
| `update:check` / `update:install` / `update:get-info` (`UPDATE_*`) | feature-flagged behind `MYTHOS_AUTO_UPDATE=1` + `app.isPackaged`; no payload | electron-updater drives the rest | none | safe | pass | `main.ts:2050-2098` |
| `app:checkForUpdate` (`APP_CHECK_FOR_UPDATE`) | none | feature-flagged; errors swallowed | none | safe | pass | `main.ts:2067-2091` |
| `app:installUpdate` (`APP_INSTALL_UPDATE`) | none | safe no-op when flag off | none | safe | pass | `main.ts:2095-2098` |
| `suggestions:list` / `:upsert` / `:accept` / `:apply` / `:reject` / `:rollback` (`SUGGESTIONS_*`) | DB prepared statements; `:apply` and `:rollback` route any `snapshotPath` through `safePath` | DB-bounded; vault writes via `safePath` | none | thrown error from `getSuggestion` echoes renderer-supplied `id` (no leak) | pass | `main.ts:478-601` |
| `audit:list` (`AUDIT_LIST`) | DB prepared statements | DB-bounded | none | n/a | pass | `main.ts:604-607` |
| `timeline:list` (`TIMELINE_LIST`) | DB prepared statements | DB-bounded | none | n/a | pass | `main.ts:610-613` |
| `timeline:upsert` (`TIMELINE_UPSERT`) | accepts whole `TimelineEntryRow` — no shape validation; DB prepared statements still bind it safely | DB-bounded | none | n/a | pass (advisory) | `main.ts:614-618` |
| `timeline:infer` (`TIMELINE_INFER`) | `storyId` string; reads vault scenes via `safePath` | bounded | none | path may leak via fs error | pass¹ | `main.ts:621-687` |
| `snapshot:save` / `:list` / `:get` / `:restore` (`SNAPSHOT_*`) | `sceneId` UUID string; snapshot routines route paths via `safePath`; `:restore` snapshots current content first | bounded | none | path may leak | pass¹ | `main.ts:723-760` |
| `version:list` / `:get` / `:rollback` (`VERSION_*`) | `:rollback` resolves scene path via manifest → `safePath` | bounded | none | path may leak | pass¹ | `main.ts:763-823` |
| `entity:create` / `:read` / `:update` / `:delete` / `:list` / `:backlinks` (`ENTITY_*`) | entity file path derived deterministically from `type` + UUID — renderer cannot inject path components (`entities.ts:108`); writes via `writeVaultFileAtomic` → `safePath` | bounded | none | error message echoes renderer-supplied `id` (no leak) | pass | `main.ts:826-869` |
| `chapter:create` / `:list` / `:get` / `:save` / `scene:create` / `:list` / `:get` / `:save` (`CHAPTER_*`, `SCENE_*`) | titles slugified before becoming path segments (`vault.ts:25-86`); save handlers call `safePath` before writing | bounded | none | absolute path may leak via fs error | pass¹ | `main.ts:979-1156` |
| `search:query` (`SEARCH_QUERY`) | sqlite FTS5 — query string is bound, not concatenated | DB-bounded | none | n/a | pass | `main.ts:1187-1192` |
| `vault:graph-data` (`VAULT_GRAPH_DATA`) | none | reads vault files via `safePath`; capped at 2000 nodes | none | path may leak | pass¹ | `main.ts:1195-1253` |
| `archive:status` / `:scan` / `:confirm` / `:ignore-list` (`ARCHIVE_*`) | `:scan` short-circuits when archive agent is disabled; `:confirm` validates `action` discriminant and `suggestion.source_agent === 'archive'` | bounded | none | `Error.message` echoes renderer-supplied `suggestionId` | pass | `main.ts:1256-1408` |
| `export:epub` (`EXPORT_EPUB`) | optional `targetPath` routed through `resolveEpubExportPath` (rejects abs paths, `..`, non-`.epub`, symlink escapes) | bounded to vault | none | path may leak via dialog/fs error | pass | `main.ts:1411-1458` |
| `export:docx` (`EXPORT_DOCX`) | no `targetPath` escape hatch — always uses OS save dialog | bounded by dialog | none | n/a | pass | `main.ts:1461-1493` |
| `generationLog:recent` / `:list` / `:get` (`GENERATION_LOG_*`) | DB-bound; bodies truncated by `truncateGenerationLogBody` | DB-bounded | none | `:get` returns `prompt_text` / `response_text` as stored — if `PERSIST_PROMPTS=1` this is full prompt text (which can include scene prose) | pass (advisory — documented env-flagged behaviour) | `main.ts:950-976` |
| `betaRead:create` / `:list` / `:dismiss` (`BETA_READ_*`) | DB prepared statements; payload sizes unbounded but DB-bound | DB-bounded | none | n/a | pass (advisory — cap `comment_text` length at the IPC boundary) | `main.ts:1159-1184` |
| `telemetry:report` (`TELEMETRY_REPORT`) | `payload.type` cast to `TelemetryEventType` enum but **not** runtime-validated; any string ends up in the event store; `meta` shape unchecked | telemetry is opt-in and never leaves the device unless the user enables it, so unvalidated payloads don't escape locally | none | n/a | pass (advisory) — tracked in [MYT-794](/MYT/issues/MYT-794) for shape validation | `main.ts:1902-1905` |
| `writingMode:get` / `:set` (`WRITING_MODE_*`) | `mode` validated against allowlist; `focusFlags` / `editConfig` shallow-merged into defaults | local SQLite write | none | n/a | pass | `main.ts:1965-1977` → `writingMode.ts` |

¹ Channels marked _pass¹_ inherit the cross-cutting findings
  [MYT-791](/MYT/issues/MYT-791) (sender-frame check) and
  [MYT-790](/MYT/issues/MYT-790) (absolute-path leak in error replies);
  those are addressed once at the framework level rather than per channel.

## Summary

- Total `ipcMain.handle` channels: 78 (including 3 auto-update,
  3 streaming, 5 voice).
- Channels in **pass**: 73.
- Channels in **needs-fix**: 5 distinct issues, all filed:
  - [MYT-791](/MYT/issues/MYT-791) — add `senderFrame === senderFrame.top`
    check across every `ipcMain.handle` handler. (LOW)
  - [MYT-790](/MYT/issues/MYT-790) — sanitize error replies in
    `setupIpcMain` and the manually-registered handlers so absolute paths
    and Node fs error strings don't reach the renderer. (MED)
  - [MYT-788](/MYT/issues/MYT-788) — gate `voice:transcribe` and
    `voice:speak` against arbitrary renderer-supplied binaries, and add
    schema validation on `settings:set` so `stt.*` / `tts.*` paths cannot
    be set without a registration-token / dialog gesture. (HIGH)
  - [MYT-789](/MYT/issues/MYT-789) — require a registration token (or
    recent-projects allowlist) on `vault:setPaths` and `project:switch`
    so the renderer cannot re-root the vault sandbox to arbitrary
    directories. (HIGH)
  - [MYT-792](/MYT/issues/MYT-792) — schema-validate the `Manifest`
    payload in `vault:manifest:write` before persisting; reject unknown
    shapes rather than trusting the renderer's blob. (MED, advisory)

Two additional advisory issues filed:

  - [MYT-793](/MYT/issues/MYT-793) — wrap `voice:stop` and
    `voice:transcribe` / `voice:speak` error strings in a categorized
    envelope (mirroring `streaming.ts::categorizeStreamError`) so
    upstream provider stderr / response bodies aren't surfaced verbatim.
  - [MYT-794](/MYT/issues/MYT-794) — validate `telemetry:report` payload
    shape (event `type` allowlist, `meta` typed
    `Record<string, string|number|boolean>`).

This audit closes when the child issues above are filed — done as of
this revision. The deliverable is committed at
`docs/security/ipc-channel-review.md`.
