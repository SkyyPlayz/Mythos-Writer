// Wiki self-building autonomy gate (M12.B5b / SKY-10878).
//
// This is the single decision point the self-building wiki engine calls before
// it would create an entity stub. It reads the tri-state `wikiAutonomy` setting
// (SKY-10740's parent decision) and routes each auto-stub candidate:
//
//   'ask'  (default) — NEVER writes to the vault. Each candidate becomes a
//                      Brainstorm question (SKY-10737) the author answers; the
//                      author's answer is what authors the note. This module
//                      imports NO note writer, so the "always ask never writes
//                      without approval" guarantee is structural, not just a
//                      runtime check.
//   'auto'           — delegates the keep/suppress decision to M12.B5a's
//                      hygiene contract (SKY-10877 `filterAutoStubCandidates`)
//                      and returns only the survivors for the caller to write.
//                      Dedup / junk detection is NOT reimplemented here.
//   'off'            — proposes nothing: no questions, no stubs.
//
// Deliberate split:
//   planWikiAutonomy   — PURE. No side effects. The auditable core; safe to
//                        assert against directly in tests.
//   executeWikiAutonomy — the only effectful entry point; its sole side effect
//                        in 'ask' mode is enqueuing questions.

import { filterAutoStubCandidates, type BatchHygieneResult } from './autoStubHygiene.js';
import { enqueueQuestion, type EnqueueQuestionInput } from './brainstormQuestionQueue.js';
import type { DbBrainstormQuestion } from './db.js';
import type { EntityEntry, AppSettings } from './ipc.js';

export type WikiAutonomyMode = 'off' | 'ask' | 'auto';

/**
 * Resolve the effective mode from settings. Absent or any unrecognised value
 * falls back to 'ask' — the safe default that never writes without approval.
 */
export function resolveWikiAutonomyMode(
  settings: Pick<AppSettings, 'wikiAutonomy'> | null | undefined,
): WikiAutonomyMode {
  const mode = settings?.wikiAutonomy;
  return mode === 'off' || mode === 'auto' ? mode : 'ask';
}

/** A name the wiki engine wants to stub, plus the context to frame a question. */
export interface WikiAutoStubCandidate {
  /** The proposed entity name (what the stub / question is about). */
  name: string;
  /** Best-guess entity type; used to word the question and set the note kind. */
  entityType?: string | null;
  /** Scene the mention was found in, if any. Drives per-scene dedup in the queue. */
  scenePath?: string | null;
  /**
   * Existing entity id, if this candidate is a link to a known entity rather
   * than a brand-new stub (e.g. the obscured-reference flow). Usually null.
   */
  entityId?: string | null;
}

export interface WikiAutonomyOptions {
  mode: WikiAutonomyMode;
  /** Current vault entities — the hygiene contract's dedup source (auto mode). */
  entities: EntityEntry[];
  /** Levenshtein threshold forwarded to the hygiene contract. Default 1. */
  fuzzyThreshold?: number;
}

/**
 * The pure, side-effect-free plan. Exactly one of `questions` / `stubs` is
 * non-empty depending on mode; `suppressed` records hygiene rejections in
 * 'auto' mode for surfacing / telemetry.
 */
export interface WikiAutonomyPlan {
  mode: WikiAutonomyMode;
  /** 'ask' mode: questions to enqueue. Empty otherwise. */
  questions: EnqueueQuestionInput[];
  /** 'auto' mode: candidates that passed hygiene and should be written. Empty otherwise. */
  stubs: WikiAutoStubCandidate[];
  /** 'auto' mode: candidates the hygiene contract rejected (dupes / junk). Empty otherwise. */
  suppressed: BatchHygieneResult[];
}

function toQuestionInput(candidate: WikiAutoStubCandidate): EnqueueQuestionInput {
  const kind = candidate.entityType?.trim() || 'entity';
  return {
    source: 'wiki_autostub',
    // "A question is an invitation" (SKY-10528) — frame it as a choice, not a
    // flag. Answering it in Brainstorm is what writes the note.
    question: `A new ${kind} “${candidate.name}” appeared in your draft. Add it to the wiki?`,
    entityId: candidate.entityId ?? null,
    entityName: candidate.name,
    entityType: candidate.entityType ?? null,
    scenePath: candidate.scenePath ?? null,
  };
}

/**
 * Decide what to do with a batch of auto-stub candidates. PURE: no DB writes,
 * no vault writes. The caller executes the plan (or asserts against it).
 */
export function planWikiAutonomy(
  candidates: WikiAutoStubCandidate[],
  opts: WikiAutonomyOptions,
): WikiAutonomyPlan {
  const base: WikiAutonomyPlan = { mode: opts.mode, questions: [], stubs: [], suppressed: [] };

  if (opts.mode === 'off' || candidates.length === 0) {
    return base;
  }

  if (opts.mode === 'ask') {
    return { ...base, questions: candidates.map(toQuestionInput) };
  }

  // 'auto' — the hygiene contract (SKY-10877) is the sole arbiter of which
  // names survive. We never re-implement dedup / junk detection here.
  const results = filterAutoStubCandidates(
    candidates.map((c) => c.name),
    opts.entities,
    opts.fuzzyThreshold,
  );
  const okNames = new Set(
    results.filter((r) => r.result.verdict === 'ok').map((r) => r.candidateName),
  );
  const stubs = candidates.filter((c) => okNames.has(c.name));
  const suppressed = results.filter((r) => r.result.verdict !== 'ok');
  return { ...base, stubs, suppressed };
}

/** Injectable deps so unit tests can run 'ask' mode without a real DB. */
export interface WikiAutonomyDeps {
  enqueue: (input: EnqueueQuestionInput) => DbBrainstormQuestion | null;
}

const DEFAULT_DEPS: WikiAutonomyDeps = { enqueue: enqueueQuestion };

export interface WikiAutonomyResult {
  mode: WikiAutonomyMode;
  /** 'ask' mode: questions actually enqueued (nulls from the queue's own dedup dropped). */
  enqueued: DbBrainstormQuestion[];
  /** 'auto' mode: survivors the caller should now write to the vault. */
  stubs: WikiAutoStubCandidate[];
  /** 'auto' mode: hygiene-rejected candidates. */
  suppressed: BatchHygieneResult[];
}

/**
 * Execute the plan. The ONLY side effect is enqueuing questions in 'ask' mode.
 * 'auto' mode returns survivors for the caller to write — this gate never
 * writes vault notes itself, in any mode.
 */
export function executeWikiAutonomy(
  candidates: WikiAutoStubCandidate[],
  opts: WikiAutonomyOptions,
  deps: WikiAutonomyDeps = DEFAULT_DEPS,
): WikiAutonomyResult {
  const plan = planWikiAutonomy(candidates, opts);
  const enqueued: DbBrainstormQuestion[] = [];
  for (const q of plan.questions) {
    const row = deps.enqueue(q);
    if (row) enqueued.push(row);
  }
  return { mode: plan.mode, enqueued, stubs: plan.stubs, suppressed: plan.suppressed };
}
