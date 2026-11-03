// Beta 4 M5 — MythosVault v2 `book.md`: compiled order + metadata per story.
//
// `Story Vault/<Story>/book.md` carries the story's identity and the compiled
// spine (parts → chapters). Scene ORDER inside a chapter derives from the
// numbered scene files on disk; the spine records what folders cannot:
// part labels/epigraphs and chapter ids/titles/intros.
//
// The spine is stored as JSON inside an HTML-comment fence in the body
// (invisible in Obsidian's reading view, immune to the simple YAML parser's
// inline-array splitting), below a regenerated human-readable table of
// contents.
//
// Book profiles live in a second fence, `<!-- mythos:book-profiles … -->`,
// after the spine. Unknown YAML keys round-trip through `extraFrontmatter`.
// A rewrite refuses a malformed book, or an unrecognized or duplicate
// profiles fence, and leaves the file untouched. `profilesFenceRaw` is only
// for a caller that already chose to echo a payload.
//
// Pure Node.

import { parseFrontmatter, serializeFrontmatter } from '../vault.js';
import { partDirName, chapterDirName } from './sceneFiles.js';
import {
  BookProfilesCapError,
  MAX_BOOK_PROFILES,
  MAX_BOOK_PROFILES_FENCE_BYTES,
  validateBookProfiles,
  type BookProfile,
} from '../bookBuilder.js';

export const BOOK_FILENAME = 'book.md';

const SPINE_FENCE_OPEN = '<!-- mythos:spine';
const PROFILES_FENCE_OPEN = '<!-- mythos:book-profiles';
const FENCE_CLOSE = '-->';

const KNOWN_FRONTMATTER_KEYS = new Set(['id', 'title', 'synopsis', 'createdAt', 'updatedAt']);

export interface BookSpineChapter {
  /** Directory name under the part ("Chapter 01"). */
  dir: string;
  id: string;
  title: string;
  /** Optional chapter epigraph / intro paragraphs. */
  intro?: string[];
}

export interface BookSpinePart {
  /** Directory name under the story ("Part 1"). */
  dir: string;
  /** Display label ("Ash and Oath"). */
  label?: string;
  intro?: string[];
  chapters: BookSpineChapter[];
}

export interface BookFile {
  id: string;
  title: string;
  synopsis?: string;
  createdAt: string;
  updatedAt: string;
  spine: BookSpinePart[];
  /** Validated profiles. Omitted when the book has none. */
  profiles?: BookProfile[];
  /**
   * Original profiles-fence payload when it could not be adopted (over the
   * 50-profile / 64 KB cap, or not a valid profile list). Sync echoes it.
   */
  profilesFenceRaw?: string;
  /** YAML keys this codec does not own. Omitted when empty. */
  extraFrontmatter?: Record<string, unknown>;
}

function sanitizeSpine(raw: unknown): BookSpinePart[] {
  if (!Array.isArray(raw)) return [];
  const parts: BookSpinePart[] = [];
  for (const [i, entry] of raw.entries()) {
    if (typeof entry !== 'object' || entry === null) continue;
    const p = entry as Record<string, unknown>;
    const chapters: BookSpineChapter[] = [];
    if (Array.isArray(p.chapters)) {
      for (const [j, c] of p.chapters.entries()) {
        if (typeof c !== 'object' || c === null) continue;
        const ch = c as Record<string, unknown>;
        chapters.push({
          dir: typeof ch.dir === 'string' && ch.dir ? ch.dir : chapterDirName(j + 1),
          id: typeof ch.id === 'string' && ch.id ? ch.id : '',
          title: typeof ch.title === 'string' && ch.title ? ch.title : `Chapter ${j + 1}`,
          ...(Array.isArray(ch.intro) ? { intro: ch.intro.map(String) } : {}),
        });
      }
    }
    parts.push({
      dir: typeof p.dir === 'string' && p.dir ? p.dir : partDirName(i + 1),
      ...(typeof p.label === 'string' && p.label ? { label: p.label } : {}),
      ...(Array.isArray(p.intro) ? { intro: p.intro.map(String) } : {}),
      chapters,
    });
  }
  return parts;
}

/**
 * A fence opener counts only when it is the first non-whitespace on its line.
 * Title, synopsis, and chapter text can name the marker without becoming a fence.
 */
function fenceOpensAt(body: string, open: string, from: number): number {
  let cursor = from;
  while (cursor < body.length) {
    const start = body.indexOf(open, cursor);
    if (start === -1) return -1;
    const lineStart = body.lastIndexOf('\n', start - 1) + 1;
    if (body.slice(lineStart, start).trim() === '') return start;
    cursor = start + open.length;
  }
  return -1;
}

function extractFencePayload(body: string, open: string): string | null {
  const start = fenceOpensAt(body, open, 0);
  if (start === -1) return null;
  const afterOpen = start + open.length;
  const end = body.indexOf(FENCE_CLOSE, afterOpen);
  if (end === -1) return null;
  return body.slice(afterOpen, end).trim();
}

/** Body copy of user text. A line that would open a fence is not stored as one. */
function visibleProse(value: string): string {
  return value.split('\n').map((line) => {
    const bare = line.replace(/\r$/, '');
    const lead = bare.trimStart();
    if (!lead.startsWith(SPINE_FENCE_OPEN) && !lead.startsWith(PROFILES_FENCE_OPEN)) return bare;
    const indent = bare.slice(0, bare.length - lead.length);
    return `${indent}< !--${lead.slice('<!--'.length)}`;
  }).join('\n');
}

/** Extract the JSON payload between the mythos:spine comment fences. */
export function extractSpineJson(body: string): string | null {
  return extractFencePayload(body, SPINE_FENCE_OPEN);
}

function extraFrontmatterFrom(frontmatter: Record<string, unknown>): Record<string, unknown> | undefined {
  const extra: Record<string, unknown> = {};
  let count = 0;
  for (const [key, value] of Object.entries(frontmatter)) {
    if (KNOWN_FRONTMATTER_KEYS.has(key)) continue;
    extra[key] = value;
    count += 1;
  }
  return count > 0 ? extra : undefined;
}

export type BookFileRewriteEvent =
  | 'book-file-malformed'
  | 'book-file-profiles-fence'
  | 'book-file-profiles-duplicate';

export class BookFileRewriteRefusedError extends Error {
  readonly event: BookFileRewriteEvent;
  constructor(event: BookFileRewriteEvent) {
    super(event);
    this.name = 'BookFileRewriteRefusedError';
    this.event = event;
  }
}

export function isBookFileRewriteRefused(err: unknown): err is BookFileRewriteRefusedError {
  return err instanceof BookFileRewriteRefusedError;
}

interface FenceHit {
  payload: string;
  closed: boolean;
}

function collectFences(body: string, open: string): FenceHit[] {
  const hits: FenceHit[] = [];
  let from = 0;
  while (from < body.length) {
    const start = fenceOpensAt(body, open, from);
    if (start === -1) break;
    const after = start + open.length;
    const end = body.indexOf(FENCE_CLOSE, after);
    if (end === -1) {
      hits.push({ payload: body.slice(after).trim(), closed: false });
      break;
    }
    hits.push({ payload: body.slice(after, end).trim(), closed: true });
    from = end + FENCE_CLOSE.length;
  }
  return hits;
}

function spinePayloadRewritable(payload: string): boolean {
  try {
    return Array.isArray(JSON.parse(payload));
  } catch {
    return false;
  }
}

function profilesPayloadRewritable(payload: string): boolean {
  if (Buffer.byteLength(payload, 'utf8') > MAX_BOOK_PROFILES_FENCE_BYTES) return false;
  try {
    return validateBookProfiles(JSON.parse(payload)).ok;
  } catch {
    return false;
  }
}

/**
 * Refuse a rewrite that would drop or replace bytes we cannot carry.
 * A missing file is not passed here — only a verified ENOENT may create.
 */
export function assertBookFileRewritable(raw: string): void {
  const { prose } = parseFrontmatter(raw);
  const spines = collectFences(prose, SPINE_FENCE_OPEN);
  if (spines.length > 1 || spines.some((hit) => !hit.closed || !spinePayloadRewritable(hit.payload))) {
    throw new BookFileRewriteRefusedError('book-file-malformed');
  }
  const profiles = collectFences(prose, PROFILES_FENCE_OPEN);
  if (profiles.length > 1) throw new BookFileRewriteRefusedError('book-file-profiles-duplicate');
  if (profiles.length === 1) {
    const hit = profiles[0];
    if (!hit.closed || !profilesPayloadRewritable(hit.payload)) {
      throw new BookFileRewriteRefusedError('book-file-profiles-fence');
    }
  }
}

function profilesFromFence(prose: string): { profiles?: BookProfile[]; profilesFenceRaw?: string } {
  const payload = extractFencePayload(prose, PROFILES_FENCE_OPEN);
  if (payload === null) return {};
  if (Buffer.byteLength(payload, 'utf8') > MAX_BOOK_PROFILES_FENCE_BYTES) {
    return { profilesFenceRaw: payload };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return { profilesFenceRaw: payload };
  }
  const validated = validateBookProfiles(parsed);
  if (!validated.ok) return { profilesFenceRaw: payload };
  if (validated.profiles.length === 0) return {};
  return { profiles: validated.profiles };
}

export function parseBookFile(content: string, fallbackTitle = 'Untitled Story'): BookFile {
  const { frontmatter, prose } = parseFrontmatter(content);
  let spine: BookSpinePart[] = [];
  const spineJson = extractSpineJson(prose);
  if (spineJson) {
    try {
      spine = sanitizeSpine(JSON.parse(spineJson));
    } catch {
      spine = [];
    }
  }
  const carried = profilesFromFence(prose);
  const extraFrontmatter = extraFrontmatterFrom(frontmatter);
  return {
    id: typeof frontmatter.id === 'string' && frontmatter.id ? frontmatter.id : '',
    title:
      typeof frontmatter.title === 'string' && frontmatter.title
        ? frontmatter.title
        : fallbackTitle,
    ...(typeof frontmatter.synopsis === 'string' && frontmatter.synopsis
      ? { synopsis: frontmatter.synopsis }
      : {}),
    createdAt:
      typeof frontmatter.createdAt === 'string' && frontmatter.createdAt
        ? frontmatter.createdAt
        : new Date(0).toISOString(),
    updatedAt:
      typeof frontmatter.updatedAt === 'string' && frontmatter.updatedAt
        ? frontmatter.updatedAt
        : new Date(0).toISOString(),
    spine,
    ...carried,
    ...(extraFrontmatter ? { extraFrontmatter } : {}),
  };
}

/** Strip newlines from a value destined for a single frontmatter line. */
function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

export function serializeBookFile(book: BookFile): string {
  const fm: Record<string, unknown> = {
    id: book.id,
    title: oneLine(book.title),
    ...(book.synopsis ? { synopsis: oneLine(book.synopsis) } : {}),
    createdAt: book.createdAt,
    updatedAt: book.updatedAt,
  };
  if (book.extraFrontmatter) {
    for (const [key, value] of Object.entries(book.extraFrontmatter)) {
      if (KNOWN_FRONTMATTER_KEYS.has(key) || value === undefined || value === null) continue;
      fm[key] = typeof value === 'string' ? oneLine(value) : value;
    }
  }
  const body: string[] = [`# ${visibleProse(book.title)}`, ''];
  if (book.synopsis) body.push(visibleProse(book.synopsis), '');
  for (const part of book.spine) {
    const label = part.label ? visibleProse(part.label) : '';
    body.push(`## ${part.dir}${label ? ` — ${label}` : ''}`, '');
    if (part.intro?.length) {
      for (const line of part.intro) {
        for (const piece of visibleProse(line).split('\n')) body.push(`> ${piece}`);
      }
      body.push('');
    }
    for (const ch of part.chapters) {
      body.push(`- [[${part.dir}/${ch.dir}|${visibleProse(ch.title)}]]`);
    }
    body.push('');
  }
  body.push(SPINE_FENCE_OPEN, stringifySpineJson(book.spine), FENCE_CLOSE, '');
  if (book.profilesFenceRaw !== undefined) {
    body.push(PROFILES_FENCE_OPEN, book.profilesFenceRaw, FENCE_CLOSE, '');
  } else if (book.profiles && book.profiles.length > 0) {
    if (book.profiles.length > MAX_BOOK_PROFILES) throw new BookProfilesCapError();
    const payload = stringifyFenceJson(book.profiles);
    if (Buffer.byteLength(payload, 'utf8') > MAX_BOOK_PROFILES_FENCE_BYTES) {
      throw new BookProfilesCapError();
    }
    body.push(PROFILES_FENCE_OPEN, payload, FENCE_CLOSE, '');
  }
  return serializeFrontmatter(fm, `${body.join('\n')}`);
}

/**
 * Serialize JSON for an HTML-comment fence.
 * `-->` inside JSON strings would close the fence early; encode defensively.
 */
export function stringifyFenceJson(value: unknown): string {
  return JSON.stringify(value).replace(/-->/g, '--\\u003e');
}

/**
 * Serialize spine JSON for the `<!-- mythos:spine … -->` fence.
 * `-->` inside JSON strings would close the fence early; encode defensively.
 */
export function stringifySpineJson(spine: unknown): string {
  return stringifyFenceJson(spine);
}
