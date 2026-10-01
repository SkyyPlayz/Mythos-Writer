// F6 — vault-wide story/chapter/scene ID dedupe helpers for MythosVault v2.
// Used by scanMythosStoryVault (winner selection + surgical write-back) and
// ensureVaultDir boot check (rebuildCacheIfDuplicated). Pure Node.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Manifest, StoryEntry, ChapterEntry, SceneEntry } from '../ipc.js';
import { writeFileAtomic, markSelfWrite } from '../vault.js';
import { stringifySpineJson } from './bookFile.js';
import { resolveManifestPath } from './mythosJson.js';
import { isSceneFileName } from './sceneFiles.js';

const SPINE_FENCE_OPEN = '<!-- mythos:spine';
const SPINE_FENCE_CLOSE = '-->';

/** Session memo: path.resolve(vaultRoot) → already attempted this boot. */
const dupBootMemo = new Set<string>();

/** Test-only: clear the boot memo between cases. */
export function _clearDupBootMemoForTests(): void {
  dupBootMemo.clear();
}

export function manifestHasDuplicateIds(rawJson: unknown): boolean {
  if (!rawJson || typeof rawJson !== 'object') return false;
  const m = rawJson as Partial<Manifest>;
  const storyIds: string[] = [];
  const chapterIds: string[] = [];
  const sceneIds: string[] = [];

  const nestedChapterIds = new Set<string>();
  const nestedSceneIds = new Set<string>();

  for (const story of m.stories ?? []) {
    if (story?.id) storyIds.push(story.id);
    for (const ch of story.chapters ?? []) {
      if (ch?.id) {
        chapterIds.push(ch.id);
        nestedChapterIds.add(ch.id);
      }
      for (const sc of ch.scenes ?? []) {
        if (sc?.id) {
          sceneIds.push(sc.id);
          nestedSceneIds.add(sc.id);
        }
      }
    }
  }
  // Flat lists mirror the hierarchy — only count entries not already seen nested
  // so a healthy cache with both shapes is not a false positive.
  for (const ch of m.chapters ?? []) {
    if (ch?.id && !nestedChapterIds.has(ch.id)) chapterIds.push(ch.id);
  }
  for (const sc of m.scenes ?? []) {
    if (sc?.id && !nestedSceneIds.has(sc.id)) sceneIds.push(sc.id);
  }

  return hasDup(storyIds) || hasDup(chapterIds) || hasDup(sceneIds);
}

function hasDup(ids: string[]): boolean {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) return true;
    seen.add(id);
  }
  return false;
}

/** Read prior manifest-cache raw JSON (no hydrate). Absent/unparseable → null. */
export function loadPriorCacheRaw(storyVaultRoot: string): Manifest | null {
  try {
    const cachePath = resolveManifestPath(storyVaultRoot);
    if (!fs.existsSync(cachePath)) return null;
    const raw = JSON.parse(fs.readFileSync(cachePath, 'utf-8')) as unknown;
    if (!raw || typeof raw !== 'object') return null;
    return raw as Manifest;
  } catch {
    return null;
  }
}

export interface IdPathMember {
  /** Vault-relative path used for rule-1 cache matching (story.path / chapter.path / scene.path). */
  path: string;
  /** Index into the provisional scan list for this kind. */
  index: number;
}

/**
 * Rule 1: if EXACTLY ONE member sits at the path prior cache records for that id, it wins.
 * Zero or several → null (skip).
 */
export function winnerByPriorCachePath(
  id: string,
  members: IdPathMember[],
  priorPathsById: Map<string, string>,
): number | null {
  const priorPath = priorPathsById.get(id);
  if (!priorPath) return null;
  const matches = members.filter((m) => m.path === priorPath);
  if (matches.length === 1) return matches[0].index;
  return null;
}

/** Build id → path maps from a prior cache for rule 1.
 *  When the prior cache itself lists the same id at multiple paths, skip that
 *  id (rule 1 requires EXACTLY ONE recorded path — never pick between several).
 */
export function priorPathMaps(prior: Manifest | null): {
  stories: Map<string, string>;
  chapters: Map<string, string>;
  scenes: Map<string, string>;
} {
  const stories = new Map<string, string>();
  const chapters = new Map<string, string>();
  const scenes = new Map<string, string>();
  if (!prior) return { stories, chapters, scenes };

  const storyPaths = new Map<string, Set<string>>();
  const chapterPaths = new Map<string, Set<string>>();
  const scenePaths = new Map<string, Set<string>>();

  const add = (map: Map<string, Set<string>>, id: string, p: string) => {
    const set = map.get(id) ?? new Set<string>();
    set.add(p);
    map.set(id, set);
  };

  for (const story of prior.stories ?? []) {
    if (story?.id && story.path) add(storyPaths, story.id, story.path);
    for (const ch of story.chapters ?? []) {
      if (ch?.id && ch.path) add(chapterPaths, ch.id, ch.path);
      for (const sc of ch.scenes ?? []) {
        if (sc?.id && sc.path) add(scenePaths, sc.id, sc.path);
      }
    }
  }
  for (const ch of prior.chapters ?? []) {
    if (ch?.id && ch.path) add(chapterPaths, ch.id, ch.path);
  }
  for (const sc of prior.scenes ?? []) {
    if (sc?.id && sc.path) add(scenePaths, sc.id, sc.path);
  }

  const freeze = (src: Map<string, Set<string>>, dest: Map<string, string>) => {
    for (const [id, paths] of src) {
      if (paths.size === 1) dest.set(id, [...paths][0]);
    }
  };
  freeze(storyPaths, stories);
  freeze(chapterPaths, chapters);
  freeze(scenePaths, scenes);
  return { stories, chapters, scenes };
}

/**
 * Surgical scene frontmatter id replace: only the `id:` line inside the FIRST
 * frontmatter block. Never touches prose `id: old`. Preserves LF/CRLF.
 * Returns null when the id line is missing (caller keeps in-memory id).
 */
export function surgicalReplaceSceneFrontmatterId(
  raw: string,
  oldId: string,
  newId: string,
): string | null {
  const nl = raw.includes('\r\n') ? '\r\n' : '\n';
  const open = raw.match(/^---\r?\n/);
  if (!open) return null;
  const afterOpen = open[0].length;
  const closeIdx = raw.indexOf(`${nl}---`, afterOpen);
  if (closeIdx === -1) return null;
  const fm = raw.slice(afterOpen, closeIdx);
  const fmLines = fm.split(/\r?\n/);
  let replaced = 0;
  const next = fmLines.map((line) => {
    const m = line.match(/^(id\s*:\s*)(.*)$/);
    if (!m) return line;
    const value = m[2].trim().replace(/^["']|["']$/g, '');
    if (value !== oldId) return line;
    replaced += 1;
    // Preserve quoting style if the original value was quoted.
    const quoted = /^["']/.test(m[2].trim());
    const outVal = quoted ? `"${newId}"` : newId;
    return `${m[1]}${outVal}`;
  });
  if (replaced !== 1) return null;
  return raw.slice(0, afterOpen) + next.join(nl) + raw.slice(closeIdx);
}

export type ChapterFolderReplacement = {
  partDir: string;
  chapterDir: string;
  oldId: string;
  newId: string;
};

/**
 * Surgical book.md id replace: frontmatter story id (optional) + whole id
 * values inside the mythos:spine fence.
 *
 * Chapter replacements are folder-scoped (`chapterFolders`) so a spine that
 * lists the same id twice only rewrites the *losing* chapter entry — the
 * winner's spine slot is untouched (Probe/Ivy: no churn on repeat scans).
 *
 * When `chapterFolders` is passed (including `[]`), only those folder slots are
 * rewritten — an empty list means no chapter spine edits even if `replacements`
 * still holds out-of-spine loser ids. When omitted, Map-based chapter id
 * replacements still require exactly one matching spine folder per id
 * (JSON-escaped / ambiguous duplicates refuse the entire write — no partial
 * frontmatter-only write).
 */
export function surgicalReplaceBookIds(
  raw: string,
  replacements: Map<string, string>,
  opts: {
    expectFrontmatterStoryId?: string;
    /** Loser-only spine slots to rewrite (partDir + chapterDir). */
    chapterFolders?: ChapterFolderReplacement[];
  },
): string | null {
  const chapterFolders = opts.chapterFolders ?? [];
  if (replacements.size === 0 && !opts.expectFrontmatterStoryId && chapterFolders.length === 0) {
    return raw;
  }
  const nl = raw.includes('\r\n') ? '\r\n' : '\n';
  let out = raw;
  let frontmatterApplied = false;

  if (opts.expectFrontmatterStoryId) {
    const newStoryId = replacements.get(opts.expectFrontmatterStoryId);
    if (newStoryId) {
      const open = out.match(/^---\r?\n/);
      if (!open) return null;
      const afterOpen = open[0].length;
      const closeIdx = out.indexOf(`${nl}---`, afterOpen);
      if (closeIdx === -1) return null;
      const fm = out.slice(afterOpen, closeIdx);
      const fmLines = fm.split(/\r?\n/);
      let fmHits = 0;
      const nextFm = fmLines.map((line) => {
        const m = line.match(/^(id\s*:\s*)(.*)$/);
        if (!m) return line;
        const value = m[2].trim().replace(/^["']|["']$/g, '');
        if (value !== opts.expectFrontmatterStoryId) return line;
        fmHits += 1;
        const quoted = /^["']/.test(m[2].trim());
        const outVal = quoted ? `"${newStoryId}"` : newStoryId;
        return `${m[1]}${outVal}`;
      });
      if (fmHits !== 1) return null;
      out = out.slice(0, afterOpen) + nextFm.join(nl) + out.slice(closeIdx);
      frontmatterApplied = true;
    }
  }

  const start = out.indexOf(SPINE_FENCE_OPEN);
  if (start === -1) {
    return frontmatterApplied
      ? out
      : replacements.size === 0 && chapterFolders.length === 0
        ? out
        : null;
  }
  const afterOpen = start + SPINE_FENCE_OPEN.length;
  const end = out.indexOf(SPINE_FENCE_CLOSE, afterOpen);
  if (end === -1) return null;
  const spineRaw = out.slice(afterOpen, end);

  let parsed: unknown;
  try {
    parsed = JSON.parse(spineRaw.trim());
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  const idByFolder = new Map<string, string>();
  for (const part of parsed) {
    if (!part || typeof part !== 'object') continue;
    const p = part as Record<string, unknown>;
    const partDir = typeof p.dir === 'string' ? p.dir : '';
    const chapters = Array.isArray(p.chapters) ? p.chapters : [];
    for (const ch of chapters) {
      if (!ch || typeof ch !== 'object') continue;
      const c = ch as Record<string, unknown>;
      const chDir = typeof c.dir === 'string' ? c.dir : '';
      const id = typeof c.id === 'string' ? c.id : '';
      if (!id) continue;
      const folderKey = `${partDir}/${chDir}`;
      if (idByFolder.has(folderKey)) return null;
      idByFolder.set(folderKey, id);
    }
  }

  type Work = { partDir: string; chapterDir: string; oldId: string; newId: string };
  const work: Work[] = [];
  // When the scan passes chapterFolders (even empty), stay folder-scoped so an
  // out-of-spine loser's id in `replacements` cannot rewrite a winner spine slot
  // via the map-by-id branch (Critic r3 / Shield X2).
  if (opts.chapterFolders !== undefined) {
    for (const cf of chapterFolders) {
      const folderKey = `${cf.partDir}/${cf.chapterDir}`;
      const current = idByFolder.get(folderKey);
      if (current !== cf.oldId) return null;
      work.push({
        partDir: cf.partDir,
        chapterDir: cf.chapterDir,
        oldId: cf.oldId,
        newId: cf.newId,
      });
    }
  } else {
    const foldersById = new Map<string, string[]>();
    for (const [folderKey, id] of idByFolder) {
      if (!replacements.has(id)) continue;
      if (opts.expectFrontmatterStoryId && id === opts.expectFrontmatterStoryId) continue;
      const list = foldersById.get(id) ?? [];
      list.push(folderKey);
      foldersById.set(id, list);
    }
    for (const [oldId, folders] of foldersById) {
      if (folders.length !== 1) return null;
      const newId = replacements.get(oldId);
      if (!newId) continue;
      const slash = folders[0].indexOf('/');
      work.push({
        partDir: folders[0].slice(0, slash),
        chapterDir: folders[0].slice(slash + 1),
        oldId,
        newId,
      });
    }
  }

  if (work.length === 0) {
    return out;
  }

  for (const item of work) {
    const re = new RegExp(`("id"\\s*:\\s*")(${escapeRegExp(item.oldId)})(")`);
    if (!re.test(spineRaw)) return null;
  }

  const spineArr = parsed as Array<Record<string, unknown>>;
  for (const item of work) {
    let found = false;
    for (const part of spineArr) {
      if (!part || typeof part !== 'object') continue;
      if (part.dir !== item.partDir) continue;
      const chapters = Array.isArray(part.chapters) ? part.chapters : [];
      for (const ch of chapters) {
        if (!ch || typeof ch !== 'object') continue;
        const c = ch as Record<string, unknown>;
        if (c.dir !== item.chapterDir) continue;
        if (c.id !== item.oldId) return null;
        c.id = item.newId;
        found = true;
      }
    }
    if (!found) return null;
  }

  const leading = spineRaw.match(/^\s*/)?.[0] ?? '';
  const trailing = spineRaw.match(/\s*$/)?.[0] ?? '';
  const spine = `${leading}${stringifySpineJson(spineArr)}${trailing}`;
  return out.slice(0, afterOpen) + spine + out.slice(end);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Re-derive fallback chapter id `storyId-Part-1-Chapter-01` when story id changes. */
export function rederiveFallbackChapterId(
  chapterId: string,
  oldStoryId: string,
  newStoryId: string,
): string | null {
  const prefix = `${oldStoryId}-`;
  if (!chapterId.startsWith(prefix)) return null;
  return `${newStoryId}-${chapterId.slice(prefix.length)}`;
}

export function writeReIdFile(absPath: string, next: string): boolean {
  try {
    writeFileAtomic(absPath, next);
    try {
      markSelfWrite(absPath);
    } catch {
      /* self-write mark best-effort — accept one follow-up reindex */
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * True when the story vault has a top-level directory that is not tracked and
 * contains a `book.md` (Finder-copied story; Probe H4). Lists ONLY the top
 * level of the stories folder — no deep scan.
 */
export function vaultHasUntrackedBookMd(
  storyVaultRoot: string,
  trackedFolders: ReadonlySet<string>,
): boolean {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(storyVaultRoot, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    if (trackedFolders.has(entry.name)) continue;
    try {
      if (fs.lstatSync(path.join(storyVaultRoot, entry.name)).isSymbolicLink()) continue;
    } catch {
      continue;
    }
    try {
      if (fs.existsSync(path.join(storyVaultRoot, entry.name, 'book.md'))) return true;
    } catch {
      continue;
    }
  }
  return false;
}

/**
 * Boot-only: rebuild the regenerable cache when it holds duplicate ids **or**
 * when the story vault has an untracked folder with `book.md` (warm-cache
 * Finder-copy leaves the copy invisible otherwise — Probe H4).
 *
 * Memoized per mythosRoot for the session. On ANY throw, leave the existing
 * cache untouched.
 *
 * R3: registry lookup (`resolveVaultRoot`) runs *after* the memo check and
 * inside try — EACCES / read-only mythos roots must not throw out of
 * ensureVaultDir on every IPC call.
 *
 * `scan` is injected to avoid a circular import with v2Manifest.ts.
 */
export function rebuildCacheIfDuplicated(
  mythosRoot: string,
  cachePath: string,
  scan: (mythosRoot: string, opts?: { carry?: Partial<Manifest> }) => Manifest,
  writeCache: (cachePath: string, manifest: Manifest) => void,
  resolveVaultRoot: (mythosRoot: string) => string,
  getTrackedFolders?: (mythosRoot: string) => ReadonlySet<string>,
): void {
  const key = path.resolve(mythosRoot);
  if (dupBootMemo.has(key)) return;
  dupBootMemo.add(key);

  let vaultRoot: string;
  let rawText: string;
  let parsed: unknown;
  try {
    vaultRoot = resolveVaultRoot(mythosRoot);
    rawText = fs.readFileSync(cachePath, 'utf-8');
    parsed = JSON.parse(rawText);
  } catch {
    return;
  }

  let tracked: ReadonlySet<string> = new Set();
  if (getTrackedFolders) {
    try {
      tracked = getTrackedFolders(mythosRoot);
    } catch {
      tracked = new Set();
    }
  }

  const needsRebuild =
    manifestHasDuplicateIds(parsed) || vaultHasUntrackedBookMd(vaultRoot, tracked);
  if (!needsRebuild) return;

  const beforeBytes = Buffer.from(rawText, 'utf-8');
  try {
    const rebuilt = scan(mythosRoot, { carry: parsed as Partial<Manifest> });
    writeCache(cachePath, rebuilt);
  } catch {
    try {
      if (fs.readFileSync(cachePath).equals(beforeBytes) === false) {
        fs.writeFileSync(cachePath, beforeBytes);
      }
    } catch {
      /* best-effort restore */
    }
  }
}

/** Code-point ascending (not localeCompare) — brief rule 2 / rule 4. */
export function codePointCompare(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export function mintId(): string {
  return crypto.randomUUID();
}

export type { Manifest, StoryEntry, ChapterEntry, SceneEntry };
