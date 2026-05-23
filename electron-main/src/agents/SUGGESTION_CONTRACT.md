# Suggestion Contract

Cross-agent suggestion lifecycle: payload schema, IPC surface, auto-apply policy, budget caps, snapshots, audit log, and rollback.

---

## 1. Payload Schema

All suggestion state lives in SQLite (`<vault>/.mythos/state.db`, `suggestions` table). The canonical TypeScript shape is `SuggestionRow` from `ipc.ts` and `DbSuggestion` from `db.ts` — kept in sync manually.

```ts
// ipc.ts — SuggestionRow (renderer-facing)
interface SuggestionRow {
  id: string;                              // UUIDv4
  source_agent: SourceAgent | string;      // 'writing-assistant' | 'brainstorm' | 'archive'
  confidence: number;                      // 0..1 float
  rationale: string;                       // human-readable reason for the suggestion
  target_kind: 'vault' | 'manuscript' | null;  // where the payload should land
  target_path: string | null;              // vault-relative path to the target file
  target_anchor: string | null;           // optional heading / line anchor within the file
  payload_json: string | null;             // JSON string: { content?: string; prose?: string; … }
  status: SuggestionStatus;               // see §3 — Status Transitions
  created_at: string;                      // ISO-8601
  applied_at: string | null;              // ISO-8601 when accepted/applied, null otherwise
  applied_run_id: string | null;          // run-id that applied the suggestion (or 'auto-apply')
  budget_exceeded: number;                 // 1 if blocked by a budget cap; 0 otherwise
}

type SourceAgent   = 'writing-assistant' | 'brainstorm' | 'archive';
type SuggestionStatus = 'proposed' | 'accepted' | 'rejected' | 'applied' | 'rolled_back';
```

### Field notes

| Field | Description |
|---|---|
| `source_agent` | Identifies which AI agent produced the suggestion. Budget enforcement is keyed on this field. |
| `confidence` | Normalized 0–1 score. The auto-apply engine rejects suggestions below `confidenceThreshold`. |
| `rationale` | Shown verbatim in the Suggestion Review panel. Agents should write one clear sentence. |
| `target_kind` | `vault` → the suggestion touches a vault entity file and will be applied by `vault.ts`. `manuscript` → advisory only; `accept` records the decision but never edits prose. |
| `payload_json` | For vault suggestions, must deserialize to `{ content: string }` or `{ prose: string }`. Manuscript suggestions may include any advisory payload. |
| `budget_exceeded` | Set to `1` by the auto-apply engine when the suggestion was blocked by a rate or token cap. The UI surfaces this as a budget-blocked badge. |

---

## 2. IPC Surface

All suggestion operations cross the Electron context-isolation boundary via `contextBridge` (`preload.ts → window.api`). Main-process handlers live in `main.ts`.

### 2.1 Channel names

```ts
// ipc.ts — IPC_CHANNELS (suggestions slice)
SUGGESTIONS_LIST:     'suggestions:list'
SUGGESTIONS_UPSERT:   'suggestions:upsert'   // agents call this to submit a suggestion
SUGGESTIONS_ACCEPT:   'suggestions:accept'   // user or auto-apply accepts + applies vault suggestions
SUGGESTIONS_APPLY:    'suggestions:apply'    // low-level apply with explicit snapshotPath
SUGGESTIONS_REJECT:   'suggestions:reject'   // user rejects a proposed suggestion
SUGGESTIONS_ROLLBACK: 'suggestions:rollback' // one-click rollback of an applied vault suggestion

AUDIT_LIST:           'audit:list'           // fetch audit log (optionally filtered by suggestion id)
```

> **Note on SUGGESTION_IGNORE:** There is no dedicated ignore channel. Dismissing a suggestion from the UI calls `suggestions:reject` with a `reason` of `"dismissed"`. Both map to the `rejected` status in the DB.

### 2.2 Request / response types

#### `suggestions:list`
```ts
// Request
interface SuggestionsListPayload {
  status?: SuggestionStatus;          // filter by status; omit for all
  sourceAgent?: SourceAgent | string; // filter by agent; omit for all
}

// Response
interface SuggestionsListResponse {
  suggestions: SuggestionRow[];       // ordered by created_at DESC
}
```

#### `suggestions:upsert`
Agents use this channel to submit new suggestions (or update existing ones with the same `id`).

```ts
// Request
interface SuggestionsUpsertPayload {
  suggestion: SuggestionRow;   // full row; status should be 'proposed'
}

// Response
interface SuggestionsUpsertResponse {
  id: string;  // echoed suggestion id
}
```

**Auto-apply side-effect:** immediately after `upsert`, the main process evaluates the auto-apply policy (§4). If the policy fires, the suggestion is transitioned to `accepted`/`applied` within the same synchronous handler and an audit row is written.

#### `suggestions:accept`
User-initiated accept. For `target_kind: 'vault'` suggestions, this also applies the payload to the vault file and snapshots the original.

```ts
// Request
interface SuggestionsAcceptPayload {
  id: string;
  actor?: string;  // defaults to 'user'
}

// Response
interface SuggestionsAcceptResponse {
  id: string;
  status: 'accepted' | 'applied';  // 'applied' when vault write succeeded
  auditId: string;
}
```

#### `suggestions:reject`
```ts
// Request
interface SuggestionsRejectPayload {
  id: string;
  reason?: string;  // optional free-text; 'dismissed' for UI ignore actions
  actor?: string;   // defaults to 'user'
}

// Response
interface SuggestionsRejectResponse {
  id: string;
  auditId: string;
}
```

#### `suggestions:rollback`
Restores the vault file from the snapshot that was saved during `accept`. Only valid when `status === 'applied'`.

```ts
// Request
interface SuggestionsRollbackPayload {
  id: string;
  actor?: string;  // defaults to 'user'
}

// Response
interface SuggestionsRollbackResponse {
  id: string;
  auditId: string;
  restoredPath: string | null;  // vault-relative path that was restored; null if nothing to restore
}
```

#### `audit:list`
```ts
// Request
interface AuditListPayload {
  suggestionId?: string;  // omit to fetch entire log
}

// Response
interface AuditListResponse {
  entries: AuditLogRow[];  // ordered by created_at DESC
}

interface AuditLogRow {
  id: string;
  suggestion_id: string;
  action: 'accept' | 'apply' | 'reject' | 'rollback';
  snapshot_path: string | null;  // vault-relative path to the pre-apply snapshot JSON
  actor: string;                  // 'user' | 'auto_applied' | custom
  created_at: string;             // ISO-8601
}
```

### 2.3 Preload bridge (`window.api`)

```ts
window.api.suggestionsList(status?, sourceAgent?) → Promise<SuggestionsListResponse>
window.api.suggestionsUpsert(suggestion)           → Promise<SuggestionsUpsertResponse>
window.api.suggestionsAccept(id, actor?)           → Promise<SuggestionsAcceptResponse>
window.api.suggestionsReject(id, reason?, actor?)  → Promise<SuggestionsRejectResponse>
window.api.suggestionsRollback(id, actor?)         → Promise<SuggestionsRollbackResponse>
window.api.auditList(suggestionId?)                → Promise<AuditListResponse>
```

---

## 3. Status Transitions

Status transitions are append-only. Moving to a terminal state (`rejected`, `applied`, `rolled_back`) is irreversible at the DB level.

```
                    ┌──────────┐
                    │ proposed │◄── agent upserts here
                    └────┬─────┘
              ┌──────────┼──────────────┐
              ▼          ▼              ▼
         ┌──────────┐ ┌──────────┐  budget_exceeded=1
         │ accepted │ │ rejected │  (still proposed, blocked badge)
         └────┬─────┘ └──────────┘
              │  vault write
              ▼
         ┌──────────┐
         │  applied │
         └────┬─────┘
              │  rollback
              ▼
        ┌─────────────┐
        │ rolled_back │
        └─────────────┘
```

- `proposed → accepted`: non-vault suggestions; `accept` records the decision, no file write.
- `proposed → applied`: vault suggestions; `accept` snapshots the original and writes the new content.
- `proposed → rejected`: user rejects or dismisses.
- `applied → rolled_back`: `rollback` restores the original from snapshot.

---

## 4. Auto-Apply Policy

**Source:** `budget.ts → evaluateAutoApply()`, called inline during `suggestions:upsert`.

### 4.1 Per-agent settings

Each agent has an independent policy block in `AppSettings.agents`:

```ts
// ipc.ts — AgentBudgetSettings (also in budget.ts)
interface AgentBudgetSettings {
  autoApply: boolean;          // master on/off (default: false)
  confidenceThreshold: number; // 0..1; suggestion must reach this to auto-apply (default: 0.85)
  maxTokensPerHour: number;    // rolling 1-hour token cap across in + out (default: 100,000)
  maxSuggestionsPerHour: number; // rolling 1-hour suggestion count cap (default: 50)
}
```

Full `AppSettings.agents` shape:

```ts
agents: {
  writingAssistant: { enabled: boolean; model: string; scanIntervalSeconds: number } & AgentBudgetSettings;
  brainstorm:       { enabled: boolean; model: string } & AgentBudgetSettings;
  archive:          { enabled: boolean; model: string; continuityCheckIntervalSeconds: number } & AgentBudgetSettings;
}
```

Default values (from `main.ts → AGENT_BUDGET_DEFAULTS`):

| Setting | Default |
|---|---|
| `autoApply` | `false` |
| `confidenceThreshold` | `0.85` |
| `maxTokensPerHour` | `100,000` |
| `maxSuggestionsPerHour` | `50` |

### 4.2 Evaluation order

`evaluateAutoApply(confidence, sourceAgent, settings, db)` short-circuits in this order:

1. `autoApply === false` → stay `proposed`, no budget check.
2. `confidence < confidenceThreshold` → stay `proposed`, no budget check.
3. `countSuggestionsInWindow(agent, 1h) >= maxSuggestionsPerHour` → `budgetExceeded = true`, stay `proposed`.
4. `countTokensInWindow(agent, 1h) >= maxTokensPerHour` → `budgetExceeded = true`, stay `proposed`.
5. All checks pass → `shouldAutoApply = true`.

### 4.3 Budget tracking

Budget windows are derived from live DB queries (no in-memory cache):

- **Suggestion count:** `COUNT(*) FROM suggestions WHERE source_agent = ? AND created_at >= <windowStart>` — counts all suggestions in the window regardless of status.
- **Token count:** `SUM(tokens_in + tokens_out) FROM generation_log WHERE agent = ? AND created_at >= <windowStart>` — uses the generation log populated by each agent's streaming handler.

The window is always `Date.now() - 3,600,000 ms` (rolling 1-hour window, not a clock-aligned bucket).

### 4.4 `source_agent` → settings key mapping

```ts
// main.ts — SOURCE_AGENT_TO_SETTINGS_KEY
'writing-assistant' → agents.writingAssistant
'brainstorm'        → agents.brainstorm
'archive'           → agents.archive
```

Unknown `source_agent` values have no budget enforcement and will never auto-apply.

---

## 5. Snapshots and Audit Log

### 5.1 Pre-apply snapshot

When `suggestions:accept` fires on a `target_kind: 'vault'` suggestion, the main process:

1. Reads the current file content from the vault.
2. Writes a snapshot JSON to `.mythos/suggestion-snapshots/<suggestion-id>.json`:
   ```json
   { "originalContent": "<file content before apply>", "path": "<vault-relative path>" }
   ```
3. Stores the relative snapshot path (`<audit_log.snapshot_path>`) in the audit row.

Snapshot files are not pruned automatically — they persist until the user clears `.mythos/` or the vault.

### 5.2 Audit log

Every state transition writes one row to the `audit_log` table:

```ts
interface AuditLogRow {
  id: string;           // UUIDv4
  suggestion_id: string;
  action: 'accept' | 'apply' | 'reject' | 'rollback';
  snapshot_path: string | null;  // set on 'apply' and 'rollback' for vault suggestions
  actor: string;        // 'user' | 'auto_applied' | custom value from caller
  created_at: string;   // ISO-8601
}
```

Actor values:
- `'user'` — explicit user action via the Review panel.
- `'auto_applied'` — auto-apply policy triggered during `suggestions:upsert`.
- Custom strings are allowed for future agent-to-agent flows.

The audit log is append-only. No rows are deleted or updated; status transitions are inferred from the action sequence.

### 5.3 One-click rollback

`suggestions:rollback` restores a vault suggestion in one call:

1. Validates `status === 'applied'` — throws if not.
2. Locates the `apply` audit row to find `snapshot_path`.
3. Path-traversal-safe check via `safePath()` before reading.
4. Reads `snapshot.originalContent` from the snapshot JSON.
5. Writes the original content back to `snapshot.path` via `writeVaultFile`.
6. Transitions `status → 'rolled_back'`.
7. Appends a `rollback` audit row.

Manuscript suggestions (`target_kind: 'manuscript'`) cannot be rolled back — the handler throws `Suggestion is not in 'applied' state` because `accept` never advances them past `accepted`.

---

## 6. Provenance Frontmatter

When the main process applies a vault suggestion, it injects a `provenance:` key into the target file's YAML frontmatter before writing:

```yaml
---
provenance: <suggestion-id>
---
```

The manifest's `provenance` map (`Record<string, string>`) is also updated to index `suggestionId → vaultPath`.

This makes every applied suggestion traceable back to the agent run that produced it.

---

## 7. Security Notes

- `safePath()` is called before reading or writing any snapshot path supplied by a caller. Path-traversal attempts throw and abort the operation.
- The Anthropic API key never leaves the main process. `settings:get` returns a masked preview (`sk-ant-...XXXX`); the raw key is preserved in the main process and only restored when a settings update arrives with the same masked preview.
- IPC payloads are validated by TypeScript types at compile time. Runtime schema validation is not currently enforced — add it at the `setupIpcMain` boundary if untrusted renderer extensions are introduced.

---

## 8. File Map

| Path | Role |
|---|---|
| `electron-main/src/db.ts` | SQLite schema, migrations (v1–v5), CRUD helpers, budget window counters |
| `electron-main/src/budget.ts` | `evaluateAutoApply()` — pure logic, no Electron imports |
| `electron-main/src/ipc.ts` | Channel names (`IPC_CHANNELS`), all payload/response TypeScript interfaces |
| `electron-main/src/main.ts` | IPC handler implementations, `AGENT_BUDGET_DEFAULTS`, `SOURCE_AGENT_TO_SETTINGS_KEY` |
| `electron-main/src/preload.ts` | `window.api` bridge — one method per IPC channel |
| `electron-main/src/snapshots.ts` | Per-scene snapshot storage (independent of suggestion snapshots) |
| `electron-main/src/vault.ts` | `parseFrontmatter` / `serializeFrontmatter` / `safePath` used during apply |
| `<vault>/.mythos/state.db` | Runtime SQLite DB (suggestions, audit_log, generation_log, timeline_entries) |
| `<vault>/.mythos/suggestion-snapshots/` | Pre-apply snapshot JSON files, one per applied suggestion |
