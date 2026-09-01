# Fact Ledger + Continuity Check — Buildable Spec

Version: 1.1 · Status: Draft, amended per Ivy ruling, awaiting Ivy review · Author: CTO ·
Date: 2026-08-25, amended 2026-08-26

**Amendment (2026-08-26, `SKY-11031`, directive from Ivy on the `SKY-10731` thread,
11:31):** v1.0 of this spec (below, preserved in git history) resolved the naming collision
in §0 by proposing new `manuscript_fact_*` tables alongside PR #1283's tables — "coexist,
don't collide on names." Ivy's follow-up ruling supersedes that: **extend, do not
parallel.** The manuscript ledger adds a `source` discriminator, position, grounding, and
kind onto PR #1283's *same* tables rather than standing up a second table family. Section 0
and Section 1 are rewritten below to match. Sections 2, 4, 6 are pipeline/harness/cost
content that doesn't depend on which tables store the rows and are otherwise unchanged;
Sections 3, 5, 7, and the risk list have the table-name references and one new required
Phase 0 item updated accordingly — those edits are marked inline.

**Source of intent:** the verbatim design record captured in SKY-11018 (owner + Ivy design
session, 2026-08-25). That record is authoritative for product intent; this document turns
it into field types, interfaces, and build sequencing. Where this doc restates a settled
owner ruling, it is restating, not re-deciding.

**Board:** M12.2 (`SKY-10731`), a child of the M12 scale-architecture epic (`SKY-10729`,
ruling `SKY-10666`: vault ≠ fact ledger). Storage location is governed by the Agent Vault
final ruling (`SKY-10949`, 2026-08-19: everything belonging to a vault's machine state lives
inside `Agent Vault/`, no split).

---

## 0. Read this first — where the tables actually stand, and the ruling that binds this spec

**`SKY-10731` has an open, CI-green, `in_review` PR** — **#1283**,
`feat(SKY-10731): fact-ledger schema + persistent vault index cache (M12.2)`, branch
`sky-10731-fact-ledger-schema`. As of this amendment its schema (v30) is:

- **`entity_index_facts`** — `id`, `fingerprint` (UNIQUE, `sha256(entity_key\nfact_key\nfact_value)`), `entity_key`, `fact_key`, `fact_value`, `status` (`active`\|`superseded`), `superseded_by`, `extracted_at`.
- **`fact_provenance`** — `id`, `fact_id` (FK → `entity_index_facts.id`), `source_path`, `source_hash`, `span_start`, `span_end`, `extracted_at`, `UNIQUE(fact_id, source_path)` — one fact can have many provenance rows (many source occurrences of the same value).
- **`fact_decisions`** — `fingerprint` (PK), `decision` (`dismissed`\|`dont_ask_again`\|`answered`), `payload_json`, `decided_at`, `revoked_at` — tombstoned, never hard-deleted, durable bucket, excluded from `rebuildDerivedFactStores()`.
- **`vault_index_cache`** — unrelated to facts; a persistent replacement for `entityIndex.ts`'s rebuild-on-open name/alias/type cache.

**Table naming already moved once because of this exact collision.** Commit `b87ca777`
(2026-08-26 11:28, three minutes before the amendment directive) renamed the notes-side
table from `fact_ledger` to `entity_index_facts` specifically to free the name `fact_ledger`
for the manuscript side, per Ivy's first ruling on this collision (COEXIST + rename). The
11:31 follow-up directive supersedes the *coexist* half of that ruling but not the rename —
`entity_index_facts` is the correct current name and this spec uses it throughout.
`fact_provenance`, `fact_decisions`, and `vault_index_cache` were untouched by that rename
(no "ledger" in their names, no collision to resolve).

`entity_key` is documented in the PR as "the resolved **vault note** path" — today this
table holds only Notes-Vault entity/property facts (the thing
`archiveContinuityEngine.ts`'s `PROPERTY_CONTRADICTION_PAIRS` and the entity panel are
headed toward). It has no `scene_id`, no `kind`, no `grounding`, no `exitValue` — §1 below
adds those as columns, not as a parallel schema.

There is also a **third**, separate thing already named "continuity check" in the shipped
product: Archive Agent's `continuity_issues` table + `archiveContinuityEngine.ts` (SKY-1684,
live since v23) — a single-scene-vs-vault-notes contradiction scanner with its own LLM
prompt and its own Notes-tree context-menu entry. This spec doesn't touch it; the
product-naming question (§ Open questions) is still Ivy's, not resolved by this amendment.

**Binding for everything below: `entity_index_facts` + `fact_provenance` + `fact_decisions`
are now a shared substrate for two sources, not two schemas.** A `source` column
(`notes`\|`manuscript`) on the fact row is what makes "does the manuscript agree with the
notes for this `entity_key`+`fact_key`" a **join, not a sync job** — this is the property
the design record's thesis and Ivy's ruling both depend on, and it's why §1 is written the
way it is.

---

## 1. Fact schema

**Restating the settled authority ruling before the schema, since everything below depends
on it**: the ledger is derived from the manuscript and is **never authoritative over notes**.
Notes remain the series bible (design record, settled). A ledger row that conflicts with a
note is the flag — the fix lands in the notes or the manuscript, decided by the author, never
by the ledger overwriting either. Nothing in this schema stores a notes-derived value as if
it were manuscript truth; §2's blindness constraint is part of how this holds (the extractor
never sees notes content at all).

**Per the amendment (§0): this section extends `entity_index_facts` / `fact_provenance` /
`fact_decisions` with new columns and one genuinely new small table. It does not create a
parallel `manuscript_fact_ledger`.** Where extending doesn't cleanly fit (§1.4), that's
called out as an explicit exception with the reason, per the amendment's own instruction not
to silently fork.

### 1.1 Storage location and format

Unchanged from v1.0: SQLite tables inside the existing per-vault `state.db` (opened via
`openDb(vaultRoot)`, `electron-main/src/db.ts`), migrated through the existing
single-integer `PRAGMA user_version` chain.

**Schema slot depends on sequencing, not a fixed number:**

- **If this build starts before PR #1283 merges** (true today — #1283 is CI-green but
  `mergedAt: null`): land the new columns **inside the same v30 migration block**, i.e.
  coordinate with whoever picks up #1283 to add the columns to the `CREATE TABLE` statements
  before they ship, instead of following with an `ALTER TABLE`. This is strictly cheaper and
  avoids every migration hazard in §1.5 — no released version of `entity_index_facts` has
  ever existed without the new columns, so there is nothing to backfill.
- **If PR #1283 merges first**: claim the next free slot at implementation time (confirm in
  `db.ts` immediately before writing the migration — the codebase's own comments show v30/v31
  already collided once between sibling branches; don't trust a number written here) and use
  `ALTER TABLE ... ADD COLUMN` + presence-check, matching the existing v29
  `continuity_issues.scope` precedent. §1.5 covers what a post-merge migration must also do
  to the `fingerprint` column.

Vault-conceptual location and the `SKY-10957` physical-path gap are unchanged from v1.0 — not
repeated here.

### 1.2 Two buckets (unchanged discipline, now literally the same tables PR #1283 defined)

- **Derived / disposable** — `entity_index_facts`, `fact_provenance` (both sources). Fully
  rebuildable from vault/manuscript content at any time.
- **Durable / decision** — `fact_decisions` (both sources, reused as-is — see §1.4). Author
  actions (dismiss a flag, accept a plan-drift note, "don't ask again"). Tombstoned, never
  hard-deleted.

**Required infra change, not optional (new — not in v1.0):** `rebuildDerivedFactStores()`
today is `DELETE FROM <table>` over the whole of `DERIVED_FACT_TABLES`, unscoped. Once one
table holds both sources, an author clicking "reindex notes" (or any future notes-side
rebuild trigger) would silently wipe every manuscript fact too — hours of LLM extraction
work destroyed by an unrelated, cheap, notes-only action, and vice versa. **This function
must take a `source` filter** (`rebuildDerivedFactStores(source: FactSource)` →
`DELETE FROM <table> WHERE source = ?`, with `fact_provenance`/`vault_index_cache` filtered
via a join back to `entity_index_facts.source` where they don't carry the column
themselves — see §1.3). This is a Phase 0 build item (§7), not a nice-to-have: without it,
"extend, don't parallel" introduces a real data-loss bug that didn't exist when the two
sources lived in separate tables.

### 1.3 `entity_index_facts` — extended field table

Existing columns (`id`, `fingerprint`, `entity_key`, `fact_key`, `fact_value`, `status`,
`superseded_by`, `extracted_at`) are unchanged in meaning. New columns:

| Field | Type | Required | Description |
|---|---|---|---|
| `source` | TEXT enum: `notes` \| `manuscript` | **yes, `NOT NULL DEFAULT 'notes'`** | The discriminator the whole amendment turns on. Default preserves every existing/in-flight PR #1283 row as `notes` with zero data movement. |
| `kind` | TEXT enum: `attribute` \| `state` \| `rule` | no (manuscript: yes; notes: null) | Drives which check applies downstream (§ design record). **Quantity is deliberately excluded**, not merely inert — Quantity is a separate, standalone visible tool per the owner ruling (design record, "Deferred: Quantity"); this column should not grow a fifth value to accommodate it without a fresh decision. Notes-side rows leave this null — the notes cache has no concept of kind today and this spec doesn't add one. |

`fact_key`/`fact_value` are reused directly as `attribute`/`value` — no renaming needed, the
notes-side vocabulary already matches the manuscript design record's shape.

**Fingerprint formula must change to include `source` (binding, not optional):** the
existing formula is `sha256(entity_key\nfact_key\nfact_value)`. Without `source` in the
hash, a manuscript fact and a notes fact that happen to share the same `entity_key` +
`fact_key` + `fact_value` (e.g. notes says "Luca: eye colour = green" and manuscript scene 2
asserts the same) would collide onto **one row** — silently merging two facts with different
lifecycles (notes rebuilds on note edit, manuscript rebuilds on scene edit) and different
provenance shapes. New formula: `sha256(source\nentity_key\nfact_key\nfact_value)`. See §1.5
for the migration implication if this lands after PR #1283 merges.

**Identity / dedup rule, restated for the shared table:** `fingerprint` uniqueness (now
source-scoped by construction) is still what makes two facts "the same fact." For
`source = 'manuscript'`, this correctly reuses the *existing* PR #1283 dedup behavior with no
new logic: if Luca's location is `Mirage Vale` across three consecutive scenes with no
change, that's **one** `entity_index_facts` row with **three** `fact_provenance` rows (§1.4)
— exactly how the notes side already handles "the same fact asserted in multiple files." A
value *change* between scenes produces a genuinely different `fact_value`, hence a different
fingerprint, hence a new row — which is precisely the "new fact vs. changed fact" signal
§2's adjacency diff needs, for free, from the table's existing behavior. **This is the
technical validation of Ivy's framing** ("a query, not a second subsystem") — the per-scene
identity model v1.0 invented in this section was unnecessary; PR #1283's existing
value-dedup + multi-provenance model already does the job once `source` and `fact_provenance`
carry scene identity (§1.4).

### 1.4 `fact_provenance` — extended field table (this is where scene/position/grounding live)

Existing columns (`id`, `fact_id`, `source_path`, `source_hash`, `span_start`, `span_end`,
`extracted_at`, `UNIQUE(fact_id, source_path)`) are unchanged. New columns — all nullable,
manuscript-only:

| Field | Type | Required | Description |
|---|---|---|---|
| `scene_id` | TEXT (uuid) | manuscript: yes; notes: null | The manuscript scene's stable identifier — see §3. **Never** a positional path string. Grounding/position live per-occurrence (per scene visit) rather than per-fact because the same value can recur across scenes unchanged (§1.3) — grounding describes *this* assertion, not the deduped fact. |
| `grounding` | TEXT enum: `shown` \| `stated` \| `implied` \| `absent` | manuscript: yes; notes: null | Grounding of the fact's assertion at this scene's entry. |
| `exit_value` | TEXT | no | Only set when the fact changes **within** this scene; the extractor sees this directly (design record — "most facts have value == exitValue"). Null means value == exitValue for this occurrence. |
| `exit_grounding` | TEXT enum: `shown` \| `stated` \| `implied` \| `absent` | no | Only set alongside `exit_value`; grounding of the in-scene change. |
| `extractor_prompt_version` | INTEGER | manuscript: yes; notes: null | Which extractor-prompt version produced this occurrence — see §4. Lives per-occurrence (not on `entity_index_facts`) because re-extraction is per-scene: a fact whose value is unchanged since the last prompt version still gets a fresh provenance row stamped with the new version, without disturbing the canonical fact row. Used for incremental invalidation (§5) and regression triage — a *content* version, unrelated to the DB schema version below. |

`source_path` for a manuscript provenance row is the scene's vault-relative file path (same
column, same purpose as the notes side); `scene_id` is the added authoritative identity
column because §3 explicitly rejects path as identity (paths aren't stable across
reorder/move — the scene UUID is). `source_hash` is reused as-is (§5 — scene content hash,
same convention). Part/Chapter/Scene **position is not a stored column** — unchanged from
v1.0's own reasoning (§3): it's resolved live from the manifest tree at scan/display time
from `scene_id`, never persisted as identity, so a reorder never touches these rows.

Re-extracting a scene whose `source_hash` is unchanged is a no-op (idempotent) — unchanged
from v1.0. Re-extracting after an edit does not overwrite in place: the `entity_index_facts`
row for the old value is marked `superseded` if the new extraction no longer confirms it, and
a new/updated row + provenance entry captures the current state — unchanged in spirit from
v1.0, now expressed through the shared table's existing `status`/`superseded_by` machinery
instead of a bespoke one.

**Future build requirement, not this spec's scope but must be named so it isn't missed
later:** whoever wires `entity_index_facts`/`vault_index_cache` into the entity panel or any
notes-facing UI (PR #1283 doesn't do this yet — confirmed no consumer exists today) **must
filter `WHERE source = 'notes'`**, or manuscript rows will leak into a notes-only surface the
moment this ledger starts writing.

### 1.4a `manuscript_fact_flags` — still a new table, and here is the concrete reason (exception, flagged per the amendment's own instruction)

Everything above extends cleanly. This one piece doesn't, and rather than silently forcing
it in, here's why: a **flag** (the adjacency-diff / boundary-pass output — "this change
between scene N and N+1 wasn't accounted for") is not a fact. It has no `entity_key` /
`fact_key` / `fact_value` shape — it's a *relationship between two `entity_index_facts`
rows* (`fact_a_id`, `fact_b_id`) plus judgment metadata (`match_state`,
`account_grounding`) that doesn't exist on either fact individually and isn't a decision
either (it's derived/rebuildable, not an author action — wrong bucket for `fact_decisions`).
Forcing it onto `entity_index_facts` would require every row to carry two nullable
self-references and a second, incompatible "kind" of row shape in the same table — worse
for clarity than one small dedicated table. Ivy's directive names `fact_ledger` +
`fact_provenance` + `fact_decisions` specifically; it doesn't mention flags, and the notes
side has no equivalent concept to collide with. **Flagging this for Ivy sign-off rather than
deciding it silently** (open question, below) — my recommendation is: yes, keep
`manuscript_fact_flags` as a new table, because it isn't a fact and isn't a decision, it's a
third kind of row that only the manuscript side produces.

Field table (unchanged from v1.0 §1.4, table name only):

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | TEXT (uuid) | yes | Row identity. |
| `fact_a_id` / `fact_b_id` | TEXT (uuid) | yes | The two `entity_index_facts` rows in tension (consecutive-scene value change, both `source = 'manuscript'`). |
| `boundary_scene_prev_id` / `boundary_scene_next_id` | TEXT (uuid) | yes | The two scenes bracketing the change — the exact context the boundary pass (§2, Stage 3) was allowed to see. |
| `match_state` | TEXT enum: `matched` \| `unmatched` \| `judged` | yes | `matched` = adjacency diff found an explanation marker mechanically, written straight through, no LLM judgment needed. `unmatched` = queued for boundary pass. `judged` = boundary pass has run. |
| `account_grounding` | TEXT enum: `shown` \| `stated` \| `implied` \| `absent` | no | Set only once `match_state = judged`. This is the actual finding — "was the change accounted for, and how clearly" (design record's worked example). |
| `created_at` / `updated_at` | TEXT (ISO) | yes | Standard. |

Note `status`/dismiss is **not** a column here (unlike v1.0) — see §1.5: dismissal reuses
`fact_decisions` directly, no schema needed for it.

### 1.5 Decisions — `fact_decisions` reused as-is, no new columns needed

Unlike the other two tables, **`fact_decisions` needs no schema change at all.** Its shape
(`fingerprint` PK, `decision`, `payload_json`, `decided_at`, `revoked_at`) is already generic
over "what got fingerprinted" — it doesn't care whether the fingerprint identifies a fact or
a flag. Dismissing a manuscript flag: `fingerprint = sha256(fact_a_id + fact_b_id +
boundary_scene_prev_id + boundary_scene_next_id)`, `decision = 'dismissed'`. This is a direct
readout of "extend, don't parallel" working exactly as Ivy's rationale predicts — the
existing durable bucket already generalizes.

**Migration hazard if PR #1283 merges (and ships) before this schema-extension lands** —
name this explicitly rather than gloss over it: changing the `entity_index_facts.fingerprint`
formula (§1.3) after real rows exist means every existing fingerprint value changes on
migration. Any `fact_decisions` row referencing an old fingerprint (app-level reference, no
DB `FOREIGN KEY` — confirmed against the current schema) would silently orphan: a
previously-dismissed fact would resurface as if never dismissed. If the fingerprint-formula
change can't land inside v30 before #1283 merges (§1.1's preferred path), the follow-up
migration must **recompute and rewrite `fact_decisions.fingerprint` in the same pass**,
using the same old-formula→new-formula mapping applied to `entity_index_facts`, in one
transaction. Recommendation: avoid this entirely by making the fingerprint-formula change
part of PR #1283 itself, or landing this spec's schema work before #1283 merges — coordinate
timing with whoever owns that PR rather than let it ship first.

### 1.6 Migration / versioning discipline

- Schema version = the `PRAGMA user_version` slot per §1.1's sequencing guidance.
- `extractor_prompt_version` is a *content* version (§1.4), unrelated to the DB schema
  version — do not conflate the two. A schema migration changes column shapes; a prompt
  version change re-derives row *content* under the same columns.
- This file will outlive several releases — when a future migration needs to add a column,
  follow `db.ts`'s existing `ALTER TABLE ... ADD COLUMN` + presence-check pattern (see the
  v29 `continuity_issues.scope` backfill) rather than a destructive rebuild.

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
`entity_index_facts`/`fact_provenance` (`source = 'manuscript'`), re-running the whole
pipeline against unchanged content is a no-op (§1.4's content-hash idempotency) — a full
rescan naturally finds fewer new items each pass and terminates when a pass finds nothing
new, with no separate "convergence" logic required.

`FactRow` in the interfaces above is the joined shape a caller works with — an
`entity_index_facts` row plus its relevant `fact_provenance` occurrence (scene, grounding,
exit value) — not a literal single-table row; see §1.3/§1.4 for the underlying columns.

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
reference problem unless it adds its **own** delete hook. Build item: on scene delete,
delete that scene's `fact_provenance` rows (`WHERE scene_id = ?`, disposable bucket — safe
to drop) and mark the parent `entity_index_facts` row `superseded` if that was its only
remaining provenance (a fact can survive if other scenes still provenance it — see §1.3);
tombstone any `fact_decisions` rows for `manuscript_fact_flags` that referenced the deleted
scene as a boundary (durable bucket — tombstone via `revoked_at`, don't hard-delete,
consistent with §1.5).

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
   `electron-main/src/vault/entityIndexCache.test.ts` (`SKY-10769` AC1/AC2/AC4/AC5 —
   corrected from v1.0's citation of a `factLedger.acceptance.test.ts` file, which does not
   exist in PR #1283's actual diff; verified against the live PR file list, not assumed) —
   its rebuild/restart/isolation tests are written so a broken implementation fails them, not
   just a happy path. Mirror that: every fixture
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
hashing scheme. A `fact_provenance` row's `source_hash` (§1.4, for the manuscript
`scene_id` it carries) is compared against the scene's current hash; a mismatch means stale,
triggering re-extraction of **that scene only**.

**On edit of scene S**:
1. Re-run Stage 1 for S only.
2. Diff the new `ExtractorOutput` against S's current `active` facts.
3. For anything changed/added, re-run Stage 2 for exactly the two boundary pairs touching S
   (`S-1↔S` and `S↔S+1`) — never the whole manuscript.
4. Run Stage 3 only for any newly-`unmatched` change at those two boundaries.

Cost is therefore **O(1) in manuscript length, O(scene length) in the edited scene** — never
a full rescan for a single-scene edit (§6 quantifies this).

**Reorder or move with no text change**: `source_hash` is unchanged, so Stage 1 is
skipped entirely. Only the adjacency pairs affected by the scene's *new* neighbor set need
Stage 2 re-run — the old neighbor pair (now discontinuous) and the new one.

**Delete**: see §3.2 — this is an invalidation case too, not just an addressing risk. Handle
it as part of the same delete hook.

**Open call, not decided here**: when a flag tied to a scene pair is dismissed
(`fact_decisions` tombstone, §1.5) and later one of those two scenes is deleted, does
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

**Phase 0 also now includes (added by the §0/§1 amendment, not in v1.0):**
- Coordinate the `source` column + fingerprint-formula change (§1.3) with whoever owns PR
  #1283 — land it inside the same v30 migration if #1283 hasn't merged yet by the time this
  is built (preferred), or run the `fact_decisions.fingerprint` rewrite migration (§1.5) if
  it has.
- Scope `rebuildDerivedFactStores()` by `source` (§1.2) before either side can safely call
  a full rebuild without destroying the other's data. This is a correctness prerequisite,
  not a nice-to-have — do not ship manuscript writes into the shared tables before this
  lands.

**Phase 1 — BlindExtractor + ledger writes only.** Ship this alone, measure extraction
fidelity against the golden fixture set (§4) on real manuscripts, before building anything
on top. No adjacency diff, no flags, no UI beyond a bare job summary. This is the owner's own
sequencing instruction, restated as a hard gate: *"ledger scan + adjacency diff before any
judgment passes, so we can measure extraction fidelity before building on top of it."*

**Phase 2 — AdjacencyDiff (mechanical).** New-fact and matched-change detection. The ledger
is now self-building and self-maintaining (§2's "same mechanism" property). Still no
judgment — unmatched changes are queued, not surfaced to the author yet.

**Phase 3 — BoundaryPass + `manuscript_fact_flags` (§1.4a, §2 Stage 3).** This spec fully
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

1. **`rebuildDerivedFactStores()` is unscoped and will cross-destroy data once one table
   holds both sources (§1.2, new in this amendment).** This is the single most severe risk
   introduced by "extend, don't parallel" itself: without a `source` filter, a routine
   notes-side reindex silently deletes every manuscript fact (hours of LLM extraction) and
   vice versa. Concrete, load-bearing, and must land in Phase 0 before any manuscript writes
   touch the shared tables — not a "later" item.
2. **Fingerprint-formula change + `fact_decisions` migration hazard (§1.3/§1.5, new in this
   amendment).** Adding `source` to the fingerprint hash is required to stop notes/manuscript
   facts colliding, but if PR #1283 merges and ships before this lands, existing
   `fact_decisions` rows reference the old fingerprint and orphan silently (a dismissed fact
   resurfaces as if never dismissed) unless the migration rewrites both in lockstep.
   Preventable entirely by sequencing this schema work inside or immediately after #1283,
   before either reaches a released build — a coordination risk, not just an engineering one.
3. **Extraction fidelity is completely unmeasured.** The design's own thesis (§ design
   record) is that everything downstream only works if extraction is faithful — there is no
   eval harness today. Phase 1 (§7) must ship with the golden-fixture regression harness
   (§4) before any later phase is trusted, not as a nice-to-have added afterward.
4. **Job-queue substrate doesn't fit blind fan-out as documented (§7 Phase 0).** FIFO,
   single job, fs+compute-only workers vs. N-concurrent LLM calls. A real conflict, not a
   detail — needs the Phase 0 sign-off before any extraction code is written against
   either assumption.
5. **`manuscript_fact_flags` remains a new table — explicit exception to "extend, don't
   parallel," flagged for sign-off, not silently decided (§1.4a, new in this amendment).** A
   flag is a relationship between two facts plus judgment metadata, not a fact or a decision
   — it doesn't fit either of the three tables Ivy's directive names. My recommendation is to
   keep it as one small dedicated table; this is the one place this amendment could not fold
   in and says so explicitly, per the ticket's own instruction not to silently fork.
6. **No split/merge-scene feature exists (§3.1).** Scene addressing is solid for everything
   the app does today; it is untested against the one future operation most likely to break
   "stable identifier." Surfaced, not worked around, per the ticket's explicit instruction.
7. **No cascade cleanup on scene delete today (§3.2).** The ledger must add its own hook or
   it will accumulate orphaned rows the moment an author deletes a scene.
8. **Future notes-UI consumers must filter by `source` (§1.4, new in this amendment).** No
   consumer of `entity_index_facts`/`vault_index_cache` exists yet (confirmed against the
   live PR #1283 diff), so this is latent, not active — but whoever wires the entity panel to
   these tables must add `WHERE source = 'notes'` or manuscript rows leak into a notes-only
   surface. Naming it now so it isn't missed when that build issue is scoped.
9. **Schema slot is a moving target.** `db.ts`'s own comments show v30/v31 already collided
   once between sibling branches. Re-verify the free slot immediately before implementation
   if #1283 has already merged by then (§1.1) — don't trust a number written here.
10. **Prompt caching doesn't exist in `provider.ts` yet (§4).** The cost model's central
    economics claim (§6) requires `cache_control` support that is net-new engineering work,
    not just prompt wording.
11. **No pre-run cost estimate infrastructure exists anywhere (§6).** No pricing table, no
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

## Open questions for Ivy (not answered here — product/sign-off calls, not settled by engineering alone)

1. **`manuscript_fact_flags` as the one remaining new table (§1.4a, Risk #5).** Confirm this
   is the correct place to stop extending — my read is that a flag isn't a fact or a
   decision so it can't fold into the three named tables without a worse-for-clarity
   compromise, but this is exactly the kind of "silent fork" the directive told me to bring
   to you rather than decide alone.
2. **Does the Archive Agent's existing "Continuity Check" menu item get renamed, merged
   into, or left alongside this new one?** What does the user-facing name become so it
   doesn't collide with the term Archive Agent already owns? (Carried forward from v1.0 —
   the extend-vs-parallel ruling settles the *schema* question but not this product-naming
   one.)
3. **Phase 0's architecture call (§7)** — main-process LLM orchestration alongside the
   existing worker-only job queue, as opposed to extending the worker substrate itself for
   network calls. I have a recommendation; it changes how M12.2 and M12.3 (`SKY-10770`)
   fit together and deserves explicit sign-off before Phase 1 implementation starts.
4. **Sequencing with PR #1283 (§1.1, §1.5, Risk #2).** Should the `source`/fingerprint
   schema change be folded into #1283 itself before it merges, or does #1283 merge first and
   this follows as a migration? This is a coordination call between whoever owns #1283 and
   whoever picks up this spec — naming it here so it doesn't fall through the gap between two
   tickets.
