// SKY-10: Legacy single-file-per-chapter → per-scene migration.
//
// Detects projects that pre-date the SKY-9/SKY-15 layout (where each scene is
// its own .md file inside a chapter folder) and offers an idempotent, reversible
// migration via a dry-run plan.
//
// Reversibility: the original chapter file is snapshotted as a `migration`-
// intent version BEFORE it is unlinked, so rollback restores the legacy file.
//
// Idempotency: re-running the detector finds no work once every legacy file has
// been split. The applier itself short-circuits on plans whose changes were
// already applied (folder + chapter.md already exist).
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { writeVaultFileAtomic, writeChapterMetaFile, serializeFrontmatter, parseFrontmatter, realSafePath } from './vault.js';
import { saveVersion } from './versions.js';
import type {
  MigrationPlan,
  MigrationPlanChange,
  MigrationApplyResult,
} from './ipc.js';

const MANUSCRIPT_DIR = 'Manuscript';
const RESERVED_TOP_LEVEL_FILES = new Set(['Outline.md', 'Synopsis.md']);

// In-process plan registry: planId → { storyPath, fileSet }.
// buildMigrationPlans writes an entry; applyMigrationPlan reads it to reject
// unknown planIds and to block apply when NEW files appear that weren't in the
// original dry-run (stale-plan protection for GH#636).
// Files that have already been migrated (no longer detected) are fine —
// that is the idempotent case.
const _planRegistry = new Map<string, { storyPath: string; fileSet: ReadonlySet<string> }>();

interface DetectedLegacyChapter {
  storyDir: string; // vault-relative, posix
  storyName: string;
  legacyFile: string; // vault-relative, posix
  baseTitle: string;
  proposedFolder: string;
}

function listDirEntries(absDir: string): string[] {
  if (!fs.existsSync(absDir)) return [];
  return fs.readdirSync(absDir);
}

function joinRel(...parts: string[]): string {
  return parts.filter(Boolean).join('/');
}

function chapterFolderSlug(baseTitle: string, takenFolders: Set<string>): string {
  let candidate = baseTitle;
  let i = 2;
  while (takenFolders.has(candidate)) {
    candidate = `${baseTitle} (${i})`;
    i += 1;
  }
  return candidate;
}

/**
 * Walk a story folder and return every legacy chapter file (top-level .md not
 * named Outline/Synopsis/chapter, and no matching folder already exists).
 */
function detectLegacyChaptersForStory(
  vaultRoot: string,
  storyDir: string,
): DetectedLegacyChapter[] {
  const absStoryDir = path.join(vaultRoot, storyDir);
  if (!fs.existsSync(absStoryDir)) return [];
  const entries = listDirEntries(absStoryDir);
  const existingFolders = new Set(
    entries.filter((e) => {
      const abs = path.join(absStoryDir, e);
      try {
        return fs.statSync(abs).isDirectory();
      } catch {
        return false;
      }
    }),
  );

  const out: DetectedLegacyChapter[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue;
    if (RESERVED_TOP_LEVEL_FILES.has(entry)) continue;
    const baseTitle = entry.replace(/\.md$/, '');
    if (existingFolders.has(baseTitle)) continue; // already migrated for this chapter
    out.push({
      storyDir,
      storyName: path.basename(storyDir),
      legacyFile: joinRel(storyDir, entry),
      baseTitle,
      proposedFolder: chapterFolderSlug(baseTitle, existingFolders),
    });
    existingFolders.add(baseTitle);
  }
  return out;
}

interface ParsedLegacyChapter {
  chapterId: string;
  chapterTitle: string;
  chapterPreface: string;
  scenes: Array<{ id: string; title: string; order: number; prose: string }>;
}

/**
 * Parse a single legacy chapter file into chapter metadata + 1..N scenes.
 *
 * Heuristic: scene breaks are H1/H2 headings (`# ` or `## `). Prose before the
 * first heading is treated as a chapter preface and stored on chapter.md.
 * If no headings are present, the entire file becomes a single "Scene One".
 */
export function parseLegacyChapterFile(
  vaultRoot: string,
  relativePath: string,
  baseTitle: string,
): ParsedLegacyChapter {
  const abs = realSafePath(vaultRoot, relativePath, false);
  const raw = fs.readFileSync(abs, 'utf-8');
  const { frontmatter, prose } = parseFrontmatter(raw);

  const chapterId =
    typeof frontmatter.id === 'string' && frontmatter.id ? frontmatter.id : crypto.randomUUID();
  const chapterTitle =
    typeof frontmatter.title === 'string' && frontmatter.title ? frontmatter.title : baseTitle;

  // Split on H1/H2 headings (line-start `#` or `##` followed by space).
  const lines = prose.split(/\r?\n/);
  type Block = { heading: string | null; body: string[] };
  const blocks: Block[] = [{ heading: null, body: [] }];
  for (const line of lines) {
    const m = line.match(/^(#{1,2})\s+(.+)$/);
    if (m) {
      blocks.push({ heading: m[2].trim(), body: [] });
    } else {
      blocks[blocks.length - 1].body.push(line);
    }
  }
  const preface = blocks[0].body.join('\n').trim();
  const sceneBlocks = blocks.slice(1);

  const scenes: ParsedLegacyChapter['scenes'] =
    sceneBlocks.length > 0
      ? sceneBlocks.map((b, i) => ({
          id: crypto.randomUUID(),
          title: b.heading ?? `Scene ${i + 1}`,
          order: i + 1,
          prose: b.body.join('\n').trim() + '\n',
        }))
      : [
          {
            id: crypto.randomUUID(),
            title: 'Scene One',
            order: 1,
            prose: prose.trim() + '\n',
          },
        ];

  return { chapterId, chapterTitle, chapterPreface: preface, scenes };
}

function safeSlug(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 64) || 'scene'
  );
}

function describeStoryRoots(vaultRoot: string, storyPathHint?: string): string[] {
  if (storyPathHint) {
    // Reject ../.. escapes, absolute paths, and symlink escapes before any fs access (GH#634).
    realSafePath(vaultRoot, storyPathHint, false);
    return [storyPathHint];
  }
  const manuscriptAbs = path.join(vaultRoot, MANUSCRIPT_DIR);
  if (!fs.existsSync(manuscriptAbs)) return [];
  return fs
    .readdirSync(manuscriptAbs)
    .filter((name) => {
      try {
        return fs.statSync(path.join(manuscriptAbs, name)).isDirectory();
      } catch {
        return false;
      }
    })
    .map((name) => joinRel(MANUSCRIPT_DIR, name));
}

/**
 * Build a dry-run migration plan for one or more story folders. Pure reader —
 * touches no files. Returns one plan per story that has legacy work.
 */
export function buildMigrationPlans(vaultRoot: string, storyPathHint?: string): MigrationPlan[] {
  const stories = describeStoryRoots(vaultRoot, storyPathHint);
  const plans: MigrationPlan[] = [];
  for (const storyDir of stories) {
    const legacy = detectLegacyChaptersForStory(vaultRoot, storyDir);
    if (legacy.length === 0) continue;

    const changes: MigrationPlanChange[] = [];
    const detected: string[] = [];

    for (const item of legacy) {
      const chapterRel = joinRel(item.storyDir, item.proposedFolder);
      detected.push(item.legacyFile);
      changes.push({
        kind: 'create-dir',
        path: chapterRel,
        description: `Create chapter folder ${item.proposedFolder}/`,
      });
      changes.push({
        kind: 'write-file',
        path: joinRel(chapterRel, 'chapter.md'),
        description: `Write chapter.md (metadata + preface)`,
      });
      // Note: actual scene count is computed at apply time. The dry-run lists
      // the intent at the chapter level — the modal can elaborate further
      // when the user expands a row.
      changes.push({
        kind: 'write-file',
        path: joinRel(chapterRel, '<scenes>.md'),
        description: `Split chapter prose into per-scene .md files`,
      });
      changes.push({
        kind: 'snapshot-legacy',
        path: item.legacyFile,
        description: `Archive original as a migration-intent snapshot (rollback handle)`,
      });
      changes.push({
        kind: 'unlink-file',
        path: item.legacyFile,
        description: `Remove the original chapter file (after snapshot)`,
      });
    }

    const planId = crypto.randomUUID();
    _planRegistry.set(planId, { storyPath: storyDir, fileSet: new Set(detected) });
    plans.push({
      planId,
      storyPath: storyDir,
      detectedLegacyFiles: detected,
      changes,
      createdAt: new Date().toISOString(),
    });
  }
  return plans;
}

function writeNewSceneFile(
  vaultRoot: string,
  chapterRel: string,
  storyId: string | undefined,
  chapterId: string,
  scene: { id: string; title: string; order: number; prose: string },
): string {
  const filename = `${String(scene.order).padStart(2, '0')} - ${safeSlug(scene.title)}.md`;
  const relPath = joinRel(chapterRel, filename);
  const content = serializeFrontmatter(
    {
      id: scene.id,
      title: scene.title,
      ...(storyId ? { storyId } : {}),
      chapterId,
      order: scene.order,
      updatedAt: new Date().toISOString(),
    },
    scene.prose,
  );
  writeVaultFileAtomic(vaultRoot, relPath, content);
  return relPath;
}

/**
 * Apply a previously-built plan. Idempotent — if the per-chapter folder already
 * exists with chapter.md and the legacy file is gone, the chapter is skipped.
 *
 * Snapshots the original chapter file as a `migration`-intent version before
 * unlinking so the migration is reversible from the SceneHistoryPane.
 */
export function applyMigrationPlan(
  vaultRoot: string,
  storyPath: string,
  planId: string,
): MigrationApplyResult {
  // Reject unknown or mismatched planIds (GH#636).
  const registered = _planRegistry.get(planId);
  if (!registered || registered.storyPath !== storyPath) {
    throw new Error(`Unknown or stale migration planId: ${planId}`);
  }

  const legacy = detectLegacyChaptersForStory(vaultRoot, storyPath);

  // Reject apply if new legacy files appeared since the dry-run (GH#636).
  // Already-migrated files (no longer detected) are fine — that is the
  // idempotent case; only UNEXPECTED additions invalidate the plan.
  const unexpected = legacy.filter((i) => !registered.fileSet.has(i.legacyFile));
  if (unexpected.length > 0) {
    throw new Error(
      'Migration plan is stale: new legacy files detected since the dry-run was built.',
    );
  }

  let appliedChanges = 0;
  const snapshotsWritten: string[] = [];

  for (const item of legacy) {
    const chapterRel = joinRel(item.storyDir, item.proposedFolder);
    const chapterAbs = path.join(vaultRoot, chapterRel);
    const chapterMetaAbs = path.join(chapterAbs, 'chapter.md');
    const legacyAbs = path.join(vaultRoot, item.legacyFile);

    if (fs.existsSync(chapterMetaAbs) && !fs.existsSync(legacyAbs)) {
      continue; // already migrated
    }

    const parsed = parseLegacyChapterFile(vaultRoot, item.legacyFile, item.baseTitle);

    fs.mkdirSync(chapterAbs, { recursive: true });
    appliedChanges += 1;

    writeChapterMetaFile(vaultRoot, chapterRel, {
      id: parsed.chapterId,
      title: parsed.chapterTitle,
      order: 1,
      prose: parsed.chapterPreface,
    });
    appliedChanges += 1;

    for (const scene of parsed.scenes) {
      writeNewSceneFile(vaultRoot, chapterRel, undefined, parsed.chapterId, scene);
      appliedChanges += 1;
    }

    // Snapshot the legacy file content under the chapter's versions/ folder
    // BEFORE unlinking, so rollback restores the original chapter file.
    if (fs.existsSync(legacyAbs)) {
      const legacyRaw = fs.readFileSync(legacyAbs, 'utf-8');
      const snap = saveVersion(vaultRoot, parsed.chapterId, legacyRaw, {
        chapterRelPath: chapterRel,
        intent: 'migration',
      });
      snapshotsWritten.push(snap.ts);
      fs.unlinkSync(legacyAbs);
      appliedChanges += 1;
    }
  }

  return {
    planId,
    storyPath,
    appliedChanges,
    snapshotsWritten,
  };
}
