// Beta 4 M5 — MythosVault v2 drafts: numbered snapshot files.
//
// FULL-SPEC §2: `Story Vault/<Story>/drafts/Scene 01.draft-6.md`. The drafts
// folder lives at the STORY level; inside it the scene's part/chapter path is
// mirrored so "Scene 01" of Chapter 01 and "Scene 01" of Chapter 02 cannot
// collide:
//
//   <Story>/drafts/Part 1/Chapter 01/Scene 01.draft-6.md
//
// Each draft file is the full scene snapshot (frontmatter + prose) prefixed
// with its own draft-header frontmatter, so a draft opened in Obsidian reads
// as a normal markdown document. Draft numbers only grow; "Draft 6" in the
// UI is literally `.draft-6.md` on disk (M10 builds DraftsCompare on these).
//
// The module exposes a SceneVersion-compatible surface so the SKY-10
// version IPC (`version:list/get/rollback`) transparently serves v2 vaults
// from draft files (see versions.ts gate). CF-4 (snapshot before destructive
// changes, one-click restore) rides on that same surface.
//
// Pure Node.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseFrontmatter, serializeFrontmatter, writeFileAtomic } from '../vault.js';
import type { SceneVersion, VersionIntent, VersionRetention } from '../versions.js';

export const DRAFTS_DIRNAME = 'drafts';

const DRAFT_FILE_RE = /^(.+)\.draft-(\d+)\.md$/;

export interface DraftFileHeader {
  sceneId: string;
  draft: number;
  savedAt: string;
  intent: VersionIntent;
  contentHash: string;
  label?: string;
}

export interface DraftFileEntry extends DraftFileHeader {
  /** Absolute path of the draft file. */
  filePath: string;
  /** Snapshot content (byte-identical scene file content at save time). */
  content: string;
}

function sha256Hex(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf-8').digest('hex');
}

const DRAFT_HEADER_KEYS = new Set([
  'mythosDraft', 'sceneId', 'draft', 'savedAt', 'intent', 'contentHash', 'label',
]);

const ALLOWED_INTENTS: readonly VersionIntent[] = [
  'save', 'auto', 'agent-suggestion-applied', 'pre-rollback', 'migration',
];

export function serializeDraftFile(header: DraftFileHeader, content: string): string {
  const fm: Record<string, unknown> = {
    mythosDraft: 1,
    sceneId: header.sceneId,
    draft: header.draft,
    savedAt: header.savedAt,
    intent: header.intent,
    contentHash: header.contentHash,
    ...(header.label ? { label: header.label.replace(/[\r\n]+/g, ' ') } : {}),
  };
  return serializeFrontmatter(fm, content);
}

export function parseDraftFile(raw: string): { header: DraftFileHeader; content: string } | null {
  const { frontmatter, prose } = parseFrontmatter(raw);
  if (frontmatter.mythosDraft === undefined) return null;
  const sceneId = typeof frontmatter.sceneId === 'string' ? frontmatter.sceneId : '';
  if (!sceneId) return null;
  const draft = typeof frontmatter.draft === 'number' ? frontmatter.draft : NaN;
  if (!Number.isInteger(draft) || draft < 1) return null;
  const intentRaw = typeof frontmatter.intent === 'string' ? frontmatter.intent : 'save';
  const intent: VersionIntent = (ALLOWED_INTENTS as readonly string[]).includes(intentRaw)
    ? (intentRaw as VersionIntent)
    : 'save';
  // Reject any stray frontmatter keys — a scene file is never a draft file.
  for (const k of Object.keys(frontmatter)) {
    if (!DRAFT_HEADER_KEYS.has(k)) return null;
  }
  return {
    header: {
      sceneId,
      draft,
      savedAt: typeof frontmatter.savedAt === 'string' ? frontmatter.savedAt : new Date(0).toISOString(),
      intent,
      contentHash: typeof frontmatter.contentHash === 'string' ? frontmatter.contentHash : '',
      ...(typeof frontmatter.label === 'string' && frontmatter.label
        ? { label: frontmatter.label }
        : {}),
    },
    content: prose,
  };
}

// ─── Location resolution ─────────────────────────────────────────────────────

/**
 * Where a chapter's drafts live: first path segment (the story folder) +
 * `drafts/` + the remaining chapter path. `The City/Part 1/Chapter 02` →
 * `The City/drafts/Part 1/Chapter 02`.
 */
export function draftsDirForChapter(chapterRelPath: string): string {
  const norm = chapterRelPath.split(path.sep).join('/').replace(/^\/+|\/+$/g, '');
  const segments = norm.split('/').filter(Boolean);
  if (segments.length === 0) return DRAFTS_DIRNAME;
  const [storyFolder, ...rest] = segments;
  return [storyFolder, DRAFTS_DIRNAME, ...rest].join('/');
}

function containedJoin(vaultRoot: string, relPath: string): string {
  const vaultAbs = path.resolve(vaultRoot);
  const resolved = path.resolve(vaultAbs, relPath);
  const withSep = vaultAbs.endsWith(path.sep) ? vaultAbs : `${vaultAbs}${path.sep}`;
  if (resolved !== vaultAbs && !resolved.startsWith(withSep)) {
    throw new Error(`Path escapes vault root: ${relPath}`);
  }
  return resolved;
}

/**
 * Find the scene's file basename ("Scene 04") inside its chapter folder by
 * matching frontmatter id. Falls back to `scene-<id>` when the scene file is
 * missing (deleted scene with surviving history).
 */
export function resolveSceneBaseName(
  vaultRoot: string,
  chapterRelPath: string,
  sceneId: string,
): string {
  try {
    const chapterAbs = containedJoin(vaultRoot, chapterRelPath);
    for (const entry of fs.readdirSync(chapterAbs, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      if (entry.name === 'book.md' || entry.name === 'chapter.md') continue;
      try {
        const raw = fs.readFileSync(path.join(chapterAbs, entry.name), 'utf-8');
        const { frontmatter } = parseFrontmatter(raw);
        if (frontmatter.id === sceneId) return path.basename(entry.name, '.md');
      } catch {
        /* unreadable candidate — keep scanning */
      }
    }
  } catch {
    /* missing chapter dir — fall through */
  }
  return `scene-${sceneId}`;
}

interface DraftFileOnDisk {
  fileName: string;
  draft: number;
}

function listDraftFilesRaw(draftsAbs: string): DraftFileOnDisk[] {
  let names: string[];
  try {
    names = fs.readdirSync(draftsAbs);
  } catch {
    return [];
  }
  const out: DraftFileOnDisk[] = [];
  for (const name of names) {
    const m = DRAFT_FILE_RE.exec(name);
    if (!m) continue;
    const draft = Number.parseInt(m[2], 10);
    if (!Number.isInteger(draft) || draft < 1) continue;
    out.push({ fileName: name, draft });
  }
  return out;
}

/** All drafts for one scene in a chapter drafts dir, ascending draft number. */
export function listDraftsForScene(
  vaultRoot: string,
  chapterRelPath: string,
  sceneId: string,
): DraftFileEntry[] {
  const draftsRel = draftsDirForChapter(chapterRelPath);
  let draftsAbs: string;
  try {
    draftsAbs = containedJoin(vaultRoot, draftsRel);
  } catch {
    return [];
  }
  const entries: DraftFileEntry[] = [];
  for (const f of listDraftFilesRaw(draftsAbs)) {
    const filePath = path.join(draftsAbs, f.fileName);
    try {
      const parsed = parseDraftFile(fs.readFileSync(filePath, 'utf-8'));
      if (!parsed || parsed.header.sceneId !== sceneId) continue;
      entries.push({ ...parsed.header, draft: f.draft, filePath, content: parsed.content });
    } catch {
      /* unreadable draft — skip */
    }
  }
  entries.sort((a, b) => a.draft - b.draft);
  return entries;
}

export interface SaveDraftOptions {
  sceneId: string;
  chapterRelPath: string;
  content: string;
  intent?: VersionIntent;
  label?: string;
  savedAt?: string;
  retention?: VersionRetention;
  /** Explicit draft number (migration); defaults to max existing + 1. */
  draftNumber?: number;
}

/**
 * Write the next numbered draft for a scene. Auto-save dedup mirrors
 * versions.ts: an `auto` save whose hash matches the newest draft is skipped.
 */
export function saveDraftForScene(vaultRoot: string, opts: SaveDraftOptions): DraftFileEntry {
  const intent = opts.intent ?? 'save';
  const existing = listDraftsForScene(vaultRoot, opts.chapterRelPath, opts.sceneId);
  const contentHash = sha256Hex(opts.content);
  const newest = existing[existing.length - 1];
  if (intent === 'auto' && newest && newest.contentHash === contentHash) {
    return newest;
  }
  const draftsRel = draftsDirForChapter(opts.chapterRelPath);
  const draftsAbs = containedJoin(vaultRoot, draftsRel);
  const base = resolveSceneBaseName(vaultRoot, opts.chapterRelPath, opts.sceneId);
  // Numbering is per-scene, but a rename could collide with another scene's
  // files at the same base name — bump past ANY existing file of that name.
  let draftNumber = opts.draftNumber ?? (newest ? newest.draft + 1 : 1);
  let filePath = path.join(draftsAbs, `${base}.draft-${draftNumber}.md`);
  while (fs.existsSync(filePath)) {
    draftNumber += 1;
    filePath = path.join(draftsAbs, `${base}.draft-${draftNumber}.md`);
  }
  const header: DraftFileHeader = {
    sceneId: opts.sceneId,
    draft: draftNumber,
    savedAt: opts.savedAt ?? new Date().toISOString(),
    intent,
    contentHash,
    ...(opts.label ? { label: opts.label } : {}),
  };
  writeFileAtomic(filePath, serializeDraftFile(header, opts.content));
  if (opts.retention) {
    pruneDraftsForScene(vaultRoot, opts.chapterRelPath, opts.sceneId, opts.retention);
  }
  return { ...header, filePath, content: opts.content };
}

/** Delete oldest drafts beyond maxPerScene / older than maxAgeDays. */
export function pruneDraftsForScene(
  vaultRoot: string,
  chapterRelPath: string,
  sceneId: string,
  retention: VersionRetention,
): void {
  let entries = listDraftsForScene(vaultRoot, chapterRelPath, sceneId);
  if (retention.maxAgeDays > 0) {
    const cutoff = Date.now() - retention.maxAgeDays * 24 * 60 * 60 * 1000;
    for (const e of entries) {
      const t = Date.parse(e.savedAt);
      if (Number.isFinite(t) && t < cutoff) {
        try { fs.unlinkSync(e.filePath); } catch { /* ignore */ }
      }
    }
    entries = listDraftsForScene(vaultRoot, chapterRelPath, sceneId);
  }
  if (retention.maxPerScene > 0 && entries.length > retention.maxPerScene) {
    for (const e of entries.slice(0, entries.length - retention.maxPerScene)) {
      try { fs.unlinkSync(e.filePath); } catch { /* ignore */ }
    }
  }
}

// ─── SceneVersion adapter (SKY-10 IPC compatibility) ────────────────────────

/** `ts` token used by version:get / version:rollback for v2 drafts. */
export function draftTs(draft: number): string {
  return `draft-${draft}`;
}

export function parseDraftTs(ts: string): number | null {
  const m = /^draft-(\d+)$/.exec(ts);
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

export function toSceneVersion(entry: DraftFileEntry): SceneVersion {
  return {
    sceneId: entry.sceneId,
    ts: draftTs(entry.draft),
    content: entry.content,
    intent: entry.intent,
    contentHash: entry.contentHash,
  };
}

/** Newest-first SceneVersion list (matches versions.ts ordering contract). */
export function listDraftsAsVersions(
  vaultRoot: string,
  sceneId: string,
  chapterRelPath: string,
): SceneVersion[] {
  return listDraftsForScene(vaultRoot, chapterRelPath, sceneId)
    .map(toSceneVersion)
    .reverse();
}

export function getDraftAsVersion(
  vaultRoot: string,
  sceneId: string,
  ts: string,
  chapterRelPath: string,
): SceneVersion | null {
  const n = parseDraftTs(ts);
  if (n === null) return null;
  const entry = listDraftsForScene(vaultRoot, chapterRelPath, sceneId).find((e) => e.draft === n);
  return entry ? toSceneVersion(entry) : null;
}
