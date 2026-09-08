import { describe, expect, it, vi } from 'vitest';
import {
  runWikiAutonomyForScene,
  type RunWikiAutonomyArgs,
  type WikiAutonomyRunnerDeps,
} from './wikiAutonomyRunner.js';
import type { EnqueueQuestionInput } from './brainstormQuestionQueue.js';
import type { DbBrainstormQuestion } from './db.js';
import type { WikiKnownEntity } from './wikiNameCandidates.js';

// SKY-11457: before this runner existed the tri-state setting was persisted and
// then read by nobody. These tests are the regression guard — each mode must
// produce a different, observable outcome for the same scene.

const SCENE = 'Stories/Argent/Chapter 1/Scene 1.md';
const KNOWN: WikiKnownEntity[] = [{ name: 'Elara', aliases: ['Ellie'] }];

// Two new names, each appearing away from a sentence start.
const PROSE = 'The lantern swung as Corwin crossed the yard toward Halvard.';

function makeDeps(): WikiAutonomyRunnerDeps & {
  queued: EnqueueQuestionInput[];
  written: { path: string; body: string }[];
} {
  const queued: EnqueueQuestionInput[] = [];
  const written: { path: string; body: string }[] = [];
  return {
    queued,
    written,
    enqueue: (input) => {
      queued.push(input);
      return { id: `q${queued.length}` } as DbBrainstormQuestion;
    },
    resolveDestination: ({ title }) => ({
      status: 'resolved',
      destinationPath: `Inbox/${title}.md`,
    }),
    writeNote: ({ proposal }) => {
      written.push({ path: proposal.destinationPath, body: proposal.body });
      return { status: 'written', path: proposal.destinationPath };
    },
  };
}

function args(
  wikiAutonomy: 'off' | 'ask' | 'auto' | undefined,
  over: Partial<RunWikiAutonomyArgs> = {},
): RunWikiAutonomyArgs {
  return {
    sceneText: PROSE,
    scenePath: SCENE,
    entities: KNOWN,
    settings: { wikiAutonomy },
    notesVaultRoot: '/notes',
    storyVaultRoot: '/story',
    now: '2026-09-08T00:00:00.000Z',
    ...over,
  };
}

describe('runWikiAutonomyForScene — "off"', () => {
  it('proposes nothing and writes nothing', () => {
    const deps = makeDeps();
    const summary = runWikiAutonomyForScene(args('off'), deps);

    expect(summary).toEqual({
      mode: 'off',
      candidates: 0,
      questionsQueued: 0,
      stubsWritten: 0,
      suppressed: 0,
      skipped: 0,
    });
    expect(deps.queued).toEqual([]);
    expect(deps.written).toEqual([]);
  });
});

describe('runWikiAutonomyForScene — "ask" (the default)', () => {
  it('turns every new name into a Brainstorm question and writes nothing', () => {
    const deps = makeDeps();
    const summary = runWikiAutonomyForScene(args('ask'), deps);

    expect(summary.mode).toBe('ask');
    expect(summary.candidates).toBe(2);
    expect(summary.questionsQueued).toBe(2);
    expect(summary.stubsWritten).toBe(0);
    expect(deps.written).toEqual([]);
    expect(deps.queued.map((q) => q.entityName)).toEqual(['Corwin', 'Halvard']);
    expect(deps.queued.every((q) => q.source === 'wiki_autostub')).toBe(true);
    expect(deps.queued.every((q) => q.scenePath === SCENE)).toBe(true);
  });

  it('is the mode used when the setting is missing or corrupt', () => {
    for (const value of [undefined, 'nonsense' as never]) {
      const deps = makeDeps();
      const summary = runWikiAutonomyForScene(args(value), deps);
      expect(summary.mode).toBe('ask');
      expect(deps.written).toEqual([]);
    }
    const nullSettings = runWikiAutonomyForScene(args(undefined, { settings: null }), makeDeps());
    expect(nullSettings.mode).toBe('ask');
  });

  it('queues nothing when a re-scan finds only names already asked about', () => {
    const deps = makeDeps();
    // The queue's own name+scene guard returns null for a repeat.
    deps.enqueue = () => null;
    const summary = runWikiAutonomyForScene(args('ask'), deps);
    expect(summary.candidates).toBe(2);
    expect(summary.questionsQueued).toBe(0);
  });
});

describe('runWikiAutonomyForScene — "auto"', () => {
  it('stubs the survivors into the Notes Vault and asks nothing', () => {
    const deps = makeDeps();
    const summary = runWikiAutonomyForScene(args('auto'), deps);

    expect(summary.mode).toBe('auto');
    expect(summary.candidates).toBe(2);
    expect(summary.questionsQueued).toBe(0);
    expect(summary.stubsWritten).toBe(2);
    expect(deps.queued).toEqual([]);
    expect(deps.written.map((w) => w.path)).toEqual(['Inbox/Corwin.md', 'Inbox/Halvard.md']);
    // The stub says where it came from, so the author can trust or delete it.
    expect(deps.written[0].body).toContain('Corwin');
    expect(deps.written[0].body).toContain(SCENE);
  });

  it('files an unconfirmed name in the Inbox rather than asserting a type', () => {
    const deps = makeDeps();
    const resolve = vi.fn(deps.resolveDestination);
    runWikiAutonomyForScene(args('auto'), { ...deps, resolveDestination: resolve });
    expect(resolve.mock.calls.every((call) => call[0].kind === 'inbox')).toBe(true);
  });

  it('lets the hygiene contract suppress a near-duplicate of a known entity', () => {
    const deps = makeDeps();
    // "Elarah" is one edit from the known "Elara" — a misspelling, not a new
    // character. Detection cannot see that; the hygiene contract can.
    const summary = runWikiAutonomyForScene(
      args('auto', { sceneText: 'The road bent where Elarah had fallen.' }),
      deps,
    );
    expect(summary.candidates).toBe(1);
    expect(summary.stubsWritten).toBe(0);
    expect(summary.suppressed).toBe(1);
    expect(deps.written).toEqual([]);
  });

  it('never overwrites a note the author already has', () => {
    const deps = makeDeps();
    const summary = runWikiAutonomyForScene(args('auto'), {
      ...deps,
      resolveDestination: () => ({ status: 'existing_note_match', existingPath: 'Inbox/Corwin.md' }),
    });
    expect(summary.stubsWritten).toBe(0);
    expect(summary.skipped).toBe(2);
    expect(deps.written).toEqual([]);
  });

  it('skips instead of throwing when the vault refuses a write', () => {
    const deps = makeDeps();
    const summary = runWikiAutonomyForScene(args('auto'), {
      ...deps,
      writeNote: () => {
        throw new Error('STORY_VAULT_GUARD_ERROR');
      },
    });
    expect(summary.stubsWritten).toBe(0);
    expect(summary.skipped).toBe(2);
  });
});

describe('runWikiAutonomyForScene — quiet scenes', () => {
  it('does no work when the scene holds no new names', () => {
    const deps = makeDeps();
    const summary = runWikiAutonomyForScene(
      args('auto', { sceneText: 'The road bent where Elara had fallen.' }),
      deps,
    );
    expect(summary.candidates).toBe(0);
    expect(deps.written).toEqual([]);
  });
});
