// #1765 — Import hub commit writer: writes a previewed ImportPlan into the
// open Mythos vault, exactly as previewed.
//
// Story (v2 vault): a new `<Story>/book.md` + `Part 1/Chapter NN/Scene NN.md`
// folder — the shape materializeDocxAsStoryFolder writes — but every file goes
// through writeVaultFileAtomic, and the story is appended to the manifest
// cache with the ids/titles/orders/paths scanMythosStoryVault would derive
// from those files, so a later cache rebuild neither loses nor duplicates it.
// The caller's writeManifest wrapper then syncs mythos.json + book.md.
// Story (legacy vault): the writeImportedStoryToVault layout
// (`Manuscript/<slug>/<chapter>/<scene>.md`), persisted via deps.writeManifest.
//
// Notes: plain notes → `Imported/<source>/<folder>/<title>.md`; entities →
// the v2 seed's top-level type folders; the Story Plan note → `Plans/`.
// Nothing existing is ever overwritten (" 2", " 3" … suffixes).
//
// The renderer debounces whole-manifest saves; flushRenderer() runs before any
// write so a pending save can't replace the cache and drop the new story.
//
// Pure Node — no Electron.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { sanitizeVaultName } from '@mythos-writer/shared/vaultNameSanitizer';
import type { ChapterEntry, Manifest, SceneEntry, StoryEntry } from '../ipc.js';
import {
  MANUSCRIPT_DIR,
  resolveSlugCollision,
  sceneVaultPath,
  toSlug,
  writeSceneFile,
  writeVaultFileAtomic,
  yamlInlineQuote,
} from '../vault.js';
import { planNoteFileName } from '../storyImport.js';
import { BOOK_FILENAME, serializeBookFile, type BookFile, type BookSpineChapter } from '../mythosFormat/bookFile.js';
import {
  chapterDirName,
  parseV2SceneFile,
  partDirName,
  sceneFileName,
  serializeV2SceneFile,
  statusToDraftState,
  storyFolderName,
} from '../mythosFormat/sceneFiles.js';
import { assertValidManifest } from '../manifestValidate.js';
import { inlinesToMarkdown } from './blocks.js';
import { countWords, SOURCE_LABELS } from './importPreview.js';
import type {
  ImportChapter,
  ImportCommitOptions,
  ImportCommitResult,
  ImportEntityType,
  ImportNote,
  ImportPlan,
  ImportScene,
} from './types.js';

export interface ImportCommitDeps {
  getStoryVaultRoot(): string | null;
  isV2StoryVault(storyVaultRoot: string): boolean;
  getManifestPath(): string;
  readManifest(manifestPath: string): Manifest;
  /** main.ts wrapper: writes the cache and, for v2, syncs mythos.json + book.md. */
  writeManifest(manifestPath: string, m: Manifest): void;
  getNotesVaultRoot(): string | null;
  ensureNotesVaultDir(): void;
  notifyNotesWritten(relPaths: string[]): void;
  notifyStoriesChanged(): void;
  /** Flush the renderer's pending (debounced) manifest save. */
  flushRenderer(): Promise<void>;
  now?(): Date;
}

export const IMPORT_MAX_NOTES = 5000;
export const IMPORT_MAX_SCENES = 2000;

/**
 * Longest story/chapter/scene title kept, in code points (≤ 1000 UTF-16 units,
 * well under the manifest validator's LIMITS.stringFieldMaxLen). A longer one
 * is cut with "…"; a cut chapter/scene title's full text opens the scene's prose.
 */
export const MAX_IMPORT_TITLE_CHARS = 500;

const TITLES_SHORTENED_WARNING =
  'Some headings were too long to use as titles, so they were shortened. The full text is kept at the start of the scene.';
const STORY_TITLE_SHORTENED_WARNING = 'The book\'s title was too long, so it was shortened.';
const TOO_LARGE_ERROR = 'Part of this import is too large to save. Split the source into smaller files.';

/**
 * Why `plan` is too large to import, in plain words — or null. Checked at
 * preview time (importHubIpc) and again at commit.
 */
export function importPlanTooLargeError(plan: Pick<ImportPlan, 'story' | 'notes'>): string | null {
  if (plan.notes.length > IMPORT_MAX_NOTES) {
    return `This import has more than ${IMPORT_MAX_NOTES.toLocaleString('en-US')} notes. Import the folder in smaller parts.`;
  }
  const sceneTotal = (plan.story?.chapters ?? []).reduce((n, ch) => n + ch.scenes.length, 0);
  if (sceneTotal > IMPORT_MAX_SCENES) {
    return `This manuscript has more than ${IMPORT_MAX_SCENES.toLocaleString('en-US')} scenes. Split it into smaller files.`;
  }
  return null;
}

/** Top-level Notes Vault folder per entity type (v2 seed skeleton names). */
export const ENTITY_NOTE_FOLDERS: Readonly<Record<ImportEntityType, string>> = Object.freeze({
  character: 'Characters',
  location: 'Locations',
  faction: 'Factions',
  item: 'Items',
  // No Events/Concepts folder in the seed — Plot and Worldbuilding are the closest.
  event: 'Plot',
  concept: 'Worldbuilding',
});

export const IMPORTED_NOTES_DIR = 'Imported';
export const PLAN_NOTES_DIR = 'Plans';

const NO_VAULT_ERROR = 'Open or create a Mythos vault first (Settings → Vault & Files → New vault…).';
const MAX_SEGMENT_CHARS = 120;
// Filesystems cap a name at 255 bytes (ext4, APFS) — a 120-character CJK or
// emoji title is ~360. 200 leaves room for " (9999)" / " 9999" + ".md".
export const MAX_SEGMENT_BYTES = 200;
const MAX_FOLDER_DEPTH = 8;

// ─── Small helpers ───────────────────────────────────────────────────────────

function oneLine(s: string): string {
  return s.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** `s` cut to MAX_IMPORT_TITLE_CHARS code points (at a code-point boundary, ending "…"). */
export function capTitle(s: string): { title: string; cut: boolean } {
  // Code units ≥ code points, so a short string needs no split.
  if (s.length <= MAX_IMPORT_TITLE_CHARS) return { title: s, cut: false };
  // Only the head is split into code points (a title can be megabytes long).
  // Over 2× the cap in code units is always over the cap in code points.
  const head = Array.from(s.slice(0, MAX_IMPORT_TITLE_CHARS * 2));
  if (s.length <= MAX_IMPORT_TITLE_CHARS * 2 && head.length <= MAX_IMPORT_TITLE_CHARS) return { title: s, cut: false };
  return { title: `${head.slice(0, MAX_IMPORT_TITLE_CHARS - 1).join('').trimEnd()}…`, cut: true };
}

function byOrder<T extends { order: number }>(items: T[]): T[] {
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => a.item.order - b.item.order || a.i - b.i)
    .map((x) => x.item);
}

const RESERVED_WIN_NAME = /^(CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(\..*)?$/i;

/** Cut `s` to at most `maxBytes` UTF-8 bytes, at a code-point boundary. */
export function truncateUtf8(s: string, maxBytes: number): string {
  if (Buffer.byteLength(s, 'utf8') <= maxBytes) return s;
  let bytes = 0;
  let out = '';
  for (const cp of s) {
    const n = Buffer.byteLength(cp, 'utf8');
    if (bytes + n > maxBytes) break;
    bytes += n;
    out += cp;
  }
  return out;
}

/** One filesystem-safe path segment (no separators, reserved names, dots-only). */
export function safeSegment(raw: string, fallback: string): string {
  let s = sanitizeVaultName(oneLine(raw), '').replace(/^[.\s]+/, '');
  if ([...s].length > MAX_SEGMENT_CHARS) s = [...s].slice(0, MAX_SEGMENT_CHARS).join('').trimEnd();
  s = truncateUtf8(s, MAX_SEGMENT_BYTES);
  s = s.replace(/[.\s]+$/, '');
  if (!s) return fallback;
  const reserved = RESERVED_WIN_NAME.exec(s);
  if (reserved) s = `${reserved[1]}_${reserved[2] ?? ''}`;
  return s;
}

/** Source name without its importable extension ("My Book.docx" → "My Book"). */
function sourceStem(name: string): string {
  return name.replace(/\.(docx|html?|md|markdown|mdown|mkd|txt|text|rtf|epub|scrivx|scriv)$/i, '') || name;
}

/** True when `rel` resolves inside `root` (belt-and-braces over writeVaultFileAtomic). */
function insideRoot(root: string, rel: string): boolean {
  const abs = path.resolve(root, ...rel.split('/'));
  const r = path.relative(path.resolve(root), abs);
  return r !== '' && !r.startsWith('..') && !path.isAbsolute(r);
}

/**
 * The simple frontmatter parser (vault.ts parseFrontmatter) turns `[x]`,
 * `true`/`false` and numbers into non-strings, and the v2 scan then falls back
 * to the file name. Nudge such scene titles so they stay titles.
 */
function frontmatterSafeTitle(raw: string, fallback: string): string {
  let t = oneLine(raw) || fallback;
  if (t.startsWith('[') && t.endsWith(']')) t = `(${t.slice(1, -1)})`;
  if (t === 'true' || t === 'false') t = t[0].toUpperCase() + t.slice(1);
  else if (!isNaN(Number(t))) t = `${fallback.replace(/\s*\d+$/, '')} ${t}`.trim();
  return t;
}

/** YAML scalar that real YAML (Obsidian) and the app's parsers both read back. */
function fmScalar(value: string): string {
  const v = oneLine(value);
  // A ':' is plain-scalar safe unless a space or the end follows it (ISO dates stay bare).
  if (
    /^[A-Za-z0-9_./ :-]+$/.test(v) &&
    !/^[-.: ]|: |:$/.test(v) &&
    isNaN(Number(v)) &&
    v !== 'true' &&
    v !== 'false'
  ) {
    return v;
  }
  return JSON.stringify(v);
}

function fmTag(raw: string): string {
  return oneLine(raw).replace(/^#+/, '').replace(/\s+/g, '-');
}

const FM_KEY = /^[A-Za-z0-9_-]+$/;
const OWNED_NOTE_KEYS = new Set(['id', 'title', 'type', 'tags', 'imported', 'source']);

function renderNoteFile(fields: Array<[string, string | string[]]>, body: string): string {
  const lines = ['---'];
  for (const [key, value] of fields) {
    if (Array.isArray(value)) {
      lines.push(`${key}: [${value.map((v) => yamlInlineQuote(oneLine(v))).join(', ')}]`);
    } else {
      lines.push(`${key}: ${fmScalar(value)}`);
    }
  }
  lines.push('---', '');
  const text = body.replace(/\r\n/g, '\n').replace(/^\n+/, '');
  return `${lines.join('\n')}${text}${text.endsWith('\n') ? '' : '\n'}`;
}

/** Claims unique note paths within one notes root for one commit. */
class NotePathClaims {
  private readonly claimed = new Set<string>();
  constructor(private readonly root: string) {}

  claim(dir: string, stem: string): string {
    for (let n = 1; n < 10000; n++) {
      const name = n === 1 ? `${stem}.md` : `${stem} ${n}.md`;
      const rel = dir ? `${dir}/${name}` : name;
      const key = rel.toLowerCase();
      if (this.claimed.has(key)) continue;
      if (fs.existsSync(path.join(this.root, ...rel.split('/')))) continue;
      this.claimed.add(key);
      return rel;
    }
    throw new Error('Too many notes with the same name');
  }
}

// ─── Story: v2 layout ────────────────────────────────────────────────────────

interface WrittenStory {
  title: string;
  chapterCount: number;
  sceneCount: number;
  /** Story-vault-relative top folder created by this write (for rollback). */
  createdRel: string;
}

interface NormalizedChapter {
  title: string;
  scenes: Array<{ title: string; prose: string; synopsis?: string }>;
}

function normalizeChapters(chapters: ImportChapter[]): { chapters: NormalizedChapter[]; titlesCut: boolean } {
  let titlesCut = false;
  const out = byOrder(chapters).map((ch, ci) => {
    const chapterFull = oneLine(ch.title);
    const chapterTitle = capTitle(chapterFull);
    if (chapterTitle.cut) titlesCut = true;
    const scenes = byOrder(ch.scenes).map((sc: ImportScene, si) => {
      const sceneFull = oneLine(sc.title);
      const sceneTitle = capTitle(sceneFull);
      if (sceneTitle.cut) titlesCut = true;
      // A cut title's words open the scene, so none are lost: the chapter's
      // in its first scene, then the scene's own (once, when they match).
      const kept: string[] = [];
      if (si === 0 && chapterTitle.cut) kept.push(chapterFull);
      if (sceneTitle.cut && !kept.includes(sceneFull)) kept.push(sceneFull);
      const prose = sc.prose ?? '';
      const keptMd = kept.map((t) => inlinesToMarkdown([{ text: t }])).join('\n\n');
      return {
        title: frontmatterSafeTitle(sceneTitle.title, `Scene ${si + 1}`),
        prose: keptMd ? (prose.trim() ? `${keptMd}\n\n${prose}` : keptMd) : prose,
        ...(sc.synopsis && oneLine(sc.synopsis) ? { synopsis: oneLine(sc.synopsis) } : {}),
      };
    });
    const keptChapter = chapterTitle.cut && scenes.length === 0 ? inlinesToMarkdown([{ text: chapterFull }]) : '';
    return {
      title: chapterTitle.title || `Chapter ${ci + 1}`,
      // An empty chapter still needs a scene file, or the scan can't see its folder.
      scenes: scenes.length > 0 ? scenes : [{ title: 'Scene 1', prose: keptChapter }],
    };
  });
  return { chapters: out, titlesCut };
}

function uniqueV2Folder(storyVaultRoot: string, manifest: Manifest, title: string): string {
  const taken = new Set<string>();
  for (const s of manifest.stories ?? []) {
    const first = (s.path ?? '').split(/[\\/]/).filter(Boolean)[0];
    if (first) taken.add(first.toLowerCase());
  }
  const base = safeSegment(storyFolderName(title), 'Untitled Story');
  let candidate = base;
  let n = 2;
  while (taken.has(candidate.toLowerCase()) || fs.existsSync(path.join(storyVaultRoot, candidate))) {
    candidate = `${base} (${n++})`;
  }
  return candidate;
}

function writeV2Story(
  storyVaultRoot: string,
  manifest: Manifest,
  title: string,
  chapters: NormalizedChapter[],
  nowIso: string,
): { entry: StoryEntry; written: WrittenStory } {
  const folder = uniqueV2Folder(storyVaultRoot, manifest, title);
  const written: WrittenStory = { title, chapterCount: 0, sceneCount: 0, createdRel: folder };
  const storyId = crypto.randomUUID();
  const partDir = partDirName(1);
  const spine: BookSpineChapter[] = [];
  const chapterEntries: ChapterEntry[] = [];
  try {
    chapters.forEach((ch, ci) => {
      const chapterDir = chapterDirName(ci + 1);
      const chapterRel = `${folder}/${partDir}/${chapterDir}`;
      const chapterId = crypto.randomUUID();
      const scenes: SceneEntry[] = ch.scenes.map((sc, si) => {
        const fileName = sceneFileName(si + 1);
        const rel = `${chapterRel}/${fileName}`;
        if (!insideRoot(storyVaultRoot, rel)) throw new Error('Refusing to write outside the Story Vault');
        const content = serializeV2SceneFile({
          id: crypto.randomUUID(),
          title: sc.title,
          status: sc.prose.trim() ? 'draft' : 'todo',
          updatedAt: nowIso,
          ...(sc.synopsis ? { extraFrontmatter: { synopsis: sc.synopsis } } : {}),
          prose: sc.prose,
        });
        writeVaultFileAtomic(storyVaultRoot, rel, content);
        written.sceneCount++;
        // Read back through the scan's own codec so the cache entry matches
        // what a rebuild would derive from this file, field for field.
        const parsed = parseV2SceneFile(content, fileName);
        const updatedAt = parsed.updatedAt ?? nowIso;
        const draftState = statusToDraftState(parsed.status);
        return {
          id: parsed.id,
          title: parsed.title,
          path: rel,
          order: si,
          chapterId,
          storyId,
          blocks: [
            { id: `block-${parsed.id}`, type: 'prose', order: 0, content: parsed.prose, updatedAt },
          ],
          ...(draftState ? { draftState } : {}),
          createdAt: updatedAt,
          updatedAt,
        };
      });
      spine.push({ dir: chapterDir, id: chapterId, title: ch.title });
      chapterEntries.push({
        id: chapterId,
        title: ch.title,
        path: chapterRel,
        order: ci,
        scenes,
        createdAt: nowIso,
        updatedAt: nowIso,
      });
      written.chapterCount++;
    });
    // book.md last: until it exists the folder is never adopted as a story.
    const book: BookFile = {
      id: storyId,
      title,
      createdAt: nowIso,
      updatedAt: nowIso,
      spine: [{ dir: partDir, chapters: spine }],
    };
    writeVaultFileAtomic(storyVaultRoot, `${folder}/${BOOK_FILENAME}`, serializeBookFile(book));
  } catch (err) {
    rollback(storyVaultRoot, folder);
    throw err;
  }
  return {
    entry: { id: storyId, title, path: folder, chapters: chapterEntries, createdAt: nowIso, updatedAt: nowIso },
    written,
  };
}

// ─── Story: legacy layout ────────────────────────────────────────────────────

function writeLegacyStory(
  vaultRoot: string,
  title: string,
  chapters: NormalizedChapter[],
  nowIso: string,
): { entry: StoryEntry; written: WrittenStory } {
  // Collision-suffix the story folder too, so a second import of one title
  // doesn't merge into the first story's chapter folders.
  const storyDir = resolveSlugCollision(vaultRoot, MANUSCRIPT_DIR, toSlug(truncateUtf8(title, MAX_SEGMENT_BYTES)));
  const written: WrittenStory = { title, chapterCount: 0, sceneCount: 0, createdRel: storyDir };
  const storyId = crypto.randomUUID();
  const chapterEntries: ChapterEntry[] = [];
  try {
    chapters.forEach((ch, ci) => {
      const chapterId = crypto.randomUUID();
      const chapterDir = resolveSlugCollision(vaultRoot, storyDir, toSlug(truncateUtf8(ch.title, MAX_SEGMENT_BYTES)));
      const scenes: SceneEntry[] = ch.scenes.map((sc, si) => {
        const sceneId = crypto.randomUUID();
        // The slug (file name) comes from the title; the title itself is kept whole.
        const scenePath = sceneVaultPath(vaultRoot, chapterDir, truncateUtf8(sc.title, MAX_SEGMENT_BYTES));
        if (!insideRoot(vaultRoot, scenePath)) throw new Error('Refusing to write outside the vault');
        writeSceneFile(vaultRoot, scenePath, {
          id: sceneId,
          title: sc.title,
          chapterId,
          storyId,
          order: si,
          prose: sc.prose,
        });
        written.sceneCount++;
        return {
          id: sceneId,
          title: sc.title,
          path: scenePath,
          order: si,
          chapterId,
          storyId,
          blocks: [],
          draftState: 'in-progress' as const,
          createdAt: nowIso,
          updatedAt: nowIso,
        };
      });
      chapterEntries.push({
        id: chapterId,
        title: ch.title,
        path: chapterDir,
        order: ci,
        scenes,
        createdAt: nowIso,
        updatedAt: nowIso,
      });
      written.chapterCount++;
    });
  } catch (err) {
    rollback(vaultRoot, storyDir);
    throw err;
  }
  return {
    entry: { id: storyId, title, path: storyDir, chapters: chapterEntries, createdAt: nowIso, updatedAt: nowIso },
    written,
  };
}

/** Best-effort removal of a folder this commit created. */
function rollback(root: string, rel: string): void {
  if (!rel || !insideRoot(root, rel)) return;
  try {
    fs.rmSync(path.join(root, ...rel.split('/')), { recursive: true, force: true });
  } catch {
    /* leave it — the writer can delete it by hand */
  }
}

// ─── Notes ───────────────────────────────────────────────────────────────────

function carriedFrontmatter(fm: ImportNote['frontmatter']): { fields: Array<[string, string | string[]]>; tags: string[] } {
  const fields: Array<[string, string | string[]]> = [];
  const tags: string[] = [];
  for (const [key, value] of Object.entries(fm ?? {})) {
    if (!FM_KEY.test(key)) continue;
    const lower = key.toLowerCase();
    if (lower === 'tags' || lower === 'tag') {
      const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,\s]+/) : [];
      for (const t of list) if (typeof t === 'string' && fmTag(t)) tags.push(fmTag(t));
      continue;
    }
    if (OWNED_NOTE_KEYS.has(lower)) continue;
    if (typeof value === 'string') {
      if (oneLine(value)) fields.push([key, value]);
    } else if (Array.isArray(value)) {
      const items = value.filter((v): v is string => typeof v === 'string' && oneLine(v) !== '');
      if (items.length > 0) fields.push([key, items]);
    }
  }
  return { fields, tags };
}

function noteFolderSegments(folder: string): string[] {
  return folder
    .split(/[\\/]/)
    .filter((s) => s.trim() && s.trim() !== '.' && s.trim() !== '..')
    .slice(0, MAX_FOLDER_DEPTH)
    .map((s) => safeSegment(s, 'Folder'));
}

function buildPlanNote(
  plan: ImportPlan,
  title: string,
  chapters: NormalizedChapter[],
  partCount: number,
  nowIso: string,
): string {
  const label = SOURCE_LABELS[plan.source.kind];
  const sceneCount = chapters.reduce((n, ch) => n + ch.scenes.length, 0);
  // Same shape as storyImport.ts buildStoryPlanNote (crafterState + timeline
  // read these), but labelled with the import hub's source kinds.
  const lines: string[] = [
    '---',
    `id: ${crypto.randomUUID()}`,
    `title: ${JSON.stringify(`Plan — ${title}`)}`,
    'type: story-plan',
    `imported: ${nowIso}`,
    `source: ${JSON.stringify(`${label} · ${plan.source.name}`)}`,
    'tags:',
    '  - story-plan',
    '  - imported',
    '---',
    '',
    `# Plan — ${title}`,
    '',
    `Imported from ${label}. The manuscript was mapped to `
      + `${partCount > 0 ? `${partCount} part(s), ` : ''}${chapters.length} chapter(s) and ${sceneCount} scene(s).`,
    '',
    '## Structure',
    '',
  ];
  for (const ch of chapters) {
    lines.push(`- **${ch.title}** (${ch.scenes.length} scene${ch.scenes.length === 1 ? '' : 's'})`);
    for (const sc of ch.scenes) {
      const words = countWords(sc.prose);
      lines.push(`  - [ ] ${sc.title}${words > 0 ? ` — ${words.toLocaleString('en-US')} words` : ''}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

// ─── Commit ──────────────────────────────────────────────────────────────────

function plainError(err: unknown): string {
  const msg = err instanceof Error ? err.message : '';
  if (/too large/i.test(msg)) return TOO_LARGE_ERROR;
  if (/symlink|refus/i.test(msg)) return 'Mythos won\'t write through a linked folder inside your vault. Remove the link and try again.';
  if (/EACCES|EPERM|read-only|EROFS/i.test(msg)) return 'Mythos isn\'t allowed to write to your vault folder. Check its permissions.';
  if (/ENOSPC/i.test(msg)) return 'Your disk is full. Free some space and try again.';
  return 'Mythos couldn\'t save the imported story. Nothing was added.';
}

/**
 * Write a previewed plan into the open vault. Story first; if it fails nothing
 * else is written. A failing note is skipped with a warning.
 */
export async function commitImportPlan(
  plan: ImportPlan,
  deps: ImportCommitDeps,
  options: ImportCommitOptions = {},
): Promise<ImportCommitResult> {
  const tooLarge = importPlanTooLargeError(plan);
  if (tooLarge) return { ok: false, error: tooLarge };
  const wantStory = options.story !== false && plan.story !== null;
  const wantNotes = options.notes !== false && plan.notes.length > 0;
  if (!wantStory && !wantNotes) return { ok: false, error: 'There is nothing selected to import.' };

  try {
    await deps.flushRenderer();
  } catch {
    return { ok: false, error: 'Mythos couldn\'t save your open work before importing. Try again.' };
  }

  const nowIso = (deps.now?.() ?? new Date()).toISOString();
  const warnings: string[] = [];
  let story: WrittenStory | null = null;
  let normalized: NormalizedChapter[] = [];

  if (wantStory && plan.story) {
    const storyVaultRoot = deps.getStoryVaultRoot();
    if (!storyVaultRoot) return { ok: false, error: NO_VAULT_ERROR };
    const storyTitle = capTitle(oneLine(plan.story.title) || sourceStem(plan.source.name) || 'Untitled Story');
    const title = storyTitle.title;
    const norm = normalizeChapters(plan.story.chapters);
    normalized = norm.chapters;
    if (storyTitle.cut) warnings.push(STORY_TITLE_SHORTENED_WARNING);
    if (norm.titlesCut) warnings.push(TITLES_SHORTENED_WARNING);
    try {
      const manifestPath = deps.getManifestPath();
      const manifest = deps.readManifest(manifestPath);
      const isV2 = deps.isV2StoryVault(storyVaultRoot);
      const { entry, written } = isV2
        ? writeV2Story(storyVaultRoot, manifest, title, normalized, nowIso)
        : writeLegacyStory(storyVaultRoot, title, normalized, nowIso);
      manifest.stories = [...(manifest.stories ?? []), entry];
      try {
        // Every later renderer save validates the whole manifest: never write
        // one that would fail it (an over-long field would block all saves).
        try {
          assertValidManifest(manifest);
        } catch {
          throw new Error(TOO_LARGE_ERROR);
        }
        deps.writeManifest(manifestPath, manifest);
      } catch (err) {
        rollback(storyVaultRoot, written.createdRel);
        throw err;
      }
      story = written;
    } catch (err) {
      return { ok: false, error: plainError(err) };
    }
  }

  const noteRels: string[] = [];
  let noteCount = 0;
  let entityCount = 0;
  let planNotePath: string | undefined;
  const needNotesRoot = wantNotes || story !== null;
  let notesRoot: string | null = null;
  if (needNotesRoot) {
    try {
      deps.ensureNotesVaultDir();
      notesRoot = deps.getNotesVaultRoot();
    } catch {
      notesRoot = null;
    }
    if (!notesRoot) {
      if (!story) return { ok: false, error: 'No Notes Vault is open to import notes into.' };
      warnings.push('No Notes Vault is open, so notes and the Story Plan note were skipped.');
    }
  }

  if (notesRoot) {
    const claims = new NotePathClaims(notesRoot);
    const sourceLabel = `${SOURCE_LABELS[plan.source.kind]} · ${plan.source.name}`;
    const sourceDir = `${IMPORTED_NOTES_DIR}/${safeSegment(sourceStem(plan.source.name), 'Import')}`;

    if (story && plan.story) {
      try {
        const rel = claims.claim(PLAN_NOTES_DIR, safeSegment(planNoteFileName(story.title).replace(/\.md$/, ''), 'Plan'));
        writeVaultFileAtomic(notesRoot, rel, buildPlanNote(plan, story.title, normalized, plan.story.partCount, nowIso));
        noteRels.push(rel);
        planNotePath = rel;
      } catch {
        warnings.push('The Story Plan note couldn\'t be written.');
      }
    }

    if (wantNotes) {
      for (const note of plan.notes) {
        const title = oneLine(note.title) || 'Untitled';
        try {
          const dir = note.entityType
            ? ENTITY_NOTE_FOLDERS[note.entityType]
            : [sourceDir, ...noteFolderSegments(note.folder)].join('/');
          if (!dir) throw new Error('unknown entity type');
          const rel = claims.claim(dir, safeSegment(title, 'Untitled'));
          if (!insideRoot(notesRoot, rel)) throw new Error('outside notes vault');
          const carried = carriedFrontmatter(note.frontmatter);
          const tags = [...new Set(['imported', ...carried.tags])];
          const fields: Array<[string, string | string[]]> = [
            ['id', crypto.randomUUID()],
            ['title', title],
            ...(note.entityType ? [['type', note.entityType] as [string, string]] : []),
            ['tags', tags],
            ['imported', nowIso],
            ['source', sourceLabel],
            ...carried.fields,
          ];
          writeVaultFileAtomic(notesRoot, rel, renderNoteFile(fields, note.body ?? ''));
          noteRels.push(rel);
          if (note.entityType) entityCount++;
          else noteCount++;
        } catch {
          warnings.push(`The note "${title}" couldn't be written and was skipped.`);
        }
      }
    }
  }

  if (noteRels.length > 0) deps.notifyNotesWritten(noteRels);
  if (story) deps.notifyStoriesChanged();

  return {
    ok: true,
    ...(story ? { storyTitle: story.title } : {}),
    chapterCount: story?.chapterCount ?? 0,
    sceneCount: story?.sceneCount ?? 0,
    noteCount,
    entityCount,
    ...(planNotePath ? { planNotePath } : {}),
    warnings,
  };
}
