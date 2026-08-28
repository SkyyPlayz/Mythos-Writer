# SKY-10957: state.db Location — Decision

**Date:** 2026-08-27  
**Author:** FoundingEngineer  
**Status:** Decided — no move required  
**Related:** SKY-10949, SKY-10952, SKY-10730, SKY-10731, SKY-10895

---

## Decision

**`state.db` stays in `<Story Vault>/.mythos/state.db`. No relocation is required.**

The SKY-10949 Agent Vault ruling applies to *durable, agent-authored, human-readable data* (chat sessions, decision logs, board state, queue configs written by the agent). `state.db` holds a different category: a **mixed-content SQLite store that predates Agent Vault**, and its agent-owned tables are ephemeral machine caches, not the durable data the ruling was concerned with.

---

## Audit findings

### Physical layout

```
<mythosRoot>/           e.g. ~/Documents/My Novel/
  mythos.json
  Story Vault/          storyVaultRoot
    .mythos/
      state.db          ← current location
  Notes Vault/
  Agent Vault/          agentVaultRootFor(mythosRoot) — SIBLING, not child
```

Agent Vault is a **sibling** of Story Vault under `mythosRoot`. `state.db` is currently inside Story Vault's `.mythos/` tree.

### Vault-move already handles state.db correctly

`vault:move` and `vault:local-folder-move` both do:
```
closeDb() → moveVaultAtomic(<StoryVault>, <target>) → openDb(newRoot)
```
`moveVaultAtomic` moves the entire Story Vault tree — including `.mythos/state.db`. So `state.db` already travels with Story Vault on every move. This is the correct behavior for the author-decision tables it contains.

Moving `state.db` to Agent Vault would *break* this: Agent Vault does not move when Story Vault moves. We'd need to teach all three move handlers to also relocate Agent Vault (or its DB file) — significant scope and new failure modes.

### Table classification

| Table | Owner | Ephemeral? | Location decision |
|---|---|---|---|
| `suggestions` | Author decision | No | Stay in Story Vault |
| `wiki_link_suggestions` | Author decision | No | Stay in Story Vault |
| `audit_log` | Author decision | No | Stay in Story Vault |
| `continuity_issues` | Author decision | No | Stay in Story Vault |
| `beta_read_comments` | Author decision | No | Stay in Story Vault |
| `notes`, `tags` | Author content | No | Stay in Story Vault |
| `timeline_entries` | Author content | No | Stay in Story Vault |
| `entity_index` | Machine cache | Yes — regenerable | Stay (see below) |
| `entity_relationships` | Machine cache | Yes — regenerable | Stay (see below) |
| `scene_entity_links` | Machine cache | Yes — regenerable | Stay (see below) |
| `background_jobs` | Machine state | Yes — ephemeral | Stay (see below) |
| `job_coverage` | Machine state | Yes — ephemeral | Stay (see below) |
| `*_fts*` | Full-text cache | Yes — regenerable | Stay |

### Why the machine tables don't need to move

**The SKY-10949 ruling's intent** was to ensure agent-authored *human-meaningful* artifacts (chat sessions the user should be able to back up, review, delete) live in Agent Vault. `entity_index`, `background_jobs`, etc. are SQLite caches:

- `entity_index` / `entity_relationships` / `scene_entity_links` — derived from the vault's own prose. Deleted or corrupted → regenerated on next scan. Not user data.
- `background_jobs` / `job_coverage` — transient job queue. App restart already re-queues pending work. Not user data.

Moving ephemeral caches to Agent Vault gains nothing: they don't back up meaningfully, and they can't be synchronized because they're process-local machine state.

### Why splitting is not viable

`entity_relationships` and `scene_entity_links` declare FK constraints to `entity_index`:
```sql
from_entity_id TEXT NOT NULL REFERENCES entity_index(id) ON DELETE CASCADE
entity_id      TEXT NOT NULL REFERENCES entity_index(id) ON DELETE CASCADE
```
SQLite FK constraints cannot span files without `ATTACH DATABASE`. The entire `getDb()` singleton — consumed by `jobsDb.ts`, `entityIndex.ts`, `search.ts`, `budget.ts`, and 15+ other modules — would need to become a two-handle API. The blast radius of that refactor far exceeds the benefit.

### The three concrete risks from the ticket, adjudicated

| Risk | Verdict | Rationale |
|---|---|---|
| Copying Story Vault without Agent Vault silently drops agent machine state | Accepted | `background_jobs`/`entity_index` are ephemeral. The copy is complete: author-decision data travels with Story Vault exactly as expected. |
| Deleting Agent Vault does not remove all agent data | Accepted | `entity_index` is regenerable. The durable agent data (chat sessions, decisions) DOES live in Agent Vault after SKY-10952. `state.db` caches do not belong there. |
| Notes Vault-only sync never sees the fact ledger | Not a real risk today | Notes Vault as a standalone sync target (without Story Vault) is not a supported scenario. Main process always opens Story Vault → `getDb()` is always available. If we ever ship standalone Notes Vault sync, revisit then. |

---

## Implementation scope (SKY-10957)

**No code changes.** This ticket's scope was "decide and scope, not build blind." Decision is made:

- `state.db` stays in `<Story Vault>/.mythos/state.db`.
- The vault-move coverage from SKY-10895 already handles it correctly (state.db moves with Story Vault).
- No DB split, no second file, no new migration.

### One small follow-up to file

The `SUGGESTION_CONTRACT.md` comment at line 375 documents the path as `<vault>/.mythos/state.db`. Once the v2 Mythos layout is widespread, update that doc to be explicit: `<Story Vault>/.mythos/state.db` — not Agent Vault. (Low priority, doc-only.)

---

## If this needs to change later

The only future trigger that would re-open this decision is shipping **standalone Notes Vault sync** where the user can sync Notes Vault without Story Vault. In that scenario, entity_index (which is built from Notes Vault content) has no storage home. File a new ticket at that point.
