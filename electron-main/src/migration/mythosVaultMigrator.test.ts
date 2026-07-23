// Beta 4 M5 — v0.4 → MythosVault migration round-trip tests.
//
// A synthetic-but-rich v0.4 twin-root vault (manifest with prose blocks,
// scene .md files with custom frontmatter, comments.json, SKY-10 versions,
// .snapshots, SQLite beta comments + scene snapshots, timeline sidecars,
// notes vault with nested folders) is migrated and every artifact is
// asserted present in the new format — and the ORIGINAL is asserted
// byte-for-byte untouched.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import {
  detectVaultFormat,
  planMythosVaultMigration,
  runMythosVaultMigration,
  suggestMigrationTarget,
} from './mythosVaultMigrator.js';
import { _clearDetectionCache, readMythosFile, resolveManifestPath } from '../mythosFormat/mythosJson.js';
import { scanMythosStoryVault } from '../mythosFormat/v2Manifest.js';
import { parseV2SceneFile } from '../mythosFormat/sceneFiles.js';
import { parseBookFile } from '../mythosFormat/bookFile.js';
import { readTimelinesFile } from '../mythosFormat/timelinesFile.js';
import { listDraftsForScene } from '../mythosFormat/draftFiles.js';
import { listVersions, rollbackVersion, saveVersion } from '../versions.js';
import { saveSnapshot } from '../snapshots.js';
import type { Manifest } from '../ipc.js';

let tmp: string;
let storyVault: string;
let notesVault: string;
let target: string;

const SCENE_A1_PROSE = 'The vault held every secret.\n\nThe first chamber breathed.';
const SCENE_A2_PROSE = 'Second scene prose — with unicode: Veynn drowned twice. 🜁';
const SCENE_B1_PROSE = 'Story two, only scene.';
const ORPHAN_PROSE = 'Manifest-only scene whose file was lost.';

function writeSceneMd(relPath: string, id: string, title: string, prose: string, extra = ''): void {
  const full = path.join(storyVault, ...relPath.split('/'));
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(
    full,
    `---\nid: ${id}\ntitle: ${title}\n${extra}updatedAt: 2026-06-01T00:00:00.000Z\n---\n${prose}`,
  );
}

/** Full recursive content snapshot: relPath → sha256 (dirs excluded). */
function treeHashes(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string, prefix: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), rel);
      else {
        out.set(rel, crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, entry.name))).digest('hex'));
      }
    }
  };
  walk(root, '');
  return out;
}

let sourceHashesBefore: Map<string, string>;
let notesHashesBefore: Map<string, string>;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-migrate-'));
  const bundle = path.join(tmp, 'My Twin Vault');
  storyVault = path.join(bundle, 'Story Vault');
  notesVault = path.join(bundle, 'Notes Vault');
  target = path.join(tmp, 'My Twin Vault (MythosVault)');
  fs.mkdirSync(storyVault, { recursive: true });
  fs.mkdirSync(notesVault, { recursive: true });
  _clearDetectionCache();

  // ── Scene files (v0.4 layout, mixed conventions) ──
  writeSceneMd(
    'Manuscript/story-one/01 - opening/01 - the-first-chamber.md',
    'scene-a1', 'The First Chamber', SCENE_A1_PROSE,
    'pov: Mira\ngoal: enter the vault\nmood: tense\nchronologicalDate: Y871\n',
  );
  writeSceneMd(
    'Manuscript/story-one/01 - opening/02 - the-echo.md',
    'scene-a2', 'The Echo', SCENE_A2_PROSE,
  );
  writeSceneMd(
    'Manuscript/story-two/01 - solo/01 - only.md',
    'scene-b1', 'Only Scene', SCENE_B1_PROSE,
  );

  // ── v0.4 manifest (prose embedded in blocks; scene-a3 has no file) ──
  const nowStr = '2026-06-01T00:00:00.000Z';
  const mkScene = (id: string, title: string, p: string, order: number, chapterId: string, storyId: string, filePath: string, draftState?: 'in-progress' | 'review' | 'final') => ({
    id, title, path: filePath, order, chapterId, storyId,
    blocks: [{ id: `b-${id}`, type: 'prose' as const, order: 0, content: p, updatedAt: nowStr }],
    ...(draftState ? { draftState } : {}),
    createdAt: nowStr, updatedAt: nowStr,
  });
  const manifest = {
    schemaVersion: 1,
    version: '2.0.0',
    vaultRoot: storyVault,
    stories: [
      {
        id: 'story-one', title: 'Story One: The Vault', synopsis: 'Secrets kept.',
        path: 'Manuscript/story-one',
        chapters: [
          {
            id: 'ch-a1', title: 'Opening', path: 'Manuscript/story-one/01 - opening', order: 0,
            scenes: [
              mkScene('scene-a1', 'The First Chamber', SCENE_A1_PROSE, 0, 'ch-a1', 'story-one', 'Manuscript/story-one/01 - opening/01 - the-first-chamber.md', 'final'),
              mkScene('scene-a2', 'The Echo', SCENE_A2_PROSE, 1, 'ch-a1', 'story-one', 'Manuscript/story-one/01 - opening/02 - the-echo.md', 'in-progress'),
            ],
            createdAt: nowStr, updatedAt: nowStr,
          },
          {
            id: 'ch-a2', title: 'The Locked Door', path: 'Manuscript/story-one/02 - locked-door', order: 1,
            scenes: [
              mkScene('scene-a3', 'Lost File', ORPHAN_PROSE, 0, 'ch-a2', 'story-one', 'Manuscript/story-one/02 - locked-door/01 - lost.md'),
            ],
            createdAt: nowStr, updatedAt: nowStr,
          },
        ],
        createdAt: nowStr, updatedAt: nowStr,
      },
      {
        id: 'story-two', title: 'Story Two', path: 'Manuscript/story-two',
        chapters: [
          {
            id: 'ch-b1', title: 'Solo', path: 'Manuscript/story-two/01 - solo', order: 0,
            scenes: [mkScene('scene-b1', 'Only Scene', SCENE_B1_PROSE, 0, 'ch-b1', 'story-two', 'Manuscript/story-two/01 - solo/01 - only.md')],
            createdAt: nowStr, updatedAt: nowStr,
          },
        ],
        createdAt: nowStr, updatedAt: nowStr,
      },
    ],
    entities: [
      { id: 'ent-1', name: 'Mira', type: 'character' as const, path: 'Universes/U/Characters/Mira.md', createdAt: nowStr, updatedAt: nowStr },
    ],
    suggestions: [],
    scenes: [],
    chapters: [],
    provenance: {},
    boardReferences: ['boards/board-1.json'],
    timeline: [
      { sceneId: 'scene-a1', inferredDay: 3, inferredTime: 'dusk', confidence: 0.8, rawCue: 'nine bells' },
    ],
  };
  fs.writeFileSync(path.join(storyVault, 'manifest.json'), JSON.stringify(manifest));

  // ── comments.json (existing sidecar for story-one) ──
  fs.writeFileSync(
    path.join(storyVault, 'Manuscript', 'story-one', 'comments.json'),
    JSON.stringify({
      version: 1,
      comments: [
        {
          id: 'c-1', storyId: 'story-one', sceneId: 'scene-a1', anchor: 'every secret',
          author: 'You', kind: 'user', text: 'Expand this.', createdAt: nowStr,
        },
      ],
    }),
  );

  // ── SKY-10 versions + .snapshots for scene-a1 ──
  saveVersion(storyVault, 'scene-a1', 'draft v1 content', {
    chapterRelPath: 'Manuscript/story-one/01 - opening', intent: 'save',
  });
  saveVersion(storyVault, 'scene-a1', 'draft v2 content', {
    chapterRelPath: 'Manuscript/story-one/01 - opening', intent: 'auto',
  });
  saveSnapshot(storyVault, 'scene-a1', 'snapshot content', undefined, 'Before big edit');

  // SKY-6571 regression: on some CI runners the system clock has stepped
  // backward by a few ms between two saveVersion() calls that ran a moment
  // apart, so the *earlier* save (lower in-memory `_seq`) ends up on disk
  // with a *later*-looking filename stamp than the save right after it.
  // Simulate that here by giving the v1 draft's on-disk file a stamp 1s
  // ahead of v2's — its `_seq` suffix (and therefore creation order) is
  // untouched. If the migrator ever regresses to trusting the wall-clock
  // stamp over `_seq`, draftsA1 below comes back v2-before-v1.
  {
    const versionsDir = path.join(
      storyVault, 'Manuscript', 'story-one', '01 - opening', 'versions', 'scene-a1',
    );
    const files = fs.readdirSync(versionsDir).filter((f) => f.endsWith('.md')).sort();
    const [olderFile, newerFile] = files; // ascending filename sort = creation order here
    const newerStampIso = newerFile
      .match(/^(\d{4}-\d{2}-\d{2}T[\d-]+Z)/)![1]
      .replace(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, '$1T$2:$3:$4.$5Z');
    const laterStamp = new Date(new Date(newerStampIso).getTime() + 1000)
      .toISOString().replace(/[:.]/g, '-');
    const olderSuffix = olderFile.slice(olderFile.indexOf('_'));
    fs.renameSync(
      path.join(versionsDir, olderFile),
      path.join(versionsDir, `${laterStamp}${olderSuffix}`),
    );
  }

  // ── SQLite: beta comments + legacy scene_snapshots rows ──
  const dbDir = path.join(storyVault, '.mythos');
  fs.mkdirSync(dbDir, { recursive: true });
  const db = new DatabaseSync(path.join(dbDir, 'state.db'));
  db.exec(`
    CREATE TABLE beta_read_comments (
      id TEXT PRIMARY KEY, scene_id TEXT NOT NULL, anchor_text TEXT NOT NULL,
      comment_text TEXT NOT NULL, created_at TEXT NOT NULL, dismissed_at TEXT
    );
    CREATE TABLE scene_snapshots (
      id TEXT NOT NULL PRIMARY KEY, scene_id TEXT NOT NULL,
      created_at INTEGER NOT NULL, label TEXT, content TEXT NOT NULL
    );
  `);
  db.prepare('INSERT INTO beta_read_comments VALUES (?, ?, ?, ?, ?, ?)')
    .run('bc-1', 'scene-a2', 'Veynn drowned', 'Lovely rhythm here.', nowStr, null);
  db.prepare('INSERT INTO beta_read_comments VALUES (?, ?, ?, ?, ?, ?)')
    .run('bc-2', 'scene-a2', 'dismissed anchor', 'Should not migrate.', nowStr, nowStr);
  db.prepare('INSERT INTO scene_snapshots VALUES (?, ?, ?, ?, ?)')
    .run('dbsnap-1', 'scene-b1', Date.parse('2026-05-01T00:00:00.000Z'), 'db snapshot', 'db snapshot content');
  db.close();

  // ── timeline sidecars ──
  fs.writeFileSync(
    path.join(storyVault, 'timeline-settings.json'),
    JSON.stringify({ granularity: 'day', zoom: 2 }),
  );
  fs.writeFileSync(
    path.join(storyVault, 'arcs.json'),
    JSON.stringify([{ id: 'arc-1', name: 'Main', color: '#00f0ff' }]),
  );

  // ── extra user files in the story vault ──
  fs.writeFileSync(path.join(storyVault, 'Manuscript', 'story-one', 'Outline.md'), '# Outline\n- beat');
  fs.mkdirSync(path.join(storyVault, 'boards'), { recursive: true });
  fs.writeFileSync(path.join(storyVault, 'boards', 'board-1.json'), '{"cards":[]}');
  fs.writeFileSync(path.join(storyVault, 'notes-to-self.md'), 'remember the tide rule');
  // chapter.md metadata (folded into the spine, not copied).
  fs.writeFileSync(
    path.join(storyVault, 'Manuscript', 'story-one', '01 - opening', 'chapter.md'),
    '---\nid: ch-a1\ntitle: Opening\n---\n',
  );
  // W0.1 sentinels (adopted into mythos.json, not copied).
  fs.writeFileSync(path.join(storyVault, '.mythos-seeded'), '{"markerVersion":1}');
  fs.writeFileSync(path.join(notesVault, '.mythos-seeded'), '{"markerVersion":1}');

  // ── notes vault ──
  for (const dir of ['Universes/U/Characters', 'Stories/Story One', 'Inbox', '.obsidian']) {
    fs.mkdirSync(path.join(notesVault, ...dir.split('/')), { recursive: true });
  }
  fs.writeFileSync(
    path.join(notesVault, 'Universes', 'U', 'Characters', 'Mira.md'),
    '---\ntype: character\naliases: [Mira]\n---\nShe counts bells. Links: [[The Vault]]',
  );
  fs.writeFileSync(path.join(notesVault, 'Stories', 'Story One', 'Beats.md'), '# Beats\n1. bell');
  fs.writeFileSync(path.join(notesVault, 'Inbox', 'loose idea.md'), 'rain that falls upward');
  fs.writeFileSync(path.join(notesVault, '.obsidian', 'app.json'), '{"theme":"obsidian"}');

  sourceHashesBefore = treeHashes(storyVault);
  notesHashesBefore = treeHashes(notesVault);
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('detection + planning', () => {
  it('classifies the fixture as v0.4 and a v2 vault as mythos-v2', () => {
    expect(detectVaultFormat(storyVault)).toBe('v0.4-twin-root');
    expect(detectVaultFormat(path.join(tmp, 'nowhere'))).toBe('empty');
  });

  it('suggests a sibling target for a bundled twin-root vault', () => {
    const suggested = suggestMigrationTarget(storyVault, notesVault);
    expect(path.dirname(suggested)).toBe(tmp);
    expect(path.basename(suggested)).toContain('My Twin Vault (MythosVault)');
  });

  it('plans a read-only inventory', () => {
    const plan = planMythosVaultMigration({
      sourceStoryVault: storyVault, sourceNotesVault: notesVault, targetRoot: target,
    });
    expect(plan.stories).toBe(2);
    expect(plan.chapters).toBe(3);
    expect(plan.scenes).toBe(4);
    expect(plan.commentFiles).toBe(1);
    expect(plan.betaCommentRows).toBe(1); // dismissed row excluded
    expect(plan.versionSnapshots).toBe(2);
    expect(plan.fileSnapshots).toBe(1);
    expect(plan.dbSnapshotRows).toBe(1);
    expect(plan.timelineArcs).toBe(1);
    expect(plan.timelineSceneEntries).toBe(1);
    expect(plan.noteFiles).toBe(4); // sentinel excluded
    expect(plan.warnings.some((w) => w.includes('Lost File'))).toBe(false);
    // Planning wrote NOTHING.
    expect(treeHashes(storyVault)).toEqual(sourceHashesBefore);
  });
});

describe('run: copy-based migration', () => {
  let report: ReturnType<typeof runMythosVaultMigration>;

  it('runs and verifies cleanly', () => {
    report = runMythosVaultMigration({
      sourceStoryVault: storyVault, sourceNotesVault: notesVault, targetRoot: target,
      layoutMode: 'default', defaultTheme: 'classic',
    });
    expect(report.error).toBeUndefined();
    expect(report.ok).toBe(true);
    expect(report.counts).toMatchObject({ stories: 2, chapters: 3, scenes: 4, notes: 4 });
    expect(report.verified.scenesChecked).toBe(4);
    expect(report.verified.notesChecked).toBe(4);
    expect(report.verified.mismatches).toEqual([]);
  });

  it('THE ORIGINAL IS UNTOUCHED — byte-for-byte', () => {
    expect(treeHashes(storyVault)).toEqual(sourceHashesBefore);
    expect(treeHashes(notesVault)).toEqual(notesHashesBefore);
  });

  it('maps the old manifest → mythos.json + frontmatter', () => {
    _clearDetectionCache();
    const mythos = readMythosFile(target);
    expect(mythos.stories.map((s) => s.title)).toEqual(['Story One: The Vault', 'Story Two']);
    expect(mythos.seed?.layout).toBe('migrated-v0.4@M5'); // marker: never demo-seed a migrated vault
    expect(mythos.migratedFrom?.storyVaultRoot).toBe(storyVault);

    // Scene files landed at Part/Chapter/Scene with v2 frontmatter.
    const sceneA1 = parseV2SceneFile(
      fs.readFileSync(
        path.join(target, 'Story Vault', 'Story One The Vault', 'Part 1', 'Chapter 01', 'Scene 01.md'),
        'utf-8',
      ),
    );
    expect(sceneA1.id).toBe('scene-a1');
    expect(sceneA1.title).toBe('The First Chamber');
    expect(sceneA1.status).toBe('done'); // draftState final → done
    expect(sceneA1.pov).toBe('Mira');
    expect(sceneA1.prose).toBe(SCENE_A1_PROSE);
    // Old frontmatter (goal, custom mood, chronological metadata) preserved.
    expect(sceneA1.extraFrontmatter?.goal).toBe('enter the vault');
    expect(sceneA1.extraFrontmatter?.mood).toBe('tense');
    expect(sceneA1.extraFrontmatter?.chronologicalDate).toBe('Y871');

    // Orphan scene (manifest blocks, no file) migrated from blocks.
    const sceneA3 = parseV2SceneFile(
      fs.readFileSync(
        path.join(target, 'Story Vault', 'Story One The Vault', 'Part 1', 'Chapter 02', 'Scene 01.md'),
        'utf-8',
      ),
    );
    expect(sceneA3.prose).toBe(ORPHAN_PROSE);
    expect(sceneA3.status).toBe('draft');

    // book.md spine carries chapter identity.
    const book = parseBookFile(
      fs.readFileSync(path.join(target, 'Story Vault', 'Story One The Vault', 'book.md'), 'utf-8'),
    );
    expect(book.id).toBe('story-one');
    expect(book.spine[0].chapters.map((c) => c.title)).toEqual(['Opening', 'The Locked Door']);
  });

  it('migrates comments (sidecar + SQLite) into the story comments file', () => {
    const raw = JSON.parse(
      fs.readFileSync(
        path.join(target, 'Story Vault', 'Story One The Vault', 'comments.json'), 'utf-8'),
    ) as { comments: Array<Record<string, unknown>> };
    expect(raw.comments).toHaveLength(2);
    const user = raw.comments.find((c) => c.kind === 'user');
    expect(user?.anchor).toBe('every secret');
    const beta = raw.comments.find((c) => c.kind === 'beta');
    expect(beta?.sceneId).toBe('scene-a2');
    expect(beta?.text).toBe('Lovely rhythm here.');
    // The dismissed row stayed behind.
    expect(raw.comments.some((c) => c.text === 'Should not migrate.')).toBe(false);
  });

  it('migrates versions + snapshots + DB snapshots into numbered draft files', () => {
    const storyVaultV2 = path.join(target, 'Story Vault');
    const draftsA1 = listDraftsForScene(
      storyVaultV2, 'Story One The Vault/Part 1/Chapter 01', 'scene-a1');
    expect(draftsA1).toHaveLength(3); // 2 versions + 1 snapshot
    expect(draftsA1.map((d) => d.draft)).toEqual([1, 2, 3]);
    expect(draftsA1.map((d) => d.content)).toEqual([
      'draft v1 content', 'draft v2 content', 'snapshot content',
    ]);
    expect(draftsA1[2].label).toBe('Before big edit');
    expect(path.basename(draftsA1[0].filePath)).toBe('Scene 01.draft-1.md');

    const draftsB1 = listDraftsForScene(
      storyVaultV2, 'Story Two/Part 1/Chapter 01', 'scene-b1');
    expect(draftsB1).toHaveLength(1); // legacy DB scene_snapshots row
    expect(draftsB1[0].content).toBe('db snapshot content');
  });

  it('the SKY-10 version IPC surface serves migrated drafts (v2 gate)', () => {
    _clearDetectionCache();
    const storyVaultV2 = path.join(target, 'Story Vault');
    const chapterRelPath = 'Story One The Vault/Part 1/Chapter 01';
    const versions = listVersions(storyVaultV2, 'scene-a1', { chapterRelPath });
    expect(versions.map((v) => v.ts)).toEqual(['draft-3', 'draft-2', 'draft-1']);
    // One-click restore (CF-4): rollback snapshots current content first.
    const { restoredVersion, preRollbackVersion } = rollbackVersion(
      storyVaultV2, 'scene-a1', 'draft-1', 'current editor content', { chapterRelPath });
    expect(restoredVersion.content).toBe('draft v1 content');
    expect(preRollbackVersion.intent).toBe('pre-rollback');
    expect(listVersions(storyVaultV2, 'scene-a1', { chapterRelPath })[0].ts).toBe('draft-4');
  });

  it('carries the notes vault byte-identically and copies loose story files', () => {
    expect(
      fs.readFileSync(path.join(target, 'Notes Vault', 'Universes', 'U', 'Characters', 'Mira.md'), 'utf-8'),
    ).toBe(fs.readFileSync(path.join(notesVault, 'Universes', 'U', 'Characters', 'Mira.md'), 'utf-8'));
    expect(fs.existsSync(path.join(target, 'Notes Vault', '.obsidian', 'app.json'))).toBe(true);
    expect(fs.existsSync(path.join(target, 'Notes Vault', '.mythos-seeded'))).toBe(false);
    // Extras: Outline.md, boards, loose root files survive path-preserved.
    expect(fs.existsSync(path.join(target, 'Story Vault', 'Manuscript', 'story-one', 'Outline.md'))).toBe(true);
    expect(fs.existsSync(path.join(target, 'Story Vault', 'boards', 'board-1.json'))).toBe(true);
    expect(fs.existsSync(path.join(target, 'Story Vault', 'notes-to-self.md'))).toBe(true);
    // Transformed artifacts did NOT leak into the new vault.
    expect(fs.existsSync(path.join(target, 'Story Vault', 'manifest.json'))).toBe(false);
    expect(fs.existsSync(path.join(target, 'Story Vault', 'timeline-settings.json'))).toBe(false);
    expect(fs.existsSync(path.join(target, 'Story Vault', 'arcs.json'))).toBe(false);
    expect(
      fs.existsSync(path.join(target, 'Story Vault', 'Manuscript', 'story-one', '01 - opening', 'chapter.md')),
    ).toBe(false);
  });

  it('gathers timeline sidecars + manifest entries into timelines.json', () => {
    const timelines = readTimelinesFile(target);
    expect(timelines.settings).toMatchObject({ granularity: 'day', zoom: 2 });
    expect(timelines.arcs).toHaveLength(1);
    expect(timelines.sceneEntries).toHaveLength(1);
    expect(timelines.sceneEntries[0].sceneId).toBe('scene-a1');
  });

  it('the migrated vault opens through the v2 gate with everything intact', () => {
    _clearDetectionCache();
    const storyVaultV2 = path.join(target, 'Story Vault');
    // The gate routes the legacy manifest to the regenerable cache…
    const cachePath = resolveManifestPath(storyVaultV2);
    expect(cachePath).toContain('.mythos');
    const cache = JSON.parse(fs.readFileSync(cachePath, 'utf-8')) as Manifest;
    expect(cache.stories).toHaveLength(2);
    expect(cache.entities).toHaveLength(1); // entities carried into the cache
    expect(cache.boardReferences).toEqual(['boards/board-1.json']);
    // …and the scanner rebuild agrees with the cache even without it.
    const rescanned = scanMythosStoryVault(target);
    expect(rescanned.stories.map((s) => s.id).sort()).toEqual(['story-one', 'story-two']);
    expect(
      rescanned.stories.flatMap((s) => s.chapters.flatMap((c) => c.scenes.map((sc) => sc.id))).sort(),
    ).toEqual(['scene-a1', 'scene-a2', 'scene-a3', 'scene-b1']);
  });
});

describe('run: safety refusals', () => {
  it('refuses a non-empty target', () => {
    const busy = path.join(tmp, 'busy-target');
    fs.mkdirSync(busy, { recursive: true });
    fs.writeFileSync(path.join(busy, 'file.txt'), 'x');
    const report = runMythosVaultMigration({
      sourceStoryVault: storyVault, sourceNotesVault: notesVault, targetRoot: busy,
    });
    expect(report.ok).toBe(false);
    expect(report.error).toContain('not empty');
  });

  it('refuses a target inside the source vaults', () => {
    const report = runMythosVaultMigration({
      sourceStoryVault: storyVault, sourceNotesVault: notesVault,
      targetRoot: path.join(storyVault, 'nested-target'),
    });
    expect(report.ok).toBe(false);
    expect(report.error).toContain('outside the source');
  });

  it('a failed run leaves the original untouched', () => {
    expect(treeHashes(storyVault)).toEqual(sourceHashesBefore);
    expect(treeHashes(notesVault)).toEqual(notesHashesBefore);
  });

  it('re-running to a fresh target is repeatable', () => {
    const target2 = path.join(tmp, 'second-run');
    const report = runMythosVaultMigration({
      sourceStoryVault: storyVault, sourceNotesVault: notesVault, targetRoot: target2,
    });
    expect(report.ok).toBe(true);
    expect(report.counts.scenes).toBe(4);
    expect(treeHashes(storyVault)).toEqual(sourceHashesBefore);
  });
});

// ─── SKY-7937: post-migrate verification hardening ─────────────────────────
//
// Minimal, self-contained v0.4 twin-root fixture builder — deliberately
// separate from the rich fixture above so each hardening scenario can mutate
// its own tiny vault (0-byte placeholder file, unreadable sidecar, stray
// pre-existing target file) without disturbing the shared fixture other
// describe blocks depend on.
function buildMinimalVault(root: string): { storyVault: string; notesVault: string } {
  const bundle = path.join(root, 'Mini Vault');
  const sv = path.join(bundle, 'Story Vault');
  const nv = path.join(bundle, 'Notes Vault');
  fs.mkdirSync(sv, { recursive: true });
  fs.mkdirSync(nv, { recursive: true });
  const nowStr = '2026-06-01T00:00:00.000Z';
  const scenePath = 'Manuscript/story-one/01 - opening/01 - scene.md';
  fs.mkdirSync(path.dirname(path.join(sv, ...scenePath.split('/'))), { recursive: true });
  fs.writeFileSync(
    path.join(sv, ...scenePath.split('/')),
    `---\nid: scene-1\ntitle: Scene\nupdatedAt: ${nowStr}\n---\nSome prose.`,
  );
  const manifest: Manifest = {
    schemaVersion: 1,
    version: '2.0.0',
    vaultRoot: sv,
    stories: [
      {
        id: 'story-one', title: 'Story One', path: 'Manuscript/story-one',
        chapters: [
          {
            id: 'ch-1', title: 'Opening', path: 'Manuscript/story-one/01 - opening', order: 0,
            scenes: [
              {
                id: 'scene-1', title: 'Scene', path: scenePath, order: 0,
                chapterId: 'ch-1', storyId: 'story-one',
                blocks: [{ id: 'b-1', type: 'prose', order: 0, content: 'Some prose.', updatedAt: nowStr }],
                createdAt: nowStr, updatedAt: nowStr,
              },
            ],
            createdAt: nowStr, updatedAt: nowStr,
          },
        ],
        createdAt: nowStr, updatedAt: nowStr,
      },
    ],
    entities: [], suggestions: [], scenes: [], chapters: [], provenance: {},
  } as unknown as Manifest;
  fs.writeFileSync(path.join(sv, 'manifest.json'), JSON.stringify(manifest));
  fs.mkdirSync(path.join(nv, 'Inbox'), { recursive: true });
  fs.writeFileSync(path.join(nv, 'Inbox', 'idea.md'), 'a real idea');
  return { storyVault: sv, notesVault: nv };
}

describe('run: cloud-sync placeholder hardening (SKY-7937)', () => {
  let miniTmp: string;

  beforeAll(() => {
    miniTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-migrate-placeholder-'));
  });
  afterAll(() => {
    fs.rmSync(miniTmp, { recursive: true, force: true });
  });

  it('hard-fails when a notes-vault file is a 0-byte cloud-sync placeholder', () => {
    const dir = path.join(miniTmp, 'case-1');
    const { storyVault: sv, notesVault: nv } = buildMinimalVault(dir);
    // Simulate an un-hydrated OneDrive/Dropbox "online-only" stub: the file
    // exists on disk but has zero bytes even though it's a .md note.
    fs.writeFileSync(path.join(nv, 'Inbox', 'placeholder.md'), '');
    const before = treeHashes(sv);

    const report = runMythosVaultMigration({
      sourceStoryVault: sv, sourceNotesVault: nv, targetRoot: path.join(dir, 'target'),
    });

    expect(report.ok).toBe(false);
    expect(
      report.verified.mismatches.some(
        (m) => m.includes('placeholder.md') && m.includes('cloud-sync placeholder') && m.includes('re-run'),
      ),
    ).toBe(true);
    expect(treeHashes(sv)).toEqual(before);
  });

  it('does not flag a genuinely non-empty note as a placeholder', () => {
    const dir = path.join(miniTmp, 'case-2');
    const { storyVault: sv, notesVault: nv } = buildMinimalVault(dir);
    const report = runMythosVaultMigration({
      sourceStoryVault: sv, sourceNotesVault: nv, targetRoot: path.join(dir, 'target'),
    });
    expect(report.ok).toBe(true);
    expect(report.verified.mismatches).toEqual([]);
  });
});

describe('run: locked/unreadable sidecar hardening (SKY-7937)', () => {
  let miniTmp: string;

  beforeAll(() => {
    miniTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-migrate-sidecar-'));
  });
  afterAll(() => {
    fs.rmSync(miniTmp, { recursive: true, force: true });
  });

  it('fails gracefully and leaves the source untouched when comments.json cannot be read', () => {
    const dir = path.join(miniTmp, 'case-1');
    const { storyVault: sv, notesVault: nv } = buildMinimalVault(dir);
    const commentsPath = path.join(sv, 'Manuscript', 'story-one', 'comments.json');
    // A directory sitting where a file is expected reproduces the same
    // "exists but unreadable as a file" failure mode as a locked/permission-
    // denied sidecar, and — unlike fs.chmodSync(path, 0) — is reliable
    // across CI runners that run as root (root ignores POSIX file-mode
    // read protection, but EISDIR always fails regardless of user).
    fs.mkdirSync(commentsPath, { recursive: true });
    const before = treeHashes(sv);

    const report = runMythosVaultMigration({
      sourceStoryVault: sv, sourceNotesVault: nv, targetRoot: path.join(dir, 'target'),
    });

    expect(report.ok).toBe(false);
    expect(report.error).toBeTruthy();
    expect(report.error).toContain('comments.json');
    expect(treeHashes(sv)).toEqual(before);
  });
});

describe('run: aborted-then-re-run migration (SKY-7937)', () => {
  let miniTmp: string;

  beforeAll(() => {
    miniTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-migrate-abort-'));
  });
  afterAll(() => {
    fs.rmSync(miniTmp, { recursive: true, force: true });
  });

  it('refuses a partially-populated target, then succeeds after cleanup and retry', () => {
    const dir = path.join(miniTmp, 'case-1');
    const { storyVault: sv, notesVault: nv } = buildMinimalVault(dir);
    const target2 = path.join(dir, 'target');

    // Fabricate an aborted prior run: the target dir exists with one stray
    // file left over (as a real aborted build would leave behind).
    fs.mkdirSync(target2, { recursive: true });
    fs.writeFileSync(path.join(target2, 'stray-partial-file.txt'), 'leftover from an aborted build');

    const first = runMythosVaultMigration({
      sourceStoryVault: sv, sourceNotesVault: nv, targetRoot: target2,
    });
    expect(first.ok).toBe(false);
    expect(first.error).toContain('Target folder is not empty');

    // Clean up the aborted target and retry — the second run is a real
    // successful migration.
    fs.rmSync(target2, { recursive: true, force: true });
    const second = runMythosVaultMigration({
      sourceStoryVault: sv, sourceNotesVault: nv, targetRoot: target2,
    });
    expect(second.ok).toBe(true);
    expect(second.error).toBeUndefined();
    expect(second.verified.mismatches).toEqual([]);
    expect(second.counts).toMatchObject({ stories: 1, chapters: 1, scenes: 1, notes: 1 });
  });
});
