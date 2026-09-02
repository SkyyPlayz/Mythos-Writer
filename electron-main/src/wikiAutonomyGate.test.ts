import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  executeWikiAutonomy,
  planWikiAutonomy,
  resolveWikiAutonomyMode,
  type WikiAutoStubCandidate,
  type WikiAutonomyDeps,
} from './wikiAutonomyGate.js';
import * as autoStubHygiene from './autoStubHygiene.js';
import { closeDb, listBrainstormQuestions, openDb } from './db.js';
import type { EntityEntry } from './ipc.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function entity(name: string, aliases: string[] = [], id = name.toLowerCase()): EntityEntry {
  return {
    id,
    name,
    type: 'character',
    path: `Universes/Argent/Characters/${name}.md`,
    aliases,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

const EXISTING: EntityEntry[] = [entity('Elara', ['Ellie']), entity('Lyra Ash')];

function candidate(name: string, over: Partial<WikiAutoStubCandidate> = {}): WikiAutoStubCandidate {
  return { name, entityType: 'character', scenePath: 'Scenes/01.md', ...over };
}

function makeTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-wiki-autonomy-'));
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ── AC1: tri-state, default "always ask", user-changeable ──────────────────────

describe('resolveWikiAutonomyMode — tri-state with a safe default', () => {
  it('defaults to "ask" when the setting is absent', () => {
    expect(resolveWikiAutonomyMode(undefined)).toBe('ask');
    expect(resolveWikiAutonomyMode({})).toBe('ask');
    expect(resolveWikiAutonomyMode({ wikiAutonomy: undefined })).toBe('ask');
  });

  it('honors each of the three explicit states', () => {
    expect(resolveWikiAutonomyMode({ wikiAutonomy: 'off' })).toBe('off');
    expect(resolveWikiAutonomyMode({ wikiAutonomy: 'ask' })).toBe('ask');
    expect(resolveWikiAutonomyMode({ wikiAutonomy: 'auto' })).toBe('auto');
  });

  it('falls back to the safe "ask" default for an unrecognised value', () => {
    // A corrupted / forward-compat settings file must never silently start
    // auto-writing to the vault.
    expect(resolveWikiAutonomyMode({ wikiAutonomy: 'garbage' as never })).toBe('ask');
  });
});

// ── AC2: "always ask" never writes to the vault without author approval ────────

describe('"always ask" mode never writes to the vault', () => {
  it('turns every candidate into a queued question and writes nothing', () => {
    // Inject the enqueue dep so this asserts behavior without a real DB — and,
    // critically, proves the ONLY side effect is enqueuing a question.
    const enqueue = vi.fn<WikiAutonomyDeps['enqueue']>((input) => ({
      id: `q-${input.entityName}`,
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
      created_at: '2026-01-01T00:00:00.000Z',
    }));

    const result = executeWikiAutonomy(
      [candidate('Nyx'), candidate('Corvin')],
      { mode: 'ask', entities: EXISTING },
      { enqueue },
    );

    // Every candidate became a pending question, none became a stub-to-write.
    expect(result.mode).toBe('ask');
    expect(result.stubs).toEqual([]);
    expect(result.enqueued).toHaveLength(2);
    expect(enqueue).toHaveBeenCalledTimes(2);
    for (const call of enqueue.mock.calls) {
      expect(call[0].source).toBe('wiki_autostub');
    }
    // The hygiene contract is not even consulted in ask mode — nothing is
    // auto-decided; the author decides.
    const filterSpy = vi.spyOn(autoStubHygiene, 'filterAutoStubCandidates');
    executeWikiAutonomy([candidate('Nyx')], { mode: 'ask', entities: EXISTING }, { enqueue });
    expect(filterSpy).not.toHaveBeenCalled();
  });

  it('plan is pure: with no deps supplied, planning enqueues nothing', () => {
    const plan = planWikiAutonomy([candidate('Nyx')], { mode: 'ask', entities: EXISTING });
    expect(plan.questions).toHaveLength(1);
    expect(plan.questions[0].source).toBe('wiki_autostub');
    expect(plan.stubs).toEqual([]);
  });

  it('lands real rows in the question queue and never a vault note (end-to-end)', () => {
    const vault = makeTmp();
    openDb(vault);
    try {
      const result = executeWikiAutonomy(
        [candidate('Nyx', { entityType: 'location' })],
        { mode: 'ask', entities: EXISTING },
        // default deps → the real enqueueQuestion → real DB
      );
      expect(result.enqueued).toHaveLength(1);

      const pending = listBrainstormQuestions('pending');
      expect(pending).toHaveLength(1);
      expect(pending[0].source).toBe('wiki_autostub');
      expect(pending[0].entity_name).toBe('Nyx');
      expect(pending[0].status).toBe('pending');
      // note_path stays null: nothing was written to the vault. The note is
      // only authored later, when the author answers the question.
      expect(pending[0].note_path).toBeNull();
    } finally {
      closeDb();
      fs.rmSync(vault, { recursive: true, force: true });
    }
  });
});

// ── AC3: "auto" paths call through to the M12.B5a hygiene contract ─────────────

describe('"auto" mode delegates the keep/suppress decision to the hygiene contract', () => {
  it('routes candidate names through filterAutoStubCandidates, not a local reimplementation', () => {
    const filterSpy = vi.spyOn(autoStubHygiene, 'filterAutoStubCandidates');
    planWikiAutonomy([candidate('Vorn')], { mode: 'auto', entities: EXISTING });
    expect(filterSpy).toHaveBeenCalledTimes(1);
    expect(filterSpy.mock.calls[0][0]).toEqual(['Vorn']);
    expect(filterSpy.mock.calls[0][1]).toBe(EXISTING);
  });

  it('keeps only hygiene survivors and suppresses dupes / junk', () => {
    const result = executeWikiAutonomy(
      [
        candidate('Vorn'), // brand new → survives
        candidate('Elara'), // exact duplicate of an existing entity → suppressed
        candidate('Ellie'), // alias collision with Elara → suppressed
        candidate('the'), // throwaway junk → suppressed
      ],
      { mode: 'auto', entities: EXISTING },
    );

    expect(result.mode).toBe('auto');
    expect(result.stubs.map((s) => s.name)).toEqual(['Vorn']);
    expect(result.enqueued).toEqual([]); // auto mode never enqueues questions
    const suppressedNames = result.suppressed.map((s) => s.candidateName).sort();
    expect(suppressedNames).toEqual(['Elara', 'Ellie', 'the']);
  });

  it('preserves candidate context (type / scene) on the survivors it hands back', () => {
    const result = executeWikiAutonomy(
      [candidate('Vorn', { entityType: 'faction', scenePath: 'Scenes/09.md' })],
      { mode: 'auto', entities: EXISTING },
    );
    expect(result.stubs).toHaveLength(1);
    expect(result.stubs[0]).toMatchObject({
      name: 'Vorn',
      entityType: 'faction',
      scenePath: 'Scenes/09.md',
    });
  });
});

// ── "off" mode ─────────────────────────────────────────────────────────────────

describe('"off" mode proposes nothing', () => {
  it('produces no questions and no stubs, and touches neither contract', () => {
    const enqueue = vi.fn<WikiAutonomyDeps['enqueue']>(() => null);
    const filterSpy = vi.spyOn(autoStubHygiene, 'filterAutoStubCandidates');

    const result = executeWikiAutonomy(
      [candidate('Vorn'), candidate('Elara')],
      { mode: 'off', entities: EXISTING },
      { enqueue },
    );

    expect(result).toEqual({ mode: 'off', enqueued: [], stubs: [], suppressed: [] });
    expect(enqueue).not.toHaveBeenCalled();
    expect(filterSpy).not.toHaveBeenCalled();
  });
});
