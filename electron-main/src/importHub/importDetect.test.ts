// #1765 — import hub source detection matrix (files by extension + content,
// folders by Scrivener markers / Markdown files within depth 4).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { Document, Packer, Paragraph } from 'docx';

// htmlBlocks owns Google-Docs recognition; pin its verdict so this suite only
// tests the routing.
vi.mock('./htmlBlocks.js', () => ({
  isGoogleDocsHtml: (html: string) => html.includes('docs-internal-guid'),
}));

import { assessImportPath, type AssessedImportPath } from './importSafety.js';
import { detectImportSource, FOLDER_SCAN_MAX_ENTRIES, FOLDER_TOO_BIG_ERROR } from './importDetect.js';
import { createRequire } from 'node:module';

// Static import of ../test-utils would pull that .d.ts under tsconfig rootDir
// (src) and break `tsc`. require() keeps the helper outside the program.
const require = createRequire(import.meta.url);
const { makeTestTmp, cleanupTestTmp } = require('../../test-utils/tmpdir.mjs') as {
  makeTestTmp: (name: string) => string;
  cleanupTestTmp: () => void;
};

let tmp: string;

beforeEach(() => {
  tmp = makeTestTmp('import-detect');
});

afterEach(() => {
  cleanupTestTmp();
});

function write(rel: string, content: Buffer | string): string {
  const p = path.join(tmp, ...rel.split('/'));
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return p;
}

function assessed(p: string): AssessedImportPath {
  const r = assessImportPath(p);
  if (!r.ok) throw new Error(`assess failed: ${r.reason}`);
  return r;
}

async function realDocx(): Promise<Buffer> {
  const doc = new Document({ sections: [{ children: [new Paragraph({ text: 'Hello.' })] }] });
  return Buffer.from(await Packer.toBuffer(doc));
}

async function epub(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('OEBPS/ch1.xhtml', '<html><body><p>Hi</p></body></html>');
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('detectImportSource — files', () => {
  it('detects a real .docx', async () => {
    expect(detectImportSource(assessed(write('Novel.docx', await realDocx())))).toEqual({ ok: true, kind: 'docx' });
  });

  it('detects an ePub', async () => {
    expect(detectImportSource(assessed(write('Book.epub', await epub())))).toEqual({ ok: true, kind: 'epub' });
  });

  it('tells the writer to rename a Word file saved with the wrong extension', async () => {
    const r = detectImportSource(assessed(write('Novel.txt', await realDocx())));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/really a Word document.*\.docx/);
  });

  it('splits Google Docs HTML from other HTML', () => {
    const gdoc = '<html><head><style>.c1{font-weight:700}</style></head><body><p><b id="docs-internal-guid-1">x</b></p></body></html>';
    expect(detectImportSource(assessed(write('Draft.html', gdoc)))).toEqual({ ok: true, kind: 'gdoc-html' });
    expect(detectImportSource(assessed(write('Page.htm', '<html><body><p>Plain</p></body></html>')))).toEqual({ ok: true, kind: 'html' });
  });

  it('detects every Markdown extension and plain text', () => {
    for (const ext of ['md', 'markdown', 'mdown', 'mkd', 'MD']) {
      expect(detectImportSource(assessed(write(`a.${ext}`, '# Hi\n')))).toEqual({ ok: true, kind: 'markdown' });
    }
    for (const ext of ['txt', 'text']) {
      expect(detectImportSource(assessed(write(`b.${ext}`, 'Hi\n')))).toEqual({ ok: true, kind: 'text' });
    }
  });

  it('requires {\\rtf at the start of an .rtf', () => {
    expect(detectImportSource(assessed(write('Doc.rtf', '{\\rtf1\\ansi Hello}')))).toEqual({ ok: true, kind: 'rtf' });
    const bad = detectImportSource(assessed(write('Fake.rtf', 'Hello there')));
    expect(bad.ok).toBe(false);
  });

  it('detects a .scrivx file as Scrivener', () => {
    const p = write('Novel.scriv/Novel.scrivx', '<?xml version="1.0"?><ScrivenerProject/>');
    expect(detectImportSource(assessed(p))).toEqual({ ok: true, kind: 'scrivener' });
  });

  function utf16(text: string, order: 'le' | 'be'): Buffer {
    const le = Buffer.from(text, 'utf16le');
    if (order === 'le') return Buffer.concat([Buffer.from([0xff, 0xfe]), le]);
    return Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(le).swap16()]);
  }

  it('accepts UTF-16 text with a byte-order mark (Word "Unicode" .txt, old Notepad)', () => {
    const body = 'Chapter One\r\n\r\nIt was dark.';
    expect(detectImportSource(assessed(write('Unicode.txt', utf16(body, 'le'))))).toEqual({ ok: true, kind: 'text' });
    expect(detectImportSource(assessed(write('BigEndian.txt', utf16(body, 'be'))))).toEqual({ ok: true, kind: 'text' });
    expect(detectImportSource(assessed(write('Notes.md', utf16('# Hi\n', 'le'))))).toEqual({ ok: true, kind: 'markdown' });
  });

  it('decodes UTF-16 HTML before checking for a Google Docs export', () => {
    const gdoc = '<html><body><p><b id="docs-internal-guid-1">x</b></p></body></html>';
    expect(detectImportSource(assessed(write('Draft.html', utf16(gdoc, 'le'))))).toEqual({ ok: true, kind: 'gdoc-html' });
    expect(detectImportSource(assessed(write('Page.html', utf16('<p>Plain</p>', 'be'))))).toEqual({ ok: true, kind: 'html' });
  });

  it('rejects binary content behind a text extension', () => {
    const r = detectImportSource(assessed(write('weird.md', Buffer.from([0x41, 0x00, 0x42, 0x00]))));
    expect(r.ok).toBe(false);
  });

  it('rejects an empty file and a .docx that is not a ZIP', () => {
    expect(detectImportSource(assessed(write('empty.md', ''))).ok).toBe(false);
    const r = detectImportSource(assessed(write('Plain.docx', 'just some text')));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/isn't a Word document/);
  });
});

describe('detectImportSource — folders', () => {
  it('detects a .scriv bundle by name, and a folder holding a .scrivx', () => {
    fs.mkdirSync(path.join(tmp, 'Empty.scriv'));
    expect(detectImportSource(assessed(path.join(tmp, 'Empty.scriv')))).toEqual({ ok: true, kind: 'scrivener' });
    write('Project/Book.scrivx', '<ScrivenerProject/>');
    expect(detectImportSource(assessed(path.join(tmp, 'Project')))).toEqual({ ok: true, kind: 'scrivener' });
  });

  it('detects a Markdown folder with a file nested up to depth 4', () => {
    write('Vault/a/b/c/d/deep.md', '# Deep');
    expect(detectImportSource(assessed(path.join(tmp, 'Vault')))).toEqual({ ok: true, kind: 'markdown-folder' });
  });

  it('stops the whole scan at the entry cap (no readdir of queued siblings) and says the folder is too big', () => {
    const big = path.join(tmp, 'Big');
    const half = Math.ceil(FOLDER_SCAN_MAX_ENTRIES / 2) + 1;
    for (const sub of ['a', 'b']) {
      fs.mkdirSync(path.join(big, sub), { recursive: true });
      for (let i = 0; i < half; i++) fs.writeFileSync(path.join(big, sub, `f${i}.bin`), '');
    }
    // A sibling queued after the cap is hit must never be read.
    fs.mkdirSync(path.join(big, 'c'));
    fs.writeFileSync(path.join(big, 'c', 'late.md'), '# late');
    const spy = vi.spyOn(fs, 'readdirSync');
    try {
      expect(detectImportSource(assessed(big))).toEqual({ ok: false, error: FOLDER_TOO_BIG_ERROR });
      expect(spy.mock.calls.some(([p]) => String(p).endsWith(`${path.sep}c`))).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it('ignores Markdown deeper than depth 4', () => {
    write('Deep/a/b/c/d/e/too-deep.md', '# Too deep');
    const r = detectImportSource(assessed(path.join(tmp, 'Deep')));
    expect(r).toEqual({ ok: false, error: 'This folder has no Markdown or Scrivener files Mythos can read.' });
  });

  it('skips hidden, .obsidian, .git, node_modules and .trash folders', () => {
    write('Skip/.obsidian/workspace.md', 'x');
    write('Skip/.git/notes.md', 'x');
    write('Skip/node_modules/pkg/readme.md', 'x');
    write('Skip/.trash/old.md', 'x');
    write('Skip/.hidden/secret.txt', 'x');
    write('Skip/image.png', 'x');
    const r = detectImportSource(assessed(path.join(tmp, 'Skip')));
    expect(r.ok).toBe(false);
    write('Skip/Characters/Mira.md', '# Mira');
    expect(detectImportSource(assessed(path.join(tmp, 'Skip')))).toEqual({ ok: true, kind: 'markdown-folder' });
  });

  it('does not follow a directory junction into files outside the folder', () => {
    const root = path.join(tmp, 'Root');
    const outside = path.join(tmp, 'Outside');
    fs.mkdirSync(root);
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'note.md'), '# Outside');
    const linkAbs = path.join(root, 'Link');
    const real = fs.readdirSync.bind(fs);
    const spy = vi.spyOn(fs, 'readdirSync').mockImplementation(((p: fs.PathLike, opts?: { withFileTypes?: boolean }) => {
      if (String(p) === root) {
        return [{
          name: 'Link',
          isFile: () => false,
          isDirectory: () => true,
          isSymbolicLink: () => true,
          isBlockDevice: () => false,
          isCharacterDevice: () => false,
          isFIFO: () => false,
          isSocket: () => false,
        }] as fs.Dirent[];
      }
      if (String(p) === linkAbs) return real(outside, opts as never);
      return real(p, opts as never);
    }) as typeof fs.readdirSync);
    try {
      expect(detectImportSource(assessed(root)).ok).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it('accepts a folder of plain .txt chapters', () => {
    write('Chapters/01.txt', 'One');
    expect(detectImportSource(assessed(path.join(tmp, 'Chapters')))).toEqual({ ok: true, kind: 'markdown-folder' });
  });
});
