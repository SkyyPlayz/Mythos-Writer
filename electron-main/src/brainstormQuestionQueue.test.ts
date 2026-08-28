import { describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  answerQuestion,
  enqueueQuestion,
  ingestArchiveQuestions,
  listPendingQuestions,
} from './brainstormQuestionQueue.js';
import {
  closeDb,
  getBrainstormQuestion,
  insertContinuityIssue,
  listBrainstormQuestions,
  listContinuityIssues,
  openDb,
  type DbContinuityIssue,
} from './db.js';
import type { ArchiveProposedQuestion } from './archiveAgent.js';

const NOW = '2026-06-15T12:00:00.000Z';

function makeTmp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeArchiveQuestion(overrides: Partial<ArchiveProposedQuestion> = {}): ArchiveProposedQuestion {
  return {
    id: 'archive-question-1',
    entityId: 'entity-elara',
    entityName: 'Elara',
    entityType: 'character',
    question: '"Elara" appears in the manuscript but the vault has no tracked details yet — what should be recorded?',
    scenePath: 'Scenes/01.md',
    createdAt: NOW,
    ...overrides,
  };
}

function makeContinuityIssue(overrides: Partial<DbContinuityIssue> = {}): DbContinuityIssue {
  return {
    id: 'issue-1',
    scope: 'story_vault',
    category: 'factual_contradiction',
    severity: 'high',
    manuscript_scene_id: 'Scenes/01.md',
    manuscript_offset: 0,
    manuscript_excerpt: 'crystal-lit lantern',
    vault_note_path: 'Universes/Argent/Items/Lantern.md',
    vault_line: 3,
    vault_excerpt: 'oil-lit lantern',
    rationale: 'fuel source contradiction',
    proposed_match_archive: 'oil-lit lantern',
    proposed_suggest_story: 'crystal-lit lantern',
    status: 'open',
    resolved_at: null,
    resolved_action: null,
    created_at: NOW,
    ...overrides,
  };
}

describe('ingestArchiveQuestions', () => {
  it('lands a Check 2 gap question in the queue as its own artifact type, not a flag', () => {
    const vault = makeTmp('mythos-question-queue-db-');
    openDb(vault);
    try {
      const queued = ingestArchiveQuestions([makeArchiveQuestion()]);

      expect(queued).toHaveLength(1);
      expect(queued[0].source).toBe('archive_check2');
      expect(queued[0].status).toBe('pending');
      expect(queued[0].entity_name).toBe('Elara');

      const pending = listPendingQuestions();
      expect(pending).toHaveLength(1);
      expect(pending[0].id).toBe(queued[0].id);

      // Never lands in the continuity-flags table — separate model entirely.
      expect(listContinuityIssues()).toHaveLength(0);
    } finally {
      closeDb();
      fs.rmSync(vault, { recursive: true, force: true });
    }
  });

  it('does not re-queue the same entity+scene gap on a repeat scan', () => {
    const vault = makeTmp('mythos-question-queue-dedup-db-');
    openDb(vault);
    try {
      ingestArchiveQuestions([makeArchiveQuestion()]);
      ingestArchiveQuestions([makeArchiveQuestion({ id: 'archive-question-2' })]);

      expect(listBrainstormQuestions()).toHaveLength(1);
    } finally {
      closeDb();
      fs.rmSync(vault, { recursive: true, force: true });
    }
  });

  it('negative control: a continuity-flag write does not create a queue entry', () => {
    const vault = makeTmp('mythos-question-queue-negctrl-db-');
    openDb(vault);
    try {
      insertContinuityIssue(makeContinuityIssue());

      expect(listContinuityIssues()).toHaveLength(1);
      expect(listBrainstormQuestions()).toHaveLength(0);
    } finally {
      closeDb();
      fs.rmSync(vault, { recursive: true, force: true });
    }
  });
});

describe('answerQuestion', () => {
  it('authors a vault note via Brainstorm and tombstones the question (durable, not deleted)', () => {
    const root = makeTmp('mythos-question-queue-answer-');
    const notesRoot = path.join(root, 'Notes Vault');
    const storyRoot = path.join(root, 'Story Vault');
    fs.mkdirSync(notesRoot, { recursive: true });
    fs.mkdirSync(storyRoot, { recursive: true });
    openDb(root);
    try {
      const [queued] = ingestArchiveQuestions([makeArchiveQuestion()]);

      const result = answerQuestion({
        id: queued.id,
        answer: 'Elara is the healer who refuses the throne.',
        notesVaultRoot: notesRoot,
        storyVaultRoot: storyRoot,
        activeUniverse: 'Argent',
        now: NOW,
      });

      expect(result.status).toBe('answered');
      if (result.status !== 'answered') throw new Error('unreachable');

      const notePath = path.join(notesRoot, result.notePath);
      expect(fs.existsSync(notePath)).toBe(true);
      const content = fs.readFileSync(notePath, 'utf-8');
      expect(content).toContain('created_by: brainstorm_agent');
      expect(content).toContain('Elara is the healer who refuses the throne.');

      const row = getBrainstormQuestion(queued.id);
      expect(row?.status).toBe('answered');
      expect(row?.answer).toBe('Elara is the healer who refuses the throne.');
      expect(row?.answered_at).toBe(NOW);
      expect(row?.note_path).toBe(result.notePath);

      // Tombstoned, not deleted — durable per the fact-ledger split (M12.2).
      expect(listBrainstormQuestions()).toHaveLength(1);
    } finally {
      closeDb();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses to re-answer an already-answered question', () => {
    const root = makeTmp('mythos-question-queue-reanswer-');
    const notesRoot = path.join(root, 'Notes Vault');
    const storyRoot = path.join(root, 'Story Vault');
    fs.mkdirSync(notesRoot, { recursive: true });
    fs.mkdirSync(storyRoot, { recursive: true });
    openDb(root);
    try {
      const row = enqueueQuestion({
        source: 'brainstorm_gap_hunt',
        question: 'Who is the hooded figure?',
        entityName: 'Hooded Figure',
        entityType: 'character',
        now: NOW,
      });
      if (!row) throw new Error('expected a queued row');

      answerQuestion({
        id: row.id,
        answer: 'The hooded figure is Kael in disguise.',
        notesVaultRoot: notesRoot,
        storyVaultRoot: storyRoot,
        now: NOW,
      });

      const second = answerQuestion({
        id: row.id,
        answer: 'A different answer.',
        notesVaultRoot: notesRoot,
        storyVaultRoot: storyRoot,
        now: NOW,
      });

      expect(second.status).toBe('already_answered');
      expect(getBrainstormQuestion(row.id)?.answer).toBe('The hooded figure is Kael in disguise.');
    } finally {
      closeDb();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('reports not_found for an unknown question id', () => {
    const vault = makeTmp('mythos-question-queue-notfound-db-');
    openDb(vault);
    try {
      const result = answerQuestion({
        id: 'does-not-exist',
        answer: 'irrelevant',
        notesVaultRoot: path.join(vault, 'Notes Vault'),
        storyVaultRoot: path.join(vault, 'Story Vault'),
        now: NOW,
      });
      expect(result.status).toBe('not_found');
    } finally {
      closeDb();
      fs.rmSync(vault, { recursive: true, force: true });
    }
  });
});
