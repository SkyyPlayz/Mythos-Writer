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
// Pure Node.

import { parseFrontmatter, serializeFrontmatter } from '../vault.js';
import { partDirName, chapterDirName } from './sceneFiles.js';

export const BOOK_FILENAME = 'book.md';

const SPINE_FENCE_OPEN = '<!-- mythos:spine';
const SPINE_FENCE_CLOSE = '-->';

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

/** Extract the JSON payload between the mythos:spine comment fences. */
export function extractSpineJson(body: string): string | null {
  const start = body.indexOf(SPINE_FENCE_OPEN);
  if (start === -1) return null;
  const afterOpen = start + SPINE_FENCE_OPEN.length;
  const end = body.indexOf(SPINE_FENCE_CLOSE, afterOpen);
  if (end === -1) return null;
  return body.slice(afterOpen, end).trim();
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
  const body: string[] = [`# ${book.title}`, ''];
  if (book.synopsis) body.push(book.synopsis, '');
  for (const part of book.spine) {
    body.push(`## ${part.dir}${part.label ? ` — ${part.label}` : ''}`, '');
    if (part.intro?.length) {
      for (const line of part.intro) body.push(`> ${line}`);
      body.push('');
    }
    for (const ch of part.chapters) {
      body.push(`- [[${part.dir}/${ch.dir}|${ch.title}]]`);
    }
    body.push('');
  }
  body.push(
    SPINE_FENCE_OPEN,
    // `-->` inside JSON strings would close the fence early; encode defensively.
    JSON.stringify(book.spine).replace(/-->/g, '--\\u003e'),
    SPINE_FENCE_CLOSE,
    '',
  );
  return serializeFrontmatter(fm, `${body.join('\n')}`);
}
