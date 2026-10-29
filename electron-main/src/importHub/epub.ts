// #1765 — ePub → RichBlocks.
//
// container.xml → OPF package → spine order; each XHTML spine document goes
// through the shared htmlToBlocks walker and the documents are joined with a
// pageBreak (a spine boundary is where an ePub starts a new page, so the
// segmenter can treat it as a chapter boundary). dc:title is the book title.
//
// Archive reads are capped (entry count, total inflated bytes) so a zip bomb
// renamed .epub can't exhaust memory: entries are inflated as a stream and
// abandoned the moment the budget runs out.
//
// Pure — no Electron, no fs.

import path from 'node:path';
import JSZip from 'jszip';
import { segmentBlocks, type RichBlock } from './blocks.js';
import { decodeEntities, htmlToBlocks } from './htmlBlocks.js';
import type { ImportStory } from './types.js';
import { ImportUserError } from './importErrors.js';

export const EPUB_MAX_ENTRIES = 5000;
export const EPUB_MAX_INFLATED_BYTES = 200 * 1024 * 1024; // 200 MB

const DAMAGED = 'This ePub file looks damaged or isn\'t really an ePub.';
const TOO_BIG = 'This ePub unpacks to far more data than a book should, so Mythos stopped reading it.';

/** JSZip's (untyped) streaming reader. */
interface StreamHelper {
  on(event: 'data', cb: (chunk: Uint8Array) => void): StreamHelper;
  on(event: 'end', cb: () => void): StreamHelper;
  on(event: 'error', cb: (err: Error) => void): StreamHelper;
  resume(): StreamHelper;
  pause(): StreamHelper;
}

class EntryReader {
  private used = 0;

  constructor(private readonly zip: JSZip, private readonly maxBytes: number) {}

  file(name: string): JSZip.JSZipObject | null {
    const f = this.zip.file(name);
    return f && !f.dir ? f : null;
  }

  /** Inflate one entry, failing once the archive-wide byte budget is spent. */
  async text(entry: JSZip.JSZipObject): Promise<string> {
    const declared = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
    if (typeof declared === 'number' && this.used + declared > this.maxBytes) throw new ImportUserError(TOO_BIG);
    const chunks: Uint8Array[] = [];
    await new Promise<void>((resolve, reject) => {
      const stream = (entry as unknown as { internalStream(type: 'uint8array'): StreamHelper }).internalStream('uint8array');
      let done = false;
      stream
        .on('data', (chunk) => {
          if (done) return;
          this.used += chunk.length;
          if (this.used > this.maxBytes) {
            done = true;
            stream.pause();
            reject(new ImportUserError(TOO_BIG));
            return;
          }
          chunks.push(chunk);
        })
        .on('error', (err) => {
          if (!done) { done = true; reject(err); }
        })
        .on('end', () => {
          if (!done) { done = true; resolve(); }
        })
        .resume();
    });
    return decodeBytes(Buffer.concat(chunks));
  }
}

function decodeBytes(buf: Buffer): string {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.subarray(2));
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf.subarray(2));
  return new TextDecoder('utf-8').decode(buf).replace(/^\ufeff/, '');
}

/**
 * Each `<name …>` start tag (any namespace prefix), sliced out with indexOf.
 * The OPF is untrusted: no regex ever scans from a tag start to the end of
 * the file, so a thousand unclosed `<item` can't stall the main process.
 */
function* startTags(xml: string, name: string): Generator<string> {
  const re = new RegExp(`<(?:[A-Za-z_][\\w.-]*:)?${name}(?=[\\s/>])`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const end = xml.indexOf('>', re.lastIndex);
    if (end === -1) return;
    yield xml.slice(m.index, end + 1);
    re.lastIndex = end + 1;
  }
}

/** Longer than any real book title: the rest is not read. */
const MAX_TITLE_SOURCE = 2000;

/** The first `<dc:title>…</dc:title>` text: one search for its start, one for its end. */
function readDcTitle(opf: string): string {
  const open = /<dc:title\b/i.exec(opf);
  if (!open) return '';
  const openEnd = opf.indexOf('>', open.index);
  if (openEnd === -1) return '';
  const close = /<\/dc:title\s*>/gi;
  close.lastIndex = openEnd + 1;
  const cm = close.exec(opf);
  if (!cm) return '';
  const raw = opf.slice(openEnd + 1, Math.min(cm.index, openEnd + 1 + MAX_TITLE_SOURCE));
  return decodeEntities(raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}

function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag);
  return m ? decodeEntities(m[1] ?? m[2] ?? '') : undefined;
}

/** OPF-relative href → zip entry path (resolves `../`, decodes %XX, drops #fragments). */
function resolveHref(opfDir: string, href: string): string {
  const bare = href.split('#')[0];
  let decoded = bare;
  try {
    decoded = decodeURIComponent(bare);
  } catch {
    // A stray `%` — use the href as written.
  }
  // Zip entries always use forward slashes, whatever the host OS.
  return path.posix.normalize(path.posix.join(opfDir, decoded)).replace(/^\.\//, '');
}

/**
 * An .epub buffer → blocks in spine order (a pageBreak between spine
 * documents). `title` is dc:title — treat it as authoritative. `limits`
 * lowers the zip-bomb caps (tests); the defaults are the EPUB_MAX_* constants.
 */
export async function epubToBlocks(
  buffer: Buffer,
  limits: { maxEntries?: number; maxInflatedBytes?: number } = {},
): Promise<{ blocks: RichBlock[]; title?: string; warnings: string[] }> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw new ImportUserError(DAMAGED);
  }
  if (Object.keys(zip.files).length > (limits.maxEntries ?? EPUB_MAX_ENTRIES)) {
    throw new ImportUserError('This ePub holds far more files than a book should, so Mythos stopped reading it.');
  }
  const reader = new EntryReader(zip, limits.maxInflatedBytes ?? EPUB_MAX_INFLATED_BYTES);
  const warnings: string[] = [];

  // 1) container.xml → OPF path (else the first .opf in the archive).
  let opfPath: string | undefined;
  const container = reader.file('META-INF/container.xml');
  if (container) {
    const xml = await reader.text(container);
    const rootfile = startTags(xml, 'rootfile').next().value;
    opfPath = rootfile ? attr(rootfile, 'full-path') : undefined;
  }
  if (!opfPath || !reader.file(opfPath)) {
    opfPath = Object.keys(zip.files).find((f) => f.toLowerCase().endsWith('.opf'));
  }
  const opfFile = opfPath ? reader.file(opfPath) : null;
  if (!opfPath || !opfFile) throw new ImportUserError(DAMAGED);
  const opf = await reader.text(opfFile);
  const opfDir = path.posix.dirname(opfPath) === '.' ? '' : path.posix.dirname(opfPath);

  // 2) Manifest + spine.
  const items = new Map<string, { href: string; type: string; props: string }>();
  for (const tag of startTags(opf, 'item')) {
    const id = attr(tag, 'id');
    const href = attr(tag, 'href');
    if (id && href) items.set(id, { href, type: (attr(tag, 'media-type') ?? '').toLowerCase(), props: attr(tag, 'properties') ?? '' });
  }
  const spine = [...startTags(opf, 'itemref')]
    .filter((tag) => (attr(tag, 'linear') ?? 'yes').toLowerCase() !== 'no')
    .map((tag) => attr(tag, 'idref'))
    .filter((id): id is string => Boolean(id));
  const title = readDcTitle(opf);

  // 3) Spine documents in reading order.
  const blocks: RichBlock[] = [];
  const docWarnings = new Map<string, number>();
  let docs = 0;
  for (const idref of spine) {
    const item = items.get(idref);
    if (!item) continue;
    const isHtml = /x?html|xml/.test(item.type) || /\.(x?html?|xml)$/i.test(item.href);
    if (!isHtml || /\bnav\b/.test(item.props)) continue;
    const entry = reader.file(resolveHref(opfDir, item.href));
    if (!entry) {
      warnings.push(`A chapter file listed in the book is missing: ${path.posix.basename(item.href)}`);
      continue;
    }
    const parsed = htmlToBlocks(await reader.text(entry));
    if (!parsed.blocks.some((b) => b.kind !== 'empty')) continue;
    if (docs > 0) blocks.push({ kind: 'pageBreak' });
    // A loop, not push(...spread): a spread of 125k+ blocks overflows the call stack.
    for (const b of parsed.blocks) blocks.push(b);
    docs++;
    for (const w of parsed.warnings) docWarnings.set(w, (docWarnings.get(w) ?? 0) + 1);
  }
  if (docs === 0) throw new ImportUserError('This ePub has no readable chapters.');
  for (const w of summarizeDocWarnings(docWarnings)) warnings.push(w);
  return { blocks, ...(title ? { title } : {}), warnings };
}

/** Per-document "3 images were not imported." lines → one total per kind. */
function summarizeDocWarnings(counts: Map<string, number>): string[] {
  const totals = new Map<string, number>();
  const other: string[] = [];
  for (const w of counts.keys()) {
    const m = /^(\d+) (image|images|footnote|footnotes|comment|comments)\b/.exec(w);
    if (!m) { other.push(w); continue; }
    const kind = m[2].replace(/s$/, '');
    totals.set(kind, (totals.get(kind) ?? 0) + Number(m[1]) * (counts.get(w) ?? 1));
  }
  const out: string[] = [];
  const images = totals.get('image') ?? 0;
  if (images) out.push(images === 1 ? '1 image was not imported.' : `${images} images were not imported.`);
  const notes = totals.get('footnote') ?? 0;
  if (notes) {
    out.push(notes === 1
      ? '1 footnote was left out of the story — Mythos doesn’t import footnotes yet.'
      : `${notes} footnotes were left out of the story — Mythos doesn’t import footnotes yet.`);
  }
  const comments = totals.get('comment') ?? 0;
  if (comments) out.push(comments === 1 ? '1 comment was left out.' : `${comments} comments were left out.`);
  return [...out, ...other];
}

/** An .epub buffer → a segmented story; dc:title (else `fallbackTitle`) is the title. */
export async function parseEpubStory(
  buffer: Buffer,
  fallbackTitle: string,
): Promise<{ story: ImportStory; warnings: string[] }> {
  const { blocks, title, warnings } = await epubToBlocks(buffer);
  const seg = segmentBlocks(blocks, {
    fallbackTitle: title ?? fallbackTitle,
    // An ePub's first heading is a chapter, never the book title: without
    // dc:title the caller's fallback (the file name) stands.
    titleIsAuthoritative: true,
    pageBreaksAreChapters: true,
  });
  return { story: seg.story, warnings: [...warnings, ...seg.warnings] };
}
