// SKY-11186 (Notes Board 6/9): unit coverage for the note-thumbnail
// resolver + derivative cache — frontmatter `thumb:` parsing, first-image
// detection, Obsidian-style ref resolution, end-to-end resolveNoteThumbs on
// a temp vault, the cache read/write/prune cycle, and the allowlist gate
// running BEFORE any fs access (bgLoad.test.ts / vaultIconFile.test.ts
// precedent). Real filesystem via fs.mkdtempSync (no fs mocking except the
// two gate spies), matching notesBoard.test.ts.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseFrontmatter } from './vault.js';
import {
  MAX_THUMB_CACHE_BYTES,
  MAX_THUMB_NOTE_SCAN_BYTES,
  MAX_THUMB_SOURCE_BYTES,
  THUMB_IMAGE_MIME,
  parseThumbField,
  findFirstImageRef,
  buildVaultImageIndex,
  resolveImageRef,
  resolveNoteThumbs,
  thumbCacheFileName,
  readCachedThumb,
  writeCachedThumb,
  readThumbSource,
  getThumb,
  putThumb,
  isValidThumbVersion,
  noneThumbInfo,
} from './noteThumbnails.js';

function writeFile(root: string, relPath: string, content: string | Buffer): string {
  const abs = path.join(root, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}

function versionOf(abs: string): string {
  const st = fs.statSync(abs);
  return `${st.mtimeMs}-${st.size}`;
}

afterEach(() => vi.restoreAllMocks());

// ─── parseThumbField ───

describe('parseThumbField — frontmatter `thumb:` forms', () => {
  it('boolean false (what parseFrontmatter yields for `thumb: false`) is off', () => {
    expect(parseThumbField(false)).toEqual({ kind: 'off' });
  });

  it("the strings 'false' / 'off' / 'none' are off, case-insensitively", () => {
    expect(parseThumbField('false')).toEqual({ kind: 'off' });
    expect(parseThumbField('OFF')).toEqual({ kind: 'off' });
    expect(parseThumbField('None')).toEqual({ kind: 'off' });
    expect(parseThumbField('"false"')).toEqual({ kind: 'off' });
  });

  it("YAML's own falsy spellings — no / null / ~ — are off too (parseFrontmatter hands them over as strings)", () => {
    expect(parseThumbField('no')).toEqual({ kind: 'off' });
    expect(parseThumbField('NULL')).toEqual({ kind: 'off' });
    expect(parseThumbField('~')).toEqual({ kind: 'off' });
    expect(parseThumbField(parseFrontmatter('---\nthumb: ~\n---\n').frontmatter.thumb)).toEqual({ kind: 'off' });
  });

  it('a bare wikilink whose file name has a comma survives the inline-array split', () => {
    // parseInlineArray splits `[[My, Cover.png]]` on the comma; the pieces are rejoined.
    const { frontmatter } = parseFrontmatter('---\nthumb: [[My, Cover.png]]\n---\n');
    expect(Array.isArray(frontmatter.thumb)).toBe(true);
    expect(parseThumbField(frontmatter.thumb)).toEqual({ kind: 'ref', target: 'My, Cover.png' });
    // A real list is still not a thumbnail ref.
    expect(parseThumbField(['a.png', 'b.png'])).toEqual({ kind: 'unset' });
  });

  it('a quoted string is unquoted', () => {
    expect(parseThumbField('"assets/cover.png"')).toEqual({ kind: 'ref', target: 'assets/cover.png' });
    expect(parseThumbField("'cover.png'")).toEqual({ kind: 'ref', target: 'cover.png' });
  });

  it('wikilink wrappers are stripped, with or without the embed bang', () => {
    expect(parseThumbField('[[cover.png]]')).toEqual({ kind: 'ref', target: 'cover.png' });
    expect(parseThumbField('![[cover.png]]')).toEqual({ kind: 'ref', target: 'cover.png' });
    expect(parseThumbField('"[[cover.png]]"')).toEqual({ kind: 'ref', target: 'cover.png' });
  });

  it('|alias and #heading suffixes inside a wikilink are dropped', () => {
    expect(parseThumbField('[[cover.png|100]]')).toEqual({ kind: 'ref', target: 'cover.png' });
    expect(parseThumbField('[[cover.png#section]]')).toEqual({ kind: 'ref', target: 'cover.png' });
    expect(parseThumbField('[[cover.png#x|Alias]]')).toEqual({ kind: 'ref', target: 'cover.png' });
  });

  it('a plain (non-wikilink) ref keeps a literal # in the filename', () => {
    expect(parseThumbField('Cover #2.png')).toEqual({ kind: 'ref', target: 'Cover #2.png' });
  });

  it('accepts the one-element array parseFrontmatter yields for a bare `thumb: [[x]]`', () => {
    const { frontmatter } = parseFrontmatter('---\nthumb: [[cover.png|200]]\n---\nbody\n');
    expect(Array.isArray(frontmatter.thumb)).toBe(true);
    expect(parseThumbField(frontmatter.thumb)).toEqual({ kind: 'ref', target: 'cover.png' });
  });

  it('true, numbers, empty strings, objects and undefined are unset', () => {
    expect(parseThumbField(true)).toEqual({ kind: 'unset' });
    expect(parseThumbField(42)).toEqual({ kind: 'unset' });
    expect(parseThumbField('')).toEqual({ kind: 'unset' });
    expect(parseThumbField('   ')).toEqual({ kind: 'unset' });
    expect(parseThumbField('[[]]')).toEqual({ kind: 'unset' });
    expect(parseThumbField(undefined)).toEqual({ kind: 'unset' });
    expect(parseThumbField(null)).toEqual({ kind: 'unset' });
    expect(parseThumbField({ a: 1 })).toEqual({ kind: 'unset' });
    expect(parseThumbField(['a.png', 'b.png'])).toEqual({ kind: 'unset' });
  });
});

// ─── findFirstImageRef ───

describe('findFirstImageRef — first image block in prose', () => {
  it('returns null when the prose has no image', () => {
    expect(findFirstImageRef('# Title\n\nJust words and a [[wikilink]].\n')).toBeNull();
    expect(findFirstImageRef('')).toBeNull();
  });

  it('earliest by index wins across embed and markdown forms', () => {
    expect(findFirstImageRef('a ![[one.png]] b ![two](two.png)')).toEqual({ target: 'one.png', alt: '' });
    expect(findFirstImageRef('a ![two](two.png) b ![[one.png]]')).toEqual({ target: 'two.png', alt: 'two' });
  });

  it('skips images inside fenced code blocks (``` and ~~~), including an unclosed fence', () => {
    expect(
      findFirstImageRef('```md\n![[fenced.png]]\n```\n\n![[real.png]]\n'),
    ).toEqual({ target: 'real.png', alt: '' });
    expect(
      findFirstImageRef('~~~\n![x](fenced.png)\n~~~\n![y](real.png)'),
    ).toEqual({ target: 'real.png', alt: 'y' });
    expect(findFirstImageRef('```\n![[fenced.png]]\n```\n')).toBeNull();
    expect(findFirstImageRef('```\n![[fenced.png]]\nnever closed')).toBeNull();
  });

  it('skips remote / data / file targets — they are not vault images', () => {
    expect(
      findFirstImageRef('![r](https://example.com/r.png) ![[local.png]]'),
    ).toEqual({ target: 'local.png', alt: '' });
    expect(findFirstImageRef('![r](http://example.com/r.png)')).toBeNull();
    expect(findFirstImageRef('![d](data:image/png;base64,AAAA)')).toBeNull();
    expect(findFirstImageRef('![f](file:///tmp/x.png)')).toBeNull();
    expect(findFirstImageRef('![p](//cdn.example.com/x.png)')).toBeNull();
  });

  it('skips targets whose extension is not on the image allowlist', () => {
    expect(findFirstImageRef('![[doc.pdf]] ![[Other Note]] ![[x.png]]')).toEqual({ target: 'x.png', alt: '' });
    expect(findFirstImageRef('![[clip.mp4]]')).toBeNull();
    expect(findFirstImageRef('![a](script.js)')).toBeNull();
  });

  it('accepts every allowlisted extension, case-insensitively', () => {
    for (const ext of Object.keys(THUMB_IMAGE_MIME)) {
      expect(findFirstImageRef(`![[a.${ext.toUpperCase()}]]`)).toEqual({ target: `a.${ext.toUpperCase()}`, alt: '' });
    }
  });

  it('URL-decodes markdown targets (%20) and drops a #fragment', () => {
    expect(findFirstImageRef('![alt](my%20cover.png)')).toEqual({ target: 'my cover.png', alt: 'alt' });
    expect(findFirstImageRef('![](assets/img.png#center)')).toEqual({ target: 'assets/img.png', alt: '' });
    expect(findFirstImageRef('![](Cover%20%232.png)')).toEqual({ target: 'Cover #2.png', alt: '' });
  });

  it('accepts the <angle> target form and an optional "title"', () => {
    expect(findFirstImageRef('![alt](<my cover.png>)')).toEqual({ target: 'my cover.png', alt: 'alt' });
    expect(findFirstImageRef('![alt](cover.png "The title")')).toEqual({ target: 'cover.png', alt: 'alt' });
    expect(findFirstImageRef("![alt](<a b.png> 'T')")).toEqual({ target: 'a b.png', alt: 'alt' });
  });

  it('embed alias: a size is not a caption, any other alias is; #heading is dropped', () => {
    expect(findFirstImageRef('![[c.png|100]]')).toEqual({ target: 'c.png', alt: '' });
    expect(findFirstImageRef('![[c.png|100x50]]')).toEqual({ target: 'c.png', alt: '' });
    expect(findFirstImageRef('![[c.png|Cover art]]')).toEqual({ target: 'c.png', alt: 'Cover art' });
    expect(findFirstImageRef('![[c.png#x|Cover art]]')).toEqual({ target: 'c.png', alt: 'Cover art' });
  });
});

// ─── buildVaultImageIndex + resolveImageRef ───

describe('buildVaultImageIndex — one walk, basename → shortest paths', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vb-thumb-index-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('collects allowlisted images only, skips dot-prefixed segments, shortest path first', () => {
    writeFile(root, 'deep/dir/cover.png', 'x');
    writeFile(root, 'img/cover.png', 'x');
    // Probe the temp filesystem's case sensitivity before asserting on
    // img/COVER.PNG: on a case-insensitive volume (macOS APFS default)
    // this write lands on img/cover.png above, so only two paths exist.
    const caseInsensitiveFs = fs.existsSync(path.join(root, 'img', 'COVER.PNG'));
    writeFile(root, 'img/COVER.PNG', 'x');
    writeFile(root, 'notes/a.md', 'x');
    writeFile(root, 'doc.pdf', 'x');
    writeFile(root, '.obsidian/cover.png', 'x');
    writeFile(root, 'img/.hidden.png', 'x');

    const index = buildVaultImageIndex(root);
    if (caseInsensitiveFs) {
      expect(index.get('cover.png')).toEqual(['img/cover.png', 'deep/dir/cover.png']);
    } else {
      expect(index.get('cover.png')).toEqual(['img/COVER.PNG', 'img/cover.png', 'deep/dir/cover.png']);
    }
    expect(index.has('a.md')).toBe(false);
    expect(index.has('doc.pdf')).toBe(false);
    expect(index.has('.hidden.png')).toBe(false);
  });
});

describe('resolveImageRef — Obsidian link semantics, vault-contained', () => {
  let root: string;
  let outside: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vb-thumb-resolve-'));
    outside = fs.mkdtempSync(path.join(os.tmpdir(), 'vb-thumb-outside-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it('(1) resolves relative to the note’s own folder first', () => {
    writeFile(root, 'notes/img.png', 'x');
    writeFile(root, 'img.png', 'x');
    expect(resolveImageRef(root, 'notes/a.md', 'img.png', new Map())).toBe('notes/img.png');
    expect(resolveImageRef(root, 'notes/a.md', './img.png', new Map())).toBe('notes/img.png');
  });

  it('(2) falls back to vault-root-relative', () => {
    writeFile(root, 'assets/img.png', 'x');
    expect(resolveImageRef(root, 'notes/a.md', 'assets/img.png', new Map())).toBe('assets/img.png');
    expect(resolveImageRef(root, 'a.md', 'assets/img.png', new Map())).toBe('assets/img.png');
  });

  it('(3) bare filename: case-insensitive shortest-path basename match from the index', () => {
    writeFile(root, 'deep/dir/cover.png', 'x');
    writeFile(root, 'img/cover.png', 'x');
    const index = buildVaultImageIndex(root);
    expect(resolveImageRef(root, 'notes/a.md', 'COVER.PNG', index)).toBe('img/cover.png');
    // a target with a folder never uses the basename fallback
    expect(resolveImageRef(root, 'notes/a.md', 'nope/cover.png', index)).toBeNull();
  });

  it('builds the index lazily — the thunk is only called when basename resolution is needed', () => {
    writeFile(root, 'notes/img.png', 'x');
    writeFile(root, 'elsewhere/other.png', 'x');
    const thunk = vi.fn(() => buildVaultImageIndex(root));
    expect(resolveImageRef(root, 'notes/a.md', 'img.png', thunk)).toBe('notes/img.png');
    expect(thunk).not.toHaveBeenCalled();
    expect(resolveImageRef(root, 'notes/a.md', 'other.png', thunk)).toBe('elsewhere/other.png');
    expect(thunk).toHaveBeenCalledTimes(1);
  });

  it('normalises backslashes', () => {
    writeFile(root, 'assets/img.png', 'x');
    expect(resolveImageRef(root, 'a.md', 'assets\\img.png', new Map())).toBe('assets/img.png');
  });

  it('rejects traversal, absolute paths and dot-prefixed segments even when the file exists', () => {
    writeFile(outside, 'evil.png', 'x');
    const rel = path.relative(root, path.join(outside, 'evil.png')).split(path.sep).join('/');
    expect(rel.startsWith('..')).toBe(true);
    expect(resolveImageRef(root, 'a.md', rel, new Map())).toBeNull();
    expect(resolveImageRef(root, 'a.md', path.join(outside, 'evil.png'), new Map())).toBeNull();
    expect(resolveImageRef(root, 'a.md', '/etc/passwd.png', new Map())).toBeNull();
    expect(resolveImageRef(root, 'a.md', 'C:/evil.png', new Map())).toBeNull();
    writeFile(root, '.mythos/x.png', 'x');
    expect(resolveImageRef(root, 'a.md', '.mythos/x.png', new Map())).toBeNull();
  });

  it('does not follow a symlink — a link to a file outside the vault is no match', () => {
    if (process.platform === 'win32') return; // symlinks need privileges there; the CI matrix is linux + mac
    writeFile(outside, 'real.png', 'x');
    fs.symlinkSync(path.join(outside, 'real.png'), path.join(root, 'link.png'));
    expect(resolveImageRef(root, 'a.md', 'link.png', new Map())).toBeNull();
  });

  it('returns null for a ref that resolves nowhere', () => {
    expect(resolveImageRef(root, 'notes/a.md', 'missing.png', new Map())).toBeNull();
    expect(resolveImageRef(root, 'notes/a.md', '', new Map())).toBeNull();
    // a directory named like an image is not a file
    fs.mkdirSync(path.join(root, 'dir.png'));
    expect(resolveImageRef(root, 'a.md', 'dir.png', new Map())).toBeNull();
  });
});

// ─── resolveNoteThumbs end-to-end ───

describe('resolveNoteThumbs — spec §9 resolution order on a temp vault', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vb-thumb-notes-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('explicit: frontmatter thumb wins over the first image block', async () => {
    const cover = writeFile(root, 'notes/cover.png', Buffer.from('PNG-COVER'));
    writeFile(root, 'notes/other.png', 'x');
    writeFile(root, 'notes/A.md', '---\nthumb: cover.png\n---\n# A\n\n![[other.png]]\n');
    const { 'notes/A.md': info } = await resolveNoteThumbs(root, ['notes/A.md']);
    expect(info).toEqual({
      mode: 'explicit',
      src: 'notes/cover.png',
      version: versionOf(cover),
      missing: false,
      caption: 'cover',
    });
    expect(isValidThumbVersion(info.version)).toBe(true);
  });

  it('auto: first image block, caption = markdown alt text', async () => {
    const img = writeFile(root, 'img.png', Buffer.from('PNG'));
    writeFile(root, 'B.md', '# B\n\nText.\n\n![My cover](img.png)\n\n![[other.png]]\n');
    const { 'B.md': info } = await resolveNoteThumbs(root, ['B.md']);
    expect(info).toEqual({ mode: 'auto', src: 'img.png', version: versionOf(img), missing: false, caption: 'My cover' });
  });

  it('auto: caption falls back to the image basename without extension', async () => {
    writeFile(root, 'assets/Dragon Sketch.webp', 'x');
    writeFile(root, 'C.md', '![[Dragon Sketch.webp]]\n');
    const { 'C.md': info } = await resolveNoteThumbs(root, ['C.md']);
    expect(info.mode).toBe('auto');
    expect(info.src).toBe('assets/Dragon Sketch.webp');
    expect(info.caption).toBe('Dragon Sketch');
  });

  it('off: thumb: false is text-only even though the note has images', async () => {
    writeFile(root, 'img.png', 'x');
    writeFile(root, 'D.md', '---\nthumb: false\n---\n![[img.png]]\n');
    writeFile(root, 'D2.md', '---\nthumb: "off"\n---\n![[img.png]]\n');
    const res = await resolveNoteThumbs(root, ['D.md', 'D2.md']);
    expect(res['D.md']).toEqual({ mode: 'off', src: null, version: null, missing: false, caption: '' });
    expect(res['D2.md']).toEqual({ mode: 'off', src: null, version: null, missing: false, caption: '' });
  });

  it('none: no thumb field and no image block', async () => {
    writeFile(root, 'E.md', '---\ntitle: E\n---\n# E\n\nWords only. [[Link]]\n');
    const { 'E.md': info } = await resolveNoteThumbs(root, ['E.md']);
    expect(info).toEqual(noneThumbInfo());
  });

  it('missing: explicit or auto ref to an image that is not on disk → missing:true, src null', async () => {
    writeFile(root, 'F.md', '---\nthumb: gone.png\n---\n![[present.png]]\n');
    writeFile(root, 'present.png', 'x');
    writeFile(root, 'G.md', '![[vanished.jpg]]\n');
    writeFile(root, 'H.md', '---\nthumb: notes.md\n---\n');
    const res = await resolveNoteThumbs(root, ['F.md', 'G.md', 'H.md']);
    expect(res['F.md']).toEqual({ mode: 'explicit', src: null, version: null, missing: true, caption: 'gone' });
    expect(res['G.md']).toEqual({ mode: 'auto', src: null, version: null, missing: true, caption: 'vanished' });
    // an explicit ref to a non-image is a broken cover, not a fallthrough to auto
    expect(res['H.md']).toEqual({ mode: 'explicit', src: null, version: null, missing: true, caption: 'notes' });
  });

  it('version tracks the source file: rewriting the image changes it', async () => {
    const img = writeFile(root, 'img.png', Buffer.from('v1'));
    writeFile(root, 'I.md', '![[img.png]]\n');
    const before = (await resolveNoteThumbs(root, ['I.md']))['I.md'].version;
    expect(before).toBe(versionOf(img));
    fs.writeFileSync(img, Buffer.from('v2-longer'));
    const after = (await resolveNoteThumbs(root, ['I.md']))['I.md'].version;
    expect(after).toBe(versionOf(img));
    expect(after).not.toBe(before);
  });

  it('a note over the scan cap whose only image is past the cap resolves to none; an early image still resolves', async () => {
    writeFile(root, 'img.png', 'x');
    const filler = 'lorem ipsum dolor sit amet\n'.repeat(Math.ceil(MAX_THUMB_NOTE_SCAN_BYTES / 27) + 10);
    expect(Buffer.byteLength(filler)).toBeGreaterThan(MAX_THUMB_NOTE_SCAN_BYTES);
    writeFile(root, 'Late.md', `# Late\n\n${filler}\n![[img.png]]\n`);
    writeFile(root, 'Early.md', `---\ntitle: Early\n---\n![[img.png]]\n${filler}`);
    const res = await resolveNoteThumbs(root, ['Late.md', 'Early.md']);
    expect(res['Late.md']).toEqual(noneThumbInfo());
    expect(res['Early.md'].mode).toBe('auto');
    expect(res['Early.md'].src).toBe('img.png');
  });

  it('an unreadable path (missing note, or a directory) resolves to none instead of failing the batch', async () => {
    fs.mkdirSync(path.join(root, 'Folder'));
    writeFile(root, 'ok.png', 'x');
    writeFile(root, 'OK.md', '![[ok.png]]\n');
    const res = await resolveNoteThumbs(root, ['Missing.md', 'Folder', 'OK.md', '']);
    expect(res['Missing.md']).toEqual(noneThumbInfo());
    expect(res['Folder']).toEqual(noneThumbInfo());
    expect(res['']).toEqual(noneThumbInfo());
    expect(res['OK.md'].src).toBe('ok.png');
  });

  it('result keys are the input paths verbatim, for a batch larger than the concurrency bound', async () => {
    writeFile(root, 'shared/cover.png', 'x');
    const paths: string[] = [];
    for (let i = 0; i < 40; i++) {
      const rel = `batch/Note ${i}.md`;
      writeFile(root, rel, i % 2 === 0 ? '![[cover.png]]\n' : 'no image\n');
      paths.push(rel);
    }
    const res = await resolveNoteThumbs(root, paths);
    expect(Object.keys(res).sort()).toEqual([...paths].sort());
    for (let i = 0; i < 40; i++) {
      const info = res[`batch/Note ${i}.md`];
      if (i % 2 === 0) {
        expect(info.mode).toBe('auto');
        expect(info.src).toBe('shared/cover.png');
      } else {
        expect(info.mode).toBe('none');
      }
    }
  });

  it('an empty batch resolves to an empty map without touching the vault', async () => {
    expect(await resolveNoteThumbs(root, [])).toEqual({});
  });
});

// ─── Derivative cache ───

describe('thumb cache — read / write / prune', () => {
  let cacheDir: string;

  beforeEach(() => {
    cacheDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vb-thumb-cache-')), 'note-thumb-cache', 'abc');
  });

  afterEach(() => {
    fs.rmSync(path.dirname(path.dirname(cacheDir)), { recursive: true, force: true });
  });

  it('thumbCacheFileName is deterministic: 24-hex sha1 prefix + version + .webp', () => {
    const name = thumbCacheFileName('assets/cover.png', '1700000000000.5-1234');
    expect(name).toMatch(/^[0-9a-f]{24}-1700000000000\.5-1234\.webp$/);
    expect(thumbCacheFileName('assets/cover.png', '1700000000000.5-1234')).toBe(name);
    expect(thumbCacheFileName('assets/other.png', '1700000000000.5-1234')).not.toBe(name);
  });

  it('write then read round-trips a data:image/webp;base64 URL; wrong version reads null', async () => {
    const bytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3]);
    expect(await writeCachedThumb(cacheDir, 'assets/cover.png', '100-7', bytes)).toBe(true);
    const url = await readCachedThumb(cacheDir, 'assets/cover.png', '100-7');
    expect(url).toBe(`data:image/webp;base64,${Buffer.from(bytes).toString('base64')}`);
    expect(await readCachedThumb(cacheDir, 'assets/cover.png', '101-7')).toBeNull();
    expect(await readCachedThumb(cacheDir, 'assets/other.png', '100-7')).toBeNull();
    expect(await readCachedThumb(path.join(cacheDir, 'nope'), 'assets/cover.png', '100-7')).toBeNull();
  });

  it('writing a new version prunes the same image’s old derivative and leaves other images alone', async () => {
    await writeCachedThumb(cacheDir, 'a.png', '1-1', new Uint8Array([1]));
    await writeCachedThumb(cacheDir, 'b.png', '1-1', new Uint8Array([2]));
    await writeCachedThumb(cacheDir, 'a.png', '2-2', new Uint8Array([3]));

    const files = fs.readdirSync(cacheDir).sort();
    expect(files).toEqual([thumbCacheFileName('a.png', '2-2'), thumbCacheFileName('b.png', '1-1')].sort());
    expect(await readCachedThumb(cacheDir, 'a.png', '1-1')).toBeNull();
    expect(await readCachedThumb(cacheDir, 'a.png', '2-2')).not.toBeNull();
    expect(await readCachedThumb(cacheDir, 'b.png', '1-1')).not.toBeNull();
    // no tmp files left behind by the atomic write
    expect(files.some((f) => f.endsWith('.tmp'))).toBe(false);
  });

  it('never throws: bad version or an unwritable cache dir → false, nothing written', async () => {
    expect(await writeCachedThumb(cacheDir, 'a.png', '../../evil', new Uint8Array([1]))).toBe(false);
    expect(await writeCachedThumb(cacheDir, 'a.png', '', new Uint8Array([1]))).toBe(false);
    expect(fs.existsSync(cacheDir)).toBe(false);
    // cacheDir path occupied by a FILE → mkdir/rename fails → false, no throw
    fs.mkdirSync(path.dirname(cacheDir), { recursive: true });
    fs.writeFileSync(cacheDir, 'not a dir');
    expect(await writeCachedThumb(cacheDir, 'a.png', '1-1', new Uint8Array([1]))).toBe(false);
    expect(await readCachedThumb(cacheDir, 'a.png', '1-1')).toBeNull();
  });
});

// ─── readThumbSource gate ───

describe('readThumbSource — allowlist gate BEFORE any fs access', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vb-thumb-src-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('a non-image extension is unsupported (not missing) and never reaches stat', async () => {
    const statSpy = vi.spyOn(fs.promises, 'stat');
    expect(await readThumbSource(root, 'does-not-exist.txt')).toEqual({ status: 'unsupported' });
    expect(await readThumbSource(root, 'secrets.json')).toEqual({ status: 'unsupported' });
    expect(await readThumbSource(root, 'noext')).toEqual({ status: 'unsupported' });
    expect(statSpy).not.toHaveBeenCalled();
  });

  it('traversal / absolute / empty paths are missing without any fs access', async () => {
    const statSpy = vi.spyOn(fs.promises, 'stat');
    expect(await readThumbSource(root, '../outside.png')).toEqual({ status: 'missing' });
    expect(await readThumbSource(root, 'a/../../outside.png')).toEqual({ status: 'missing' });
    expect(await readThumbSource(root, '/etc/x.png')).toEqual({ status: 'missing' });
    expect(await readThumbSource(root, '')).toEqual({ status: 'missing' });
    expect(statSpy).not.toHaveBeenCalled();
  });

  it('a source over MAX_THUMB_SOURCE_BYTES is unsupported and is never read', async () => {
    writeFile(root, 'huge.png', 'x');
    vi.spyOn(fs.promises, 'stat').mockResolvedValue({
      size: MAX_THUMB_SOURCE_BYTES + 1,
      mtimeMs: 1,
      isFile: () => true,
    } as unknown as fs.Stats);
    const readSpy = vi.spyOn(fs.promises, 'readFile');
    expect(await readThumbSource(root, 'huge.png')).toEqual({ status: 'unsupported' });
    expect(readSpy).not.toHaveBeenCalled();
  });

  it('an allowlisted path that is not on disk (or is a directory) is missing', async () => {
    expect(await readThumbSource(root, 'gone.png')).toEqual({ status: 'missing' });
    fs.mkdirSync(path.join(root, 'dir.png'));
    expect(await readThumbSource(root, 'dir.png')).toEqual({ status: 'missing' });
  });

  it('returns the bytes, mime and version for a real source', async () => {
    const abs = writeFile(root, 'assets/cover.JPG', Buffer.from('JPEGDATA'));
    const res = await readThumbSource(root, 'assets/cover.JPG');
    expect(res.status).toBe('source');
    if (res.status !== 'source') throw new Error('unreachable');
    expect(res.mime).toBe('image/jpeg');
    expect(res.bytes.toString()).toBe('JPEGDATA');
    expect(res.version).toBe(versionOf(abs));
    const svg = await readThumbSource(root, 'x.svg');
    expect(svg).toEqual({ status: 'missing' });
  });
});

// ─── getThumb / putThumb (the IPC bodies) ───

describe('getThumb / putThumb — serve cached derivative else source; store renderer derivative', () => {
  let root: string;
  let cacheDir: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vb-thumb-get-'));
    cacheDir = path.join(root, '.cache');
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('cache miss → source bytes as a standalone Uint8Array; after put → ready with the cached data URL', async () => {
    const abs = writeFile(root, 'img.png', Buffer.from('PNG'));
    const version = versionOf(abs);

    const miss = await getThumb(root, cacheDir, 'img.png');
    expect(miss.status).toBe('source');
    if (miss.status !== 'source') throw new Error('unreachable');
    expect(miss.mime).toBe('image/png');
    expect(miss.version).toBe(version);
    expect(Buffer.from(miss.bytes).toString()).toBe('PNG');
    // Copied out of Node's shared Buffer pool before crossing IPC.
    expect(miss.bytes.byteOffset).toBe(0);
    expect(miss.bytes.buffer.byteLength).toBe(miss.bytes.byteLength);

    const derived = new Uint8Array([9, 8, 7]);
    expect(await putThumb(cacheDir, 'img.png', version, derived)).toEqual({ ok: true });

    const hit = await getThumb(root, cacheDir, 'img.png');
    expect(hit).toEqual({
      status: 'ready',
      dataUrl: `data:image/webp;base64,${Buffer.from(derived).toString('base64')}`,
      version,
    });
  });

  it('a re-saved source invalidates the cached derivative by version', async () => {
    const abs = writeFile(root, 'img.png', Buffer.from('v1'));
    await putThumb(cacheDir, 'img.png', versionOf(abs), new Uint8Array([1]));
    expect((await getThumb(root, cacheDir, 'img.png')).status).toBe('ready');
    fs.writeFileSync(abs, Buffer.from('v2-different-size'));
    const again = await getThumb(root, cacheDir, 'img.png');
    expect(again.status).toBe('source');
    if (again.status !== 'source') throw new Error('unreachable');
    expect(again.version).toBe(versionOf(abs));
  });

  it('passes unsupported / missing through without touching the cache', async () => {
    expect(await getThumb(root, cacheDir, 'notes.md')).toEqual({ status: 'unsupported' });
    expect(await getThumb(root, cacheDir, 'gone.png')).toEqual({ status: 'missing' });
    expect(await getThumb(root, cacheDir, '../evil.png')).toEqual({ status: 'missing' });
    expect(fs.existsSync(cacheDir)).toBe(false);
  });

  it('putThumb rejects a bad version, a non-image src, empty / oversize / non-binary bytes with ok:false', async () => {
    expect(await putThumb(cacheDir, 'img.png', 'not-a-version', new Uint8Array([1]))).toEqual({ ok: false });
    expect(await putThumb(cacheDir, 'img.png', '../../x', new Uint8Array([1]))).toEqual({ ok: false });
    expect(await putThumb(cacheDir, 'img.png', 12, new Uint8Array([1]))).toEqual({ ok: false });
    expect(await putThumb(cacheDir, 'notes.md', '1-1', new Uint8Array([1]))).toEqual({ ok: false });
    expect(await putThumb(cacheDir, '', '1-1', new Uint8Array([1]))).toEqual({ ok: false });
    expect(await putThumb(cacheDir, 'img.png', '1-1', new Uint8Array(0))).toEqual({ ok: false });
    expect(await putThumb(cacheDir, 'img.png', '1-1', new Uint8Array(MAX_THUMB_CACHE_BYTES + 1))).toEqual({ ok: false });
    expect(await putThumb(cacheDir, 'img.png', '1-1', 'AAAA')).toEqual({ ok: false });
    expect(await putThumb(cacheDir, 'img.png', '1-1', [1, 2, 3])).toEqual({ ok: false });
    expect(fs.existsSync(cacheDir)).toBe(false);
    // a Buffer is a Uint8Array — accepted; fractional mtimeMs versions are valid
    expect(await putThumb(cacheDir, 'img.png', '1700000000000.25-3', Buffer.from([1, 2, 3]))).toEqual({ ok: true });
    expect(fs.existsSync(path.join(cacheDir, thumbCacheFileName('img.png', '1700000000000.25-3')))).toBe(true);
  });
});
