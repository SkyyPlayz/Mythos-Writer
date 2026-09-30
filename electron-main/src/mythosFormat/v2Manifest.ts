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
  tryReadMythosFile,
  writeMythosFile,
  type MythosStoryRef,
} from './mythosJson.js';
import { ensureActiveStoryVaultPath } from './storyVaultRegistry.js';
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
import { writeFileAtomic, writeManifest as writeManifestRaw } from '../vault.js';
import {
  codePointCompare,
  loadPriorCacheRaw,
  mintId,
  priorPathMaps,
  rederiveFallbackChapterId,
  surgicalReplaceBookIds,
  surgicalReplaceSceneFrontmatterId,
  winnerByPriorCachePath,
  writeReIdFile,
  manifestHasDuplicateIds,
  rebuildCacheIfDuplicated as rebuildCacheIfDuplicatedCore,
  _clearDupBootMemoForTests,
} from './v2IdDedupe.js';

export {
  manifestHasDuplicateIds,
  _clearDupBootMemoForTests,
};

const RESERVED_STORY_FILES = new Set([BOOK_FILENAME, 'chapter.md']);

// ─── Scan: files → legacy Manifest ───────────────────────────────────────────

interface ProvisionalScene {
  fileName: string;
  fileAbs: string;
  raw: string;
  storyRelPath: string;
  vaultRelPath: string;
  claimedId: string;
  title: string;
  prose: string;
  status: ReturnType<typeof parseV2SceneFile>['status'];
  pov?: string;
  updatedAt: string;
  hadNoId: boolean;
}

interface ProvisionalChapter {
  partDir: string;
  chapterDir: string;
  chapterRel: string;
  claimedId: string;
  fromSpine: boolean;
  inOwnSpine: boolean;
  title: string;
  scenes: ProvisionalScene[];
}

interface ProvisionalStory {
  ref: MythosStoryRef;
  tracked: boolean;
  mythosOrder: number;
  folder: string;
  bookPath: string;
  bookRaw: string | null;
  book: BookFile | null;
  claimedId: string;
  /** Fresh ref.id for untracked folders — reused when the copy loses. */
  freshRefId: string;
  chapters: ProvisionalChapter[];
  createdAt: string;
  updatedAt: string;
  title: string;
  synopsis?: string;
}

interface ScannedScene {
  fileName: string;
  ordinal: number | null;
  entry: SceneEntry;
}

function collectChapterScenes(
  storyVaultRoot: string,
  chapterRel: string,
): ProvisionalScene[] {
  const chapterAbs = path.join(storyVaultRoot, chapterRel);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(chapterAbs, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: ProvisionalScene[] = [];
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
    let hadNoId = false;
    if (!id) {
      // Hand-created in Obsidian: mint now; write-back happens with dedupe batch.
      id = mintId();
      hadNoId = true;
    }
    const stat = (() => {
      try {
        return fs.statSync(fileAbs);
      } catch {
        return null;
      }
    })();
    const updatedAt = scene.updatedAt ?? stat?.mtime.toISOString() ?? new Date(0).toISOString();
    const vaultRelPath = `${chapterRel}/${entry.name}`;
    const storyRelPath = vaultRelPath.split('/').slice(1).join('/');
    out.push({
      fileName: entry.name,
      fileAbs,
      raw,
      storyRelPath,
      vaultRelPath,
      claimedId: id,
      title: scene.title,
      prose: scene.prose,
      status: scene.status,
      ...(scene.pov ? { pov: scene.pov } : {}),
      updatedAt,
      hadNoId,
    });
  }
  out.sort((a, b) => {
    const ao = isSceneFileName(a.fileName) ? parseOrdinal(a.fileName) : null;
    const bo = isSceneFileName(b.fileName) ? parseOrdinal(b.fileName) : null;
    if (ao !== null && bo !== null && ao !== bo) return ao - bo;
    if (ao !== null && bo === null) return -1;
    if (ao === null && bo !== null) return 1;
    return a.fileName.localeCompare(b.fileName);
  });
  return out;
}

/** Legacy single-chapter scan used by callers that still expect SceneEntry[]. */
function scanChapterScenes(
  storyVaultRoot: string,
  chapterRel: string,
  chapterId: string,
  storyId: string,
): SceneEntry[] {
  const scanned: ScannedScene[] = collectChapterScenes(storyVaultRoot, chapterRel).map((p) => {
    let id = p.claimedId;
    if (p.hadNoId) {
      try {
        const scene = parseV2SceneFile(p.raw, p.fileName);
        writeFileAtomic(p.fileAbs, serializeV2SceneFile({ ...scene, id }));
      } catch {
        /* read-only */
      }
    }
    return {
      fileName: p.fileName,
      ordinal: isSceneFileName(p.fileName) ? parseOrdinal(p.fileName) : null,
      entry: {
        id,
        title: p.title,
        path: p.vaultRelPath,
        order: 0,
        chapterId,
        storyId,
        blocks: [
          {
            id: `block-${id}`,
            type: 'prose',
            order: 0,
            content: p.prose,
            updatedAt: p.updatedAt,
          },
        ],
        ...(statusToDraftState(p.status) ? { draftState: statusToDraftState(p.status) } : {}),
        ...(p.pov ? { card: { pov: p.pov } } : {}),
        createdAt: p.updatedAt,
        updatedAt: p.updatedAt,
      },
    };
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

function collectStory(storyVaultRoot: string, ref: MythosStoryRef, tracked: boolean, mythosOrder: number): ProvisionalStory | null {
  const storyAbs = path.join(storyVaultRoot, ref.folder);
  if (!fs.existsSync(storyAbs)) return null;
  const bookPath = path.join(storyAbs, BOOK_FILENAME);
  let book: BookFile | null = null;
  let bookRaw: string | null = null;
  try {
    bookRaw = fs.readFileSync(bookPath, 'utf-8');
    book = parseBookFile(bookRaw, ref.title);
  } catch {
    book = null;
    bookRaw = null;
  }
  const spineByDir = new Map<string, BookSpineChapter & { partDir: string }>();
  if (book) {
    for (const part of book.spine) {
      for (const ch of part.chapters) {
        spineByDir.set(`${part.dir}/${ch.dir}`, { ...ch, partDir: part.dir });
      }
    }
  }
  const claimedId = book?.id || ref.id;
  const chapters: ProvisionalChapter[] = [];
  for (const dir of scanChapterDirs(storyAbs)) {
    const key = `${dir.partDir}/${dir.chapterDir}`;
    const spine = spineByDir.get(key);
    const chapterRel = `${ref.folder}/${key}`;
    const fromSpine = Boolean(spine?.id);
    const claimedChapterId = spine?.id || `${claimedId}-${key.replace(/[^A-Za-z0-9]+/g, '-')}`;
    chapters.push({
      partDir: dir.partDir,
      chapterDir: dir.chapterDir,
      chapterRel,
      claimedId: claimedChapterId,
      fromSpine,
      inOwnSpine: fromSpine,
      title: spine?.title || dir.chapterDir,
      scenes: collectChapterScenes(storyVaultRoot, chapterRel),
    });
  }
  return {
    ref,
    tracked,
    mythosOrder,
    folder: ref.folder,
    bookPath,
    bookRaw,
    book,
    claimedId,
    freshRefId: ref.id,
    chapters,
    createdAt: book?.createdAt ?? ref.createdAt,
    updatedAt: book?.updatedAt ?? ref.updatedAt,
    title: book?.title || ref.title,
    ...(book?.synopsis ? { synopsis: book.synopsis } : {}),
  };
}

function scanStory(storyVaultRoot: string, ref: MythosStoryRef): StoryEntry | null {
  // Thin wrapper kept for any direct callers — full vault scans go through
  // scanMythosStoryVault which runs vault-wide dedupe before write-back.
  const prov = collectStory(storyVaultRoot, ref, true, 0);
  if (!prov) return null;
  const storyId = prov.claimedId;
  const chapters: ChapterEntry[] = [];
  let order = 0;
  for (const ch of prov.chapters) {
    const scenes = scanChapterScenes(storyVaultRoot, ch.chapterRel, ch.claimedId, storyId);
    chapters.push({
      id: ch.claimedId,
      title: ch.title,
      path: ch.chapterRel,
      order: order++,
      scenes,
      createdAt: prov.createdAt,
      updatedAt: prov.updatedAt,
    });
  }
  return {
    id: storyId,
    title: prov.title,
    ...(prov.synopsis ? { synopsis: prov.synopsis } : {}),
    path: prov.folder,
    chapters,
    createdAt: prov.createdAt,
    updatedAt: prov.updatedAt,
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
  // Brief rule 2: untracked folders sort by code point (not localeCompare).
  out.sort((a, b) => codePointCompare(a.folder, b.folder));
  return out;
}

interface StoryDecision {
  finalId: string;
  lost: boolean;
  /** oldId → newId for chapters that must change in this story's book.md */
  chapterIdMap: Map<string, string>;
}

/**
 * Rebuild a legacy Manifest for a v2 vault from its canonical files.
 * `carry` preserves the non-manuscript sections (entities, suggestions, …)
 * from a previous cache when one is available.
 *
 * F6: vault-wide story/chapter/scene ID dedupe runs BEFORE any sync write-back
 * so a Finder-copied story folder cannot share ids with the original.
 */
export function scanMythosStoryVault(
  mythosRoot: string,
  opts: { carry?: Partial<Manifest> } = {},
): Manifest {
  const storyVaultRoot = ensureActiveStoryVaultPath(mythosRoot);
  const mythos = readMythosFile(mythosRoot);
  const tracked = new Set(mythos.stories.map((s) => s.folder));
  // Rule 0: load prior cache inside the scan (no new caller argument).
  const prior = loadPriorCacheRaw(storyVaultRoot);
  const priorMaps = priorPathMaps(prior);

  const trackedRefs = mythos.stories.map((ref, i) => ({ ref, tracked: true, mythosOrder: i }));
  const untrackedRefs = untrackedStoryFolders(storyVaultRoot, tracked).map((ref) => ({
    ref,
    tracked: false,
    mythosOrder: Number.MAX_SAFE_INTEGER,
  }));
  const refs = [...trackedRefs, ...untrackedRefs];

  const provisional: ProvisionalStory[] = [];
  for (const { ref, tracked: isTracked, mythosOrder } of refs) {
    const story = collectStory(storyVaultRoot, ref, isTracked, mythosOrder);
    if (story) provisional.push(story);
  }

  // ── Story winners ──────────────────────────────────────────────────────────
  const storyFinal = new Map<number, StoryDecision>();
  const storiesById = new Map<string, number[]>();
  provisional.forEach((s, i) => {
    const list = storiesById.get(s.claimedId) ?? [];
    list.push(i);
    storiesById.set(s.claimedId, list);
  });

  for (const [id, idxs] of storiesById) {
    if (idxs.length === 1) {
      storyFinal.set(idxs[0], { finalId: id, lost: false, chapterIdMap: new Map() });
      continue;
    }
    const members = idxs.map((index) => ({ path: provisional[index].folder, index }));
    let winner = winnerByPriorCachePath(id, members, priorMaps.stories);
    if (winner === null) {
      // Rule 2: tracked beats untracked; among tracked, first in mythos.json order;
      // untracked sort by code point (already ordered in provisional via refs).
      const trackedIdxs = idxs.filter((i) => provisional[i].tracked);
      if (trackedIdxs.length === 1) {
        winner = trackedIdxs[0];
      } else if (trackedIdxs.length > 1) {
        winner = trackedIdxs.reduce((a, b) =>
          provisional[a].mythosOrder <= provisional[b].mythosOrder ? a : b,
        );
      } else {
        winner = idxs.slice().sort((a, b) =>
          codePointCompare(provisional[a].folder, provisional[b].folder),
        )[0];
      }
    }
    for (const i of idxs) {
      if (i === winner) {
        storyFinal.set(i, { finalId: id, lost: false, chapterIdMap: new Map() });
      } else {
        const loser = provisional[i];
        // Losing untracked story reuses fresh ref.id; otherwise mint.
        const newId = !loser.tracked ? loser.freshRefId : mintId();
        storyFinal.set(i, { finalId: newId, lost: true, chapterIdMap: new Map() });
      }
    }
  }

  // ── Chapter winners (after story decisions) ────────────────────────────────
  type ChRef = { si: number; ci: number; claimedId: string; path: string };
  const allChapters: ChRef[] = [];
  provisional.forEach((s, si) => {
    s.chapters.forEach((c, ci) => {
      allChapters.push({ si, ci, claimedId: c.claimedId, path: c.chapterRel });
    });
  });
  const chaptersById = new Map<string, ChRef[]>();
  for (const ch of allChapters) {
    const list = chaptersById.get(ch.claimedId) ?? [];
    list.push(ch);
    chaptersById.set(ch.claimedId, list);
  }
  const chapterFinalId = new Map<string, string>(); // key `${si}:${ci}` → final id

  function chKey(si: number, ci: number): string {
    return `${si}:${ci}`;
  }

  for (const [id, group] of chaptersById) {
    // Chapters in a story that lost its story id always lose.
    const eligible = group.filter((g) => !storyFinal.get(g.si)!.lost);
    const forcedLosers = group.filter((g) => storyFinal.get(g.si)!.lost);

    let winner: ChRef | null = null;
    if (eligible.length === 1) {
      winner = eligible[0];
    } else if (eligible.length > 1) {
      const members = eligible.map((g, index) => ({
        path: g.path,
        index,
      }));
      const winIdx = winnerByPriorCachePath(
        id,
        members,
        priorMaps.chapters,
      );
      if (winIdx !== null) {
        winner = eligible[winIdx];
      } else {
        // Rule 3: spine signal, then story order.
        const inSpine = eligible.filter((g) => provisional[g.si].chapters[g.ci].inOwnSpine);
        const pool = inSpine.length >= 1 ? inSpine : eligible;
        winner = pool.slice().sort((a, b) => {
          const ao = provisional[a.si].mythosOrder;
          const bo = provisional[b.si].mythosOrder;
          if (ao !== bo) return ao - bo;
          return codePointCompare(provisional[a.si].folder, provisional[b.si].folder);
        })[0];
      }
    }

    for (const g of group) {
      const storyDec = storyFinal.get(g.si)!;
      const oldStoryId = provisional[g.si].claimedId;
      const newStoryId = storyDec.finalId;
      if (winner && g.si === winner.si && g.ci === winner.ci) {
        chapterFinalId.set(chKey(g.si, g.ci), id);
      } else {
        // Forced loser or duplicate loser.
        const rederived = storyDec.lost
          ? rederiveFallbackChapterId(id, oldStoryId, newStoryId)
          : null;
        const newId = rederived ?? mintId();
        chapterFinalId.set(chKey(g.si, g.ci), newId);
        if (newId !== id) storyDec.chapterIdMap.set(id, newId);
      }
    }
    // Also map forced losers that were unique ids (no group conflict) — handled below.
    void forcedLosers;
  }

  // Chapters with unique ids that still must change because the story lost:
  provisional.forEach((s, si) => {
    const storyDec = storyFinal.get(si)!;
    if (!storyDec.lost) return;
    s.chapters.forEach((c, ci) => {
      const key = chKey(si, ci);
      const cur = chapterFinalId.get(key) ?? c.claimedId;
      if (cur !== c.claimedId) return; // already remapped by duplicate-group logic
      // Explicit spine chapter ids re-IDed explicitly; fallback ids re-derive.
      const finalNew = c.fromSpine
        ? mintId()
        : (rederiveFallbackChapterId(c.claimedId, s.claimedId, storyDec.finalId) ?? mintId());
      chapterFinalId.set(key, finalNew);
      storyDec.chapterIdMap.set(c.claimedId, finalNew);
    });
  });

  // ── Scene winners ──────────────────────────────────────────────────────────
  type ScRef = { si: number; ci: number; sci: number; claimedId: string; path: string };
  const allScenes: ScRef[] = [];
  provisional.forEach((s, si) => {
    s.chapters.forEach((c, ci) => {
      c.scenes.forEach((sc, sci) => {
        allScenes.push({ si, ci, sci, claimedId: sc.claimedId, path: sc.vaultRelPath });
      });
    });
  });
  const scenesById = new Map<string, ScRef[]>();
  for (const sc of allScenes) {
    const list = scenesById.get(sc.claimedId) ?? [];
    list.push(sc);
    scenesById.set(sc.claimedId, list);
  }
  const sceneFinalId = new Map<string, string>(); // `${si}:${ci}:${sci}`

  function scKey(si: number, ci: number, sci: number): string {
    return `${si}:${ci}:${sci}`;
  }

  for (const [id, group] of scenesById) {
    const eligible = group.filter((g) => !storyFinal.get(g.si)!.lost);
    let winner: ScRef | null = null;
    if (eligible.length === 1) {
      winner = eligible[0];
    } else if (eligible.length > 1) {
      const members = eligible.map((g, index) => ({ path: g.path, index }));
      const winIdx = winnerByPriorCachePath(id, members, priorMaps.scenes);
      if (winIdx !== null) {
        winner = eligible[winIdx];
      } else {
        // Cross-story: chapter spine-signal, then story order.
        // Within one story: canonical name beats non-canonical, then code-point story-rel path.
        const byStory = new Map<number, ScRef[]>();
        for (const g of eligible) {
          const list = byStory.get(g.si) ?? [];
          list.push(g);
          byStory.set(g.si, list);
        }
        if (byStory.size === 1) {
          // Within-story conflict
          const list = eligible.slice().sort((a, b) => {
            const aCanon = isSceneFileName(provisional[a.si].chapters[a.ci].scenes[a.sci].fileName);
            const bCanon = isSceneFileName(provisional[b.si].chapters[b.ci].scenes[b.sci].fileName);
            if (aCanon !== bCanon) return aCanon ? -1 : 1;
            return codePointCompare(
              provisional[a.si].chapters[a.ci].scenes[a.sci].storyRelPath,
              provisional[b.si].chapters[b.ci].scenes[b.sci].storyRelPath,
            );
          });
          winner = list[0];
        } else {
          const inSpine = eligible.filter(
            (g) => provisional[g.si].chapters[g.ci].inOwnSpine,
          );
          const pool = inSpine.length >= 1 ? inSpine : eligible;
          winner = pool.slice().sort((a, b) => {
            const ao = provisional[a.si].mythosOrder;
            const bo = provisional[b.si].mythosOrder;
            if (ao !== bo) return ao - bo;
            return codePointCompare(provisional[a.si].folder, provisional[b.si].folder);
          })[0];
        }
      }
    }

    for (const g of group) {
      const lostStory = storyFinal.get(g.si)!.lost;
      if (!lostStory && winner && g.si === winner.si && g.ci === winner.ci && g.sci === winner.sci) {
        sceneFinalId.set(scKey(g.si, g.ci, g.sci), id);
      } else {
        sceneFinalId.set(scKey(g.si, g.ci, g.sci), mintId());
      }
    }
  }

  // Scenes in a losing story with unique ids still lose.
  provisional.forEach((s, si) => {
    if (!storyFinal.get(si)!.lost) return;
    s.chapters.forEach((c, ci) => {
      c.scenes.forEach((sc, sci) => {
        const key = scKey(si, ci, sci);
        const cur = sceneFinalId.get(key);
        if (cur === undefined || cur === sc.claimedId) {
          sceneFinalId.set(key, mintId());
        }
      });
    });
  });

  // ── Write-backs (surgical) ─────────────────────────────────────────────────
  provisional.forEach((s, si) => {
    const storyDec = storyFinal.get(si)!;
    const bookReplacements = new Map<string, string>();
    const chapterFolders: Array<{
      partDir: string;
      chapterDir: string;
      oldId: string;
      newId: string;
    }> = [];
    if (storyDec.lost && storyDec.finalId !== s.claimedId) {
      bookReplacements.set(s.claimedId, storyDec.finalId);
    }
    for (const [oldId, newId] of storyDec.chapterIdMap) {
      bookReplacements.set(oldId, newId);
    }
    // Folder-scoped chapter id changes — only loser slots are rewritten in the spine.
    // Out-of-spine chapter folders must NOT enter chapterFolders: surgicalReplaceBookIds
    // refuses the whole book.md write when a folder is missing from the spine, which
    // would re-mint story/chapter ids on every rebuild until sync (F5 notes orphan).
    s.chapters.forEach((c, ci) => {
      const finalCh = chapterFinalId.get(chKey(si, ci)) ?? c.claimedId;
      if (finalCh !== c.claimedId) {
        bookReplacements.set(c.claimedId, finalCh);
        if (!c.fromSpine) return;
        chapterFolders.push({
          partDir: c.partDir,
          chapterDir: c.chapterDir,
          oldId: c.claimedId,
          newId: finalCh,
        });
      }
    });

    if ((bookReplacements.size > 0 || chapterFolders.length > 0) && s.bookRaw) {
      const next = surgicalReplaceBookIds(s.bookRaw, bookReplacements, {
        expectFrontmatterStoryId: storyDec.lost ? s.claimedId : undefined,
        chapterFolders,
      });
      if (next !== null && next !== s.bookRaw) {
        writeReIdFile(s.bookPath, next);
      }
    }

    s.chapters.forEach((c, ci) => {
      c.scenes.forEach((sc, sci) => {
        const finalSc = sceneFinalId.get(scKey(si, ci, sci)) ?? sc.claimedId;
        if (finalSc === sc.claimedId && !sc.hadNoId) return;
        if (sc.hadNoId && finalSc === sc.claimedId) {
          // No-id mint path: full serialize (existing behavior).
          try {
            const parsed = parseV2SceneFile(sc.raw, sc.fileName);
            writeReIdFile(sc.fileAbs, serializeV2SceneFile({ ...parsed, id: finalSc }));
          } catch {
            /* read-only */
          }
          return;
        }
        if (finalSc === sc.claimedId) return;
        const next = surgicalReplaceSceneFrontmatterId(sc.raw, sc.claimedId, finalSc);
        if (next !== null) {
          writeReIdFile(sc.fileAbs, next);
        }
        // On null (count mismatch / missing line): keep in-memory id, write nothing.
      });
    });
  });

  // ── Build final Manifest ───────────────────────────────────────────────────
  const stories: StoryEntry[] = [];
  provisional.forEach((s, si) => {
    const storyDec = storyFinal.get(si)!;
    const storyId = storyDec.finalId;
    const chapters: ChapterEntry[] = [];
    s.chapters.forEach((c, ci) => {
      const chapterId = chapterFinalId.get(chKey(si, ci)) ?? c.claimedId;
      const scenes: SceneEntry[] = c.scenes.map((sc, sci) => {
        const id = sceneFinalId.get(scKey(si, ci, sci)) ?? sc.claimedId;
        return {
          id,
          title: sc.title,
          path: sc.vaultRelPath,
          order: sci,
          chapterId,
          storyId,
          blocks: [
            {
              id: `block-${id}`,
              type: 'prose',
              order: 0,
              content: sc.prose,
              updatedAt: sc.updatedAt,
            },
          ],
          ...(statusToDraftState(sc.status) ? { draftState: statusToDraftState(sc.status) } : {}),
          ...(sc.pov ? { card: { pov: sc.pov } } : {}),
          createdAt: sc.updatedAt,
          updatedAt: sc.updatedAt,
        };
      });
      chapters.push({
        id: chapterId,
        title: c.title,
        path: c.chapterRel,
        order: ci,
        scenes,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      });
    });
    stories.push({
      id: storyId,
      title: s.title,
      ...(s.synopsis ? { synopsis: s.synopsis } : {}),
      path: s.folder,
      chapters,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    });
  });

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

/**
 * Boot-only orchestration: rebuild cache when it holds duplicate ids **or**
 * when an untracked story folder with `book.md` is present (Probe H4).
 * Memoized per mythosRoot for the session; failures leave the cache untouched.
 */
export function rebuildCacheIfDuplicated(mythosRoot: string, cachePath: string): void {
  rebuildCacheIfDuplicatedCore(
    mythosRoot,
    cachePath,
    scanMythosStoryVault,
    (p, m) => {
      writeManifestRaw(p, m);
    },
    ensureActiveStoryVaultPath,
    () => {
      try {
        return new Set(readMythosFile(mythosRoot).stories.map((s) => s.folder));
      } catch {
        return new Set();
      }
    },
  );
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
    const storyVaultRoot = ensureActiveStoryVaultPath(mythosRoot);
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
