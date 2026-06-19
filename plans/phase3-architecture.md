# Phase 3 Architecture: AI Subsystem IPC Contracts

**Audience:** Engineers picking up Phase 3 implementation tickets.
**Source of truth:** `electron-main/src/ipc.ts`, `streaming.ts`, `db.ts`, `suggestionCategory.ts`.

---

## 1. IPC Channel Naming Conventions

All channels follow `namespace:action` (kebab-case). The renderer never calls AI APIs or touches the filesystem directly — every privileged operation goes through an IPC channel to the main process.

| Namespace | Example channels | Direction |
|---|---|---|
| `agent:` | `agent:writing-assistant`, `agent:brainstorm`, `agent:archive` | renderer → main |
| `stream:` | `stream:start`, `stream:token`, `stream:cancel`, `stream:ack`, `stream:end`, `stream:error` | bidirectional |
| `suggestions:` | `suggestions:upsert`, `suggestions:accept`, `suggestions:apply`, `suggestions:reject`, `suggestions:rollback`, `suggestions:ignore` | renderer → main |
| `archive:` | `archive:scan-continuity`, `archive:scan-links`, `archive:cont-scan-result` | bidirectional |
| `brainstorm:` | `brainstorm:writeNote`, `brainstorm:extractProposals`, `brainstorm:proposalQueued` | bidirectional |
| `writing-assistant:` | `writing-assistant:scan-now`, `writing-assistant:scan-result`, `writing-assistant:scan-error` | bidirectional |

**Push channels** (main → renderer via `webContents.send`): `stream:token`, `stream:end`, `stream:error`, `archive:cont-scan-start/result/error`, `writing-assistant:scan-start/result/error`, `brainstorm:proposalQueued`, `agent:budget-cap`.

All `ipcMain.handle` callbacks run through `setupIpcMain`, which enforces the `isFromTopFrame` guard — calls from nested iframes or embedded WebViews are rejected with `PERMISSION_DENIED` before any handler logic runs.

---

## 2. Stream Lifecycle

```
Renderer                          Main
  │                                 │
  │──stream:start(messages, …)─────►│  returns { streamId } or { error }
  │                                 │  ← spawns AbortController, registers in StreamRegistry
  │◄─stream:token { streamId, token}│  repeated per token
  │──stream:ack { streamId, count }─►│  unblocks backpressure (max 50 pending tokens)
  │◄─stream:end { streamId }────────│  stream complete
  │    or                           │
  │◄─stream:error { streamId, … }───│  category + user-safe message
  │                                 │
  │──stream:cancel { streamId }────►│  aborts AbortController, clears registry entry
```

**Limits enforced by `streaming.ts`:**

| Constant | Value | Purpose |
|---|---|---|
| `MAX_PENDING_TOKENS` | 50 | backpressure; drops tokens until `stream:ack` drains |
| `MAX_CONCURRENT_PER_SENDER` | 4 | per renderer window |
| `MAX_TOKENS_CAP` | (see source) | hard output cap |
| `MAX_PAYLOAD_BYTES` | (see source) | input size guard |
| `MAX_SYSTEM_LENGTH` | (see source) | system prompt length guard |

`StreamStartPayload`: `{ messages: [{role, content}], system?, model?, maxTokens? }`.

Error categories: `RATE_LIMITED`, `AUTH`, `NETWORK`, `INVALID_REQUEST`, `UNKNOWN`. Only the category and a generic user-safe message reach the renderer — the raw SDK error stays in the main process log.

---

## 3. Suggestion State Machine

```
                 ┌──────────────────────────────────┐
                 ▼                                  │
 [agent upserts] proposed ──accept──► accepted      │ (auto-apply threshold or
                    │                    │           │  user deferred-apply)
                    │                    └──apply───►│
                    ├──apply──────────────────────► applied ──rollback──► rolled_back
                    ├──reject──────────────────── rejected
                    └──ignore──────────────────── ignored
```

**Status values** (`SuggestionStatus` in `db.ts`): `proposed` | `accepted` | `rejected` | `applied` | `rolled_back` | `ignored`.

`suggestions:accept` marks `accepted` (user acknowledged, not yet applied). `suggestions:apply` executes the payload and writes a `suggestion_snapshots` row (enables one-click rollback via `suggestions:rollback`). Every status transition is logged to `audit_log`.

**To add a new suggestion type:** insert a row via `suggestions:upsert` with `source_agent` set to your agent identifier, `payload_json` containing the type-specific delta, and `target_path`/`target_kind` pointing to the vault file. No schema change required for new payload shapes — `payload_json` is opaque to the DB layer. Assign a `category` from `SuggestionCategory` (`suggestionCategory.ts`) or leave null to get `'other'`.

---

## 4. SQLite Schema Overview

Database lives at `<userData>/mythos.db`. Schema version tracked via `PRAGMA user_version` (currently v19+).

**Core Phase 3 tables:**

```sql
suggestions        -- all agent proposals; status lifecycle; FTS5-indexed via suggestions_fts
audit_log          -- every status transition + actor
suggestion_snapshots -- pre-apply vault file content for rollback
provenance         -- agent_id/agent_type/run_id per entity written
generation_log     -- per-request token counts, latency, model, prompt/response text
timeline_entries   -- Archive-inferred scene timestamps + confidence
continuity_issues  -- Archive cross-chapter lore inconsistencies (open/closed)
wiki_link_suggestions -- Archive-proposed [[wiki-link]] insertions per scene
proposal_telemetry -- Brainstorm NoteProposal confirm/reject telemetry
```

FTS5 virtual table `suggestions_fts` (`suggestion_id`, `rationale`, `target_path`) powers the keyword search in the Suggestion Inbox (`suggestions:search`). Back-filled on migration.

---

## 5. Per-Agent Isolation Rules

| Rule | Mechanism |
|---|---|
| Renderer cannot access filesystem or AI APIs directly | `contextBridge` exposes only typed IPC wrappers; `nodeIntegration: false`, `contextIsolation: true` |
| Only top-level renderer frame may invoke IPC | `isFromTopFrame(event)` check in every `ipcMain.handle` wrapper |
| Streaming is scoped per renderer window | `StreamRegistry` keys entries by `sender.id`; max 4 concurrent per sender |
| Each AI request has an independent abort path | `AbortController` per stream; legacy non-stream requests use `Map<requestId, AbortController>` |
| File path registration tokens | Folder picker issues a one-shot, 60-second TTL token; vault write/import calls must echo it back |
| **Writing Assistant** | Propose-only — never writes vault content; all output is `suggestions:upsert` with `status='proposed'` |
| **Brainstorm Agent** | Auto-creates new Notes Vault entries (exempt from suggestion flow); edits to existing notes always go through `suggestions:upsert` |
| **Archive Agent** | Propose-only — `archive.ts` comment: *"All suggestions are proposed-only (status='proposed', never auto-applied here)"* |
| Per-agent budget enforcement | Main pushes `agent:budget-cap` to renderer when token or rate cap is hit; `generation_log` tracks every request |
| Agents do not share mutable state | Each agent call is stateless on main process side; shared state lives exclusively in SQLite and the manifest |
