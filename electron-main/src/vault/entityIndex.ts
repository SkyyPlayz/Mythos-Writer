// Entity index — scans Notes Vault directories to build a flat lookup array.
// M12.2 (SKY-10731, SKY-10666 ruling): loadEntityIndex() persists the parsed
// index in vault_index_cache keyed by SHA-256 content hash, so a panel open
// re-parses only files whose content actually changed. buildEntityIndex()
// remains the pure, DB-free full rebuild the cache regenerates from.
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { parseEntityFrontmatter } from './entityFrontmatterParser.js';
import { findBestMatch } from './entityMatcher.js';
import {
  isDbOpen,
  getVaultIndexCacheRows,
  upsertVaultIndexCacheRow,
  deleteVaultIndexCacheRows,
} from '../db.js';

export interface EntityIndexEntry {
  name: string;
  aliases: string[];
  type: string | null;
  path: string;
  /** Author-set scene/chapter reference at which this entity becomes visible to the reader. Null = always visible (AC5). */
  reveal_point: string | null;
}

function stemOf(filePath: string): string {
  return path.basename(filePath, '.md');
}

function sha256Hex(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

function listMdFilesRecursive(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listMdFilesRecursive(full));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push(full);
    }
  }
  return results;
}

function searchDirsOf(notesVaultRoot: string): string[] {
  return [path.join(notesVaultRoot, 'Universes'), path.join(notesVaultRoot, 'Stories')];
}

/** Full rebuild from disk — pure filesystem, no DB. Prefer loadEntityIndex()
 *  on hot paths; this remains for callers without an open vault DB. */
export function buildEntityIndex(notesVaultRoot: string): EntityIndexEntry[] {
  const entries: EntityIndexEntry[] = [];

  for (const dir of searchDirsOf(notesVaultRoot)) {
    const files = listMdFilesRecursive(dir);
    for (const filePath of files) {
      let content = '';
      try {
        content = fs.readFileSync(filePath, 'utf-8');
      } catch {
        continue;
      }
      const { aliases, type, reveal_point } = parseEntityFrontmatter(content);
      entries.push({
        name: stemOf(filePath),
        aliases,
        type,
        path: filePath,
        reveal_point,
      });
    }
  }

  return entries;
}

/**
 * Cache-backed entity index. Per file: hash the content, and only when the
 * hash differs from the cached row re-parse the frontmatter and flip
 * needs_rescan (consumed by the M12.1 scan job). Cache rows for deleted files
 * are purged. Falls back to a plain rebuild when no vault DB is open.
 */
export function loadEntityIndex(notesVaultRoot: string): EntityIndexEntry[] {
  if (!isDbOpen()) return buildEntityIndex(notesVaultRoot);

  const cached = new Map(getVaultIndexCacheRows().map((r) => [r.file_path, r]));
  const seen = new Set<string>();
  const entries: EntityIndexEntry[] = [];

  for (const dir of searchDirsOf(notesVaultRoot)) {
    for (const filePath of listMdFilesRecursive(dir)) {
      let content = '';
      try {
        content = fs.readFileSync(filePath, 'utf-8');
      } catch {
        continue;
      }
      seen.add(filePath);
      const contentHash = sha256Hex(content);
      const row = cached.get(filePath);

      if (row && row.content_hash === contentHash) {
        entries.push({
          name: row.name,
          aliases: JSON.parse(row.aliases_json) as string[],
          type: row.type,
          path: filePath,
          reveal_point: row.reveal_point ?? null,
        });
        continue;
      }

      const { aliases, type, reveal_point } = parseEntityFrontmatter(content);
      const entry: EntityIndexEntry = { name: stemOf(filePath), aliases, type, path: filePath, reveal_point };
      entries.push(entry);
      upsertVaultIndexCacheRow({
        file_path: filePath,
        content_hash: contentHash,
        name: entry.name,
        aliases_json: JSON.stringify(aliases),
        type,
        needs_rescan: 1,
        indexed_at: new Date().toISOString(),
        reveal_point,
      });
    }
  }

  // Orphan purge — drop cache rows for files no longer on disk.
  const orphans: string[] = [];
  for (const cachedPath of cached.keys()) {
    if (!seen.has(cachedPath)) orphans.push(cachedPath);
  }
  deleteVaultIndexCacheRows(orphans);

  return entries;
}

/**
 * Entity-resolution anchor for the fact-ledger extractor (M12.4 builds its
 * coreference logic on top of this). Delegates to the existing alias-aware
 * matcher over the index — per the SKY-10666 ruling there must never be a
 * second name/alias matcher. Returns the resolved vault note path (the
 * wikilink target) or null when the mention matches no known entity.
 */
export function resolveEntityKeyForFact(mention: string, index: EntityIndexEntry[]): string | null {
  const match = findBestMatch(mention, index);
  return match ? match.path : null;
}

/**
 * Canonical, axis-aware manuscript position (SKY-11349).
 *
 * Positions are compared as an ordered tuple `[stage, part, chapter, scene]`
 * that mirrors the product's manuscript hierarchy — Part → Chapter → Scene,
 * with Prologue/Epilogue as book-level sentinels — documented in
 * `docs/MANUSCRIPT-STRUCTURE-VIEW-DESIGN.md` and
 * `docs/entity-reveal-point-contract.md`.
 *
 * Each number is bound to an axis by the *label* that precedes it, not by the
 * order it appears in the string. That is the fix for the SKY-11318 defect
 * where `parseScenePosition` scraped the first two integers regardless of
 * label, so "Scene 12" (a scene index) miscompared against "Chapter 3" (a
 * chapter index) as if both lived on one numeric axis.
 *
 * A `0` on any axis means "unspecified" and sorts before any explicit value at
 * that level (Chapter 0 sorts before Chapter 1).
 */
export interface ScenePosition {
  /** -1 = Prologue (before the body), 0 = body, +1 = Epilogue (after the body). */
  stage: number;
  /** Part number; 0 when absent. */
  part: number;
  /** Chapter *or* Act number — the same structural level; 0 when absent. */
  chapter: number;
  /** Scene number; 0 when absent. */
  scene: number;
}

// Label → axis bindings, evaluated case-insensitively. "Act" folds onto the
// chapter axis: per docs/MANUSCRIPT-STRUCTURE-VIEW-DESIGN.md chapters and acts
// are the single primary organizational unit, not two different axes.
const POSITION_AXIS_PATTERNS: ReadonlyArray<{ axis: 'part' | 'chapter' | 'scene'; re: RegExp }> = [
  { axis: 'part', re: /\bpart\s+(\d+)/i },
  { axis: 'chapter', re: /\b(?:chapter|act)\s+(\d+)/i },
  { axis: 'scene', re: /\bscene\s+(\d+)/i },
];

/**
 * Parses a manuscript position string into a comparable {@link ScenePosition}.
 *
 * Recognized (canonical) forms are label-qualified and case-insensitive, e.g.
 * "Part 2", "Chapter 3", "Act 1 Scene 4", "Scene 12", "Prologue", "Epilogue".
 * Labels may be combined ("Part 2 Chapter 3 Scene 5"); each number binds to the
 * axis named by the label in front of it.
 *
 * Legacy fallback: a string with **no** recognized label (e.g. "5", "3.2")
 * treats the first integer as the chapter and the second as the scene, matching
 * the historical major/minor behavior so existing bare-number data keeps
 * ordering the same way.
 *
 * Exported so downstream consumers (e.g. SKY-10741 reader-perspective UI) share
 * one ordering definition instead of re-deriving it.
 */
export function parseScenePosition(pos: string): ScenePosition {
  const result: ScenePosition = { stage: 0, part: 0, chapter: 0, scene: 0 };

  if (/\bprologue\b/i.test(pos)) result.stage = -1;
  else if (/\bepilogue\b/i.test(pos)) result.stage = 1;

  let matchedLabel = false;
  for (const { axis, re } of POSITION_AXIS_PATTERNS) {
    const m = re.exec(pos);
    if (m) {
      result[axis] = parseInt(m[1], 10);
      matchedLabel = true;
    }
  }

  // No axis label and no stage sentinel → legacy positional parse
  // (first int = chapter/major, second int = scene/minor).
  if (!matchedLabel && result.stage === 0) {
    const nums = pos.match(/\d+/g) ?? [];
    result.chapter = parseInt(nums[0] ?? '0', 10);
    result.scene = parseInt(nums[1] ?? '0', 10);
  }

  return result;
}

/** Total order over {@link ScenePosition}: negative if a is before b. */
export function compareScenePositions(a: ScenePosition, b: ScenePosition): number {
  return a.stage - b.stage || a.part - b.part || a.chapter - b.chapter || a.scene - b.scene;
}

function positionReached(revealPoint: string, currentPosition: string): boolean {
  return compareScenePositions(parseScenePosition(revealPoint), parseScenePosition(currentPosition)) <= 0;
}

/**
 * Reader-perspective filter (AC2, SKY-11318): returns only entries whose reveal_point
 * has been reached at or before currentPosition. Entries with no reveal_point are
 * always included (AC5 — backward compatible).
 *
 * reveal_point and currentPosition must use the canonical position format parsed
 * by {@link parseScenePosition} (see docs/entity-reveal-point-contract.md). They
 * are compared axis-by-axis (stage → part → chapter → scene), so mixed label
 * conventions can no longer silently miscompare their raw digits.
 */
export function aliasesVisibleBefore(
  entries: EntityIndexEntry[],
  currentPosition: string,
): EntityIndexEntry[] {
  return entries.filter(
    (e) => e.reveal_point === null || positionReached(e.reveal_point, currentPosition),
  );
}
