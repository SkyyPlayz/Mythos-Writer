// Beta 4 M5 — the v2 ⇄ legacy-Manifest adapter (the heart of the version gate).
//
// For MythosVault v2 vaults the legacy `Manifest` object the whole app speaks
// becomes a REGENERABLE CACHE (`.mythos/manifest-cache.json` under the Story
// Vault). Canonical truth lives in files:
//
//   read  — scanMythosStoryVault() rebuilds the Manifest from mythos.json +
//           book.md spines + numbered scene files (used when the cache is
//           missing, e.g. the vault folder was copied to a second machine
//           without `.mythos/`).
//   write — syncCanonicalFromManifest() decomposes every manifest write back
//           into mythos.json (story list) + book.md (spines). Scene prose is
//           already file-first (writeSceneFile), so no prose is written here.
//
// Pure Node.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type {
  Manifest,
  StoryEntry,
  ChapterEntry,
  SceneEntry,
} from '../ipc.js';
import { SCHEMA_VERSION } from '../manifest.js';
import {
  readMythosFile,
  storyVaultRootFor,
  tryReadMythosFile,
  writeMythosFile,
  type MythosStoryRef,
} from './mythosJson.js';
import {
  BOOK_FILENAME,
  parseBookFile,
  serializeBookFile,
  type BookFile,
  type BookSpineChapter,
  type BookSpinePart,
} from './bookFile.js';
import {
  chapterDirName,
  isChapterDirName,
  isPartDirName,
  isSceneFileName,
  parseOrdinal,
  parseV2SceneFile,
  partDirName,
  serializeV2SceneFile,
  statusToDraftState,
  storyFolderName,
} from './sceneFiles.js';
import { writeFileAtomic } from '../vault.js';

const RESERVED_STORY_FILES = new Set([BOOK_FILENAME, 'chapter.md']);

// ─── Scan: files → legacy Manifest ───────────────────────────────────────────

interface ScannedScene {
  fileName: string;
  ordinal: number | null;
  entry: SceneEntry;
}

function scanChapterScenes(
  storyVaultRoot: string,
  chapterRel: string,
  chapterId: string,
  storyId: string,
): SceneEntry[] {
  const chapterAbs = path.join(storyVaultRoot, chapterRel);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(chapterAbs, { withFileTypes: true });
  } catch {
    return [];
  }
  const scanned: ScannedScene[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    if (RESERVED_STORY_FILES.has(entry.name)) continue;
    const fileAbs = path.join(chapterAbs, entry.name);
    let raw: string;
    try {
      raw = fs.readFileSync(fileAbs, 'utf-8');
    } catch {
      continue;
    }
    const scene = parseV2SceneFile(raw, entry.name);
    let id = scene.id;
    if (!id) {
      // A scene file without an id (hand-created in Obsidian): assign one and
      // write it back so drafts/comments keep a stable anchor across rescans.
      id = crypto.randomUUID();
      try {
        writeFileAtomic(fileAbs, serializeV2SceneFile({ ...scene, id }));
      } catch {
        /* read-only vault — keep the in-memory id for this session */
      }
    }
    const stat = (() => {
      try {
        return fs.statSync(fileAbs);
      } catch {
        return null;
      }
    })();
    const updatedAt = scene.updatedAt ?? stat?.mtime.toISOString() ?? new Date(0).toISOString();
    scanned.push({
      fileName: entry.name,
      ordinal: isSceneFileName(entry.name) ? parseOrdinal(entry.name) : null,
      entry: {
        id,
        title: scene.title,
        path: `${chapterRel}/${entry.name}`,
        order: 0, // assigned after sort
        chapterId,
        storyId,
        blocks: [
          {
            id: `block-${id}`,
            type: 'prose',
            order: 0,
            content: scene.prose,
            updatedAt,
          },
        ],
        ...(statusToDraftState(scene.status)
          ? { draftState: statusToDraftState(scene.status) }
          : {}),
        ...(scene.pov ? { card: { pov: scene.pov } } : {}),
        createdAt: updatedAt,
        updatedAt,
      },
    });
  }
  scanned.sort((a, b) => {
    const ao = a.ordinal;
    const bo = b.ordinal;
    if (ao !== null && bo !== null && ao !== bo) return ao - bo;
    if (ao !== null && bo === null) return -1;
    if (ao === null && bo !== null) return 1;
    return a.fileName.localeCompare(b.fileName);
  });
  return scanned.map((s, i) => ({ ...s.entry, order: i }));
}

interface ScannedChapterDir {
  partDir: string;
  chapterDir: string;
  partOrdinal: number;
  chapterOrdinal: number;
}

function scanChapterDirs(storyAbs: string): ScannedChapterDir[] {
  const out: ScannedChapterDir[] = [];
  let partEntries: fs.Dirent[];
  try {
    partEntries = fs.readdirSync(storyAbs, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const part of partEntries) {
    if (!part.isDirectory() || !isPartDirName(part.name)) continue;
    const partAbs = path.join(storyAbs, part.name);
    let chapterEntries: fs.Dirent[];
    try {
      chapterEntries = fs.readdirSync(partAbs, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ch of chapterEntries) {
      if (!ch.isDirectory() || !isChapterDirName(ch.name)) continue;
      out.push({
        partDir: part.name,
        chapterDir: ch.name,
        partOrdinal: parseOrdinal(part.name) ?? 0,
        chapterOrdinal: parseOrdinal(ch.name) ?? 0,
      });
    }
  }
  out.sort((a, b) => a.partOrdinal - b.partOrdinal || a.chapterOrdinal - b.chapterOrdinal);
  return out;
}

function scanStory(storyVaultRoot: string, ref: MythosStoryRef): StoryEntry | null {
  const storyAbs = path.join(storyVaultRoot, ref.folder);
  if (!fs.existsSync(storyAbs)) return null;
  let book: BookFile | null = null;
  try {
    book = parseBookFile(fs.readFileSync(path.join(storyAbs, BOOK_FILENAME), 'utf-8'), ref.title);
  } catch {
    book = null;
  }
  const spineByDir = new Map<string, BookSpineChapter & { partDir: string }>();
  if (book) {
    for (const part of book.spine) {
      for (const ch of part.chapters) {
        spineByDir.set(`${part.dir}/${ch.dir}`, { ...ch, partDir: part.dir });
      }
    }
  }
  const storyId = book?.id || ref.id;
  const chapters: ChapterEntry[] = [];
  let order = 0;
  for (const dir of scanChapterDirs(storyAbs)) {
    const key = `${dir.partDir}/${dir.chapterDir}`;
    const spine = spineByDir.get(key);
    const chapterRel = `${ref.folder}/${key}`;
    const chapterId = spine?.id || `${storyId}-${key.replace(/[^A-Za-z0-9]+/g, '-')}`;
    const scenes = scanChapterScenes(storyVaultRoot, chapterRel, chapterId, storyId);
    chapters.push({
      id: chapterId,
      title: spine?.title || dir.chapterDir,
      path: chapterRel,
      order: order++,
      scenes,
      createdAt: book?.createdAt ?? ref.createdAt,
      updatedAt: book?.updatedAt ?? ref.updatedAt,
    });
  }
  return {
    id: storyId,
    title: book?.title || ref.title,
    ...(book?.synopsis ? { synopsis: book.synopsis } : {}),
    path: ref.folder,
    chapters,
    createdAt: book?.createdAt ?? ref.createdAt,
    updatedAt: book?.updatedAt ?? ref.updatedAt,
  };
}

/** Story folders on disk that mythos.json doesn't list yet (user copied one in). */
function untrackedStoryFolders(storyVaultRoot: string, tracked: Set<string>): MythosStoryRef[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(storyVaultRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: MythosStoryRef[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || tracked.has(entry.name)) continue;
    // Only adopt folders that look like v2 stories (they carry a book.md).
    if (!fs.existsSync(path.join(storyVaultRoot, entry.name, BOOK_FILENAME))) continue;
    const now = new Date().toISOString();
    out.push({
      id: crypto.randomUUID(),
      title: entry.name,
      folder: entry.name,
      createdAt: now,
      updatedAt: now,
    });
  }
  return out;
}

/**
 * Rebuild a legacy Manifest for a v2 vault from its canonical files.
 * `carry` preserves the non-manuscript sections (entities, suggestions, …)
 * from a previous cache when one is available.
 */
export function scanMythosStoryVault(
  mythosRoot: string,
  opts: { carry?: Partial<Manifest> } = {},
): Manifest {
  const storyVaultRoot = storyVaultRootFor(mythosRoot);
  const mythos = readMythosFile(mythosRoot);
  const tracked = new Set(mythos.stories.map((s) => s.folder));
  const refs = [...mythos.stories, ...untrackedStoryFolders(storyVaultRoot, tracked)];
  const stories: StoryEntry[] = [];
  for (const ref of refs) {
    const story = scanStory(storyVaultRoot, ref);
    if (story) stories.push(story);
  }
  const flatChapters: ChapterEntry[] = [];
  const flatScenes: SceneEntry[] = [];
  for (const story of stories) {
    for (const chapter of story.chapters) {
      flatChapters.push(chapter);
      flatScenes.push(...chapter.scenes);
    }
  }
  const carry = opts.carry ?? {};
  return {
    schemaVersion: SCHEMA_VERSION,
    version: '2.0.0',
    vaultRoot: storyVaultRoot,
    stories,
    entities: carry.entities ?? [],
    suggestions: carry.suggestions ?? [],
    scenes: flatScenes,
    chapters: flatChapters,
    provenance: carry.provenance ?? {},
    boardReferences: carry.boardReferences ?? [],
    ...(carry.smartFolders ? { smartFolders: carry.smartFolders } : {}),
    ...(carry.relationships ? { relationships: carry.relationships } : {}),
  };
}

// ─── Sync: legacy Manifest → canonical files ─────────────────────────────────

function storyFolderFromEntry(storyVaultRoot: string, story: StoryEntry): string {
  const firstSegment = story.path.split(/[\\/]/).filter(Boolean)[0];
  if (
    firstSegment &&
    firstSegment !== '.' &&
    firstSegment !== '..' &&
    fs.existsSync(path.join(storyVaultRoot, firstSegment))
  ) {
    return firstSegment;
  }
  return storyFolderName(story.title);
}

/** Rebuild a story's spine from its manifest chapters (canonical paths only). */
function spineFromManifest(story: StoryEntry, folder: string, previous: BookFile | null): BookSpinePart[] {
  const prevParts = new Map<string, BookSpinePart>();
  for (const p of previous?.spine ?? []) prevParts.set(p.dir, p);
  const prevChapters = new Map<string, BookSpineChapter>();
  for (const p of previous?.spine ?? []) {
    for (const c of p.chapters) prevChapters.set(`${p.dir}/${c.dir}`, c);
  }
  const parts = new Map<string, BookSpinePart>();
  const sorted = [...story.chapters].sort((a, b) => a.order - b.order);
  for (const chapter of sorted) {
    const segments = chapter.path.split(/[\\/]/).filter(Boolean);
    // Canonical: <folder>/Part N/Chapter NN
    if (segments.length !== 3 || segments[0] !== folder) continue;
    const [, partDir, chapterDir] = segments;
    if (!isPartDirName(partDir) || !isChapterDirName(chapterDir)) continue;
    let part = parts.get(partDir);
    if (!part) {
      const prev = prevParts.get(partDir);
      part = {
        dir: partDir,
        ...(prev?.label ? { label: prev.label } : {}),
        ...(prev?.intro ? { intro: prev.intro } : {}),
        chapters: [],
      };
      parts.set(partDir, part);
    }
    const prevCh = prevChapters.get(`${partDir}/${chapterDir}`);
    part.chapters.push({
      dir: chapterDir,
      id: chapter.id,
      title: chapter.title,
      ...(prevCh?.intro ? { intro: prevCh.intro } : {}),
    });
  }
  return [...parts.values()].sort(
    (a, b) => (parseOrdinal(a.dir) ?? 0) - (parseOrdinal(b.dir) ?? 0),
  );
}

/**
 * Decompose a manifest write into the canonical v2 files. Cheap by design:
 * mythos.json and each book.md are only rewritten when their serialized
 * content actually changed. Never throws — canonical sync must not break the
 * save path (the cache write already succeeded; the next sync self-heals).
 */
export function syncCanonicalFromManifest(mythosRoot: string, manifest: Manifest): void {
  try {
    const mythos = tryReadMythosFile(mythosRoot);
    if (!mythos) return;
    const storyVaultRoot = storyVaultRootFor(mythosRoot);
    const prevRefs = new Map(mythos.stories.map((s) => [s.id, s]));
    const nextRefs: MythosStoryRef[] = [];

    for (const story of manifest.stories ?? []) {
      const folder = storyFolderFromEntry(storyVaultRoot, story);
      const prev = prevRefs.get(story.id);
      nextRefs.push({
        id: story.id,
        title: story.title,
        folder,
        ...(story.synopsis ? { synopsis: story.synopsis } : {}),
        createdAt: prev?.createdAt ?? story.createdAt,
        updatedAt: story.updatedAt,
      });

      // book.md — only for stories whose folder exists on disk.
      const storyAbs = path.join(storyVaultRoot, folder);
      if (!fs.existsSync(storyAbs)) continue;
      const bookPath = path.join(storyAbs, BOOK_FILENAME);
      let previous: BookFile | null = null;
      let previousRaw: string | null = null;
      try {
        previousRaw = fs.readFileSync(bookPath, 'utf-8');
        previous = parseBookFile(previousRaw, story.title);
      } catch {
        previous = null;
      }
      const book: BookFile = {
        id: story.id,
        title: story.title,
        ...(story.synopsis ? { synopsis: story.synopsis } : {}),
        createdAt: previous?.createdAt ?? story.createdAt,
        updatedAt: story.updatedAt,
        spine: spineFromManifest(story, folder, previous),
      };
      // Skip the write when nothing but updatedAt would change.
      const next = serializeBookFile(book);
      if (previousRaw !== null && previous) {
        const prevStable = serializeBookFile({ ...previous, updatedAt: book.updatedAt });
        if (prevStable === next) continue;
      }
      writeFileAtomic(bookPath, next);
    }

    const storiesChanged =
      JSON.stringify(mythos.stories) !== JSON.stringify(nextRefs);
    if (storiesChanged) {
      writeMythosFile(mythosRoot, { ...mythos, stories: nextRefs });
    }
  } catch {
    /* canonical sync is best-effort per contract above */
  }
}

// ─── Creation-path helpers (chapter:create / scene:create version gate) ─────

/**
 * Next canonical chapter directory for a v2 story: chapters append to the
 * LAST part (Part 1 when the story has none yet), numbered max+1.
 */
export function nextV2ChapterRelPath(storyVaultRoot: string, storyFolder: string): string {
  const storyAbs = path.join(storyVaultRoot, storyFolder);
  const dirs = scanChapterDirs(storyAbs);
  let partDir = partDirName(1);
  if (dirs.length > 0) {
    const maxPart = Math.max(...dirs.map((d) => d.partOrdinal));
    partDir = partDirName(maxPart);
  } else {
    // A story may have empty part folders (no chapters yet) — reuse the last.
    try {
      const parts = fs
        .readdirSync(storyAbs, { withFileTypes: true })
        .filter((e) => e.isDirectory() && isPartDirName(e.name))
        .map((e) => parseOrdinal(e.name) ?? 0);
      if (parts.length > 0) partDir = partDirName(Math.max(...parts));
    } catch {
      /* fresh story */
    }
  }
  const inPart = dirs.filter((d) => d.partDir === partDir);
  let n = inPart.length > 0 ? Math.max(...inPart.map((d) => d.chapterOrdinal)) + 1 : 1;
  let rel = `${storyFolder}/${partDir}/${chapterDirName(n)}`;
  while (fs.existsSync(path.join(storyVaultRoot, rel))) {
    n += 1;
    rel = `${storyFolder}/${partDir}/${chapterDirName(n)}`;
  }
  return rel;
}

/** Next canonical scene file inside a v2 chapter: `Scene NN.md`, numbered max+1. */
export function nextV2SceneRelPath(storyVaultRoot: string, chapterRelPath: string): string {
  const chapterAbs = path.join(storyVaultRoot, chapterRelPath);
  let maxN = 0;
  try {
    for (const name of fs.readdirSync(chapterAbs)) {
      if (!isSceneFileName(name)) continue;
      maxN = Math.max(maxN, parseOrdinal(name) ?? 0);
    }
  } catch {
    /* chapter dir not created yet */
  }
  let n = maxN + 1;
  let rel = `${chapterRelPath}/Scene ${String(n).padStart(2, '0')}.md`;
  while (fs.existsSync(path.join(storyVaultRoot, rel))) {
    n += 1;
    rel = `${chapterRelPath}/Scene ${String(n).padStart(2, '0')}.md`;
  }
  return rel;
}

/** True when a manifest chapter path is in the canonical v2 shape. */
export function isCanonicalV2ChapterPath(chapterRelPath: string): boolean {
  const segments = chapterRelPath.split(/[\\/]/).filter(Boolean);
  return (
    segments.length === 3 && isPartDirName(segments[1]) && isChapterDirName(segments[2])
  );
}
