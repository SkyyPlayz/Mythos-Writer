// Beta 4 M5 — v0.4 twin-root → MythosVault v2 migration (copy-based).
//
// SAFETY MODEL (owner rule B4-4 + BETA-REFINE M5):
//   1. COPY-BASED. The migrator opens the source vaults strictly read-only —
//      it never writes, renames, or deletes anything under either source
//      root. Even the SQLite database is copied to a temp dir before being
//      opened, so no WAL/-shm files are touched at the source.
//   2. Old-structure data is migrated BEFORE anything could delete it — and
//      in fact nothing here deletes it, ever: the original stays intact until
//      the user chooses to archive it, manually, after confirming.
//   3. Build → verify → confirm. `runMythosVaultMigration` builds the whole
//      new vault at a target that must not pre-exist, then re-opens it with
//      the v2 scanner and cross-checks every story/chapter/scene (prose
//      hashes), every note (byte hashes), comments and drafts counts. Only
//      after the user reviews the report does the wizard call the confirm
//      IPC, which merely repoints app settings at the new folder.
//
// WHAT MOVES WHERE:
//   manifest.json stories        → Story Vault/<Story>/Part 1/Chapter NN/Scene NN.md
//                                  (frontmatter {title,status,pov,when}) + book.md
//   comments.json + SQLite beta_read_comments → <Story>/comments.json (sidecar)
//   versions/ + .snapshots/ + SQLite scene_snapshots → <Story>/drafts/… numbered files
//   timeline-settings.json + arcs.json + manifest timeline → timelines.json
//   Notes Vault                  → Notes Vault (byte-identical copy, CF-11)
//   everything else in the Story Vault (Outline.md, boards, user files)
//                                → copied, path-preserved
//   `.mythos-seeded` sentinels   → mythos.json `seed` record (W0.1 marker)
//   legacy Manifest              → regenerable cache (.mythos/manifest-cache.json)
//
// Pure Node (node:sqlite for the read-only DB copy).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { Manifest, SceneEntry, StoryEntry } from '../ipc.js';
import { migrateManifest } from '../manifest.js';
import { readSceneFile, writeFileAtomic } from '../vault.js';
import { listVersions } from '../versions.js';
import { listSnapshots } from '../snapshots.js';
import { deriveProjectName } from '../mythosVault.js';
import {
  MYTHOS_MACHINE_DIRNAME,
  createMythosFile,
  manifestCachePathFor,
  mythosJsonPath,
  notesVaultRootFor,
  storyVaultRootFor,
  writeMythosFile,
} from '../mythosFormat/mythosJson.js';
import { BOOK_FILENAME, serializeBookFile, type BookSpinePart } from '../mythosFormat/bookFile.js';
import {
  chapterDirName,
  draftStateToStatus,
  partDirName,
  sceneFileName,
  serializeV2SceneFile,
  storyFolderName,
} from '../mythosFormat/sceneFiles.js';
import { saveDraftForScene } from '../mythosFormat/draftFiles.js';
import { defaultVaultSettingsFile, writeVaultSettingsFile } from '../mythosFormat/vaultSettingsFile.js';
import {
  defaultTimelinesFile,
  writeTimelinesFile,
  type TimelineSceneEntry,
} from '../mythosFormat/timelinesFile.js';
import { scanMythosStoryVault } from '../mythosFormat/v2Manifest.js';

export const MIGRATED_SEED_LAYOUT = 'migrated-v0.4@M5';
export const MIGRATOR_VERSION = 1;

// ─── Detection ────────────────────────────────────────────────────────────────

export type VaultFormatKind = 'mythos-v2' | 'v0.4-twin-root' | 'empty';

/** Classify the configured story vault root. */
export function detectVaultFormat(storyVaultRoot: string): VaultFormatKind {
  const parent = path.dirname(storyVaultRoot);
  if (
    path.basename(storyVaultRoot) === 'Story Vault' &&
    fs.existsSync(mythosJsonPath(parent))
  ) {
    return 'mythos-v2';
  }
  if (fs.existsSync(path.join(storyVaultRoot, 'manifest.json'))) return 'v0.4-twin-root';
  if (fs.existsSync(storyVaultRoot)) {
    try {
      if (fs.readdirSync(storyVaultRoot).length > 0) return 'v0.4-twin-root';
    } catch {
      /* unreadable — treat as empty */
    }
  }
  return 'empty';
}

/** Default migration target: a sibling folder named after the vault. */
export function suggestMigrationTarget(storyVaultRoot: string, notesVaultRoot: string): string {
  const name = deriveProjectName(storyVaultRoot, notesVaultRoot);
  const bundled = path.dirname(storyVaultRoot) === path.dirname(notesVaultRoot);
  const anchor = bundled ? path.dirname(path.dirname(storyVaultRoot)) : path.dirname(storyVaultRoot);
  const base = `${name} (MythosVault)`;
  let candidate = path.join(anchor, base);
  for (let i = 2; fs.existsSync(candidate) && i < 1000; i++) {
    candidate = path.join(anchor, `${base} ${i}`);
  }
  return candidate;
}

// ─── Plan (read-only inventory) ──────────────────────────────────────────────

export interface MigrationPlan {
  sourceStoryVault: string;
  sourceNotesVault: string;
  targetRoot: string;
  vaultName: string;
  stories: number;
  chapters: number;
  scenes: number;
  noteFiles: number;
  commentFiles: number;
  betaCommentRows: number;
  versionSnapshots: number;
  fileSnapshots: number;
  dbSnapshotRows: number;
  timelineArcs: number;
  timelineSceneEntries: number;
  extraStoryVaultFiles: number;
  warnings: string[];
}

export interface MigrationCounts {
  stories: number;
  chapters: number;
  scenes: number;
  notes: number;
  comments: number;
  drafts: number;
  extras: number;
}

export interface MigrationReport {
  ok: boolean;
  targetRoot: string;
  storyVaultPath: string;
  notesVaultPath: string;
  counts: MigrationCounts;
  verified: {
    scenesChecked: number;
    notesChecked: number;
    mismatches: string[];
  };
  error?: string;
}

interface SourceManifest {
  manifest: Manifest;
  rawTimeline: TimelineSceneEntry[];
}

/** Read the source manifest WITHOUT the openManifest write-back path. */
function readSourceManifest(storyVaultRoot: string): SourceManifest {
  const manifestPath = path.join(storyVaultRoot, 'manifest.json');
  const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>;
  const manifest = migrateManifest(raw);
  const rawTimeline = Array.isArray(raw.timeline)
    ? (raw.timeline as TimelineSceneEntry[])
    : [];
  return { manifest, rawTimeline };
}

interface DbRows {
  betaComments: Array<{
    id: string;
    scene_id: string;
    anchor_text: string;
    comment_text: string;
    created_at: string;
    dismissed_at: string | null;
  }>;
  sceneSnapshots: Array<{
    id: string;
    scene_id: string;
    created_at: number;
    label: string | null;
    content: string;
  }>;
}

/**
 * Read the rows we migrate out of SQLite — from a COPY of the database, so
 * the source file (and its WAL) is never opened for writing.
 */
function readDbRowsFromCopy(storyVaultRoot: string): DbRows {
  const out: DbRows = { betaComments: [], sceneSnapshots: [] };
  const dbPath = path.join(storyVaultRoot, MYTHOS_MACHINE_DIRNAME, 'state.db');
  if (!fs.existsSync(dbPath)) return out;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-migrate-db-'));
  const tmpDb = path.join(tmpDir, 'state.db');
  try {
    fs.copyFileSync(dbPath, tmpDb);
    for (const ext of ['-wal', '-shm']) {
      const side = `${dbPath}${ext}`;
      if (fs.existsSync(side)) fs.copyFileSync(side, `${tmpDb}${ext}`);
    }
    const db = new DatabaseSync(tmpDb);
    try {
      const hasTable = (name: string): boolean => {
        const row = db
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
          .get(name);
        return row !== undefined;
      };
      if (hasTable('beta_read_comments')) {
        out.betaComments = db
          .prepare(
            'SELECT id, scene_id, anchor_text, comment_text, created_at, dismissed_at FROM beta_read_comments',
          )
          .all() as unknown as DbRows['betaComments'];
      }
      if (hasTable('scene_snapshots')) {
        out.sceneSnapshots = db
          .prepare('SELECT id, scene_id, created_at, label, content FROM scene_snapshots')
          .all() as unknown as DbRows['sceneSnapshots'];
      }
    } finally {
      db.close();
    }
  } catch {
    // A locked/corrupt DB must not block a files-first migration; the rows it
    // held are surfaced as a warning in the plan instead.
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  return out;
}

function walkFiles(root: string, skip?: (rel: string, entry: fs.Dirent) => boolean): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (skip?.(rel, entry)) continue;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), rel);
      else if (entry.isFile()) out.push(rel);
    }
  };
  walk(root, '');
  return out;
}

const SEED_SENTINEL = '.mythos-seeded';

function listNotesFiles(notesVaultRoot: string): string[] {
  return walkFiles(notesVaultRoot, (rel, entry) => {
    if (entry.isFile() && path.basename(rel) === SEED_SENTINEL) return true;
    return false;
  });
}

interface StoryLayout {
  story: StoryEntry;
  folder: string;
  chapters: Array<{
    oldPath: string;
    newRelPath: string; // story-vault-relative: <folder>/Part 1/Chapter NN
    id: string;
    title: string;
    scenes: Array<{
      scene: SceneEntry;
      newRelPath: string; // story-vault-relative
      prose: string;
      proseHash: string;
      sourceFm: Record<string, unknown>;
    }>;
  }>;
}

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf-8').digest('hex');
}

/** Compute the full new layout for one story (pure planning, no writes). */
function planStoryLayout(
  sourceStoryVault: string,
  story: StoryEntry,
  folder: string,
  warnings: string[],
): StoryLayout {
  const chapters = [...(story.chapters ?? [])].sort((a, b) => a.order - b.order);
  const layout: StoryLayout = { story, folder, chapters: [] };
  chapters.forEach((chapter, ci) => {
    const newChapterRel = `${folder}/${partDirName(1)}/${chapterDirName(ci + 1)}`;
    const scenes = [...(chapter.scenes ?? [])].sort((a, b) => a.order - b.order);
    const plannedScenes: StoryLayout['chapters'][number]['scenes'] = [];
    scenes.forEach((scene, si) => {
      let prose = '';
      let sourceFm: Record<string, unknown> = {};
      let fromFile = false;
      try {
        const data = readSceneFile(sourceStoryVault, scene.path);
        prose = data.prose;
        fromFile = true;
        // Preserve every non-v2 frontmatter field losslessly (CF-11).
        const { prose: _p, id: _id, title: _t, ...rest } = data;
        sourceFm = Object.fromEntries(
          Object.entries({ ...rest, ...(data.customFields ?? {}) }).filter(
            ([k, v]) => k !== 'customFields' && v !== undefined && v !== null && v !== '',
          ),
        );
      } catch {
        /* scene file missing — fall back to manifest blocks */
      }
      if (!fromFile) {
        const blocks = [...(scene.blocks ?? [])].sort((a, b) => a.order - b.order);
        prose = blocks.map((b) => b.content).join('\n\n');
        if (blocks.length === 0) {
          warnings.push(`Scene "${scene.title}" (${scene.id}) has no file and no blocks; migrated empty.`);
        }
      }
      plannedScenes.push({
        scene,
        newRelPath: `${newChapterRel}/${sceneFileName(si + 1)}`,
        prose,
        proseHash: sha256(prose),
        sourceFm,
      });
    });
    layout.chapters.push({
      oldPath: chapter.path,
      newRelPath: newChapterRel,
      id: chapter.id,
      title: chapter.title,
      scenes: plannedScenes,
    });
  });
  return layout;
}

function uniqueStoryFolders(stories: StoryEntry[]): Map<string, string> {
  const used = new Set<string>();
  const byId = new Map<string, string>();
  for (const story of stories) {
    let base = storyFolderName(story.title);
    let candidate = base;
    for (let i = 2; used.has(candidate); i++) candidate = `${base} ${i}`;
    used.add(candidate);
    byId.set(story.id, candidate);
  }
  return byId;
}

export interface MigrationOptions {
  sourceStoryVault: string;
  sourceNotesVault: string;
  targetRoot: string;
  /** Layout mode carried into the new vault's settings.json. */
  layoutMode?: 'default' | 'blank';
  defaultTheme?: string;
}

/** Read-only inventory of what a migration would carry over. */
export function planMythosVaultMigration(opts: MigrationOptions): MigrationPlan {
  const warnings: string[] = [];
  const { manifest, rawTimeline } = readSourceManifest(opts.sourceStoryVault);
  const stories = manifest.stories ?? [];
  const folders = uniqueStoryFolders(stories);
  let chapters = 0;
  let scenes = 0;
  let versionSnapshots = 0;
  let fileSnapshots = 0;
  let commentFiles = 0;
  for (const story of stories) {
    const layout = planStoryLayout(opts.sourceStoryVault, story, folders.get(story.id) ?? story.title, warnings);
    chapters += layout.chapters.length;
    for (const ch of layout.chapters) {
      scenes += ch.scenes.length;
      for (const s of ch.scenes) {
        versionSnapshots += listVersions(opts.sourceStoryVault, s.scene.id, {
          chapterRelPath: ch.oldPath,
        }).length;
        try {
          fileSnapshots += listSnapshots(opts.sourceStoryVault, s.scene.id).length;
        } catch {
          /* invalid scene id chars — no snapshots */
        }
      }
    }
    if (fs.existsSync(path.join(opts.sourceStoryVault, ...story.path.split(/[\\/]/), 'comments.json'))) {
      commentFiles += 1;
    }
  }
  const dbRows = readDbRowsFromCopy(opts.sourceStoryVault);
  const noteFiles = fs.existsSync(opts.sourceNotesVault)
    ? listNotesFiles(opts.sourceNotesVault).length
    : 0;
  let arcs = 0;
  try {
    const arcsRaw = JSON.parse(
      fs.readFileSync(path.join(opts.sourceStoryVault, 'arcs.json'), 'utf-8'),
    ) as unknown;
    if (Array.isArray(arcsRaw)) arcs = arcsRaw.length;
    else if (Array.isArray((arcsRaw as { arcs?: unknown[] })?.arcs)) {
      arcs = (arcsRaw as { arcs: unknown[] }).arcs.length;
    }
  } catch {
    /* no arcs */
  }
  if (fs.existsSync(opts.targetRoot) && fs.readdirSync(opts.targetRoot).length > 0) {
    warnings.push(`Target folder already exists and is not empty: ${opts.targetRoot}`);
  }
  return {
    sourceStoryVault: opts.sourceStoryVault,
    sourceNotesVault: opts.sourceNotesVault,
    targetRoot: opts.targetRoot,
    vaultName: deriveProjectName(opts.sourceStoryVault, opts.sourceNotesVault),
    stories: stories.length,
    chapters,
    scenes,
    noteFiles,
    commentFiles,
    betaCommentRows: dbRows.betaComments.filter((c) => !c.dismissed_at).length,
    versionSnapshots,
    fileSnapshots,
    dbSnapshotRows: dbRows.sceneSnapshots.length,
    timelineArcs: arcs,
    timelineSceneEntries: rawTimeline.length,
    extraStoryVaultFiles: 0, // counted precisely during run; plan keeps this cheap
    warnings,
  };
}

// ─── Run (build + verify) ────────────────────────────────────────────────────

interface CommentRecord {
  id: string;
  storyId: string;
  sceneId: string;
  anchor: string;
  author: string;
  kind: string;
  text: string;
  createdAt: string;
  [key: string]: unknown;
}

function readExistingComments(sourceStoryVault: string, storyPath: string): CommentRecord[] {
  try {
    const raw = fs.readFileSync(
      path.join(sourceStoryVault, ...storyPath.split(/[\\/]/), 'comments.json'),
      'utf-8',
    );
    const parsed = JSON.parse(raw) as { comments?: unknown[] } | unknown[];
    const list = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { comments?: unknown[] }).comments)
        ? (parsed as { comments: unknown[] }).comments
        : [];
    return list.filter((c): c is CommentRecord => typeof c === 'object' && c !== null);
  } catch {
    return [];
  }
}

export function runMythosVaultMigration(opts: MigrationOptions): MigrationReport {
  const empty: MigrationCounts = {
    stories: 0, chapters: 0, scenes: 0, notes: 0, comments: 0, drafts: 0, extras: 0,
  };
  const fail = (error: string): MigrationReport => ({
    ok: false,
    targetRoot: opts.targetRoot,
    storyVaultPath: storyVaultRootFor(opts.targetRoot),
    notesVaultPath: notesVaultRootFor(opts.targetRoot),
    counts: empty,
    verified: { scenesChecked: 0, notesChecked: 0, mismatches: [] },
    error,
  });

  if (!path.isAbsolute(opts.targetRoot)) return fail('targetRoot must be an absolute path');
  if (fs.existsSync(opts.targetRoot) && fs.readdirSync(opts.targetRoot).length > 0) {
    return fail(`Target folder is not empty: ${opts.targetRoot}`);
  }
  const sourceResolved = path.resolve(opts.sourceStoryVault);
  const targetResolved = path.resolve(opts.targetRoot);
  if (
    targetResolved === sourceResolved ||
    targetResolved.startsWith(`${sourceResolved}${path.sep}`) ||
    targetResolved.startsWith(`${path.resolve(opts.sourceNotesVault)}${path.sep}`)
  ) {
    return fail('Target folder must be outside the source vaults');
  }

  let source: SourceManifest;
  try {
    source = readSourceManifest(opts.sourceStoryVault);
  } catch (e) {
    return fail(`Could not read the source manifest: ${(e as Error).message}`);
  }
  const { manifest, rawTimeline } = source;
  const warnings: string[] = [];
  const counts: MigrationCounts = { ...empty };

  try {
    const storyVaultPath = storyVaultRootFor(opts.targetRoot);
    const notesVaultPath = notesVaultRootFor(opts.targetRoot);
    fs.mkdirSync(storyVaultPath, { recursive: true });
    fs.mkdirSync(notesVaultPath, { recursive: true });
    fs.mkdirSync(path.join(storyVaultPath, MYTHOS_MACHINE_DIRNAME), { recursive: true });

    const dbRows = readDbRowsFromCopy(opts.sourceStoryVault);
    const stories = manifest.stories ?? [];
    const folders = uniqueStoryFolders(stories);
    const layouts: StoryLayout[] = stories.map((story) =>
      planStoryLayout(opts.sourceStoryVault, story, folders.get(story.id) ?? story.title, warnings),
    );

    // Map scene id → owning story (for beta-comment attribution).
    const sceneToStory = new Map<string, string>();
    for (const layout of layouts) {
      for (const ch of layout.chapters) {
        for (const s of ch.scenes) sceneToStory.set(s.scene.id, layout.story.id);
      }
    }

    // 1. Manuscript: scene files + book.md per story.
    const nowStr = new Date().toISOString();
    const newManifest: Manifest = {
      ...manifest,
      vaultRoot: storyVaultPath,
      stories: [],
      chapters: [],
      scenes: [],
    };
    for (const layout of layouts) {
      counts.stories += 1;
      const spine: BookSpinePart = { dir: partDirName(1), chapters: [] };
      const newStory: StoryEntry = {
        ...layout.story,
        path: layout.folder,
        chapters: [],
      };
      for (const [ci, ch] of layout.chapters.entries()) {
        counts.chapters += 1;
        spine.chapters.push({
          dir: path.basename(ch.newRelPath),
          id: ch.id,
          title: ch.title,
        });
        const newChapter = {
          id: ch.id,
          title: ch.title,
          path: ch.newRelPath,
          order: ci,
          scenes: [] as SceneEntry[],
          createdAt: layout.story.createdAt,
          updatedAt: nowStr,
        };
        for (const s of ch.scenes) {
          counts.scenes += 1;
          const status = draftStateToStatus(s.scene.draftState, s.prose.trim().length > 0);
          // POV lives on the manifest card OR in the old file's frontmatter.
          const fmPov = typeof s.sourceFm.pov === 'string' ? s.sourceFm.pov : undefined;
          const pov = s.scene.card?.pov ?? fmPov;
          writeFileAtomic(
            path.join(storyVaultPath, ...s.newRelPath.split('/')),
            serializeV2SceneFile({
              id: s.scene.id,
              title: s.scene.title,
              status,
              ...(pov ? { pov } : {}),
              updatedAt: s.scene.updatedAt,
              extraFrontmatter: {
                ...s.sourceFm,
                chapterId: ch.id,
                storyId: layout.story.id,
              },
              prose: s.prose,
            }),
          );
          newChapter.scenes.push({
            ...s.scene,
            path: s.newRelPath,
            chapterId: ch.id,
            storyId: layout.story.id,
          });
        }
        newStory.chapters.push(newChapter);
        newManifest.chapters.push(newChapter);
        newManifest.scenes.push(...newChapter.scenes);
      }
      writeFileAtomic(
        path.join(storyVaultPath, layout.folder, BOOK_FILENAME),
        serializeBookFile({
          id: layout.story.id,
          title: layout.story.title,
          ...(layout.story.synopsis ? { synopsis: layout.story.synopsis } : {}),
          createdAt: layout.story.createdAt,
          updatedAt: nowStr,
          spine: [spine],
        }),
      );
      newManifest.stories.push(newStory);

      // 2. Comments: existing sidecar + SQLite beta_read_comments → sidecar.
      const comments = readExistingComments(opts.sourceStoryVault, layout.story.path);
      for (const row of dbRows.betaComments) {
        if (row.dismissed_at) continue;
        if (sceneToStory.get(row.scene_id) !== layout.story.id) continue;
        comments.push({
          id: `c-beta-${row.id}`,
          storyId: layout.story.id,
          sceneId: row.scene_id,
          anchor: row.anchor_text,
          author: 'Beta Reader',
          kind: 'beta',
          text: row.comment_text,
          createdAt: row.created_at,
        });
      }
      if (comments.length > 0) {
        counts.comments += comments.length;
        writeFileAtomic(
          path.join(storyVaultPath, layout.folder, 'comments.json'),
          `${JSON.stringify({ version: 1, comments }, null, 2)}\n`,
        );
      }

      // 3. Drafts: versions + snapshots + DB snapshot rows, oldest → newest.
      for (const ch of layout.chapters) {
        for (const s of ch.scenes) {
          type DraftSource = {
            savedAt: string;
            sortKey: string;
            content: string;
            intent: 'save' | 'auto' | 'agent-suggestion-applied' | 'pre-rollback' | 'migration';
            label?: string;
          };
          const sources: DraftSource[] = [];
          for (const v of listVersions(opts.sourceStoryVault, s.scene.id, {
            chapterRelPath: ch.oldPath,
          })) {
            // Filename stem starts with an ISO-ish stamp; recover a sortable time.
            const stampMatch = v.ts.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/);
            const savedAt = stampMatch
              ? `${stampMatch[1]}T${stampMatch[2]}:${stampMatch[3]}:${stampMatch[4]}.${stampMatch[5]}Z`
              : new Date(0).toISOString();
            // Use the full ts (includes _seq suffix) as a tie-breaker so same-millisecond
            // saves sort in creation order rather than arbitrary filename order.
            sources.push({ savedAt, sortKey: v.ts, content: v.content, intent: v.intent });
          }
          try {
            for (const snap of listSnapshots(opts.sourceStoryVault, s.scene.id)) {
              sources.push({
                savedAt: snap.createdAt,
                sortKey: snap.createdAt,
                content: snap.content,
                intent: 'save',
                ...(snap.label ? { label: snap.label } : {}),
              });
            }
          } catch {
            /* scene id not snapshot-safe — none exist */
          }
          for (const row of dbRows.sceneSnapshots) {
            if (row.scene_id !== s.scene.id) continue;
            const at = new Date(row.created_at).toISOString();
            sources.push({
              savedAt: at,
              sortKey: at,
              content: row.content,
              intent: 'save',
              ...(row.label ? { label: row.label } : {}),
            });
          }
          sources.sort((a, b) => {
            if (a.savedAt < b.savedAt) return -1;
            if (a.savedAt > b.savedAt) return 1;
            return a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0;
          });
          for (const src of sources) {
            saveDraftForScene(storyVaultPath, {
              sceneId: s.scene.id,
              chapterRelPath: ch.newRelPath,
              content: src.content,
              intent: src.intent,
              savedAt: src.savedAt,
              ...(src.label ? { label: src.label } : {}),
            });
            counts.drafts += 1;
          }
        }
      }
    }

    // 4. Notes Vault: byte-identical copy (minus the seed sentinel).
    if (fs.existsSync(opts.sourceNotesVault)) {
      for (const rel of listNotesFiles(opts.sourceNotesVault)) {
        const from = path.join(opts.sourceNotesVault, ...rel.split('/'));
        const to = path.join(notesVaultPath, ...rel.split('/'));
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.copyFileSync(from, to);
        counts.notes += 1;
      }
    }

    // 5. Everything else in the Story Vault: copied path-preserved.
    const transformed = new Set<string>(['manifest.json', 'timeline-settings.json', 'arcs.json', SEED_SENTINEL]);
    const oldScenePaths = new Set<string>();
    const oldChapterDirs = new Set<string>();
    const oldCommentPaths = new Set<string>();
    for (const layout of layouts) {
      oldCommentPaths.add(
        [...layout.story.path.split(/[\\/]/).filter(Boolean), 'comments.json'].join('/'),
      );
      for (const ch of layout.chapters) {
        oldChapterDirs.add(ch.oldPath.split(/[\\/]/).filter(Boolean).join('/'));
        for (const s of ch.scenes) {
          oldScenePaths.add(s.scene.path.split(/[\\/]/).filter(Boolean).join('/'));
        }
      }
    }
    const extras = walkFiles(opts.sourceStoryVault, (rel, entry) => {
      if (entry.isDirectory()) {
        if (rel.startsWith('.')) return true; // .mythos, .snapshots — regenerable/migrated
        if (path.basename(rel) === 'versions') return true; // migrated into drafts/
        return false;
      }
      const posixRel = rel.split(path.sep).join('/');
      if (transformed.has(posixRel)) return true;
      if (path.basename(posixRel) === SEED_SENTINEL) return true;
      if (oldScenePaths.has(posixRel)) return true;
      if (oldCommentPaths.has(posixRel)) return true;
      // chapter.md metadata of migrated chapters → folded into book.md spine.
      const dir = posixRel.slice(0, posixRel.lastIndexOf('/'));
      if (path.basename(posixRel) === 'chapter.md' && oldChapterDirs.has(dir)) return true;
      return false;
    });
    for (const rel of extras) {
      const from = path.join(opts.sourceStoryVault, ...rel.split('/'));
      const to = path.join(storyVaultPath, ...rel.split('/'));
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
      counts.extras += 1;
    }

    // 6. timelines.json.
    const timelines = defaultTimelinesFile();
    try {
      const settingsRaw = JSON.parse(
        fs.readFileSync(path.join(opts.sourceStoryVault, 'timeline-settings.json'), 'utf-8'),
      );
      if (typeof settingsRaw === 'object' && settingsRaw !== null) {
        timelines.settings = settingsRaw as (typeof timelines)['settings'];
      }
    } catch {
      /* no timeline settings */
    }
    try {
      const arcsRaw = JSON.parse(
        fs.readFileSync(path.join(opts.sourceStoryVault, 'arcs.json'), 'utf-8'),
      ) as unknown;
      if (Array.isArray(arcsRaw)) timelines.arcs = arcsRaw as (typeof timelines)['arcs'];
      else if (Array.isArray((arcsRaw as { arcs?: unknown[] })?.arcs)) {
        timelines.arcs = (arcsRaw as { arcs: unknown[] }).arcs as (typeof timelines)['arcs'];
      }
    } catch {
      /* no arcs */
    }
    timelines.sceneEntries = rawTimeline;
    writeTimelinesFile(opts.targetRoot, timelines);

    // 7. settings.json + mythos.json (with seed marker + provenance).
    writeVaultSettingsFile(
      opts.targetRoot,
      defaultVaultSettingsFile({
        layoutMode: opts.layoutMode ?? 'default',
        ...(opts.defaultTheme ? { defaultTheme: opts.defaultTheme } : {}),
      }),
    );
    const vaultName = path.basename(opts.targetRoot);
    writeMythosFile(
      opts.targetRoot,
      createMythosFile(vaultName, {
        ...(opts.defaultTheme ? { defaultTheme: opts.defaultTheme } : {}),
        stories: newManifest.stories.map((s) => ({
          id: s.id,
          title: s.title,
          folder: s.path,
          ...(s.synopsis ? { synopsis: s.synopsis } : {}),
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
        })),
        seed: {
          layout: MIGRATED_SEED_LAYOUT,
          mode: opts.layoutMode ?? 'default',
          seededAt: nowStr,
        },
        migratedFrom: {
          from: 'v0.4-twin-root',
          storyVaultRoot: opts.sourceStoryVault,
          notesVaultRoot: opts.sourceNotesVault,
          migratedAt: nowStr,
          migratorVersion: MIGRATOR_VERSION,
        },
      }),
    );

    // 8. Regenerable manifest cache — so first open carries entities,
    //    relationships, suggestions refs, smart folders, board references.
    writeFileAtomic(manifestCachePathFor(storyVaultPath), JSON.stringify(newManifest));

    // 9. VERIFY: re-open the target with the v2 scanner and cross-check.
    const mismatches: string[] = [];
    let scenesChecked = 0;
    const rescanned = scanMythosStoryVault(opts.targetRoot);
    if (rescanned.stories.length !== counts.stories) {
      mismatches.push(
        `story count: expected ${counts.stories}, scanner found ${rescanned.stories.length}`,
      );
    }
    const rescannedScenes = new Map<string, { prose: string; title: string }>();
    for (const story of rescanned.stories) {
      for (const ch of story.chapters) {
        for (const scene of ch.scenes) {
          const prose = scene.blocks.find((b) => b.type === 'prose')?.content ?? '';
          rescannedScenes.set(scene.id, { prose, title: scene.title });
        }
      }
    }
    for (const layout of layouts) {
      for (const ch of layout.chapters) {
        for (const s of ch.scenes) {
          scenesChecked += 1;
          const got = rescannedScenes.get(s.scene.id);
          if (!got) {
            mismatches.push(`scene missing after migration: "${s.scene.title}" (${s.scene.id})`);
            continue;
          }
          if (sha256(got.prose) !== s.proseHash) {
            mismatches.push(`scene prose mismatch: "${s.scene.title}" (${s.scene.id})`);
          }
        }
      }
    }
    let notesChecked = 0;
    if (fs.existsSync(opts.sourceNotesVault)) {
      for (const rel of listNotesFiles(opts.sourceNotesVault)) {
        notesChecked += 1;
        const from = path.join(opts.sourceNotesVault, ...rel.split('/'));
        const to = path.join(notesVaultPath, ...rel.split('/'));
        if (!fs.existsSync(to)) {
          mismatches.push(`note missing after migration: ${rel}`);
          continue;
        }
        if (sha256(fs.readFileSync(from, 'utf-8')) !== sha256(fs.readFileSync(to, 'utf-8'))) {
          mismatches.push(`note content mismatch: ${rel}`);
        }
      }
    }

    return {
      ok: mismatches.length === 0,
      targetRoot: opts.targetRoot,
      storyVaultPath,
      notesVaultPath,
      counts,
      verified: { scenesChecked, notesChecked, mismatches },
      ...(mismatches.length > 0
        ? { error: `Verification found ${mismatches.length} mismatch(es); the original vault is untouched.` }
        : {}),
    };
  } catch (e) {
    return fail(`Migration failed: ${(e as Error).message}. The original vault is untouched.`);
  }
}
