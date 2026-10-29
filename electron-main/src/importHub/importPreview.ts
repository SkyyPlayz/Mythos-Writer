// #1765 — Import hub preview + token cache.
//
// import:preview parses the source once and caches the resulting ImportPlan
// under an opaque single-use token; import:commit writes exactly that plan.
// The renderer only ever sees the ImportPreview built here: titles, counts,
// a short excerpt — never an absolute path.
//
// This store is deliberately separate from registrationToken.ts: an import
// token must never be accepted by vault:set-paths / vault:obsidian-register,
// and a writer reading a preview needs far longer than that store's 60 s.
//
// Pure Node — no Electron.

import crypto from 'node:crypto';
import type {
  ImportEntityType,
  ImportPlan,
  ImportPreview,
  ImportPreviewChapter,
  ImportSourceKind,
} from './types.js';

/** Plain-words label per source kind (preview header + Story Plan note). */
export const SOURCE_LABELS: Readonly<Record<ImportSourceKind, string>> = Object.freeze({
  docx: 'Word document',
  'gdoc-html': 'Google Docs (web page export)',
  html: 'Web page',
  markdown: 'Markdown file',
  'markdown-folder': 'Markdown folder',
  scrivener: 'Scrivener project',
  epub: 'ePub book',
  rtf: 'Rich Text (.rtf)',
  text: 'Plain text',
});

export const IMPORT_SESSION_TTL_MS = 15 * 60 * 1000;
export const IMPORT_SESSION_MAX = 4;
export const PREVIEW_EXCERPT_CHARS = 600;

/** The source a plan was built from — re-checked at commit time. */
export interface ImportSessionSource {
  realPath: string;
  size: number;
  mtimeMs: number;
}

interface ImportSession {
  plan: ImportPlan;
  source: ImportSessionSource;
  createdAt: number;
  /** A commit is running on this session (claimImportSession). */
  inFlight: boolean;
}

// Map preserves insertion order, so the first key is always the oldest.
const sessions = new Map<string, ImportSession>();

function purgeExpired(now: number): void {
  for (const [token, s] of sessions) {
    if (now - s.createdAt >= IMPORT_SESSION_TTL_MS) sessions.delete(token);
  }
}

// ─── Path scrubbing ──────────────────────────────────────────────────────────

function basenameAny(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? '';
}

// Directory segments may hold single spaces ("Private Books/"); the last
// segment ends at whitespace.
const WIN_ABS_PATH = /(?:\\\\[^\s\\"']+\\|\b[A-Za-z]:[\\/])(?:[^\\/\s"'<>|]+(?: [^\\/\s"'<>|]+)*[\\/])*[^\s"'<>|]*/g;
const POSIX_ABS_PATH = /(^|[\s"'(=])(\/(?:[^/\s"'()<>]+(?: [^/\s"'()<>]+)*\/)+[^\s"'()<>]*)/g;

/** Replace absolute paths inside a message with their basename. */
export function scrubAbsolutePaths(text: string): string {
  return text
    .replace(WIN_ABS_PATH, (m) => basenameAny(m))
    .replace(POSIX_ABS_PATH, (_m, lead: string, p: string) => `${lead}${basenameAny(p)}`);
}

/** A plan folder as a safe relative POSIX path ('' for the root). */
function relFolder(folder: string): string {
  return folder
    .split(/[\\/]/)
    .map((s) => s.trim())
    .filter((s) => s && s !== '.' && s !== '..' && !/^[A-Za-z]:$/.test(s))
    .join('/');
}

// ─── Word counts + excerpt ───────────────────────────────────────────────────

/** Count words in editor Markdown, ignoring the syntax around them. */
export function countWords(markdown: string): number {
  if (!markdown) return 0;
  const plain = markdown
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s\{\.(?:center|right|justify)\}\s*$/gm, '')
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-+*]\s+|\d+[.)]\s+)/gm, '')
    .replace(/\\([\\`*_{}[\]()#+\-.!<>~|])/g, '$1')
    .replace(/[*_~`]+/g, ' ');
  let n = 0;
  for (const token of plain.split(/\s+/)) {
    if (/[\p{L}\p{N}]/u.test(token)) n++;
  }
  return n;
}

/** First ~600 chars of the first non-empty scene, cut at a word boundary. */
export function buildExcerpt(plan: ImportPlan): string {
  for (const ch of byOrder(plan.story?.chapters ?? [])) {
    for (const sc of byOrder(ch.scenes)) {
      const prose = sc.prose.trim();
      if (!prose) continue;
      const chars = [...prose];
      if (chars.length <= PREVIEW_EXCERPT_CHARS) return prose;
      const cut = chars.slice(0, PREVIEW_EXCERPT_CHARS).join('');
      const lastSpace = cut.search(/\s\S*$/);
      const atWord = lastSpace > PREVIEW_EXCERPT_CHARS / 2 ? cut.slice(0, lastSpace) : cut;
      return `${atWord.trimEnd()}…`;
    }
  }
  return '';
}

function dedupeWarnings(warnings: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of warnings) {
    if (typeof raw !== 'string') continue;
    const w = scrubAbsolutePaths(raw.trim());
    if (!w || seen.has(w)) continue;
    seen.add(w);
    out.push(w);
  }
  return out;
}

function byOrder<T extends { order: number }>(items: T[]): T[] {
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => a.item.order - b.item.order || a.i - b.i)
    .map((x) => x.item);
}

// ─── Preview ─────────────────────────────────────────────────────────────────

/** Trim a plan to the path-free view the renderer shows. */
export function buildPreview(
  plan: ImportPlan,
  token: string,
  ctx: { canCommit: boolean; commitBlockedReason?: string },
): ImportPreview {
  const name = basenameAny(plan.source.name) || 'Untitled';
  let story: ImportPreview['story'] = null;
  if (plan.story) {
    let words = 0;
    const chapters: ImportPreviewChapter[] = byOrder(plan.story.chapters).map((ch) => {
      const scenes = byOrder(ch.scenes).map((sc) => ({ title: sc.title, words: countWords(sc.prose) }));
      const chWords = scenes.reduce((n, s) => n + s.words, 0);
      words += chWords;
      return { title: ch.title, words: chWords, scenes };
    });
    story = {
      title: plan.story.title,
      structure: plan.story.structure,
      partCount: plan.story.partCount,
      words,
      chapters,
      excerpt: buildExcerpt(plan),
    };
  }
  const notes: { title: string; folder: string }[] = [];
  const entities: { title: string; type: ImportEntityType }[] = [];
  for (const note of plan.notes) {
    if (note.entityType) entities.push({ title: note.title, type: note.entityType });
    else notes.push({ title: note.title, folder: relFolder(note.folder) });
  }
  return {
    token,
    source: { kind: plan.source.kind, label: SOURCE_LABELS[plan.source.kind], name },
    story,
    notes,
    entities,
    warnings: dedupeWarnings(plan.warnings),
    canCommit: ctx.canCommit,
    ...(!ctx.canCommit && ctx.commitBlockedReason ? { commitBlockedReason: ctx.commitBlockedReason } : {}),
  };
}

// ─── Session store ───────────────────────────────────────────────────────────

/** Cache a plan and return its preview. Evicts the oldest past IMPORT_SESSION_MAX. */
export function createImportSession(
  plan: ImportPlan,
  source: ImportSessionSource,
  ctx: { canCommit: boolean; commitBlockedReason?: string },
): ImportPreview {
  const now = Date.now();
  purgeExpired(now);
  while (sessions.size >= IMPORT_SESSION_MAX) {
    const oldest = sessions.keys().next().value;
    if (oldest === undefined) break;
    sessions.delete(oldest);
  }
  const token = crypto.randomBytes(24).toString('base64url');
  sessions.set(token, {
    plan,
    source: { realPath: source.realPath, size: source.size, mtimeMs: source.mtimeMs },
    createdAt: now,
    inFlight: false,
  });
  return buildPreview(plan, token, ctx);
}

/** Single-use: returns the cached plan and forgets it. Null when unknown or expired. */
export function takeImportSession(token: string): { plan: ImportPlan; source: ImportSessionSource } | null {
  if (typeof token !== 'string' || token.length === 0) return null;
  const now = Date.now();
  const session = sessions.get(token);
  if (!session) return null;
  sessions.delete(token);
  if (now - session.createdAt >= IMPORT_SESSION_TTL_MS) return null;
  return { plan: session.plan, source: session.source };
}

export type ImportSessionClaim =
  | { status: 'claimed'; plan: ImportPlan; source: ImportSessionSource }
  | { status: 'busy' }
  | { status: 'missing' };

/**
 * Lock a session for one commit attempt without forgetting it, so a commit
 * that fails before writing anything can be retried on the same preview.
 * The caller must end the claim with finishImportSession (success, or an
 * outcome a retry can't fix) or releaseImportSession (nothing was written).
 * A second claim while one is running answers 'busy'.
 */
export function claimImportSession(token: string): ImportSessionClaim {
  if (typeof token !== 'string' || token.length === 0) return { status: 'missing' };
  const session = sessions.get(token);
  if (!session) return { status: 'missing' };
  if (Date.now() - session.createdAt >= IMPORT_SESSION_TTL_MS) {
    if (!session.inFlight) sessions.delete(token);
    return { status: 'missing' };
  }
  if (session.inFlight) return { status: 'busy' };
  session.inFlight = true;
  return { status: 'claimed', plan: session.plan, source: session.source };
}

/** End a claim and forget the session (the token is spent). */
export function finishImportSession(token: string): void {
  sessions.delete(token);
}

/** End a claim and keep the session for a retry (until its TTL). */
export function releaseImportSession(token: string): void {
  const session = sessions.get(token);
  if (session) session.inFlight = false;
}

/** Test hook: forget every cached session. */
export function _clearImportSessionsForTest(): void {
  sessions.clear();
}

/** Test hook: how many sessions are cached. */
export function _importSessionCountForTest(): number {
  return sessions.size;
}
