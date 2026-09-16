# Fact Ledger + Continuity Check — Buildable Spec

Version: 1.1 · Status: Draft, amended per Ivy ruling · Author: CTO · Date: 2026-08-26

**Amendment (v1.1, 2026-08-26, SKY-11031):** Ivy ruled on Open Question #1 below —
**extend `fact_ledger`/`fact_provenance`/`fact_decisions`, do not parallel them.** v1.0's §0/§1
(new `manuscript_fact_*` tables at a new schema slot) is superseded by this section and by the
rewritten §1. Every other section is unchanged except for table-name references. See §0 for
the ruling's paper trail and §1 for the extended schema.

**Source of intent:** the verbatim design record captured in SKY-11018 (owner + Ivy design
session, 2026-08-25). That record is authoritative for product intent; this document turns
it into field types, interfaces, and build sequencing. Where this doc restates a settled
owner ruling, it is restating, not re-deciding.

**Board:** M12.2 (`SKY-10731`), a child of the M12 scale-architecture epic (`SKY-10729`,
ruling `SKY-10666`: vault ≠ fact ledger). Storage location is governed by the Agent Vault
final ruling (`SKY-10949`, 2026-08-19: everything belonging to a vault's machine state lives
inside `Agent Vault/`, no split).

---

## 0. Read this first — the name collision is ruled, extend not parallel

Before section 1, the ruling that reshapes everything below. **`SKY-10731` has an open,
CI-green, `in_review` PR** — **#1283**, `feat(SKY-10731): fact-ledger schema + persistent
vault index cache (M12.2)`, branch `sky-10731-fact-ledger-schema`. It landed before this
design conversation happened and built:

- table **`fact_ledger`**: generic `entity_key` / `fact_key` / `fact_value` store, keyed by
  `fingerprint = sha256(entity_key\nfact_key\nfact_value)`
- table **`fact_provenance`**: `source_path`/`source_hash`/`span_start`/`span_end`, FK'd to
  `fact_ledger.id`
- table **`fact_decisions`**: tombstoned dismiss/answer decisions, `fingerprint` PK
- table **`vault_index_cache`**: name/aliases/type, a persistent replacement for
  `entityIndex.ts`'s rebuild-on-open (unrelated to this spec, no change below)
- schema slot **`PRAGMA user_version = 30`**
- acceptance criteria in `electron-main/src/factLedger.acceptance.test.ts` (AC1–AC4)

`entity_key` in PR #1283 resolves to the existing vault entity/property index (the thing
`archiveContinuityEngine.ts`'s `PROPERTY_CONTRADICTION_PAIRS` and the entity panel already
use) via the same alias-resolution graph this spec's §1.3 also requires. As shipped, PR #1283
has no `scene_id`, no `kind`, no `grounding`, no `exit_value` — none of the manuscript-scene
vocabulary this spec adds. **v1.0 of this document treated that gap as license to build a
second, parallel `manuscript_fact_*` table family at a new schema slot** (v32), and named the
choice Risk #1 / Open Question #1 for Ivy to decide.

**Ivy ruled (SKY-10731 thread, 2026-08-26 11:31, superseding this doc's own Open Question
#1): extend `fact_ledger`/`fact_provenance`/`fact_decisions`, do not parallel them.** The
paper trail on `sky-10731-fact-ledger-schema` shows the ruling being worked out in real time:
commit `b87ca777` (2026-08-26 11:28 UTC) first tried a narrower fix — rename the notes-side
table `fact_ledger` → `entity_index_facts` and coexist with a separate manuscript table —
then commit `d813d9b9` (2026-08-26 11:39 UTC) reverted that rename eleven minutes later, once
the fuller "extend, don't parallel" ruling landed. **The table names on `main`/PR #1283 do not
change.** `fact_ledger`/`fact_provenance`/`fact_decisions` stay exactly as shipped in #1283;
the manuscript ledger adds columns and a `source` discriminator to those same tables instead
of inventing `manuscript_fact_*`. §1 below is the rewritten schema; no other section of v1.0
depended on the parallel-table design, so §2–§7 only need table-name reference updates (done
inline).

**Why this is sound, not just directed** — Ivy's own reasoning, confirmed against the
codebase rather than taken on faith: the continuity check this spec exists to build *is* the
query "does the manuscript's value for `(entity_key, fact_key)` match notes' value for the
same `(entity_key, fact_key)`." That only stays a plain `SELECT ... WHERE source = ?` query,
not a second subsystem kept in sync with the first, if both sides resolve to the *same*
`entity_key`/`fact_key` vocabulary — and they already do: both sides go through the same
wikilink/alias graph (`vaultGraph.ts`/`entities.ts`/`wikiLinks.ts`) that PR #1283's AC4
specifies and this doc's original §1.3 already required reusing. Extending was always
structurally available; v1.0 didn't take it because the parallel-table design predates this
ruling.

This does **not** resolve the Archive Agent naming overlap (row #1 below) — that is a
separate, still-open product question about the user-facing "Continuity Check" term, not a
schema question, and Ivy's ruling was schema-specific. Two overlapping things remain, one
resolved:

| # | What | Where | Status |
|---|---|---|---|
| 1 | Archive Agent "Continuity Scan" — one scene vs. vault notes, LLM contradiction check | `archiveContinuityEngine.ts`, `continuity_issues` table (v23) | Shipped — naming overlap with this spec still open, **Open Question #1 below** |
| 2 | `fact_ledger` + `fact_provenance` + `fact_decisions` — now a **shared** store: PR #1283's notes-side rows (`source = 'notes'`) and this spec's manuscript-scene rows (`source = 'manuscript'`) | `db.ts` v30 (PR #1283, unmerged) + a later `ALTER TABLE` migration (§1.6) for the manuscript columns | PR #1283: in review, CI green, mergeable, **unmodified by this amendment** (§1.1). Manuscript extension: net new, not started |

If a future implementer hits a concrete technical reason the shared-table design breaks down
(not found here — see §1.3's identity-recipe resolution, which was the one real structural
tension), that goes back to Ivy with the reason, not a silent fork back to parallel tables —
per the ticket's own instruction.

---

## 1. Fact schema

**Restating the settled authority ruling before the schema, since everything below depends
on it**: the ledger is derived from the manuscript and is **never authoritative over notes**.
Notes remain the series bible (design record, settled). A ledger row that conflicts with a
note is the flag — the fix lands in the notes or the manuscript, decided by the author, never
by the ledger overwriting either. Nothing in this schema stores a notes-derived value as if
it were manuscript truth; §2's blindness constraint is part of how this holds (the extractor
never sees notes content at all).

### 1.1 Storage location and format

SQLite tables inside the existing per-vault `state.db` (opened via `openDb(vaultRoot)`,
`electron-main/src/db.ts`), migrated through the existing single-integer `PRAGMA
user_version` chain — **not** a new JSON/markdown file format under `Agent Vault/`. This
matches how every other durable subsystem in this codebase versions itself (`db.ts`'s own
migration blocks; `mythos.json`'s `formatVersion` gate is the file-format analog, unused
here since this is DB-native).

**No new table names for the ledger itself (§0).** `fact_ledger`, `fact_provenance`, and
`fact_decisions` are extended in place with new nullable columns plus a `source`
discriminator — not superseded, not duplicated. `fact_flags` (§1.4) is the one genuinely new
table, since nothing in PR #1283 has an adjacency-diff-finding concept to extend.

**PR #1283 itself is not touched by this amendment.** It merges at v30 exactly as already
reviewed — don't reopen a CI-green, in-review PR to add columns a not-yet-started feature
needs. The extension lands as its own `ALTER TABLE ... ADD COLUMN` migration (§1.6) at
whatever slot is free when the manuscript-ledger build (§7 Phase 0) actually starts. As of
this amendment, v30 (PR #1283, unmerged) and v32 (`SKY-10737` brainstorm questions, merged to
`main`) are both claimed — **the next free slot is v33**, and that number is a known moving
target (§1.6, Risk #6): confirm it in `db.ts` immediately before implementation, don't trust
this document's number past the day it's read.

Vault-conceptual location: these tables are **Agent Vault content** per the SKY-10949 ruling
(`index/` in that ruling's logical layout). `state.db` physically sits under `.mythos/`
today, not literally inside the `Agent Vault/` folder — a known, already-filed, already-
scoped gap (`SKY-10957`, unassigned, not blocking). Per that ticket's own guidance: **the
schema is location-independent; do not block this build on the relocation.** Just don't
invent a second, competing "where does machine state live" answer — reference SKY-10957 in
the eventual PR description so the two land coherently.

### 1.2 Two buckets (binding — mirrors PR #1283's AC1, apply the same discipline)

- **Derived / disposable** — `fact_ledger` (both sources), `fact_flags` (manuscript only).
  Fully rebuildable from manuscript content at any time; a full wipe-and-rescan must be a
  supported, safe operation. Wiping and re-scanning **must filter by `source = 'manuscript'`**
  — a manuscript rescan must never touch or drop notes-side rows, and vice versa.
- **Durable / decision** — `fact_decisions` (both sources, already shared — no schema change,
  §1.5). Author actions (dismiss a flag, accept a plan-drift note, "don't ask again").
  Tombstoned, never hard-deleted. Already included in the existing `.mythos/` backup path
  (`electron-main/src/backup.ts`) via PR #1283; nothing new to wire up.

### 1.3 `fact_ledger` — extended field table

Existing PR #1283 columns are reused directly; new columns are additive and nullable so
existing (notes-side) rows need no backfill beyond a default. `source` is the one column that
must land with a real default so existing rows classify correctly:

| Field | Type | PR #1283? | Required (manuscript rows) | Description |
|---|---|---|---|---|
| `id` | TEXT (uuid) | existing | yes | Row identity. Unchanged. |
| `source` | TEXT enum: `notes` \| `manuscript` | **new** | yes | `NOT NULL DEFAULT 'notes'` — existing v30 rows backfill to `'notes'` automatically on `ALTER TABLE ... ADD COLUMN ... DEFAULT`, matching PR #1283's actual (pre-this-spec) behavior. This is the column that turns "manuscript vs. notes for the same fact" into a `WHERE` clause instead of a join across two subsystems (§0). |
| `entity_key` | TEXT | existing | yes | Reused as-is for both sources. For manuscript rows this **is** `subject_entity_key` from v1.0 — same resolver, same column, renamed only in this doc's prose for clarity. Resolved via the existing wikilink/alias graph (`vaultGraph.ts`/`entities.ts`/`wikiLinks.ts`) — never a raw extracted name string. Reuse the alias resolution PR #1283 and AC4 already specify; do not build a second matcher. |
| `fact_key` | TEXT | existing | yes | Reused as-is. For manuscript rows this **is** `attribute` from v1.0 — free-text attribute name as extracted (e.g. `location`, `eye_colour`). Not an enum — the extractor decides the vocabulary; normalization is a v-next concern, not v1. |
| `fact_value` | TEXT | existing | yes | Reused as-is. For manuscript rows this **is** `value` from v1.0 — the entry value for the scene. |
| `kind` | TEXT enum: `attribute` \| `state` \| `rule` | **new**, nullable | yes | `NULL` for notes rows (PR #1283 has no `kind` concept). Drives which check applies downstream (§ design record). **Quantity is deliberately excluded from this enum**, not merely inert — the owner ruling is that Quantity is a separate, standalone visible tool, not part of this checker (§ design record, "Deferred: Quantity"). If a future Quantity tool needs its own ledger, it gets its own table; this schema should not grow a fifth kind to accommodate it later without a fresh decision. |
| `exit_value` | TEXT | **new**, nullable | no | `NULL` for notes rows always; for manuscript rows, only set when the fact changes **within** the same scene (§ design record — "most facts have value == exitValue"). Null means value == exitValue. |
| `scene_id` | TEXT (uuid) | **new**, nullable | yes | `NULL` for notes rows always. The manuscript scene's stable identifier — see §3. **Never** a positional path string. This column *is* the manuscript position this amendment's directive asks for — Part/Chapter/Scene display text is derived from it at read time (§3), never stored redundantly. |
| `grounding_entry` | TEXT enum: `shown` \| `stated` \| `implied` \| `absent` | **new**, nullable | yes | `NULL` for notes rows. Grounding of the fact's assertion at scene entry. |
| `grounding_exit` | TEXT enum: `shown` \| `stated` \| `implied` \| `absent` | **new**, nullable | no | `NULL` for notes rows and for manuscript rows with no in-scene change. Only set alongside `exit_value`. |
| `extractor_prompt_version` | INTEGER | **new**, nullable | yes | `NULL` for notes rows (PR #1283's extractor, if any, isn't versioned this way). Which extractor-prompt version produced this row — see §4. Used for incremental invalidation (§5) and regression triage, **not** a schema-version field. |
| `status` | TEXT enum: `active` \| `superseded` | existing | yes | Reused as-is. `superseded` rows are kept (audit trail / undo), not deleted — same semantics both sources already share. |
| `superseded_by` | TEXT (uuid) | existing | no | Reused as-is. Points at the row that replaced this one after re-extraction. |
| `fingerprint` | TEXT (sha256), UNIQUE | existing, **recipe extended** | yes | See "Identity / dedup rule" below — this is the one column where notes and manuscript genuinely need different hashing recipes, and that difference has to be explicit, not papered over. |
| `extracted_at` | TEXT (ISO) | existing | yes | Reused as-is. No separate `updated_at` — matches PR #1283's existing convention; rows are never mutated in place (a re-extraction inserts a new row and marks the old one `superseded`), so there is nothing for `updated_at` to track that `extracted_at` + `superseded_by` don't already capture. |

`source_content_hash` from v1.0 is **dropped as a ledger-row column** — it duplicated what
`fact_provenance.source_hash` already captures via the `fact_id` FK (§1.3.1). One hash, one
place, matching how PR #1283's notes rows already work.

**Identity / dedup rule — the one real structural tension this amendment surfaces, resolved
explicitly rather than left implicit.** PR #1283's `fingerprint` is content-addressed:
`sha256(entity_key + fact_key + fact_value)` — the *value* is part of the identity, so any
value change mints a logically new fact (correct for a property cache: a note's stated eye
colour changing IS a different fact). v1.0's manuscript design is deliberately **not**
content-addressed the same way: identity is `(subject_entity_key, attribute, scene_id)`
**excluding value**, specifically so an entry→exit change within one scene stays *one* row,
not two competing facts that would incorrectly reach the adjacency-diff step (§1.3's original
"Identity / dedup rule" paragraph, unchanged reasoning, restated below). These are two
genuinely different identity schemes, not a styling difference — a shared table needs both to
coexist under one `UNIQUE(fingerprint)` constraint without either breaking the other:

- `source = 'notes'`: `fingerprint = sha256(entity_key + '\n' + fact_key + '\n' + fact_value)`
  — **unchanged from PR #1283.**
- `source = 'manuscript'`: `fingerprint = sha256('manuscript\n' + entity_key + '\n' + fact_key
  + '\n' + scene_id)` — value deliberately **excluded** from the hash, `scene_id` included
  instead, and a literal `'manuscript'` tag prefixed so a manuscript fingerprint can never
  collide with a notes fingerprint even in the (already astronomically unlikely, sha256)
  case where the remaining fields matched.

`fingerprint` stays **one column, one `UNIQUE` constraint** — this is what makes "extend, not
parallel" hold structurally rather than just nominally: the recipe branches on `source` in
application code (an ordinary discriminated-union pattern), the storage and uniqueness
enforcement do not fork. If a future change needs a *third* fingerprint recipe, that is a
signal to revisit this design, not a reason to add a second column.

**Dedup semantics restated for manuscript rows, unchanged from v1.0:** among `status =
'active'` rows, `(entity_key, fact_key, scene_id)` is unique (enforced by the `fingerprint`
recipe above). One row per subject+attribute+scene captures both the entry value and, when
present, the in-scene exit value — a change *within* a scene is data on one row, not two
competing facts, so it never reaches the merge/adjacency step (mirrors the design record's
own framing: the extractor sees an in-scene change directly).

Re-extracting a scene whose provenance `source_hash` (§1.3.1) is unchanged is a no-op
(idempotent). Re-extracting after an edit (new hash) does **not** overwrite in place — the old
row is marked `superseded`, a new `active` row is inserted, linked via `superseded_by`. This
gives an audit trail for free and is now literally the same code path PR #1283's notes-side
supersede logic already runs — no separate implementation, just a different `source` value on
the same write path.

#### 1.3.1 `fact_provenance` — reused as-is, no schema change

`source_path`, `source_hash`, `span_start`, `span_end`, `fact_id` FK all map directly onto
manuscript rows: for a manuscript fact, `source_path` is the scene's markdown file path
(`electron-main/src/vault.ts` `readSceneFile`/`writeSceneFile` — scenes are files too),
`source_hash` is that scene's content hash (§5's invalidation key — this is where it lives,
not a second column on `fact_ledger`), and `span_start`/`span_end` stay unused (`NULL`) for
v1 manuscript rows, exactly as they're already optional for notes rows. `UNIQUE(fact_id,
source_path)` holds unchanged — one manuscript fact traces to exactly one scene file.

### 1.4 `fact_flags` — new table (adjacency-diff / boundary-pass output)

The one genuinely new table this amendment introduces — nothing in PR #1283 has an
equivalent concept to extend, so there is nothing to reuse here. Named without a
`manuscript_` prefix for consistency with the now-shared `fact_ledger` family, even though
every row is inherently manuscript-only via its FKs (a notes fact has no adjacent-scene
relationship to flag).

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | TEXT (uuid) | yes | Row identity. |
| `fact_a_id` / `fact_b_id` | TEXT (uuid), `REFERENCES fact_ledger(id) ON DELETE CASCADE` | yes | The two `fact_ledger` rows in tension (consecutive-scene value change). FK'd and cascaded, matching `fact_provenance`'s existing pattern. |
| `boundary_scene_prev_id` / `boundary_scene_next_id` | TEXT (uuid) | yes | The two scenes bracketing the change — the exact context the boundary pass (§2, Stage 3) was allowed to see. |
| `match_state` | TEXT enum: `matched` \| `unmatched` \| `judged` | yes | `matched` = adjacency diff found an explanation marker mechanically, written straight through, no LLM judgment needed. `unmatched` = queued for boundary pass. `judged` = boundary pass has run. |
| `account_grounding` | TEXT enum: `shown` \| `stated` \| `implied` \| `absent` | no | Set only once `match_state = judged`. This is the actual finding — "was the change accounted for, and how clearly" (design record's worked example). |
| `status` | TEXT enum: `open` \| `dismissed` | yes | Author disposition. Dismissal writes a `fact_decisions` tombstone (§1.5), not a delete here. |
| `created_at` / `updated_at` | TEXT (ISO) | yes | Standard. |

### 1.5 `fact_decisions` — reused as-is, no schema change

Same tombstone shape PR #1283 already ships (`fingerprint` PK, `decision`, `payload_json`,
`decided_at`, `revoked_at`) — `fingerprint` here has never been FK-constrained to
`fact_ledger.fingerprint` in the DDL (it's a loosely-coupled convention key), which is exactly
what lets it carry two different fingerprint *shapes* without a schema change:

- Single-fact dismissal (notes or manuscript): the fact's own `fact_ledger.fingerprint`
  (§1.3).
- Flag dismissal (manuscript only, a *relationship*, not a single fact): `fingerprint =
  sha256('flag\n' + fact_a_id + '\n' + fact_b_id + '\n' + boundary_scene_prev_id + '\n' +
  boundary_scene_next_id)` — the `'flag\n'` prefix keeps this namespace distinct from
  single-fact fingerprints on the same shared PRIMARY KEY column, on top of sha256's own
  collision resistance.

### 1.6 Migration / versioning discipline

- Schema version = the `PRAGMA user_version` slot claimed at build time (§1.1) — an
  `ALTER TABLE fact_ledger ADD COLUMN ...` block (one per new column, guarded by the existing
  presence-check pattern) plus one `CREATE TABLE IF NOT EXISTS fact_flags`, not a
  `CREATE TABLE` for the ledger itself. `fact_provenance` and `fact_decisions` need no DDL
  changes at all (§1.3.1, §1.5).
- `extractor_prompt_version` (per-row) is a *content* version, unrelated to the DB schema
  version — do not conflate the two. A schema migration changes column shapes; a prompt
  version change re-derives row *content* under the same columns.
- This file will outlive several releases (ticket's own framing) — follow `db.ts`'s existing
  `ALTER TABLE ... ADD COLUMN` + presence-check pattern (see the v29 `continuity_issues.scope`
  backfill) for every column added here, rather than a destructive rebuild. This is no longer
  a "when a future migration needs it" hedge (v1.0's framing) — it is what Phase 0 (§7) does
  on day one, since this amendment's entire schema is additive columns on an existing table.

---

## 2. Pipeline contract

Three stages, each a real interface with an explicit **may-see / may-not-see** boundary.
The blindness constraint in Stage 1 is load-bearing (design record: loading the ledger first
and asking "what's missing" primes confirmation bias) — it is encoded here as a **type-level**
constraint, not a runtime check that something could accidentally bypass.

```ts
// Stage 1 — BlindExtractor. One call per scene, run in parallel across scenes.
interface ExtractorInput {
  sceneText: string;
  knownEntityNames: string[];   // names/aliases ONLY — never values, never other facts
  promptVersion: number;
}
// No field on this type can carry a ledger fact, another scene's text, or vault-note
// content — but a parameter type alone only restricts what's passed IN through this
// signature, not what the implementation could still import and read directly. Two
// concrete guardrails, not just the type:
//   1. The extractor module must not import db.ts or any ledger-access module — enforce
//      with a repo lint rule (e.g. an eslint import/no-restricted-paths zone scoped to the
//      extractor's directory), so a future edit that "just peeks at the ledger for context"
//      fails CI instead of silently landing.
//   2. Per §7 Phase 0's main-process orchestration call: the extractor function never
//      receives a DB handle as an argument at all — it is a pure text-in/facts-out call: the
//      orchestrator that invokes it is the only thing with ledger access, and it only reads
//      the extractor's return value, never hands anything back in.
interface ExtractorOutput {
  facts: Array<{
    subjectName: string;        // resolved to subject_entity_key by the caller, not here
    attribute: string;
    kind: 'attribute' | 'state' | 'rule';  // no 'quantity' — deliberately excluded, see §1.3
    value: string;
    exitValue?: string;
    groundingEntry: Grounding;
    groundingExit?: Grounding;
  }>;
  explanationMarkers: string[]; // e.g. "travel", "time_skip", "purchase", "injury" — free-text tags the scene itself surfaces, used by Stage 2 to match cheaply
}

// Stage 2 — AdjacencyDiff. Pure function, deterministic, no LLM call, unit-testable
// without any AI infrastructure at all.
interface AdjacencyDiffInput {
  prevScene: { sceneId: string; facts: ExtractorOutput['facts']; markers: string[] };
  nextScene: { sceneId: string; facts: ExtractorOutput['facts']; markers: string[] };
}
interface AdjacencyDiffOutput {
  newFacts: FactRow[];               // not present in prevScene — straight append to the ledger
  matchedChanges: FactRow[];         // value changed, an explanation marker plausibly covers it — written through, no flag
  unmatchedChanges: Array<{ factA: FactRow; factB: FactRow }>; // queued for Stage 3
}

// Stage 3 — BoundaryPass. ONLY on unmatchedChanges. Narrow context: exactly the two
// bracketing scenes, not the manuscript, not the ledger, not the notes.
interface BoundaryPassInput {
  change: { factA: FactRow; factB: FactRow };
  prevSceneText: string;
  nextSceneText: string;
}
interface BoundaryPassOutput {
  accountGrounding: Grounding;
  flag?: { note: string };   // present when grounding is 'implied' or 'absent' — this is the finding
}
```

**Same mechanism builds the ledger and checks continuity** (design record, explicit): a fact
absent from the ledger → new-fact append (Stage 2's `newFacts`). A fact that conflicts with
what's already there → continuity flag (Stage 2's `unmatchedChanges` → Stage 3). One
pipeline, two effects — do not build a second "checker" path later; extend this one.

**Self-correcting rescan property**: because Stage 2 only ever compares to what's already in
`fact_ledger` (`source = 'manuscript'`), re-running the whole pipeline against unchanged
content is a no-op (§1.3.1's content-hash idempotency) — a full rescan naturally finds fewer
new items each pass and terminates when a pass finds nothing new, with no separate
"convergence" logic required.

---

## 3. Scene addressing

**Good news, confirmed against the current codebase, not assumed:** every scene already has
a stable identifier — `crypto.randomUUID()`, assigned once at `SCENE_CREATE`
(`electron-main/src/main.ts`), persisted in the scene's own markdown frontmatter
(`electron-main/src/vault.ts` `readSceneFile`/`writeSceneFile`), so it round-trips through a
full manifest rebuild, not just in-memory state. Save, rename, reorder-within-chapter, and
move-to-a-different-chapter (`frontend/src/DesktopShell.tsx` `handleReorderScenes`/
`handleMoveScene`) all preserve `id` — only the numeric sibling-position `order` field
changes. **Timeline (`SKY-510`) already solved this exact addressing problem the same way**:
`TimelineEvent.sceneId` (`electron-main/src/timelines/model.ts`) anchors directly to this
same scene UUID, not to a positional path.

**Decision: the ledger anchors on scene UUID exclusively.** The human-readable
Part/Chapter/Scene position from the design record is a *display and adjacency-ordering*
concern, derived at scan time from the current tree order — never the identity key. `order`
is a plain sibling-relative integer, freely reassigned on every reorder; using it as identity
would silently corrupt the ledger the first time an author reorders a chapter.

### 3.1 Risk, surfaced as instructed — not worked around

**No split-scene or merge-scene feature exists anywhere in this codebase today.** No IPC
channel, no frontend handler, no mention in any Scene Crafter or Timeline planning doc. This
means:

- Scene addressing is **solid** for every operation the app currently supports.
- It is **completely untested** against the one operation (split/merge) that would most
  directly threaten "stable identifier" — because that operation doesn't exist yet.
- This spec cannot inherit a convention that doesn't exist. **Recommendation, not a
  build item here:** when split/merge ships, it must consult this ledger's invalidation
  contract (§5) before landing — specifically, it must decide whether a split scene mints
  two new UUIDs (orphaning the original scene's facts, requiring re-extraction of both
  halves) or one half keeps the original id (facts survive for that half only). File this as
  an explicit cross-team dependency when split/merge is scoped; do not let it ship silently
  against an assumption this spec never validated.

### 3.2 Second risk: no delete cascade today

`deleteScene` (`DesktopShell.tsx`) removes the manifest entry and trashes the file, but
nothing cascades to anything else keyed by that `sceneId` — not `TimelineEvent`, not
`scene_entity_links`, not snapshots. The fact ledger will face the identical dangling-
reference problem unless it adds its **own** delete hook. Build item: on scene delete, mark
that scene's `fact_ledger` rows (`source = 'manuscript'`, matching `scene_id`) `superseded`
(disposable bucket — safe to just drop) and tombstone any `fact_decisions` rows whose flag
referenced the deleted scene (durable bucket — tombstone, don't hard-delete, consistent with
§1.5). Scope every one of these operations to `source = 'manuscript'` explicitly — a scene
delete must never touch a `source = 'notes'` row even if some other bug produced a matching
`entity_key`/`fact_key`.

### 3.3 Third note: a second, weaker identity axis exists

Scene Crafter Kanban cards address scenes by vault-relative file **path** (Obsidian-style
wikilink), not UUID (`plans/SCENE_CRAFTER_FORMAT.md`). The ledger must never key off path —
if a future integration needs to resolve a Scene Crafter card to a ledger entry, that
resolution is the integration's job, not the ledger's.

---

## 4. Extractor prompt harness

Per the ticket: not the prompt itself — the harness that keeps it excellent.

1. **The prompt is a versioned file in the repo**, reviewed via the normal PR process (e.g.
   `electron-main/src/prompts/manuscriptFactExtractor/v1.md`), not authored through a
   settings UI in v1. (User-editable "quick command" prompts are the design record's
   separate, later concept — §7 phasing, out of scope here.)
2. **`extractor_prompt_version`** (§1.3) is a plain integer, bumped on any wording change,
   stamped on every fact row the prompt produced — this is what makes incremental
   invalidation (§5) and regression triage possible without guessing which rows came from
   which prompt.
3. **Golden fixture set**: hand-annotated scene excerpts with known-correct expected facts,
   checked into the repo (e.g. `electron-main/src/__fixtures__/manuscriptFactExtractor/`).
   Apply the same discipline this codebase already holds itself to in
   `factLedger.acceptance.test.ts` — its own header states "every check here must include a
   negative control that proves the assertion can actually fail." Mirror that: every fixture
   must include at least one fact the extractor is expected to **miss or grade low-confidence
   if the prompt regresses**, not just clean hits — otherwise a fixture set that only ever
   passes proves nothing.
4. **Regression gate**: on every prompt version bump, run the full fixture set, diff
   extracted facts against expected (precision/recall), block the bump on regression. This
   is what makes "the extractor prompt is the highest-leverage artifact" tractable —
   CI-gated, not vibes-gated. Concretely: a `vitest` suite parallel to the acceptance-test
   pattern already in this repo, run in CI on any change under
   `prompts/manuscriptFactExtractor/`.
5. **Prompt caching — net new, not assumed to exist.** `electron-main/src/provider.ts`
   (the model-agnostic Anthropic/OpenAI/Ollama provider layer this extractor should call
   through) builds its Anthropic request with no `cache_control` block on any content block
   today. Adding `cache_control` to the system/extractor-prompt block is required
   infrastructure work for the cost model in §6 to hold — it does not exist yet and is not
   a prompt-authoring concern, it's a `provider.ts` change. Only the extractor's system
   prompt is cached (identical every call in a fan-out); scene text is never cached (it
   changes every call, by definition).

---

## 5. Incremental update

**Trigger**: scene save (existing `SCENE_SAVE` handler, `electron-main/src/main.ts`) or an
explicit user-triggered scan, gated by the batch-vs-always-on setting (owner-settled,
default batch — §6/§7 of the design record).

**Invalidation key**: reuse the existing SHA-256 content-hash convention
(`versions.ts`/`draftFiles.ts`/`snapshots.ts`) over scene text — do not invent a second
hashing scheme. A manuscript fact's `fact_provenance.source_hash` (§1.3.1 — this is where the
hash lives now, not a ledger-row column) is compared against the scene's current hash; a
mismatch means stale, triggering re-extraction of **that scene only**.

**On edit of scene S**:
1. Re-run Stage 1 for S only.
2. Diff the new `ExtractorOutput` against S's current `active` facts.
3. For anything changed/added, re-run Stage 2 for exactly the two boundary pairs touching S
   (`S-1↔S` and `S↔S+1`) — never the whole manuscript.
4. Run Stage 3 only for any newly-`unmatched` change at those two boundaries.

Cost is therefore **O(1) in manuscript length, O(scene length) in the edited scene** — never
a full rescan for a single-scene edit (§6 quantifies this).

**Reorder or move with no text change**: `fact_provenance.source_hash` is unchanged, so
Stage 1 is skipped entirely. Only the adjacency pairs affected by the scene's *new* neighbor
set need Stage 2 re-run — the old neighbor pair (now discontinuous) and the new one.

**Delete**: see §3.2 — this is an invalidation case too, not just an addressing risk. Handle
it as part of the same delete hook.

**Open call, not decided here**: when a flag tied to a scene pair is dismissed
(`fact_decisions` tombstone) and later one of those two scenes is deleted, does
the tombstone need to be remembered, or is it fine for it to become moot along with the
scene? Recommendation: let it become moot (no special handling) — the underlying fact no
longer has a home either. Flagging as an explicit product call for Ivy rather than silently
picking an answer, since "does dismissing something ever need to survive the thing it was
about going away" is a product question, not an engineering one.

---

## 6. Cost model

Computable up front, per the design record's own requirement (the estimate has to run
*before* a scan, on the user's key, without a live tokenizer round-trip) — so this uses the
same chars-ratio heuristic this codebase already uses for context budgeting
(`electron-main/src/contextGuards.ts` `estimateTokens()`), not a live token-count call.

**No pricing/estimate infrastructure exists yet.** `electron-main/src/budget.ts` and the
`generation_log` table (`db.ts`) already track post-hoc `tokens_in`/`tokens_out` for
rate-limit enforcement, but never convert to a dollar figure and never show anything
pre-run. A model-price table and a pre-run estimate UI are both net-new — this section gives
the formula that table/UI needs to implement.

### 6.1 Formula

For a manuscript of `N` scenes, average scene length `S` words (≈ `1.5·S` tokens using the
chars/4 heuristic at ~6 chars/word):

- **First full scan, input tokens** ≈ `manuscript_tokens` (each scene read once, unavoidable)
  + `N × entity_index_tokens` (small, grows through the book) + `N ×
  extractor_prompt_tokens × (1 − cache_discount)` (≈ full price once, ~90% off every call
  after, per Anthropic's cache pricing — verify the actual discount/TTL against current
  provider docs at build time, per the design record's own caveat) + `boundary_pass_calls ×
  ~2·S_tokens` (only for unmatched changes).
- **First full scan, output tokens** ≈ `N × avg_facts_per_scene × ~20 tokens/fact` +
  `boundary_pass_calls × ~150 tokens`.
- **Incremental update, per edited scene** ≈ `1 extraction call + up to 2 boundary-pass
  calls` — no dependency on manuscript length at all.

### 6.2 Worked example — 120,000-word manuscript

Stated assumptions (label them as assumptions in the actual UI copy too — they're a first
approximation, not a guarantee): 1,500 words/scene → **80 scenes**; 8 facts/scene average;
15% of the 79 scene-to-scene boundaries produce an unmatched change (**≈12 boundary-pass
calls**); illustrative pricing ($3/MTok in, $15/MTok out — a Sonnet-class rate, **verify
against current provider pricing at build time**, prices change and this spec will outlive
several price changes).

| | Input tokens | Output tokens | Illustrative cost |
|---|---|---|---|
| Stage 1 (80 scenes, cached prompt after first call) | ≈ 219,000 | ≈ 12,800 (80 × 8 facts × ~20 tok/fact) | — |
| Stage 3 (12 boundary calls) | ≈ 54,000 | ≈ 1,800 | — |
| **First full scan total** | **≈ 273,000** | **≈ 14,600** | **≈ $1.04** |
| Incremental (1 edited scene, worst case: both boundaries newly unmatched) | ≈ 12,100 | ≈ 550 | **≈ $0.04** |

Ratio: an incremental update costs roughly **1/25** of a full scan — this is the
quantified version of the design record's "batch economics" claim, and it's what a pre-run
estimate should show the user before every run (owner decision: show the estimate).

---

## 7. Phasing

**Phase 0 — infra, blocking, needs sign-off before Phase 1 starts.**
Confirm the free schema slot and write the `ALTER TABLE fact_ledger ADD COLUMN` migration
plus the new `fact_flags` table (§1.1/§1.6) — no `CREATE TABLE` for the ledger itself, since
it already exists via PR #1283. Then resolve one real architectural conflict this research
surfaced that the design record doesn't address: the existing background job-queue
(`docs/jobs-background-queue.md`, M12.1/`SKY-10730`, done) is strictly **FIFO, one job at a
time**, and its worker threads are documented as **filesystem + compute only — no network,
no DB** ("workers never open `state.db`; they post progress messages, the main-process
`jobQueue.ts` owns all SQLite writes"). A **blind per-scene fan-out** implies N *concurrent*
LLM calls, which is a different capability class than anything the job substrate does today.

CTO recommendation, offered for sign-off, not silently assumed: extraction LLM calls are
orchestrated from the **main process** (a new lightweight concurrent-call orchestrator, not
inside the worker-thread pool), while the existing job queue continues to own only
progress/checkpoint bookkeeping through its current message-passing contract. The
worker/job abstraction itself stays fs+compute-only, exactly as designed — this treats the
fan-out as a new capability sitting *beside* the job queue, not a change to the job queue's
non-blocking guarantees. This is an architecture call I'm making as CTO; flagging it
explicitly because it changes how M12.2/M12.3 pieces fit together and deserves a second set
of eyes before Phase 1 code gets written against it.

**Phase 1 — BlindExtractor + ledger writes only.** Ship this alone, measure extraction
fidelity against the golden fixture set (§4) on real manuscripts, before building anything
on top. No adjacency diff, no flags, no UI beyond a bare job summary. This is the owner's own
sequencing instruction, restated as a hard gate: *"ledger scan + adjacency diff before any
judgment passes, so we can measure extraction fidelity before building on top of it."*

**Phase 2 — AdjacencyDiff (mechanical).** New-fact and matched-change detection. The ledger
is now self-building and self-maintaining (§2's "same mechanism" property). Still no
judgment — unmatched changes are queued, not surfaced to the author yet.

**Phase 3 — BoundaryPass + `fact_flags` (§1.4, §2 Stage 3).** This spec fully
designs this stage — the ticket's instruction 2 requires all three pipeline stages as real
interfaces, and that's already delivered above, not deferred. What's gated is the **build**:
**do not start writing Phase 3 code until Phase 1+2 fidelity has actually been measured
against real manuscripts** — the owner's own condition for building anything downstream of
extraction. Phase 3's output is a flag row, not a report; nothing here designs how an author
sees it.

**Phase 4 — genuinely out of this spec's scope per the ticket, named here only for
sequencing awareness, not designed anywhere in this document.** The findings-report UI, the
quick-command surface, the beta-read command, the Rule check, and Quantity as a standalone
tool. These consume `fact_flags` (Rule/report) or don't touch this schema at all (Quantity,
per §1.3) — none of them are specified here.

---

## Risk list (most severe first)

1. **Archive Agent naming/UX overlap — still unresolved (§0), narrower than v1.0's framing.**
   Ivy's ruling closed the *schema* half of the three-way collision (extend `fact_ledger`,
   don't parallel it — §0). What's left open is genuinely a two-way, product-only question:
   Archive Agent's shipped `continuity_issues` scanner and this spec's manuscript-scene
   system both want the term "continuity check" in the UI. Does Archive Agent's existing menu
   item get renamed, merged into, or left alongside this new one? **→ Ivy, open question #1**
   (narrowed from v1.0 — no longer includes PR #1283, which is now a settled "extend"
   target, not an open naming collision).
2. **Fingerprint identity-recipe divergence, resolved but non-obvious — must not regress
   (§1.3).** Notes-side `fingerprint` is content-addressed (value is part of the hash);
   manuscript-side deliberately excludes value from the hash so an in-scene entry→exit change
   stays one row. Both now share one `fingerprint` column and one `UNIQUE` constraint via a
   `source`-conditional recipe. This is the one place "extend, don't parallel" required real
   design work, not just a rename — any future change to either recipe must re-verify it
   doesn't collide with or corrupt the other source's rows.
3. **Extraction fidelity is completely unmeasured.** The design's own thesis (§ design
   record) is that everything downstream only works if extraction is faithful — there is no
   eval harness today. Phase 1 (§7) must ship with the golden-fixture regression harness
   (§4) before any later phase is trusted, not as a nice-to-have added afterward.
4. **Job-queue substrate doesn't fit blind fan-out as documented (§7 Phase 0).** FIFO,
   single job, fs+compute-only workers vs. N-concurrent LLM calls. A real conflict, not a
   detail — needs the Phase 0 sign-off before any extraction code is written against
   either assumption.
5. **No split/merge-scene feature exists (§3.1).** Scene addressing is solid for everything
   the app does today; it is untested against the one future operation most likely to break
   "stable identifier." Surfaced, not worked around, per the ticket's explicit instruction.
6. **No cascade cleanup on scene delete today (§3.2).** The ledger must add its own hook or
   it will accumulate orphaned rows the moment an author deletes a scene — scoped to
   `source = 'manuscript'` only (§3.2).
7. **Schema slot is a moving target.** `db.ts`'s own comments show migrations colliding
   between sibling branches before (v30/v31); as of this amendment v30 (PR #1283, unmerged)
   and v32 (`SKY-10737`, merged) are both already claimed. Re-verify the free slot (currently
   v33) immediately before implementation, don't trust this document's number past the day
   it's read.
8. **Prompt caching doesn't exist in `provider.ts` yet (§4).** The cost model's central
   economics claim (§6) requires `cache_control` support that is net-new engineering work,
   not just prompt wording.
9. **No pre-run cost estimate infrastructure exists anywhere (§6).** No pricing table, no
   estimate UI — both fully net-new, and pricing tables go stale (the design record's own
   caveat, carried forward here).

## What I'd cut for v1

- **Prompt caching implementation.** If Phase 1 timing is tight, ship without
  `cache_control` first — it's a cost optimization, not a correctness requirement, and the
  single-job-FIFO substrate (§7) already throttles throughput more than caching would help
  at Phase-1 scale. Add as a fast-follow once real usage shows the cost actually matters.
- **A live-priced cost estimate.** Ship a rough token-count-based estimate against a static,
  periodically-updated price table rather than a live provider-pricing lookup for v1.
- **Defensive split/merge handling.** Don't build handling for an operation that doesn't
  exist in the app yet (§3.1) — document the invalidation contract it must honor when it
  ships, and stop there.
- **Series/cross-book notes reconciliation UX.** Out of scope for a single-book v1 ledger —
  per-book scoping (design record, settled) already answers the storage question; the
  "lazy confirmation, don't ask 200 questions at book two" UX is real future work, not v1.
- **Preserving durable decisions across scene deletion (§5's open call).** Let a dismissed
  flag become moot if one of its two scenes is deleted. Revisit only if real usage shows
  this loses something an author cared about.

## Open questions for Ivy (not answered here — product calls, not engineering ones)

1. **The Archive Agent naming/UX overlap (§0, Risk #1) — narrowed by the extend ruling, not
   closed.** PR #1283 merges as-is, unmodified (settled by this amendment). What's still
   open: does the Archive Agent's existing "Continuity Check" menu item get renamed, merged
   into, or left alongside this new one? What does the user-facing name become so it doesn't
   collide with the term Archive Agent already owns?
2. **Product naming**, downstream of #1 — "continuity check" is already a shipped UI term.
3. **Phase 0's architecture call (§7)** — main-process LLM orchestration alongside the
   existing worker-only job queue, as opposed to extending the worker substrate itself for
   network calls. I have a recommendation; it changes how M12.2 and M12.3 (`SKY-10770`)
   fit together and deserves explicit sign-off before Phase 1 implementation starts.
