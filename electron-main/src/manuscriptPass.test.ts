// SKY-10875 (M12.B4a) — Shared manuscript-pass primitive tests.
//
// Covers the ticket's three acceptance criteria:
//  §1 single code path — continuity checks and a timeline-rebuild consumer share
//     one manuscript read (spy reader proves no double-read when both run);
//  §2 read-only — a continuity check driven from the snapshot leaves every file
//     in the vault (timelines.json included) byte-identical;
//  §3 negative control — a naive shared pass that rebuilds the timeline inside
//     the continuity check (the owner's original "do both at once" idea, the
//     exact bug the SKY-10528 ruling exists to prevent) is shown mutating the
//     store, proving the byte-identity harness would catch a bad extraction.
//
// FIXTURE DISCIPLINE (PR #914 review, mirrored from timelines/store.test.ts):
// vault fixtures go through the REAL writer paths — defaultManifest() +
// writeManifest(), writeSceneFile(), writeTimelinesStore() — so tests exercise
// the exact shapes real vaults have on disk.
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChapterEntry, Manifest, PartEntry, SceneEntry, StoryEntry } from './ipc.js';
import type { SceneFileData } from './vault.js';
import { defaultManifest, readSceneFile, writeManifest, writeSceneFile } from './vault.js';
import type { ArchiveIndex } from './archiveAgent.js';
import { createSeedTimelinesStore, readTimelinesStore, writeTimelinesStore } from './timelines/store.js';
import { writeProposalStore } from './timelineProposals.js';
import {
  buildManuscriptSnapshot,
  runContinuityChecksFromSnapshot,
  toManuscriptScenes,
  type ManuscriptSnapshot,
  type SceneFileReader,
} from './manuscriptPass.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const CREATED_AT = '2026-01-01T00:00:00.000Z';

function makeScene(id: string, order: number, overrides: Partial<SceneEntry> = {}): SceneEntry {
  return {
    id,
    title: `Scene ${id}`,
    path: `scenes/${id}.md`,
    order,
    blocks: [],
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

function makeChapter(id: string, order: number, scenes: SceneEntry[]): ChapterEntry {
  return {
    id,
    title: `Chapter ${id}`,
    path: `chapters/${id}`,
    order,
    scenes,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

function makeStory(id: string, chapters: ChapterEntry[]): StoryEntry {
  return {
    id,
    title: `Story ${id}`,
    path: `stories/${id}`,
    chapters,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

function writeSceneFixture(
  vaultRoot: string,
  scene: SceneEntry,
  prose: string,
  extra: Partial<SceneFileData> = {},
): void {
  writeSceneFile(vaultRoot, scene.path, { id: scene.id, title: scene.title, prose, ...extra });
}

/** The Strait entity from the SKY-10736 negative-control fixture — its vault
 *  `tide` property contradicts the "highest at dusk" scene phrase (Check 2). */
function makeIndex(): ArchiveIndex {
  return {
    entities: [
      {
        id: 'e-strait',
        name: 'the Strait',
        type: 'location' as const,
        aliases: ['Strait'],
        path: 'entities/strait.md',
        properties: { tide: 'rises at dawn' },
        prose: '',
      },
      // Propertyless entity — Check 2's vault-gap detector proposes a question
      // for it (M12.B2 artifact), proving questions plumb through the snapshot.
      {
        id: 'e-elara',
        name: 'Elara',
        type: 'character' as const,
        aliases: [],
        path: 'entities/elara.md',
        properties: {},
        prose: '',
      },
    ],
    builtAt: CREATED_AT,
  };
}

// Scene prose reusing the proven SKY-10736 trigger phrasing: the lantern
// oil-lit → crystal-lit drift is Check 1's world-rule error; the tide phrase
// is Check 2's vault contradiction.
const PROSE_CH1 =
  'Elara raised the lantern in her hand; it was oil-lit, its flame dancing gently. Down at the Strait, all was calm.';
const PROSE_CH2 =
  'By now the lantern was crystal-lit, humming faintly. Down at the Strait, the tide is highest at dusk, contradicting everything the elders taught.';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manuscript-pass-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/** Two-chapter, three-scene single-story vault written through real writers.
 *  Chapter/scene `order` fields deliberately disagree with array positions. */
function writeStandardVault(): Manifest {
  const sceneA = makeScene('sc-a', 1);
  const sceneB = makeScene('sc-b', 2);
  const sceneC = makeScene('sc-c', 1);
  // Arrays hold [ch2, ch1] and [sceneB, sceneA] — reading order must come from
  // `.order`, not array position.
  const ch2 = makeChapter('ch-2', 2, [sceneC]);
  const ch1 = makeChapter('ch-1', 1, [sceneB, sceneA]);
  const manifest: Manifest = {
    ...defaultManifest(tmpDir),
    stories: [makeStory('st-1', [ch2, ch1])],
  };
  writeManifest(path.join(tmpDir, 'manifest.json'), manifest);
  writeSceneFixture(tmpDir, sceneA, PROSE_CH1, {
    chronologicalDate: '0002-03-04',
    pov: 'Elara',
    metaMood: 'calm',
    entityCharacterIds: ['e-elara'],
    entityArcs: ['arc-tide'],
    metaWordCount: 21,
  });
  writeSceneFixture(tmpDir, sceneB, 'She walked on.');
  writeSceneFixture(tmpDir, sceneC, PROSE_CH2);
  return manifest;
}

// ─── §0: snapshot construction ───────────────────────────────────────────────

describe('buildManuscriptSnapshot', () => {
  it('reads scenes in manuscript reading order (chapter.order then scene.order) with 1-based chapter numbers', () => {
    const manifest = writeStandardVault();
    const snapshot = buildManuscriptSnapshot(tmpDir, manifest);
    expect(snapshot.scenes.map((s) => s.sceneId)).toEqual(['sc-a', 'sc-b', 'sc-c']);
    expect(snapshot.scenes.map((s) => s.chapterNumber)).toEqual([1, 1, 2]);
    expect(snapshot.scenes.map((s) => s.chapterId)).toEqual(['ch-1', 'ch-1', 'ch-2']);
    expect(snapshot.missingSceneIds).toEqual([]);
  });

  it('records unreadable scene files in missingSceneIds and keeps reading the rest (gh-944: never silently empty)', () => {
    const manifest = writeStandardVault();
    fs.rmSync(path.join(tmpDir, 'scenes', 'sc-b.md'));
    const snapshot = buildManuscriptSnapshot(tmpDir, manifest);
    expect(snapshot.missingSceneIds).toEqual(['sc-b']);
    expect(snapshot.scenes.map((s) => s.sceneId)).toEqual(['sc-a', 'sc-c']);
  });

  it('passes timeline frontmatter through from the same single read', () => {
    const manifest = writeStandardVault();
    const snapshot = buildManuscriptSnapshot(tmpDir, manifest);
    const sceneA = snapshot.scenes[0];
    expect(sceneA.chronologicalDate).toBe('0002-03-04');
    expect(sceneA.pov).toBe('Elara');
    expect(sceneA.metaMood).toBe('calm');
    expect(sceneA.entityCharacterIds).toEqual(['e-elara']);
    // Full entity/meta triples — TIMELINE_GET_SCENES exposes entityArcs and
    // metaWordCount too, so the M12.B4b rebuild must get them from this same
    // read rather than re-opening scene files.
    expect(sceneA.entityArcs).toEqual(['arc-tide']);
    expect(sceneA.metaWordCount).toBe(21);
    expect(sceneA.prose).toBe(PROSE_CH1);
  });

  it('follows parts order when parts exist (parts are the mutation authority, M2/SKY-9017)', () => {
    // The delete-chapter → add-part → add-chapter history leaves per-part
    // chapter orders non-monotonic: Part 1 holds ch-c(order 2), Part 2 holds
    // ch-n(order 1). Every reading surface renders ch-c first; a global
    // chapter.order sort would reverse them.
    const sceneC = makeScene('sc-c', 1, { path: 'scenes/sc-c.md' });
    const sceneN = makeScene('sc-n', 1, { path: 'scenes/sc-n.md' });
    const chC = makeChapter('ch-c', 2, [sceneC]);
    const chN = makeChapter('ch-n', 1, [sceneN]);
    const parts: PartEntry[] = [
      { id: 'p-1', title: 'Part 1', order: 0, note: [], chapters: [chC], createdAt: CREATED_AT, updatedAt: CREATED_AT },
      { id: 'p-2', title: 'Part 2', order: 1, note: [], chapters: [chN], createdAt: CREATED_AT, updatedAt: CREATED_AT },
    ];
    const manifest: Manifest = {
      ...defaultManifest(tmpDir),
      stories: [{ ...makeStory('st-1', [chC, chN]), parts }],
    };
    writeManifest(path.join(tmpDir, 'manifest.json'), manifest);
    writeSceneFixture(tmpDir, sceneC, 'Part one prose.');
    writeSceneFixture(tmpDir, sceneN, 'Part two prose.');

    const snapshot = buildManuscriptSnapshot(tmpDir, manifest);
    expect(snapshot.scenes.map((s) => s.sceneId)).toEqual(['sc-c', 'sc-n']);
    expect(snapshot.scenes.map((s) => s.chapterNumber)).toEqual([1, 2]);
  });

  it('treats a single untitled wrapper part as no Part tier — the flat mirror is authoritative', () => {
    // Part-tier contract (chaptersOf, shared with SKY-10770): the M2
    // migration's single untitled wrapper is not a real Part tier, and its
    // chapters can be a stale migration-time snapshot. The live flat mirror
    // must win — a stale empty wrapper must not silently produce an empty
    // manuscript for the checks to bless.
    const manifest = writeStandardVault();
    manifest.stories[0].parts = [
      { id: 'p-1', title: '', order: 0, note: [], chapters: [], createdAt: CREATED_AT, updatedAt: CREATED_AT },
    ];
    const snapshot = buildManuscriptSnapshot(tmpDir, manifest);
    expect(snapshot.scenes.map((s) => s.sceneId)).toEqual(['sc-a', 'sc-b', 'sc-c']);
  });

  it('toManuscriptScenes adapts to Check 1 input preserving order', () => {
    const manifest = writeStandardVault();
    const snapshot = buildManuscriptSnapshot(tmpDir, manifest);
    const adapted = toManuscriptScenes(snapshot.scenes);
    expect(adapted.map((s) => s.path)).toEqual(['scenes/sc-a.md', 'scenes/sc-b.md', 'scenes/sc-c.md']);
    expect(adapted[0].text).toBe(PROSE_CH1);
  });
});

// ─── §1: single code path — no double-read when both commands run ────────────

describe('single manuscript read shared by both consumers (M12.B4a AC §1)', () => {
  it('reads each scene file exactly once even when continuity checks AND a timeline consumer both run', () => {
    const manifest = writeStandardVault();
    const spyReader = vi.fn<SceneFileReader>((vaultRoot, relativePath) =>
      readSceneFile(vaultRoot, relativePath),
    );

    const snapshot = buildManuscriptSnapshot(tmpDir, manifest, spyReader);
    expect(spyReader).toHaveBeenCalledTimes(3);

    // Consumer 1: both continuity checks.
    const continuity = runContinuityChecksFromSnapshot(snapshot, makeIndex());
    // Consumer 2: a stand-in for M12.B4b's timeline rebuild — derives
    // event-shaped records from the same snapshot.
    const events = snapshot.scenes.map((s) => ({
      sceneId: s.sceneId,
      chapter: s.chapterNumber,
      chronologicalDate: s.chronologicalDate,
    }));

    expect(continuity.internalSuggestions.length + continuity.vaultSuggestions.length).toBeGreaterThan(0);
    expect(events).toHaveLength(3);
    // The proof: no consumer triggered another manuscript read.
    expect(spyReader).toHaveBeenCalledTimes(3);
  });

  it('fs-level proof: the combined run opens each scene file exactly once, even via read paths that bypass the injection seam', () => {
    const manifest = writeStandardVault();
    // Spy at the fs boundary, not the injection seam — a regression that calls
    // readSceneFile (or fs directly) inside the checks or a consumer would be
    // invisible to an injected spy reader but is counted here.
    const readSpy = vi.spyOn(fs, 'readFileSync');

    const snapshot = buildManuscriptSnapshot(tmpDir, manifest);
    const continuity = runContinuityChecksFromSnapshot(snapshot, makeIndex());
    const events = snapshot.scenes.map((s) => ({
      sceneId: s.sceneId,
      chapter: s.chapterNumber,
      chronologicalDate: s.chronologicalDate,
    }));
    expect(continuity.vaultSuggestions.length).toBeGreaterThan(0);
    expect(events).toHaveLength(3);

    const sceneFileReads = readSpy.mock.calls.filter(([p]) => String(p).endsWith('.md'));
    expect(sceneFileReads).toHaveLength(3);
  });
});

// ─── §1b: continuity checks driven from the snapshot ─────────────────────────

describe('runContinuityChecksFromSnapshot', () => {
  it('drives Check 1 (story_internal) and Check 2 (story_vault) from one snapshot', () => {
    const manifest = writeStandardVault();
    const snapshot = buildManuscriptSnapshot(tmpDir, manifest);
    const result = runContinuityChecksFromSnapshot(snapshot, makeIndex());

    // Check 1: the oil-lit → crystal-lit lantern drift, flagged on the later scene.
    expect(result.internalSuggestions).toHaveLength(1);
    const internalPayload = JSON.parse(result.internalSuggestions[0].payload_json!);
    expect(internalPayload.scope).toBe('story_internal');
    expect(internalPayload.earlierPhrase).toBe('oil-lit');
    expect(result.internalSuggestions[0].target_path).toBe('scenes/sc-c.md');

    // Check 2: the tide contradiction against the Strait's vault property.
    expect(result.vaultSuggestions.length).toBeGreaterThan(0);
    for (const s of result.vaultSuggestions) {
      expect(JSON.parse(s.payload_json!).scope).toBe('story_vault');
    }
    expect(result.vaultSuggestions.some((s) => JSON.parse(s.payload_json!).propKey === 'tide')).toBe(true);

    // Check 2's vault-gap question for the propertyless Elara plumbs through.
    expect(result.questions.some((q) => q.entityId === 'e-elara')).toBe(true);
  });

  it('never cross-flags world-rule drift between two different stories in one vault', () => {
    const sceneA = makeScene('sc-a', 1);
    const sceneB = makeScene('sc-b', 1, { path: 'scenes/sc-b.md' });
    const manifest: Manifest = {
      ...defaultManifest(tmpDir),
      stories: [
        makeStory('st-1', [makeChapter('ch-1', 1, [sceneA])]),
        makeStory('st-2', [makeChapter('ch-2', 1, [sceneB])]),
      ],
    };
    writeSceneFixture(tmpDir, sceneA, 'The lantern was oil-lit tonight.');
    writeSceneFixture(tmpDir, sceneB, 'The lantern was crystal-lit tonight.');

    const snapshot = buildManuscriptSnapshot(tmpDir, manifest);
    const result = runContinuityChecksFromSnapshot(snapshot, makeIndex());
    expect(result.internalSuggestions).toHaveLength(0);
  });

  it('performs zero disk reads of its own (all text comes from the snapshot)', () => {
    const manifest = writeStandardVault();
    const spyReader = vi.fn<SceneFileReader>((vaultRoot, relativePath) =>
      readSceneFile(vaultRoot, relativePath),
    );
    const snapshot = buildManuscriptSnapshot(tmpDir, manifest, spyReader);
    spyReader.mockClear();
    runContinuityChecksFromSnapshot(snapshot, makeIndex());
    expect(spyReader).not.toHaveBeenCalled();
  });
});

// ─── §2 + §3: read-only w.r.t. timeline data + negative control ──────────────

function hashVaultFiles(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string): void => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else out[path.relative(dir, p)] = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
    }
  };
  walk(dir);
  return out;
}

/** The NAIVE shared pass the SKY-10528 ruling forbids: the owner's original
 *  "it's already reading the manuscript, so update the timeline at the same
 *  time" folded into the continuity check. Deliberately wrong — exists only to
 *  prove the byte-identity harness detects a mutating extraction (§3). */
function naiveContinuityCheckThatAlsoRebuildsTimeline(
  vaultRoot: string,
  snapshot: ManuscriptSnapshot,
  index: ArchiveIndex,
): void {
  runContinuityChecksFromSnapshot(snapshot, index);
  const store = readTimelinesStore(vaultRoot);
  store.events.push({
    id: `scene:${snapshot.scenes[0].sceneId}`,
    timelineId: store.activeTimelineId,
    name: snapshot.scenes[0].title,
    when: 0,
    sceneId: snapshot.scenes[0].sceneId,
    chapter: snapshot.scenes[0].chapterNumber,
    source: 'agent',
  });
  writeTimelinesStore(vaultRoot, store);
}

describe('read-only w.r.t. timeline data (M12.B4a AC §2 + §3)', () => {
  function writeVaultWithTimeline(): Manifest {
    const manifest = writeStandardVault();
    // Persist a real timelines store TWICE — the second write rotates the
    // first into timelines.json.bak, so the backup genuinely exists and a
    // pass that rewrites-or-rotates-only-when-present is still caught.
    const store = createSeedTimelinesStore(CREATED_AT);
    writeTimelinesStore(tmpDir, store);
    writeTimelinesStore(tmpDir, store);
    // …and a populated proposals store, the third timeline file the ticket
    // names, via its real writer.
    writeProposalStore(tmpDir, {
      proposals: [
        {
          id: 'prop-1',
          sceneId: 'sc-a',
          kind: 'date',
          value: '0002-03-04',
          reason: 'ISO date in prose',
          confidence: 0.85,
          source: 'ai',
          isEstimated: true,
          status: 'pending',
          createdAt: CREATED_AT,
        },
      ],
    });
    return manifest;
  }

  it('a full continuity check leaves every vault file byte-identical (timelines.json included)', () => {
    const manifest = writeVaultWithTimeline();
    const before = hashVaultFiles(tmpDir);
    // Guard against fixture rot: all three protected timeline files must
    // actually exist before the byte-identity claim means anything.
    expect(Object.keys(before)).toEqual(
      expect.arrayContaining(['timelines.json', 'timelines.json.bak', 'timeline-proposals.json']),
    );

    const snapshot = buildManuscriptSnapshot(tmpDir, manifest);
    runContinuityChecksFromSnapshot(snapshot, makeIndex());

    const after = hashVaultFiles(tmpDir);
    expect(after).toEqual(before);
  });

  it('NEGATIVE CONTROL: the naive pass that rebuilds the timeline inside the check IS caught by the same harness', () => {
    const manifest = writeVaultWithTimeline();
    const before = hashVaultFiles(tmpDir);

    const snapshot = buildManuscriptSnapshot(tmpDir, manifest);
    naiveContinuityCheckThatAlsoRebuildsTimeline(tmpDir, snapshot, makeIndex());

    const after = hashVaultFiles(tmpDir);
    // The bug the ruling prevents: timeline data changed during a "read-only" check.
    expect(after['timelines.json']).not.toBe(before['timelines.json']);
    const naiveStore = readTimelinesStore(tmpDir);
    expect(naiveStore.events.some((e) => e.sceneId === 'sc-a')).toBe(true);
  });
});
