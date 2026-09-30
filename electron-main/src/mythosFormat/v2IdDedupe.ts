// F6 — vault-wide story/chapter/scene ID dedupe helpers for MythosVault v2.
// Used by scanMythosStoryVault (winner selection + surgical write-back) and
// ensureVaultDir boot check (rebuildCacheIfDuplicated). Pure Node.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Manifest, StoryEntry, ChapterEntry, SceneEntry } from '../ipc.js';
import { writeFileAtomic, markSelfWrite } from '../vault.js';
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

/**
 * Surgical book.md id replace: frontmatter story id (optional) + whole id
 * values inside the mythos:spine fence. Count guard — mismatch → null.
 */
export function surgicalReplaceBookIds(
  raw: string,
  replacements: Map<string, string>,
  opts: { expectFrontmatterStoryId?: string },
): string | null {
  if (replacements.size === 0 && !opts.expectFrontmatterStoryId) return raw;
  const nl = raw.includes('\r\n') ? '\r\n' : '\n';
  let expected = 0;
  let actual = 0;
  let out = raw;

  if (opts.expectFrontmatterStoryId) {
    const newStoryId = replacements.get(opts.expectFrontmatterStoryId);
    if (newStoryId) {
      expected += 1;
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
      actual += 1;
      out = out.slice(0, afterOpen) + nextFm.join(nl) + out.slice(closeIdx);
    }
  }

  const start = out.indexOf(SPINE_FENCE_OPEN);
  if (start === -1) {
    return expected === actual && expected > 0 ? out : expected === 0 ? out : null;
  }
  const afterOpen = start + SPINE_FENCE_OPEN.length;
  const end = out.indexOf(SPINE_FENCE_CLOSE, afterOpen);
  if (end === -1) return null;
  let spine = out.slice(afterOpen, end);
  for (const [oldId, newId] of replacements) {
    // Whole JSON string values only — never substring (fallback-shaped ids).
    const re = new RegExp(`("id"\\s*:\\s*")(${escapeRegExp(oldId)})(")`, 'g');
    const matches = spine.match(re);
    const count = matches?.length ?? 0;
    if (count === 0) continue;
    expected += count;
    spine = spine.replace(re, `$1${newId}$3`);
    actual += count;
  }
  if (expected === 0) return out;
  if (actual !== expected) return null;
  // Verify every replacement landed as whole values (re-count).
  for (const [oldId] of replacements) {
    const leftover = new RegExp(`"id"\\s*:\\s*"${escapeRegExp(oldId)}"`, 'g');
    if (leftover.test(spine)) return null;
  }
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
 * Boot-only: if the existing cache has duplicate ids, rebuild via
 * scanMythosStoryVault(+carry). Memoized per vaultRoot for the session.
 * On ANY throw, leave the existing cache untouched.
 *
 * `scan` is injected to avoid a circular import with v2Manifest.ts.
 */
export function rebuildCacheIfDuplicated(
  mythosRoot: string,
  cachePath: string,
  scan: (mythosRoot: string, opts?: { carry?: Partial<Manifest> }) => Manifest,
  writeCache: (cachePath: string, manifest: Manifest) => void,
  resolveVaultRoot: (mythosRoot: string) => string,
): void {
  const vaultRoot = resolveVaultRoot(mythosRoot);
  const key = path.resolve(vaultRoot);
  if (dupBootMemo.has(key)) return;
  dupBootMemo.add(key);

  let rawText: string;
  try {
    rawText = fs.readFileSync(cachePath, 'utf-8');
  } catch {
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return;
  }
  if (!manifestHasDuplicateIds(parsed)) return;

  const beforeBytes = Buffer.from(rawText, 'utf-8');
  try {
    const rebuilt = scan(mythosRoot, { carry: parsed as Partial<Manifest> });
    writeCache(cachePath, rebuilt);
  } catch {
    // Leave existing cache byte-identical.
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
