// Beta 3 "Liquid Neon" M24 — Import a story (Settings → Vault & Files).
// docs/releases/BETA-LIQUID-NEON.md §M24: docx / Google-Docs export / Markdown /
// Scrivener / ePub → headings map to parts, chapters and scenes; a Story Plan
// note is created in the Notes Vault.
//
// Pure parsing/conversion helpers — no Electron imports. The IPC handler in
// main.ts wires these to the vault writer (storyImportWriter.ts).
//
// Heading convention (extends docxImporter's H1=chapter / H2=scene):
//   - documents using three levels (H1+H2+H3) → H1 = part, H2 = chapter,
//     H3 = scene. Parts fold into chapter titles ("Part One · The Gate")
//     because the vault storage model is stories → chapters → scenes.
//   - two levels or fewer → the existing splitDocxMarkdown behavior.

import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';
import mammoth from 'mammoth';
import { splitDocxMarkdown, type DocxChapter } from './docxImporter.js';

export type StoryImportFormat = 'docx' | 'gdoc' | 'md' | 'scriv' | 'epub';

/** Absolute cap before parsing (matches docxImporter's DOCX_MAX_BYTES). */
export const STORY_IMPORT_MAX_BYTES = 50 * 1024 * 1024; // 50 MB

/** File-picker filters per source format (used by the story:import-pick dialog). */
export const STORY_IMPORT_FILTERS: Record<StoryImportFormat, { name: string; extensions: string[] }> = {
  docx: { name: 'Word document', extensions: ['docx'] },
  gdoc: { name: 'Google Docs export (.docx / .html)', extensions: ['docx', 'html', 'htm'] },
  md: { name: 'Markdown', extensions: ['md', 'markdown', 'txt'] },
  scriv: { name: 'Scrivener project (.scrivx)', extensions: ['scrivx', 'scriv'] },
  epub: { name: 'ePub', extensions: ['epub'] },
};

// ─── HTML → splittable markdown (h1/h2/h3 aware) ─────────────────────────────

const HTML_ENTITIES: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
  '&apos;': "'", '&nbsp;': ' ', '&#160;': ' ', '&rsquo;': '’',
  '&lsquo;': '‘', '&rdquo;': '”', '&ldquo;': '“',
  '&mdash;': '—', '&ndash;': '–', '&hellip;': '…',
};

export function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&[a-z]+;/gi, (m) => HTML_ENTITIES[m.toLowerCase()] ?? m);
}

function stripTags(s: string): string {
  return decodeHtmlEntities(s.replace(/<[^>]+>/g, ' ')).replace(/[ \t]{2,}/g, ' ').trim();
}

/**
 * Convert HTML (mammoth output, Google Docs export, ePub xhtml) to a simple
 * line format `splitStoryMarkdown` can parse. Handles h1–h3; deeper headings
 * and everything else become prose lines.
 */
export function htmlToStoryMarkdown(html: string): string {
  return html
    .replace(/<(script|style|head)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, t: string) => `\n# ${stripTags(t)}\n`)
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, t: string) => `\n## ${stripTags(t)}\n`)
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, t: string) => `\n### ${stripTags(t)}\n`)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|blockquote|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .split('\n')
    .map((line) => (
      /^#{1,3} /.test(line) ? line : decodeHtmlEntities(line).replace(/[ \t]{2,}/g, ' ').trim()
    ))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Convert a .docx buffer (Word, or a Google Docs "Download → .docx" export)
 * to splittable markdown via mammoth. Unlike docxImporter.parseDocxBuffer this
 * keeps h3 headings so three-level documents map to parts/chapters/scenes.
 */
export async function docxToStoryMarkdown(buffer: Buffer): Promise<{ markdown: string; warnings: string[] }> {
  if (buffer.length > STORY_IMPORT_MAX_BYTES) {
    const mb = (buffer.length / 1024 / 1024).toFixed(1);
    throw new Error(`File exceeds the 50 MB size limit (${mb} MB)`);
  }
  let result: Awaited<ReturnType<typeof mammoth.convertToHtml>>;
  try {
    result = await mammoth.convertToHtml({ buffer });
  } catch (err) {
    throw new Error(`Failed to parse .docx: ${err instanceof Error ? err.message : String(err)}`);
  }
  const warnings = result.messages.filter((m) => m.type === 'warning').map((m) => m.message);
  return { markdown: htmlToStoryMarkdown(result.value), warnings };
}

// ─── Markdown source normalization ────────────────────────────────────────────

/** Strip a leading YAML frontmatter block and normalize newlines. */
export function mdToStoryMarkdown(raw: string): string {
  const normalized = raw.replace(/\r\n/g, '\n');
  const fm = /^---\n[\s\S]*?\n---\n?/.exec(normalized);
  return (fm ? normalized.slice(fm[0].length) : normalized).trim();
}

// ─── Heading-level detection + 3-level split ─────────────────────────────────

export interface StorySplit {
  title: string;
  chapters: DocxChapter[];
  /** Number of H1 part headings folded into chapter titles (0 = no parts). */
  partCount: number;
}

/**
 * Split markdown into chapters/scenes, mapping parts when three heading
 * levels are present. Delegates 1–2-level documents to splitDocxMarkdown.
 */
export function splitStoryMarkdown(
  markdown: string,
  fallbackTitle = 'Untitled',
  titleIsAuthoritative = false,
): StorySplit {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const has = (re: RegExp) => lines.some((l) => re.test(l));
  const h1 = has(/^# /);
  const h2 = has(/^## /);
  const h3 = has(/^### /);

  if (h1 && h2 && h3) {
    // Three levels: H1 = part, H2 = chapter, H3 = scene.
    let part = '';
    let partCount = 0;
    const out: string[] = [];
    for (const line of lines) {
      if (line.startsWith('# ')) {
        part = line.slice(2).trim();
        partCount++;
      } else if (line.startsWith('## ')) {
        const chapter = line.slice(3).trim();
        out.push(part ? `# ${part} · ${chapter}` : `# ${chapter}`);
      } else if (line.startsWith('### ')) {
        out.push(`## ${line.slice(4).trim()}`);
      } else {
        out.push(line);
      }
    }
    const split = splitDocxMarkdown(out.join('\n'), fallbackTitle);
    return { title: fallbackTitle, chapters: split.chapters, partCount };
  }

  // Demote so the two used levels land on H1/H2 for splitDocxMarkdown.
  let demoted = lines;
  if (h3 && !h2) {
    // H1+H3 (chapters + scenes) or H3-only (scenes with an implicit chapter).
    demoted = lines.map((l) => (l.startsWith('### ') ? `## ${l.slice(4)}` : l));
  } else if (h3 && h2 && !h1) {
    // H2+H3: chapters at H2, scenes at H3.
    demoted = lines.map((l) => {
      if (l.startsWith('## ')) return `# ${l.slice(3)}`;
      if (l.startsWith('### ')) return `## ${l.slice(4)}`;
      return l;
    });
  }
  const split = splitDocxMarkdown(demoted.join('\n'), fallbackTitle);
  // A source with a real external title (ePub dc:title, a Scrivener project
  // name) keeps it — the first chapter heading is not the book title. Only
  // formats with no metadata title (docx/md/gdoc, fallbackTitle = filename)
  // fall back to "first heading wins".
  return { title: titleIsAuthoritative ? fallbackTitle : split.title, chapters: split.chapters, partCount: 0 };
}

// ─── ePub ─────────────────────────────────────────────────────────────────────

export interface EpubParseResult {
  markdown: string;
  /** dc:title from the OPF metadata when present. */
  title?: string;
  warnings: string[];
}

/** Extract the OPF spine reading order and convert each document to markdown. */
export async function epubToStoryMarkdown(buffer: Buffer): Promise<EpubParseResult> {
  const warnings: string[] = [];
  const zip = await JSZip.loadAsync(buffer);

  // 1) Locate the OPF (container.xml → full-path, else first *.opf entry).
  let opfPath: string | undefined;
  const container = zip.file('META-INF/container.xml');
  if (container) {
    const containerXml = await container.async('string');
    opfPath = /full-path="([^"]+)"/.exec(containerXml)?.[1];
  }
  if (!opfPath) {
    opfPath = Object.keys(zip.files).find((f) => f.toLowerCase().endsWith('.opf'));
    if (opfPath) warnings.push('No META-INF/container.xml — used the first .opf found');
  }
  const opfFile = opfPath ? zip.file(opfPath) : null;
  if (!opfPath || !opfFile) {
    throw new Error('Not a valid ePub: no OPF package document found');
  }
  const opf = await opfFile.async('string');
  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';

  // 2) Manifest id → href, spine order.
  const items = new Map<string, string>();
  for (const m of opf.matchAll(/<item\b[^>]*>/g)) {
    const tag = m[0];
    const id = /\bid="([^"]+)"/.exec(tag)?.[1];
    const href = /\bhref="([^"]+)"/.exec(tag)?.[1];
    if (id && href) items.set(id, href);
  }
  const spine = [...opf.matchAll(/<itemref\b[^>]*\bidref="([^"]+)"/g)].map((m) => m[1]);

  const title = /<dc:title[^>]*>([\s\S]*?)<\/dc:title>/.exec(opf)?.[1];

  // 3) Read each spine document in order.
  const parts: string[] = [];
  for (const idref of spine) {
    const href = items.get(idref);
    if (!href) continue;
    if (!/\.(x?html?|xml)$/i.test(href)) continue;
    const entryPath = decodeURIComponent(opfDir + href).replace(/\/{2,}/g, '/');
    const entry = zip.file(entryPath) ?? zip.file(decodeURIComponent(href));
    if (!entry) {
      warnings.push(`Spine document missing from archive: ${href}`);
      continue;
    }
    const html = await entry.async('string');
    const md = htmlToStoryMarkdown(html);
    if (md) parts.push(md);
  }
  if (parts.length === 0) {
    throw new Error('ePub spine contained no readable documents');
  }
  return {
    markdown: parts.join('\n\n'),
    title: title ? stripTags(title) : undefined,
    warnings,
  };
}

// ─── RTF → plain text (Scrivener content.rtf) ────────────────────────────────

const RTF_SKIP_DESTINATIONS = new Set([
  'fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'themedata', 'generator',
  'listtable', 'listoverridetable', 'latentstyles', 'datastore', 'header',
  'footer', 'xmlnstbl', 'rsidtbl', 'operator', 'wgrffmtfilter',
]);

/** Minimal RTF-to-text conversion: control words dropped, \par → newline. */
export function rtfToText(rtf: string): string {
  let out = '';
  const stack: boolean[] = [];
  let skipping = false;
  let i = 0;
  const n = rtf.length;

  while (i < n) {
    const ch = rtf[i];
    if (ch === '{') {
      stack.push(skipping);
      i++;
      // `{\*\dest …}` and known metadata destinations are skipped entirely.
      const rest = rtf.slice(i, i + 40);
      const star = /^\\\*/.exec(rest);
      const word = /^\\([a-z]+)/i.exec(rest);
      if (star || (word && RTF_SKIP_DESTINATIONS.has(word[1].toLowerCase()))) {
        skipping = true;
      }
      continue;
    }
    if (ch === '}') {
      skipping = stack.length > 0 ? (stack.pop() as boolean) : false;
      i++;
      continue;
    }
    if (ch === '\\') {
      const next = rtf[i + 1];
      if (next === '\\' || next === '{' || next === '}') {
        if (!skipping) out += next;
        i += 2;
        continue;
      }
      if (next === '~') { if (!skipping) out += ' '; i += 2; continue; }
      if (next === "'") {
        const hex = rtf.slice(i + 2, i + 4);
        if (!skipping && /^[0-9a-f]{2}$/i.test(hex)) out += String.fromCharCode(parseInt(hex, 16));
        i += 4;
        continue;
      }
      const ctrl = /^\\([a-z]+)(-?\d+)? ?/i.exec(rtf.slice(i, i + 32));
      if (ctrl) {
        const word = ctrl[1].toLowerCase();
        if (!skipping) {
          if (word === 'par' || word === 'line') out += '\n';
          else if (word === 'tab') out += ' ';
          else if (word === 'u' && ctrl[2]) {
            const code = ((parseInt(ctrl[2], 10) % 65536) + 65536) % 65536;
            out += String.fromCharCode(code);
            // Skip the single fallback character that follows \uN.
            i += ctrl[0].length;
            if (rtf[i] === '?') i++;
            continue;
          }
        }
        i += ctrl[0].length;
        continue;
      }
      i += 2; // unknown control symbol — drop it
      continue;
    }
    if (ch === '\r' || ch === '\n') { i++; continue; } // raw newlines are not text in RTF
    if (!skipping) out += ch;
    i++;
  }

  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ─── Scrivener binder ─────────────────────────────────────────────────────────

export interface ScrivBinderItem {
  uuid: string;
  type: string;
  title: string;
  children: ScrivBinderItem[];
}

/** Parse the `<Binder>` tree out of a .scrivx project file (Scrivener 3). */
export function parseScrivxBinder(xml: string): ScrivBinderItem[] {
  const roots: ScrivBinderItem[] = [];
  const stack: ScrivBinderItem[] = [];
  const re = /<BinderItem\b([^>]*?)(\/)?>|<\/BinderItem>|<Title>([\s\S]*?)<\/Title>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    if (m[0].startsWith('</BinderItem')) {
      stack.pop();
      continue;
    }
    if (m[0].startsWith('<BinderItem')) {
      const attrs = m[1] ?? '';
      const item: ScrivBinderItem = {
        uuid: /\b(?:UUID|ID)="([^"]+)"/.exec(attrs)?.[1] ?? '',
        type: /\bType="([^"]+)"/.exec(attrs)?.[1] ?? '',
        title: '',
        children: [],
      };
      (stack.length > 0 ? stack[stack.length - 1].children : roots).push(item);
      if (!m[2]) stack.push(item); // not self-closing
      continue;
    }
    // <Title> — belongs to the innermost open BinderItem (first Title wins).
    if (stack.length > 0 && !stack[stack.length - 1].title) {
      stack[stack.length - 1].title = decodeHtmlEntities(m[3] ?? '').trim();
    }
  }
  return roots;
}

export interface ScrivParseResult {
  markdown: string;
  title: string;
  warnings: string[];
}

/**
 * Convert a Scrivener 3 project into splittable markdown.
 * `inputPath` is the .scrivx file or the .scriv project folder.
 * Draft-folder children: folders → chapters (#), text documents → scenes (##).
 */
export function scrivToStoryMarkdown(inputPath: string): ScrivParseResult {
  const warnings: string[] = [];

  let projDir: string;
  let scrivxPath: string | undefined;
  const stat = fs.statSync(inputPath);
  if (stat.isDirectory()) {
    projDir = inputPath;
    scrivxPath = fs.readdirSync(projDir).filter((f) => f.toLowerCase().endsWith('.scrivx'))
      .map((f) => path.join(projDir, f))[0];
  } else {
    projDir = path.dirname(inputPath);
    scrivxPath = inputPath.toLowerCase().endsWith('.scrivx') ? inputPath : undefined;
  }
  const title = path.basename(projDir).replace(/\.scriv$/i, '') || 'Imported Story';

  const readDoc = (uuid: string): string => {
    if (!uuid) return '';
    const rtfPath = path.join(projDir, 'Files', 'Data', uuid, 'content.rtf');
    try {
      return rtfToText(fs.readFileSync(rtfPath, 'utf-8'));
    } catch {
      return '';
    }
  };

  if (!scrivxPath || !fs.existsSync(scrivxPath)) {
    // No binder — import every content.rtf in stable order as scenes.
    warnings.push('No .scrivx binder found — imported all RTF documents in folder order');
    const dataDir = path.join(projDir, 'Files', 'Data');
    const out: string[] = [];
    if (fs.existsSync(dataDir)) {
      for (const uuid of fs.readdirSync(dataDir).sort()) {
        const text = readDoc(uuid);
        if (text) out.push(`## Scene ${out.length + 1}\n${text}`);
      }
    }
    if (out.length === 0) throw new Error('No Scrivener documents found in this project');
    return { markdown: out.join('\n\n'), title, warnings };
  }

  const binder = parseScrivxBinder(fs.readFileSync(scrivxPath, 'utf-8'));
  const draft = binder.find((b) => b.type === 'DraftFolder')
    ?? binder.find((b) => /^(draft|manuscript)$/i.test(b.title));
  const rootItems = draft ? draft.children : binder;
  if (!draft) warnings.push('No Draft folder in the binder — imported the whole binder');

  const out: string[] = [];
  let missing = 0;

  const emitScenes = (items: ScrivBinderItem[]) => {
    for (const item of items) {
      if (item.type === 'Text') {
        const text = readDoc(item.uuid);
        if (!text) missing++;
        out.push(`## ${item.title || 'Untitled scene'}\n${text}`);
      }
      if (item.children.length > 0) emitScenes(item.children);
    }
  };

  for (const item of rootItems) {
    if (item.type === 'Text') {
      const text = readDoc(item.uuid);
      if (!text) missing++;
      out.push(`## ${item.title || 'Untitled scene'}\n${text}`);
    } else {
      out.push(`# ${item.title || 'Untitled chapter'}`);
      emitScenes(item.children);
    }
  }

  if (missing > 0) warnings.push(`${missing} document(s) had no readable content.rtf`);
  if (out.length === 0) throw new Error('The Scrivener binder contained no documents');
  return { markdown: out.join('\n\n'), title, warnings };
}

// ─── Story Plan note ──────────────────────────────────────────────────────────

export const STORY_IMPORT_FORMAT_LABELS: Record<StoryImportFormat, string> = {
  docx: 'Word (.docx)',
  gdoc: 'Google Docs export',
  md: 'Markdown',
  scriv: 'Scrivener',
  epub: 'ePub',
};

export interface StoryPlanNoteOptions {
  id: string;
  title: string;
  format: StoryImportFormat;
  sourceFile: string;
  importedAt: string; // ISO
  chapters: DocxChapter[];
  partCount: number;
}

/**
 * Build the Story Plan note written to the Notes Vault (`Plans/` folder — the
 * Scene Crafter + timeline read plan notes from there, see crafterState.ts).
 */
export function buildStoryPlanNote(opts: StoryPlanNoteOptions): string {
  const sceneCount = opts.chapters.reduce((acc, ch) => acc + ch.scenes.length, 0);
  const lines: string[] = [
    '---',
    `id: ${opts.id}`,
    `title: ${JSON.stringify(`Plan — ${opts.title}`)}`,
    'type: story-plan',
    `imported: ${opts.importedAt}`,
    `source: ${JSON.stringify(`${STORY_IMPORT_FORMAT_LABELS[opts.format]} · ${path.basename(opts.sourceFile)}`)}`,
    'tags:',
    '  - story-plan',
    '  - imported',
    '---',
    '',
    `# Plan — ${opts.title}`,
    '',
    `Imported from ${STORY_IMPORT_FORMAT_LABELS[opts.format]}. Headings were mapped to `
      + `${opts.partCount > 0 ? `${opts.partCount} part(s), ` : ''}${opts.chapters.length} chapter(s) and ${sceneCount} scene(s).`,
    '',
    '## Structure',
    '',
  ];
  for (const ch of opts.chapters) {
    lines.push(`- **${ch.title}** (${ch.scenes.length} scene${ch.scenes.length === 1 ? '' : 's'})`);
    for (const sc of ch.scenes) {
      const words = sc.prose ? sc.prose.split(/\s+/).filter(Boolean).length : 0;
      lines.push(`  - [ ] ${sc.title}${words > 0 ? ` — ${words.toLocaleString()} words` : ''}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

/** Sanitize a story title into a safe note filename fragment. */
export function planNoteFileName(title: string): string {
  const safe = title.replace(/[\\/:*?"<>|#^[\]{}]/g, ' ').replace(/\s+/g, ' ').trim() || 'Imported Story';
  return `Plan — ${safe}.md`;
}
