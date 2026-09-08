// Wiki-autonomy scene runner (SKY-11457).
//
// The production wiring between "the wiki read a scene" and the tri-state
// `wikiAutonomy` setting. Before this module the setting persisted but was read
// by nothing: `wikiAutonomyGate` and `autoStubHygiene` had no caller outside
// their own unit tests (QA SKY-11440 → SKY-11457).
//
// Call order, all of it side-effect-free until the mode says otherwise:
//   detectNewNameCandidates → executeWikiAutonomy → (auto only) write stubs
//
// Kept out of main.ts on purpose: main.ts's IPC table is not unit-testable, and
// the ask/auto/off split is exactly the behaviour that needs test coverage.

import crypto from 'crypto';
import { entityTypeToFactType, type NoteProposal } from './brainstormAgent.js';
import { enqueueQuestion, type EnqueueQuestionInput } from './brainstormQuestionQueue.js';
import type { DbBrainstormQuestion } from './db.js';
import {
  resolveProposalDestination,
  writeNoteProposal,
  type ProposalDestinationResolution,
} from './brainstormNoteWriter.js';
import type { AppSettings } from './ipc.js';
import {
  executeWikiAutonomy,
  resolveWikiAutonomyMode,
  type WikiAutoStubCandidate,
  type WikiAutonomyMode,
} from './wikiAutonomyGate.js';
import { detectNewNameCandidates, type WikiKnownEntity } from './wikiNameCandidates.js';

export interface RunWikiAutonomyArgs {
  sceneText: string;
  scenePath: string;
  /** The vault's current entity index — dedup source for detection and hygiene. */
  entities: WikiKnownEntity[];
  settings: Pick<AppSettings, 'wikiAutonomy'> | null | undefined;
  notesVaultRoot: string;
  storyVaultRoot: string;
  activeUniverse?: string | null;
  activeStory?: string | null;
  now?: string;
  maxCandidates?: number;
}

/** What the scan did, so the renderer (and E2E) can observe the mode taking effect. */
export interface WikiAutonomySummary {
  mode: WikiAutonomyMode;
  /** New names the detector found in this scene. */
  candidates: number;
  /** 'ask': questions newly queued (re-scans of the same scene queue nothing). */
  questionsQueued: number;
  /** 'auto': stub notes written to the Notes Vault. */
  stubsWritten: number;
  /** 'auto': candidates the hygiene contract rejected as dupes / junk. */
  suppressed: number;
  /** 'auto': survivors skipped because a note already exists or the vault is ambiguous. */
  skipped: number;
}

/** Injectable side effects so the ask/auto/off split is testable without a vault. */
export interface WikiAutonomyRunnerDeps {
  enqueue: (input: EnqueueQuestionInput) => DbBrainstormQuestion | null;
  resolveDestination: typeof resolveProposalDestination;
  writeNote: typeof writeNoteProposal;
}

const DEFAULT_DEPS: WikiAutonomyRunnerDeps = {
  enqueue: enqueueQuestion,
  resolveDestination: resolveProposalDestination,
  writeNote: writeNoteProposal,
};

const EMPTY: Omit<WikiAutonomySummary, 'mode'> = {
  candidates: 0,
  questionsQueued: 0,
  stubsWritten: 0,
  suppressed: 0,
  skipped: 0,
};

function stubBody(name: string, scenePath: string): string {
  return [
    `Auto-added by the wiki: **${name}** appeared in \`${scenePath}\` and had no entry yet.`,
    '',
    'Nothing here is confirmed — replace this line with what you actually know.',
  ].join('\n');
}

/**
 * Runs one scene through the wiki-autonomy gate.
 *
 * 'off'  — returns immediately; detection does not even run.
 * 'ask'  — every new name becomes a Brainstorm question. Nothing is written.
 * 'auto' — names that clear the hygiene contract are stubbed into the Notes
 *          Vault. An existing note of the same name is never overwritten.
 */
export function runWikiAutonomyForScene(
  args: RunWikiAutonomyArgs,
  deps: WikiAutonomyRunnerDeps = DEFAULT_DEPS,
): WikiAutonomySummary {
  const mode = resolveWikiAutonomyMode(args.settings);
  if (mode === 'off') return { mode, ...EMPTY };

  const candidates = detectNewNameCandidates(args.sceneText, args.entities, args.scenePath, {
    maxCandidates: args.maxCandidates,
  });
  if (candidates.length === 0) return { mode, ...EMPTY };

  const result = executeWikiAutonomy(
    candidates,
    {
      mode,
      // The hygiene contract wants full EntityEntry rows; the detector only
      // needs name + aliases, so fill the rest with inert values.
      entities: args.entities.map((entity, i) => ({
        id: `known-${i}`,
        name: entity.name,
        type: 'other' as const,
        path: '',
        aliases: entity.aliases ?? [],
        createdAt: '',
        updatedAt: '',
      })),
    },
    { enqueue: deps.enqueue },
  );

  const summary: WikiAutonomySummary = {
    mode,
    candidates: candidates.length,
    questionsQueued: result.enqueued.length,
    stubsWritten: 0,
    suppressed: result.suppressed.length,
    skipped: 0,
  };

  const now = args.now ?? new Date().toISOString();
  for (const stub of result.stubs) {
    if (!writeStub(stub, args, deps, now)) summary.skipped += 1;
    else summary.stubsWritten += 1;
  }

  return summary;
}

function writeStub(
  stub: WikiAutoStubCandidate,
  args: RunWikiAutonomyArgs,
  deps: WikiAutonomyRunnerDeps,
  now: string,
): boolean {
  // No guessed type → 'inbox'. An uncertain auto-stub belongs in the Inbox, not
  // filed as a character the author never confirmed.
  const kind = entityTypeToFactType(stub.entityType ?? 'other');

  let destination: ProposalDestinationResolution;
  try {
    destination = deps.resolveDestination({
      kind,
      title: stub.name,
      notesVaultRoot: args.notesVaultRoot,
      activeUniverse: args.activeUniverse,
      activeStory: args.activeStory,
    });
  } catch {
    return false;
  }

  // An existing note is the author's — auto mode adds, it never overwrites.
  // An ambiguous universe needs a human choice, which auto mode cannot make.
  if (destination.status !== 'resolved') return false;

  const proposal: NoteProposal = {
    id: crypto.randomUUID(),
    kind,
    title: stub.name,
    destinationPath: destination.destinationPath,
    body: stubBody(stub.name, stub.scenePath ?? args.scenePath),
    frontmatter: {
      source: 'wiki_autostub',
      scene_path: stub.scenePath ?? args.scenePath,
    },
    sourceConversationTurnId: `wiki-autostub:${args.scenePath}`,
    extractionConfidence: 0.5,
    status: 'confirmed',
  };

  try {
    deps.writeNote({
      proposal,
      notesVaultRoot: args.notesVaultRoot,
      storyVaultRoot: args.storyVaultRoot,
      now,
      suggestedDestination: destination.suggestedDestination,
    });
    return true;
  } catch {
    // A single unwritable stub must never fail the surrounding scene scan.
    return false;
  }
}
