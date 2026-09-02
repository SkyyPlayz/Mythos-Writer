# Fact Ledger + Continuity Check — Buildable Spec

Version: 1.0 · Status: Draft, awaiting Ivy review · Author: CTO · Date: 2026-08-25

**Source of intent:** the verbatim design record captured in SKY-11018 (owner + Ivy design
session, 2026-08-25). That record is authoritative for product intent; this document turns
it into field types, interfaces, and build sequencing. Where this doc restates a settled
owner ruling, it is restating, not re-deciding.

**Board:** M12.2 (`SKY-10731`), a child of the M12 scale-architecture epic (`SKY-10729`,
ruling `SKY-10666`: vault ≠ fact ledger). Storage location is governed by the Agent Vault
final ruling (`SKY-10949`, 2026-08-19: everything belonging to a vault's machine state lives
inside `Agent Vault/`, no split).

---

## 0. Read this first — a name collision already exists

Before section 1, the single fact that reshapes everything below: **`SKY-10731` already has
an open, CI-green, `in_review` PR** — **#1283**, `feat(SKY-10731): fact-ledger schema +
persistent vault index cache (M12.2)`, branch `sky-10731-fact-ledger-schema`. It landed
before this design conversation happened and claims:

- the name **`fact_ledger`** (table)
- schema slot **`PRAGMA user_version = 30`**
- the acceptance criteria in `electron-main/src/factLedger.acceptance.test.ts` (AC1–AC4)

But what it actually builds is **not** the manuscript-scene continuity system this ticket
designs. PR #1283's `fact_ledger` is a generic `entity_key` / `fact_key` / `fact_value`
store, keyed by `fingerprint = sha256(entity_key\nfact_key\nfact_value)`, with
`fact_provenance.source_path`/`source_hash`/`span_start`/`span_end` as generic provenance,
plus `vault_index_cache` (name/aliases/type — a persistent replacement for
`entityIndex.ts`'s rebuild-on-open) and `fact_decisions` (tombstoned dismiss/answer
decisions). `entity_key` is documented in the diff as "the resolved **vault note** path" —
i.e. this is a persistent cache for the existing **Notes Vault entity/property index** (the
thing `archiveContinuityEngine.ts`'s `PROPERTY_CONTRADICTION_PAIRS` and the entity panel
already use), not a manuscript-prose fact extractor. It has no `scene_id`, no `kind`
(attribute/state/rule/quantity), no `grounding` (shown/stated/implied/absent), no
`exitValue`, no position, no adjacency-diff or blind-extraction pipeline.

There is also a **third** thing already named "continuity check" in the shipped product:
Archive Agent's `continuity_issues` table + `archiveContinuityEngine.ts` (SKY-1684, live
since v23) — a single-scene-vs-vault-notes contradiction scanner with its own LLM prompt and
its own Notes-tree context-menu entry.

So as of 2026-08-25 there are three overlapping things:

| # | What | Where | Status |
|---|---|---|---|
| 1 | Archive Agent "Continuity Scan" — one scene vs. vault notes, LLM contradiction check | `archiveContinuityEngine.ts`, `continuity_issues` table (v23) | Shipped |
| 2 | PR #1283's `fact_ledger` — generic vault-notes entity/property cache, replaces `entityIndex.ts` rebuild-on-open | `db.ts` v30 (unmerged) | In review, CI green, mergeable |
| 3 | **This spec** — manuscript-scene-derived fact ledger + adjacency-diff continuity check | Net new | Not started |

This is not mine to silently reconcile by picking a name. **Risk #1 / Open Question #1**
below names the decision Ivy needs to make. Everything past this section is written to be
correct *either way* that decision goes, but section 1's schema deliberately does **not**
reuse `fact_ledger`/`fact_provenance`/`fact_decisions`/v30 — it proposes new tables at a new
schema slot, so this spec never blocks or gets blocked by PR #1283 merging.

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

Table names use a `manuscript_fact_*` prefix to avoid the PR #1283 collision (§0). Schema
version: **claim the next free slot** at spec-finalization time — currently that is **v32**
(v30 claimed by PR #1283, v31 already landed on `main` for the M12.1 job-queue tables).
Confirm the actual free slot in `db.ts` immediately before implementation; this number will
drift if other migrations land first (the codebase's own db.ts comment already warns this
happened once between v30 and v31 — expect it again, don't hardcode without re-checking).

Vault-conceptual location: these tables are **Agent Vault content** per the SKY-10949 ruling
(`index/` in that ruling's logical layout). `state.db` physically sits under `.mythos/`
today, not literally inside the `Agent Vault/` folder — a known, already-filed, already-
scoped gap (`SKY-10957`, unassigned, not blocking). Per that ticket's own guidance: **the
schema is location-independent; do not block this build on the relocation.** Just don't
invent a second, competing "where does machine state live" answer — reference SKY-10957 in
the eventual PR description so the two land coherently.

### 1.2 Two buckets (binding — mirrors PR #1283's AC1, apply the same discipline)

- **Derived / disposable** — `manuscript_fact_ledger`, `manuscript_fact_flags`. Fully
  rebuildable from manuscript content at any time; a full wipe-and-rescan must be a
  supported, safe operation.
- **Durable / decision** — `manuscript_fact_decisions`. Author actions (dismiss a flag,
  accept a plan-drift note, "don't ask again"). Tombstoned, never hard-deleted. Must be
  included in the existing `.mythos/` backup path (`electron-main/src/backup.ts`) the same
  way PR #1283's `fact_decisions` already is.

### 1.3 `manuscript_fact_ledger` — field table

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | TEXT (uuid) | yes | Row identity. |
| `subject_entity_key` | TEXT | yes | Resolved via the existing wikilink/alias graph (`vaultGraph.ts`/`entities.ts`/`wikiLinks.ts`) — never a raw extracted name string. Reuse the alias resolution PR #1283 and AC4 already specify; do not build a second matcher. |
| `attribute` | TEXT | yes | Free-text attribute name as extracted (e.g. `location`, `eye_colour`). Not an enum — the extractor decides the vocabulary; normalization is a v-next concern, not v1. |
| `kind` | TEXT enum: `attribute` \| `state` \| `rule` | yes | Drives which check applies downstream (§ design record). **Quantity is deliberately excluded from this enum**, not merely inert — the owner ruling is that Quantity is a separate, standalone visible tool, not part of this checker (§ design record, "Deferred: Quantity"). If a future Quantity tool needs its own ledger, it gets its own table; this schema should not grow a fifth kind to accommodate it later without a fresh decision. |
| `value` | TEXT | yes | Entry value for the scene. |
| `exit_value` | TEXT | no | Only set when the fact changes **within** the same scene; the extractor sees this directly (§ design record — "most facts have value == exitValue"). Null means value == exitValue. |
| `scene_id` | TEXT (uuid) | yes | The manuscript scene's stable identifier — see §3. **Never** a positional path string. |
| `grounding_entry` | TEXT enum: `shown` \| `stated` \| `implied` \| `absent` | yes | Grounding of the fact's assertion at scene entry. |
| `grounding_exit` | TEXT enum: `shown` \| `stated` \| `implied` \| `absent` | no | Only set alongside `exit_value`; grounding of the in-scene change. |
| `extractor_prompt_version` | INTEGER | yes | Which extractor-prompt version produced this row — see §4. Used for incremental invalidation (§5) and regression triage, **not** a schema-version field. |
| `source_content_hash` | TEXT (sha256) | yes | Hash of the scene text this row was extracted from. Reuse the existing hashing convention (`versions.ts`/`draftFiles.ts`/`snapshots.ts`), don't add a second hash function. |
| `status` | TEXT enum: `active` \| `superseded` | yes | `superseded` rows are kept (audit trail / undo), not deleted. |
| `superseded_by` | TEXT (uuid) | no | Points at the row that replaced this one after re-extraction. |
| `created_at` / `updated_at` | TEXT (ISO) | yes | Standard. |

**Identity / dedup rule** — what makes two facts "the same fact":
`(subject_entity_key, attribute, scene_id)` is unique among `status = 'active'` rows. One
row per subject+attribute+scene captures both the entry value and, when present, the
in-scene exit value — a change *within* a scene is data on one row, not two competing facts,
so it never reaches the merge/adjacency step (this mirrors the design record's own framing:
the extractor sees an in-scene change directly).

Re-extracting a scene whose `source_content_hash` is unchanged is a no-op (idempotent).
Re-extracting after an edit (new hash) does **not** overwrite in place — the old row is
marked `superseded`, a new `active` row is inserted, linked via `superseded_by`. This gives
an audit trail for free and matches PR #1283's own `status`/`superseded_by` pattern, which is
worth keeping consistent across both fact stores even though the tables are separate.

### 1.4 `manuscript_fact_flags` — field table (adjacency-diff / boundary-pass output)

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | TEXT (uuid) | yes | Row identity. |
| `fact_a_id` / `fact_b_id` | TEXT (uuid) | yes | The two `manuscript_fact_ledger` rows in tension (consecutive-scene value change). |
| `boundary_scene_prev_id` / `boundary_scene_next_id` | TEXT (uuid) | yes | The two scenes bracketing the change — the exact context the boundary pass (§2, Stage 3) was allowed to see. |
| `match_state` | TEXT enum: `matched` \| `unmatched` \| `judged` | yes | `matched` = adjacency diff found an explanation marker mechanically, written straight through, no LLM judgment needed. `unmatched` = queued for boundary pass. `judged` = boundary pass has run. |
| `account_grounding` | TEXT enum: `shown` \| `stated` \| `implied` \| `absent` | no | Set only once `match_state = judged`. This is the actual finding — "was the change accounted for, and how clearly" (design record's worked example). |
| `status` | TEXT enum: `open` \| `dismissed` | yes | Author disposition. Dismissal writes a `manuscript_fact_decisions` tombstone (§1.2), not a delete here. |
| `created_at` / `updated_at` | TEXT (ISO) | yes | Standard. |

### 1.5 `manuscript_fact_decisions` — durable bucket

Same tombstone shape as PR #1283's `fact_decisions` (`fingerprint` PK, `decision`,
`payload_json`, `decided_at`, `revoked_at`) — reuse that pattern rather than inventing a
third one. `fingerprint` here is `sha256(fact_a_id + fact_b_id + boundary_scene ids)` since a
flag decision is about a *relationship*, not a single fact.

### 1.6 Migration / versioning discipline

- Schema version = the `PRAGMA user_version` slot claimed at build time (§1.1). One
  migration block, `CREATE TABLE IF NOT EXISTS`, matching every existing block in `db.ts`.
- `extractor_prompt_version` (per-row) is a *content* version, unrelated to the DB schema
  version — do not conflate the two. A schema migration changes column shapes; a prompt
  version change re-derives row *content* under the same columns.
- This file will outlive several releases (ticket's own framing) — when a future migration
  needs to add a column, follow `db.ts`'s existing `ALTER TABLE ... ADD COLUMN` +
  presence-check pattern (see the v29 `continuity_issues.scope` backfill) rather than a
  destructive rebuild.

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
`manuscript_fact_ledger`, re-running the whole pipeline against unchanged content is a no-op
(§1.3's content-hash idempotency) — a full rescan naturally finds fewer new items each pass
and terminates when a pass finds nothing new, with no separate "convergence" logic required.

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
that scene's `manuscript_fact_ledger` rows `superseded` (disposable bucket — safe to just
drop) and tombstone any `manuscript_fact_decisions` rows whose flag referenced the deleted
scene (durable bucket — tombstone, don't hard-delete, consistent with §1.5).

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
hashing scheme. A `manuscript_fact_ledger` row's `source_content_hash` is compared against
the scene's current hash; a mismatch means stale, triggering re-extraction of **that scene
only**.

**On edit of scene S**:
1. Re-run Stage 1 for S only.
2. Diff the new `ExtractorOutput` against S's current `active` facts.
3. For anything changed/added, re-run Stage 2 for exactly the two boundary pairs touching S
   (`S-1↔S` and `S↔S+1`) — never the whole manuscript.
4. Run Stage 3 only for any newly-`unmatched` change at those two boundaries.

Cost is therefore **O(1) in manuscript length, O(scene length) in the edited scene** — never
a full rescan for a single-scene edit (§6 quantifies this).

**Reorder or move with no text change**: `source_content_hash` is unchanged, so Stage 1 is
skipped entirely. Only the adjacency pairs affected by the scene's *new* neighbor set need
Stage 2 re-run — the old neighbor pair (now discontinuous) and the new one.

**Delete**: see §3.2 — this is an invalidation case too, not just an addressing risk. Handle
it as part of the same delete hook.

**Open call, not decided here**: when a flag tied to a scene pair is dismissed
(`manuscript_fact_decisions` tombstone) and later one of those two scenes is deleted, does
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
Claim the schema slot (§1.1/§1.6) and resolve one real architectural conflict this research
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

**Phase 3 — BoundaryPass + `manuscript_fact_flags` (§1.4, §2 Stage 3).** This spec fully
designs this stage — the ticket's instruction 2 requires all three pipeline stages as real
interfaces, and that's already delivered above, not deferred. What's gated is the **build**:
**do not start writing Phase 3 code until Phase 1+2 fidelity has actually been measured
against real manuscripts** — the owner's own condition for building anything downstream of
extraction. Phase 3's output is a flag row, not a report; nothing here designs how an author
sees it.

**Phase 4 — genuinely out of this spec's scope per the ticket, named here only for
sequencing awareness, not designed anywhere in this document.** The findings-report UI, the
quick-command surface, the beta-read command, the Rule check, and Quantity as a standalone
tool. These consume `manuscript_fact_flags` (Rule/report) or don't touch this schema at all
(Quantity, per §1.3) — none of them are specified here.

---

## Risk list (most severe first)

1. **Three overlapping "fact ledger"/"continuity" systems, one collision unresolved (§0).**
   Archive Agent's shipped `continuity_issues` scanner, PR #1283's in-review generic
   vault-notes entity cache (claiming the name `fact_ledger` and schema v30), and this
   spec's manuscript-scene system are three different things that happen to share
   vocabulary and, in PR #1283's case, a ticket number. This spec avoids the *technical*
   collision (new table names, new schema slot), but the *product* question — does the
   final feature set replace, subsume, or coexist with the other two, and what does the
   user-facing name become — is unresolved and does not belong to engineering. **→ Ivy,
   open question #1.**
2. **Extraction fidelity is completely unmeasured.** The design's own thesis (§ design
   record) is that everything downstream only works if extraction is faithful — there is no
   eval harness today. Phase 1 (§7) must ship with the golden-fixture regression harness
   (§4) before any later phase is trusted, not as a nice-to-have added afterward.
3. **Job-queue substrate doesn't fit blind fan-out as documented (§7 Phase 0).** FIFO,
   single job, fs+compute-only workers vs. N-concurrent LLM calls. A real conflict, not a
   detail — needs the Phase 0 sign-off before any extraction code is written against
   either assumption.
4. **No split/merge-scene feature exists (§3.1).** Scene addressing is solid for everything
   the app does today; it is untested against the one future operation most likely to break
   "stable identifier." Surfaced, not worked around, per the ticket's explicit instruction.
5. **No cascade cleanup on scene delete today (§3.2).** The ledger must add its own hook or
   it will accumulate orphaned rows the moment an author deletes a scene.
6. **Schema slot is a moving target.** `db.ts`'s own comments show v30/v31 already collided
   once between sibling branches. Re-verify the free slot immediately before implementation,
   don't trust this document's "v32" past the day it's read.
7. **Prompt caching doesn't exist in `provider.ts` yet (§4).** The cost model's central
   economics claim (§6) requires `cache_control` support that is net-new engineering work,
   not just prompt wording.
8. **No pre-run cost estimate infrastructure exists anywhere (§6).** No pricing table, no
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

1. **The three-way name/scope collision (§0, Risk #1).** Does PR #1283 still merge as-is
   (useful on its own — it's AC2's persistent-cache fix for the existing vault-notes entity
   index)? Does the Archive Agent's existing "Continuity Check" menu item get renamed,
   merged into, or left alongside this new one? What does the user-facing name become so it
   doesn't collide with the term Archive Agent already owns?
2. **Product naming**, downstream of #1 — "continuity check" is already a shipped UI term.
3. **Phase 0's architecture call (§7)** — main-process LLM orchestration alongside the
   existing worker-only job queue, as opposed to extending the worker substrate itself for
   network calls. I have a recommendation; it changes how M12.2 and M12.3 (`SKY-10770`)
   fit together and deserves explicit sign-off before Phase 1 implementation starts.
