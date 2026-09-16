// SKY-203: Note-level backlinks — unit tests (real temp directory, no mocks)
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getNoteBacklinks } from './noteBacklinks.js';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mw-backlinks-'));
}

function writeNote(root: string, relPath: string, content: string): void {
  const abs = path.join(root, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
}

describe('getNoteBacklinks', () => {
  let root: string;

  beforeEach(() => { root = tmpDir(); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('returns empty when no other notes exist', () => {
    writeNote(root, 'target.md', '# Target');
    const result = getNoteBacklinks(root, 'target.md');
    expect(result.notePath).toBe('target.md');
    expect(result.backlinks).toHaveLength(0);
  });

  it('finds a note that links via [[stem]]', () => {
    writeNote(root, 'target.md', '# Target');
    writeNote(root, 'linker.md', 'See also [[target]] for details.');
    const result = getNoteBacklinks(root, 'target.md');
    expect(result.backlinks).toHaveLength(1);
    expect(result.backlinks[0].path).toBe('linker.md');
    expect(result.backlinks[0].name).toBe('linker');
    expect(result.backlinks[0].snippet).toContain('[[target]]');
  });

  it('does not include self-links', () => {
    writeNote(root, 'target.md', 'This note mentions [[target]] itself.');
    const result = getNoteBacklinks(root, 'target.md');
    expect(result.backlinks).toHaveLength(0);
  });

  it('is case-insensitive for the stem', () => {
    writeNote(root, 'My-Note.md', '# My Note');
    writeNote(root, 'other.md', 'See [[my-note]] here.');
    const result = getNoteBacklinks(root, 'My-Note.md');
    expect(result.backlinks).toHaveLength(1);
    expect(result.backlinks[0].path).toBe('other.md');
  });

  it('matches [[stem|alias]] piped syntax', () => {
    writeNote(root, 'target.md', '# Target');
    writeNote(root, 'linker.md', 'Click [[target|here]] to continue.');
    const result = getNoteBacklinks(root, 'target.md');
    expect(result.backlinks).toHaveLength(1);
    expect(result.backlinks[0].snippet).toContain('[[target|here]]');
  });

  it('matches [[subfolder/stem]] path syntax', () => {
    writeNote(root, 'sub/target.md', '# Target');
    writeNote(root, 'linker.md', 'See [[sub/target]] for reference.');
    const result = getNoteBacklinks(root, 'sub/target.md');
    expect(result.backlinks).toHaveLength(1);
    expect(result.backlinks[0].path).toBe('linker.md');
  });

  it('returns empty when notePath is empty string', () => {
    writeNote(root, 'note.md', 'content');
    const result = getNoteBacklinks(root, '');
    expect(result.backlinks).toHaveLength(0);
  });

  it('ignores directories and non-.md files', () => {
    writeNote(root, 'target.md', '# Target');
    // Create a plain text file that contains a wikilink
    fs.writeFileSync(path.join(root, 'readme.txt'), 'See [[target]]');
    const result = getNoteBacklinks(root, 'target.md');
    expect(result.backlinks).toHaveLength(0);
  });

  it('clips a 120-char snippet around the match', () => {
    writeNote(root, 'target.md', '# Target');
    const before = 'a'.repeat(80);
    const after = 'z'.repeat(80);
    writeNote(root, 'linker.md', `${before}[[target]]${after}`);
    const result = getNoteBacklinks(root, 'target.md');
    expect(result.backlinks).toHaveLength(1);
    const { snippet } = result.backlinks[0];
    expect(snippet.length).toBeLessThanOrEqual(130); // 60+link+60 ≈ 79 chars
    expect(snippet).toContain('[[target]]');
  });

  it('finds multiple linking notes and sorts by path', () => {
    writeNote(root, 'target.md', '# Target');
    writeNote(root, 'c-note.md', 'Mentions [[target]] here.');
    writeNote(root, 'a-note.md', 'Also links [[target]].');
    writeNote(root, 'b-note.md', 'Yet [[target]] again.');
    const result = getNoteBacklinks(root, 'target.md');
    expect(result.backlinks.map((b) => b.path)).toEqual(['a-note.md', 'b-note.md', 'c-note.md']);
  });
});

// SKY-11188: a Notes Board column item's `ref` counts as a backlink too
// (§4/§11) — this is the board-metadata half of "shows up in the Links tab".
describe('getNoteBacklinks — boardRefs (§4 column ref)', () => {
  let root: string;

  beforeEach(() => { root = tmpDir(); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  function writeSidecar(root: string, boardRelPath: string, furniture: unknown[]): void {
    const dir = boardRelPath ? path.join(root, boardRelPath) : root;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.mythos-board.json'),
      JSON.stringify({
        version: 2,
        id: 'board-1',
        updated: new Date(0).toISOString(),
        layout: {},
        colors: {},
        furniture,
        view: { zoom: 100, panX: 0, panY: 0 },
      }),
      'utf-8',
    );
  }

  it('finds a column item whose ref resolves to the note, by stem', () => {
    writeNote(root, 'target.md', '# Target');
    writeSidecar(root, 'Worldbuilding', [
      { id: 'x1', k: 'column', x: 0, y: 0, title: 'Quick links', items: [{ t: 'Target', ref: 'target.md' }] },
    ]);
    const result = getNoteBacklinks(root, 'target.md');
    expect(result.boardRefs).toEqual([
      { boardPath: 'Worldbuilding', boardItemTitle: 'Quick links', itemText: 'Target' },
    ]);
  });

  it('resolves case-insensitively and independently of a .md extension', () => {
    writeNote(root, 'Target.md', '# Target');
    writeSidecar(root, '', [
      { id: 'x1', k: 'column', x: 0, y: 0, items: [{ t: 'x', ref: 'target' }] },
    ]);
    const result = getNoteBacklinks(root, 'Target.md');
    expect(result.boardRefs).toHaveLength(1);
    expect(result.boardRefs[0].boardPath).toBe(''); // Home board
  });

  it('ignores non-column furniture and column items with no ref', () => {
    writeNote(root, 'target.md', '# Target');
    writeSidecar(root, '', [
      { id: 'x1', k: 'check', x: 0, y: 0, items: [{ t: 'target', done: false }] },
      { id: 'x2', k: 'column', x: 0, y: 0, items: [{ t: 'no ref here' }] },
    ]);
    const result = getNoteBacklinks(root, 'target.md');
    expect(result.boardRefs).toHaveLength(0);
  });

  it('ignores a ref pointing at a different note', () => {
    writeNote(root, 'target.md', '# Target');
    writeNote(root, 'other.md', '# Other');
    writeSidecar(root, '', [
      { id: 'x1', k: 'column', x: 0, y: 0, items: [{ t: 'Other', ref: 'other.md' }] },
    ]);
    const result = getNoteBacklinks(root, 'target.md');
    expect(result.boardRefs).toHaveLength(0);
  });

  it('collects refs from more than one board', () => {
    writeNote(root, 'target.md', '# Target');
    writeSidecar(root, 'BoardA', [
      { id: 'x1', k: 'column', x: 0, y: 0, items: [{ t: 'a', ref: 'target.md' }] },
    ]);
    writeSidecar(root, 'BoardB', [
      { id: 'x2', k: 'column', x: 0, y: 0, items: [{ t: 'b', ref: 'target.md' }] },
    ]);
    const result = getNoteBacklinks(root, 'target.md');
    expect(result.boardRefs.map((r) => r.boardPath).sort()).toEqual(['BoardA', 'BoardB']);
  });

  it('a note with no board refs still returns its prose backlinks unaffected', () => {
    writeNote(root, 'target.md', '# Target');
    writeNote(root, 'linker.md', 'See [[target]] here.');
    const result = getNoteBacklinks(root, 'target.md');
    expect(result.backlinks).toHaveLength(1);
    expect(result.boardRefs).toHaveLength(0);
  });
});
