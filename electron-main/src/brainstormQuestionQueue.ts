// Brainstorm question queue (M12.B2 / SKY-10737).
//
// Owner ruling (SKY-10528): "a flag is a defect, a question is an
// invitation." This is the landing point for gaps Archive's Check 2 finds
// in the vault (M12.B1), Brainstorm's own gap-hunting, and the "obscured
// reference" flow (Epic A / M12.4, e.g. an unresolvable "the hooded
// figure" mention) — never a continuity flag, never auto-applied. Archive
// (and any other finder) only detects and emits; draining the queue by
// conversation and authoring the resulting vault note is Brainstorm's job.

import crypto from 'crypto';
import {
  insertBrainstormQuestion,
  listBrainstormQuestions,
  getBrainstormQuestion,
  findBrainstormQuestionByEntityScene,
  answerBrainstormQuestion,
  type DbBrainstormQuestion,
  type BrainstormQuestionSource,
} from './db.js';
import type { ArchiveProposedQuestion } from './archiveAgent.js';
import { entityTypeToFactType, type NoteProposal } from './brainstormAgent.js';
import {
  resolveProposalDestination,
  writeNoteProposal,
  type ProposalDestinationResolution,
} from './brainstormNoteWriter.js';

export interface EnqueueQuestionInput {
  source: BrainstormQuestionSource;
  question: string;
  entityId?: string | null;
  entityName?: string | null;
  entityType?: string | null;
  scenePath?: string | null;
  now?: string;
}

/**
 * Queues one question. Skips entity-scoped questions that already have a
 * row (pending or answered) for the same entity+scene, so a re-scan of an
 * unchanged gap doesn't spam the queue and an answered gap is never re-asked.
 */
export function enqueueQuestion(input: EnqueueQuestionInput): DbBrainstormQuestion | null {
  if (input.entityId && input.scenePath) {
    const existing = findBrainstormQuestionByEntityScene(input.entityId, input.scenePath);
    if (existing) return null;
  }
  const row: DbBrainstormQuestion = {
    id: crypto.randomUUID(),
    source: input.source,
    entity_id: input.entityId ?? null,
    entity_name: input.entityName ?? null,
    entity_type: input.entityType ?? null,
    question: input.question,
    scene_path: input.scenePath ?? null,
    status: 'pending',
    answer: null,
    answered_at: null,
    note_path: null,
    created_at: input.now ?? new Date().toISOString(),
  };
  insertBrainstormQuestion(row);
  return row;
}

/** Ingests Check 2's proposed-questions output (Archive's side effect, never a flag). */
export function ingestArchiveQuestions(questions: ArchiveProposedQuestion[]): DbBrainstormQuestion[] {
  const queued: DbBrainstormQuestion[] = [];
  for (const q of questions) {
    const row = enqueueQuestion({
      source: 'archive_check2',
      question: q.question,
      entityId: q.entityId,
      entityName: q.entityName,
      entityType: q.entityType,
      scenePath: q.scenePath,
      now: q.createdAt,
    });
    if (row) queued.push(row);
  }
  return queued;
}

/** The drain candidates — questions still awaiting an author answer. */
export function listPendingQuestions(): DbBrainstormQuestion[] {
  return listBrainstormQuestions('pending');
}

export interface AnswerQuestionArgs {
  id: string;
  answer: string;
  notesVaultRoot: string;
  storyVaultRoot: string;
  activeUniverse?: string | null;
  activeStory?: string | null;
  now?: string;
}

export type AnswerQuestionResult =
  | { status: 'answered'; notePath: string }
  | { status: 'not_found' }
  | { status: 'already_answered' };

/**
 * Drains one question: the author's answer becomes a vault note that
 * Brainstorm authors (never Archive), then the question is tombstoned —
 * status flips to 'answered' with the answer/note path recorded, the row
 * is never deleted (matches the fact-ledger durable/disposable split,
 * M12.2).
 */
export function answerQuestion(args: AnswerQuestionArgs): AnswerQuestionResult {
  const row = getBrainstormQuestion(args.id);
  if (!row) return { status: 'not_found' };
  if (row.status !== 'pending') return { status: 'already_answered' };

  const now = args.now ?? new Date().toISOString();
  const title = row.entity_name ?? row.question.slice(0, 80);
  const kind = entityTypeToFactType(row.entity_type ?? 'other');

  const destination: ProposalDestinationResolution = resolveProposalDestination({
    kind,
    title,
    notesVaultRoot: args.notesVaultRoot,
    activeUniverse: args.activeUniverse,
    activeStory: args.activeStory,
  });
  if (destination.status === 'disambiguation_needed') {
    // No interactive round-trip at this layer (no renderer to ask) — same
    // ambiguous-universe case BRAINSTORM_WRITE_NOTE hands back to the author.
    throw new Error(
      `Cannot resolve a vault destination for "${title}" — multiple universes exist and none is active.`
    );
  }
  const destinationPath =
    destination.status === 'existing_note_match' ? destination.existingPath : destination.destinationPath;
  const suggestedDestination =
    destination.status === 'resolved' ? destination.suggestedDestination : undefined;

  const proposal: NoteProposal = {
    id: crypto.randomUUID(),
    kind,
    title,
    destinationPath,
    body: args.answer,
    frontmatter: {
      source: 'brainstorm_question',
      question: row.question,
      scene_path: row.scene_path ?? undefined,
    },
    sourceConversationTurnId: row.id,
    extractionConfidence: 1,
    status: 'confirmed',
  };

  const written = writeNoteProposal({
    proposal,
    notesVaultRoot: args.notesVaultRoot,
    storyVaultRoot: args.storyVaultRoot,
    now,
    suggestedDestination,
  });

  answerBrainstormQuestion(row.id, args.answer, written.path, now);
  return { status: 'answered', notePath: written.path };
}
