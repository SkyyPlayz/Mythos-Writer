// #1765 — import hub safety gate: deny-list, disguised-file sniff, ZIP
// container caps/macros, size cap, path shape, unknown-type fallback.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { Document, Packer, Paragraph } from 'docx';
import {
  assessImportPath,
  classifyExtension,
  DENIED_IMPORT_EXTENSIONS,
  finalExtension,
  SUPPORTED_IMPORT_EXTENSIONS,
  ZIP_MAX_ENTRIES,
} from './importSafety.js';

let tmp: string;

beforeEach(() => {
  tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'import-safety-')));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function write(name: string, content: Buffer | string): string {
  const p = path.join(tmp, name);
  fs.writeFileSync(p, content);
  return p;
}

async function realDocx(): Promise<Buffer> {
  const doc = new Document({ sections: [{ children: [new Paragraph({ text: 'Hello.' })] }] });
  return Buffer.from(await Packer.toBuffer(doc));
}

async function zipOf(files: Record<string, string>, compression: 'STORE' | 'DEFLATE' = 'DEFLATE'): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  return zip.generateAsync({ type: 'nodebuffer', compression });
}

const UNKNOWN_XYZ =
  "Mythos can't read .xyz files yet. You can import Word (.docx), Google Docs exports, Markdown, Scrivener, ePub, RTF or plain text.";

describe('classifyExtension / lists', () => {
  it('exports frozen deny and support lists', () => {
    expect(Object.isFrozen(DENIED_IMPORT_EXTENSIONS)).toBe(true);
    expect(Object.isFrozen(SUPPORTED_IMPORT_EXTENSIONS)).toBe(true);
    expect(SUPPORTED_IMPORT_EXTENSIONS).toEqual(
      ['docx', 'html', 'htm', 'md', 'markdown', 'mdown', 'mkd', 'txt', 'text', 'rtf', 'epub', 'scrivx'],
    );
    for (const ext of SUPPORTED_IMPORT_EXTENSIONS) expect(DENIED_IMPORT_EXTENSIONS).not.toContain(ext);
  });

  it('classifies by the final extension, case-insensitively, ignoring trailing dots/spaces', () => {
    expect(classifyExtension('Book.DOCX')).toBe('supported');
    expect(classifyExtension('Book.Exe')).toBe('denied');
    expect(classifyExtension('Chapter 1.docx.exe')).toBe('denied');
    expect(classifyExtension('story.exe.')).toBe('denied');
    expect(classifyExtension('story.exe . .')).toBe('denied');
    expect(classifyExtension('story.docx .exe')).toBe('denied');
    expect(classifyExtension('story\u202Excod.exe')).toBe('denied');
    expect(classifyExtension('invoice.exe.docx')).toBe('supported');
    expect(classifyExtension('notes.xyz')).toBe('unknown');
    expect(classifyExtension('README')).toBe('unknown');
    expect(classifyExtension('.bashrc')).toBe('unknown');
    expect(finalExtension('a.b.MD ')).toBe('md');
  });
});

describe('assessImportPath — deny-list', () => {
  it('refuses every deny-listed extension without reading it (lower and upper case)', () => {
    for (const ext of DENIED_IMPORT_EXTENSIONS) {
      for (const variant of [ext, ext.toUpperCase()]) {
        // The file does not even exist: a denied name is refused before any fs call.
        const r = assessImportPath(path.join(tmp, `story.${variant}`));
        expect(r.ok, `.${variant}`).toBe(false);
        if (r.ok) continue;
        expect(r.refused, `.${variant}`).toBe(true);
        expect(r.reason).toMatch(/never opens/);
      }
    }
  });

  it('refuses double-extension and trailing-dot/space tricks on real files', () => {
    for (const name of ['Chapter 1.docx.exe', 'story.exe.', 'story.docx .exe', 'story.scr  ']) {
      const p = write(name, 'harmless text');
      const r = assessImportPath(p);
      expect(r.ok, name).toBe(false);
      if (!r.ok) expect(r.refused, name).toBe(true);
    }
  });

  it('judges a symlink by the name it really resolves to', () => {
    const target = write('evil.exe', 'not really');
    const link = path.join(tmp, 'story.docx');
    try {
      fs.symlinkSync(target, link);
    } catch (err) {
      // Windows without Developer Mode can't create symlinks; Linux CI always can.
      if ((err as NodeJS.ErrnoException).code === 'EPERM') return;
      throw err;
    }
    const r = assessImportPath(link);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.refused).toBe(true);
      expect(r.name).toBe('evil.exe');
    }
  });
});

describe('assessImportPath — content sniff (disguised files)', () => {
  const cases: Array<[string, Buffer, RegExp]> = [
    ['Chapter 1.docx', Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200)]), /Windows program/],
    ['notes.txt', Buffer.concat([Buffer.from([0x7f]), Buffer.from('ELF'), Buffer.alloc(60)]), /Linux program/],
    ['book.md', Buffer.from('#!/bin/sh\nrm -rf ~\n'), /script/],
    ['bom.md', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('#!/usr/bin/env python\n')]), /script/],
    ['mac.rtf', Buffer.concat([Buffer.from([0xcf, 0xfa, 0xed, 0xfe]), Buffer.alloc(60)]), /Mac program/],
    ['fat.txt', Buffer.concat([Buffer.from([0xca, 0xfe, 0xba, 0xbe]), Buffer.alloc(60)]), /Mac program/],
  ];
  for (const [name, bytes, reason] of cases) {
    it(`refuses ${name} whose content is not what its name says`, () => {
      const r = assessImportPath(write(name, bytes));
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.refused).toBe(true);
        expect(r.reason).toMatch(reason);
      }
    });
  }

  it('refuses an old OLE .doc (and one renamed .docx) with the Save-As advice', () => {
    const ole = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(512)]);
    for (const name of ['Old Draft.doc', 'Old Draft.docx']) {
      const r = assessImportPath(write(name, ole));
      expect(r).toEqual({
        ok: false,
        refused: true,
        reason: 'Old Word .doc files can carry macros. Open it in Word and Save As .docx, then import that.',
        name,
      });
    }
  });
});

describe('assessImportPath — ZIP containers', () => {
  it('accepts a real .docx and reports it as a Word container', async () => {
    const r = assessImportPath(write('Novel.docx', await realDocx()));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.zip?.kind).toBe('docx');
      expect(r.ext).toBe('docx');
      expect(r.head.subarray(0, 2).toString()).toBe('PK');
      expect(r.head.length).toBeLessThanOrEqual(4096);
    }
  });

  it('accepts an ePub (mimetype entry) as an ePub container', async () => {
    const r = assessImportPath(write('Book.epub', await zipOf({ mimetype: 'application/epub+zip', 'OEBPS/a.xhtml': '<p/>' }, 'STORE')));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.zip?.kind).toBe('epub');
  });

  it('refuses a .docx carrying word/vbaProject.bin', async () => {
    const bytes = await zipOf({
      '[Content_Types].xml': '<Types/>',
      'word/document.xml': '<w:document/>',
      'word/vbaProject.bin': 'binary',
    });
    const r = assessImportPath(write('Macro.docx', bytes));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.refused).toBe(true);
      expect(r.reason).toMatch(/macros/);
    }
  });

  it('refuses a .docx whose [Content_Types].xml is macroEnabled', async () => {
    const bytes = await zipOf({
      '[Content_Types].xml':
        '<Types><Override PartName="/word/document.xml" ContentType="application/vnd.ms-word.document.macroEnabled.main+xml"/></Types>',
      'word/document.xml': '<w:document/>',
    });
    const r = assessImportPath(write('Sneaky.docx', bytes));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refused).toBe(true);
  });

  it('calls a plain .zip unsupported (not refused)', async () => {
    const r = assessImportPath(write('stuff.zip', await zipOf({ 'a.txt': 'hi' })));
    expect(r).toEqual({
      ok: false,
      refused: false,
      reason: "Mythos can't read .zip archives yet — unzip it first and import the file inside.",
      name: 'stuff.zip',
    });
  });

  it(`refuses a ZIP with more than ${ZIP_MAX_ENTRIES} entries`, async () => {
    const files: Record<string, string> = { 'word/document.xml': '<w:document/>' };
    for (let i = 0; i < ZIP_MAX_ENTRIES; i++) files[`x/${i}.txt`] = '';
    const r = assessImportPath(write('Bomb.docx', await zipOf(files, 'STORE')));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.refused).toBe(true);
      expect(r.reason).toMatch(/more than Mythos will safely open/);
    }
  });

  it('refuses a ZIP whose claimed uncompressed size passes 200 MB', async () => {
    const bytes = await zipOf({ 'word/document.xml': '<w:document/>', 'word/big.bin': 'x' }, 'STORE');
    // Patch the central-directory "uncompressed size" of every entry to 150 MB.
    for (let i = 0; i + 4 <= bytes.length; i++) {
      if (bytes.readUInt32LE(i) === 0x02014b50) bytes.writeUInt32LE(150 * 1024 * 1024, i + 24);
    }
    const r = assessImportPath(write('Inflated.docx', bytes));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refused).toBe(true);
  });

  it('calls a truncated ZIP damaged, not ok', () => {
    const r = assessImportPath(write('Broken.docx', Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(100)])));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.refused).toBe(false);
      expect(r.reason).toMatch(/damaged/);
    }
  });
});

describe('assessImportPath — size, unknown type, path shape', () => {
  it('refuses a 51 MB file as too large (refused:false)', () => {
    const p = path.join(tmp, 'Huge.txt');
    fs.writeFileSync(p, '');
    fs.truncateSync(p, 51 * 1024 * 1024);
    const r = assessImportPath(p);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.refused).toBe(false);
      expect(r.reason).toMatch(/too large/);
    }
  });

  it('honours a custom maxFileBytes', () => {
    const r = assessImportPath(write('small.md', 'x'.repeat(100)), { maxFileBytes: 10 });
    expect(r.ok).toBe(false);
  });

  it('answers "can\'t read this yet" for an unknown but safe extension', () => {
    const r = assessImportPath(write('notes.xyz', 'just text'));
    expect(r).toEqual({ ok: false, refused: false, reason: UNKNOWN_XYZ, name: 'notes.xyz' });
  });

  it('accepts a Markdown file and returns its head + stat', () => {
    const p = write('Draft.md', '# Chapter One\n\nIt was a dark night.');
    const r = assessImportPath(p);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.realPath).toBe(fs.realpathSync.native(p));
      expect(r.name).toBe('Draft.md');
      expect(r.isDirectory).toBe(false);
      expect(r.size).toBe(fs.statSync(p).size);
      expect(r.head.toString()).toContain('Chapter One');
      expect(r.zip).toBeUndefined();
    }
  });

  it('accepts a directory without reading it', () => {
    const dir = path.join(tmp, 'Novel.scriv');
    fs.mkdirSync(dir);
    const r = assessImportPath(dir);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.isDirectory).toBe(true);
      expect(r.head.length).toBe(0);
    }
  });

  it('reports a missing file in plain words without the path', () => {
    const r = assessImportPath(path.join(tmp, 'gone.docx'));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.refused).toBe(false);
      expect(r.reason).toMatch(/That file is no longer there/);
      expect(r.reason).not.toContain(tmp);
    }
  });

  it('rejects non-strings, empty, NUL bytes and relative paths', () => {
    for (const bad of [undefined, null, 42, {}, '', '   ', `${tmp}/a\0.md`, 'relative/story.md', './story.md']) {
      const r = assessImportPath(bad);
      expect(r.ok, String(bad)).toBe(false);
      if (!r.ok) expect(r.refused).toBe(false);
    }
  });

  it('rejects Windows alternate data streams, device and UNC paths (win32 rules)', () => {
    for (const bad of [
      'C:\\Users\\me\\story.docx:hidden',
      'C:\\Users\\me\\story.docx::$DATA',
      '\\\\?\\C:\\Users\\me\\story.docx',
      '\\\\.\\PhysicalDrive0',
      '\\\\server\\share\\story.docx',
      '\\Users\\me\\story.docx',
    ]) {
      const r = assessImportPath(bad, { platform: 'win32' });
      expect(r.ok, bad).toBe(false);
      if (!r.ok) expect(r.refused, bad).toBe(false);
    }
  });

  it('never puts the directory part of a path in a reason', async () => {
    const paths = [
      write('a.xyz', 'x'),
      write('b.zip', await zipOf({ 'x.txt': 'y' })),
      path.join(tmp, 'missing.md'),
      write('c.exe', 'x'),
    ];
    for (const p of paths) {
      const r = assessImportPath(p);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).not.toContain(tmp);
    }
  });
});
