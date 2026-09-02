// SKY-11183 (Notes Board 1/9): unit coverage for the board metadata store —
// lazy id assignment, path→id resolution across rename, GC of dangling
// Store B entries, debounced key-level-merged writes, furniture CRUD + line
// cascade-delete, and the item-delete stub. Real filesystem via
// fs.mkdtempSync (no fs mocking), matching vaultIcons.test.ts's pattern.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseFrontmatter } from './vault.js';
import {
  BOARD_SIDECAR_FILE_NAME,
  getBoard,
  resolveId,
  resolveOrAssignId,
  patchLayout,
  patchColors,
  flushPendingNotesBoardWrites,
  furnitureCreate,
  furnitureUpdate,
  furnitureDelete,
  itemRenameNotify,
  itemDeleteStub,
  gcBoardEntries,
  type BoardFile,
} from './notesBoard.js';

function writeNote(root: string, relPath: string, content: string): void {
  const abs = path.join(root, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
}

function readSidecar(folderAbs: string): BoardFile {
  const raw = fs.readFileSync(path.join(folderAbs, BOARD_SIDECAR_FILE_NAME), 'utf-8');
  return JSON.parse(raw);
}

describe('resolveId / resolveOrAssignId — notes', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vb-notesboard-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('a fresh note has no id: in frontmatter, and resolveId never assigns one', () => {
    writeNote(root, 'Idea.md', '# Idea\n\nSome body text.\n');
    expect(resolveId('note', path.join(root, 'Idea.md'))).toBeNull();
    // Re-read from disk — resolveId must not have written anything.
    const raw = fs.readFileSync(path.join(root, 'Idea.md'), 'utf-8');
    expect(raw).toBe('# Idea\n\nSome body text.\n');
  });

  it('resolveOrAssignId mints and persists an id, preserving other frontmatter + body', () => {
    writeNote(
      root,
      'Idea.md',
      '---\ntitle: Idea\ntags: [a, b]\n---\n# Idea\n\nSome body text.\n',
    );
    const abs = path.join(root, 'Idea.md');
    const id = resolveOrAssignId('note', abs);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);

    const raw = fs.readFileSync(abs, 'utf-8');
    const { frontmatter, prose } = parseFrontmatter(raw);
    expect(frontmatter.id).toBe(id);
    expect(frontmatter.title).toBe('Idea');
    expect(frontmatter.tags).toEqual(['a', 'b']);
    expect(prose).toBe('# Idea\n\nSome body text.\n');

    // Idempotent: calling again returns the SAME id, doesn't mint a new one.
    expect(resolveOrAssignId('note', abs)).toBe(id);
  });

  it('assigns an id to a note with no frontmatter at all', () => {
    writeNote(root, 'Bare.md', 'Just prose, no frontmatter.\n');
    const abs = path.join(root, 'Bare.md');
    const id = resolveOrAssignId('note', abs);
    const { frontmatter, prose } = parseFrontmatter(fs.readFileSync(abs, 'utf-8'));
    expect(frontmatter.id).toBe(id);
    expect(prose).toBe('Just prose, no frontmatter.\n');
  });
});

describe('resolveId / resolveOrAssignId — folders', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vb-notesboard-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('a fresh folder has no .mythos-board.json id until first touched', () => {
    fs.mkdirSync(path.join(root, 'Characters'));
    expect(resolveId('folder', path.join(root, 'Characters'))).toBeNull();
    expect(fs.existsSync(path.join(root, 'Characters', BOARD_SIDECAR_FILE_NAME))).toBe(false);
  });

  it('resolveOrAssignId mints and persists a folder id in its own sidecar', () => {
    fs.mkdirSync(path.join(root, 'Characters'));
    const abs = path.join(root, 'Characters');
    const id = resolveOrAssignId('folder', abs);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const sidecar = readSidecar(abs);
    expect(sidecar.id).toBe(id);
    expect(sidecar.version).toBe(2);
    expect(resolveOrAssignId('folder', abs)).toBe(id);
  });

  it('assigning a folder id does not disturb existing layout/furniture already in its sidecar', () => {
    fs.mkdirSync(path.join(root, 'Characters'));
    const abs = path.join(root, 'Characters');
    // Simulate the folder already being used as a board for its own
    // children (has layout data) before it is itself ever touched.
    fs.writeFileSync(
      path.join(abs, BOARD_SIDECAR_FILE_NAME),
      JSON.stringify({
        version: 2,
        id: '',
        updated: '2020-01-01T00:00:00.000Z',
        layout: { 'n:existing-id': { x: 1, y: 2 } },
        colors: {},
        furniture: [],
        view: { zoom: 100, panX: 0, panY: 0 },
      }),
    );
    const id = resolveOrAssignId('folder', abs);
    const sidecar = readSidecar(abs);
    expect(sidecar.id).toBe(id);
    expect(sidecar.layout).toEqual({ 'n:existing-id': { x: 1, y: 2 } });
  });
});

describe('getBoard — lazy id assignment (spec test 7)', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vb-notesboard-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('a never-arranged note has id: null in getBoard and no layout entry; getBoard never assigns one', () => {
    writeNote(root, 'Idea.md', '# Idea\n\nBody.\n');
    const board = getBoard(root, '');
    const child = board.children.find((c) => c.path === 'Idea.md');
    expect(child).toEqual({ path: 'Idea.md', kind: 'note', id: null });
    expect(board.layout).toEqual({});
    // getBoard must not have written an id into the note.
    const raw = fs.readFileSync(path.join(root, 'Idea.md'), 'utf-8');
    expect(raw).toBe('# Idea\n\nBody.\n');
  });

  it('touching the note once via patchLayout assigns an id, and only then does a layout entry appear', () => {
    writeNote(root, 'Idea.md', '# Idea\n\nBody.\n');

    // Before touch: no id, no layout entry.
    expect(getBoard(root, '').children[0].id).toBeNull();

    const { id } = patchLayout(root, '', 'Idea.md', { x: 10, y: 20 });
    expect(id).toBeTruthy();

    // The id is assigned immediately (structural, undebounced) even though
    // the layout entry write is still pending.
    const { frontmatter } = parseFrontmatter(fs.readFileSync(path.join(root, 'Idea.md'), 'utf-8'));
    expect(frontmatter.id).toBe(id);

    // Flush the debounced layout write, then the entry appears.
    flushPendingNotesBoardWrites(root);
    const board = getBoard(root, '');
    const child = board.children.find((c) => c.path === 'Idea.md');
    expect(child?.id).toBe(id);
    expect(board.layout[`n:${id}`]).toEqual({ x: 10, y: 20 });
  });

  it('touching via patchColors also lazily assigns an id', () => {
    writeNote(root, 'Idea.md', 'Body.\n');
    const { id } = patchColors(root, '', 'Idea.md', '#ff0000');
    flushPendingNotesBoardWrites(root);
    const board = getBoard(root, '');
    expect(board.colors[`n:${id}`]).toBe('#ff0000');
  });

  it('patchLayout on a missing item throws an error that names the caller-relative path, not the resolved absolute one', () => {
    // Matches vault.ts's convention (e.g. moveVaultFile's "Source does not
    // exist: <relPath>") so sanitizeIpcError's hardcoded absolute-path
    // pattern list isn't the only thing standing between this message and a
    // leaked host filesystem path (e.g. a vault under /mnt/ or /srv/, which
    // that pattern list doesn't cover).
    expect(() => patchLayout(root, '', 'Missing.md', { x: 0, y: 0 })).toThrow(
      /^notesBoard: item not found: Missing\.md$/,
    );
  });
});

describe('path→id resolution survives external rename (spec test 3, id-layer half)', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vb-notesboard-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('a note keeps its id across a real fs.renameSync, with zero Store B writes', () => {
    writeNote(root, 'Old Name.md', '# Idea\n');
    const { id } = patchLayout(root, '', 'Old Name.md', { x: 1, y: 1 });
    flushPendingNotesBoardWrites(root);

    const sidecarPath = path.join(root, BOARD_SIDECAR_FILE_NAME);
    const beforeContent = fs.readFileSync(sidecarPath, 'utf-8');
    const beforeMtime = fs.statSync(sidecarPath).mtimeMs;

    // Simulate an external rename (Obsidian / Explorer / Finder / sync) —
    // real fs.renameSync, not going through any notesBoard.ts function.
    fs.renameSync(path.join(root, 'Old Name.md'), path.join(root, 'New Name.md'));

    const board = getBoard(root, '');
    const child = board.children.find((c) => c.path === 'New Name.md');
    expect(child?.id).toBe(id);
    expect(board.layout[`n:${id}`]).toEqual({ x: 1, y: 1 });

    // Zero Store B writes: the sidecar's content and mtime are unchanged.
    const afterContent = fs.readFileSync(sidecarPath, 'utf-8');
    const afterMtime = fs.statSync(sidecarPath).mtimeMs;
    expect(afterContent).toBe(beforeContent);
    expect(afterMtime).toBe(beforeMtime);
  });

  it('a folder keeps its own id across a real fs.renameSync (sidecar moves with it)', () => {
    fs.mkdirSync(path.join(root, 'Old Folder'));
    const folderId = resolveOrAssignId('folder', path.join(root, 'Old Folder'));

    fs.renameSync(path.join(root, 'Old Folder'), path.join(root, 'New Folder'));

    const board = getBoard(root, '');
    const child = board.children.find((c) => c.path === 'New Folder');
    expect(child).toEqual({ path: 'New Folder', kind: 'folder', id: folderId });
    // The folder's own sidecar (with its id) moved with the rename, intact.
    expect(resolveId('folder', path.join(root, 'New Folder'))).toBe(folderId);
  });

  it('itemRenameNotify is a documented no-op — persists nothing', () => {
    writeNote(root, 'A.md', 'body');
    expect(itemRenameNotify(root, '', 'A.md', 'B.md')).toEqual({ ok: true });
    expect(fs.existsSync(path.join(root, BOARD_SIDECAR_FILE_NAME))).toBe(false);
  });
});

describe('GC of dangling Store B entries (spec test 2, data half)', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vb-notesboard-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('drops a layout/colors entry whose id has no live child, keeps untouched notes unaffected, and writes the GC back to disk', () => {
    writeNote(root, 'Kept.md', 'kept, never touched\n');
    fs.writeFileSync(
      path.join(root, BOARD_SIDECAR_FILE_NAME),
      JSON.stringify({
        version: 2,
        id: '',
        updated: '2020-01-01T00:00:00.000Z',
        layout: { 'n:dangling-id': { x: 5, y: 5 } },
        colors: { 'n:dangling-id': '#fff', 'v:also-dangling': '#000' },
        furniture: [],
        view: { zoom: 100, panX: 0, panY: 0 },
      }),
    );

    const board = getBoard(root, '');
    expect(board.layout).toEqual({});
    expect(board.colors).toEqual({});
    const kept = board.children.find((c) => c.path === 'Kept.md');
    expect(kept).toEqual({ path: 'Kept.md', kind: 'note', id: null });

    // Reload from disk — GC was actually written back, not just in-memory.
    const onDisk = readSidecar(root);
    expect(onDisk.layout).toEqual({});
    expect(onDisk.colors).toEqual({});
  });

  it('does not write back when nothing was pruned (no needless disk writes)', () => {
    writeNote(root, 'A.md', 'a\n');
    const { id } = patchLayout(root, '', 'A.md', { x: 1, y: 1 });
    flushPendingNotesBoardWrites(root);
    const mtimeBefore = fs.statSync(path.join(root, BOARD_SIDECAR_FILE_NAME)).mtimeMs;

    const board1 = getBoard(root, '');
    expect(board1.layout[`n:${id}`]).toEqual({ x: 1, y: 1 });

    const mtimeAfter = fs.statSync(path.join(root, BOARD_SIDECAR_FILE_NAME)).mtimeMs;
    expect(mtimeAfter).toBe(mtimeBefore);
  });

  it('gcBoardEntries is independently testable as a pure function', () => {
    const board: BoardFile = {
      version: 2,
      id: 'folder-id',
      updated: '2020-01-01T00:00:00.000Z',
      layout: { 'n:live': { x: 1, y: 1 }, 'n:dead': { x: 2, y: 2 } },
      colors: { 'n:live': '#111', 'n:dead': '#222' },
      furniture: [{ id: 'f1', k: 'swatch', x: 0, y: 0 }],
      view: { zoom: 100, panX: 0, panY: 0 },
    };
    const { board: gcd, changed } = gcBoardEntries(board, new Set(['live']));
    expect(changed).toBe(true);
    expect(gcd.layout).toEqual({ 'n:live': { x: 1, y: 1 } });
    expect(gcd.colors).toEqual({ 'n:live': '#111' });
    // furniture untouched by GC (not derived from Store A).
    expect(gcd.furniture).toEqual(board.furniture);

    const { changed: unchanged } = gcBoardEntries(gcd, new Set(['live']));
    expect(unchanged).toBe(false);
  });
});

describe('deleting the whole .mythos-board.json and reloading (spec test 2)', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vb-notesboard-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('reconstructs with vault contents intact, items unassigned, nothing throws, and no sidecar is (re)created', () => {
    writeNote(root, 'A.md', 'a\n');
    writeNote(root, 'B.md', 'b\n');
    fs.mkdirSync(path.join(root, 'Sub'));

    const { id } = patchLayout(root, '', 'A.md', { x: 1, y: 1 });
    flushPendingNotesBoardWrites(root);
    expect(fs.existsSync(path.join(root, BOARD_SIDECAR_FILE_NAME))).toBe(true);

    fs.rmSync(path.join(root, BOARD_SIDECAR_FILE_NAME));

    expect(() => getBoard(root, '')).not.toThrow();
    const board = getBoard(root, '');
    expect(board.id).toBeNull();
    expect(board.layout).toEqual({});
    const paths = board.children.map((c) => c.path).sort();
    expect(paths).toEqual(['A.md', 'B.md', 'Sub']);
    // A.md's id lived in ITS OWN frontmatter, unaffected by the sidecar delete.
    const aChild = board.children.find((c) => c.path === 'A.md');
    expect(aChild?.id).toBe(id);
    // getBoard must not have resurrected the sidecar file.
    expect(fs.existsSync(path.join(root, BOARD_SIDECAR_FILE_NAME))).toBe(false);
  });
});

describe('debounced concurrent writes (spec test 11)', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vb-notesboard-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('two near-simultaneous layout writes to DIFFERENT keys on the same board both persist', () => {
    writeNote(root, 'A.md', 'a\n');
    writeNote(root, 'B.md', 'b\n');

    const { id: idA } = patchLayout(root, '', 'A.md', { x: 1, y: 1 });
    const { id: idB } = patchLayout(root, '', 'B.md', { x: 2, y: 2 });

    flushPendingNotesBoardWrites(root);

    const board = getBoard(root, '');
    expect(board.layout[`n:${idA}`]).toEqual({ x: 1, y: 1 });
    expect(board.layout[`n:${idB}`]).toEqual({ x: 2, y: 2 });
  });

  it('two patches to the SAME key within one window: the later one wins', () => {
    writeNote(root, 'A.md', 'a\n');
    const { id } = patchLayout(root, '', 'A.md', { x: 1, y: 1 });
    patchLayout(root, '', 'A.md', { x: 9, y: 9 });
    flushPendingNotesBoardWrites(root);

    const board = getBoard(root, '');
    expect(board.layout[`n:${id}`]).toEqual({ x: 9, y: 9 });
  });

  it('a drag-only {x,y} patch does not erase a previously-set {w,h}', () => {
    writeNote(root, 'A.md', 'a\n');
    const { id } = patchLayout(root, '', 'A.md', { x: 1, y: 1, w: 200, h: 100 });
    flushPendingNotesBoardWrites(root);

    patchLayout(root, '', 'A.md', { x: 5, y: 5 });
    flushPendingNotesBoardWrites(root);

    const board = getBoard(root, '');
    expect(board.layout[`n:${id}`]).toEqual({ x: 5, y: 5, w: 200, h: 100 });
  });

  it('a layout patch and a colour patch to the same board coalesce into one flush', () => {
    writeNote(root, 'A.md', 'a\n');
    const { id: idLayout } = patchLayout(root, '', 'A.md', { x: 1, y: 1 });
    const { id: idColor } = patchColors(root, '', 'A.md', '#abcabc');
    expect(idLayout).toBe(idColor);

    flushPendingNotesBoardWrites(root);
    const board = getBoard(root, '');
    expect(board.layout[`n:${idLayout}`]).toEqual({ x: 1, y: 1 });
    expect(board.colors[`n:${idLayout}`]).toBe('#abcabc');
  });

  it('a null colour patch clears a previously-set colour', () => {
    writeNote(root, 'A.md', 'a\n');
    const { id } = patchColors(root, '', 'A.md', '#111111');
    flushPendingNotesBoardWrites(root);
    expect(getBoard(root, '').colors[`n:${id}`]).toBe('#111111');

    patchColors(root, '', 'A.md', null);
    flushPendingNotesBoardWrites(root);
    expect(getBoard(root, '').colors[`n:${id}`]).toBeUndefined();
  });

  it('flushPendingNotesBoardWrites(vaultRoot) only drains boards under that root', () => {
    const otherRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vb-notesboard-other-'));
    try {
      writeNote(root, 'A.md', 'a\n');
      writeNote(otherRoot, 'B.md', 'b\n');
      patchLayout(root, '', 'A.md', { x: 1, y: 1 });
      patchLayout(otherRoot, '', 'B.md', { x: 2, y: 2 });

      flushPendingNotesBoardWrites(root);

      expect(fs.existsSync(path.join(root, BOARD_SIDECAR_FILE_NAME))).toBe(true);
      expect(fs.existsSync(path.join(otherRoot, BOARD_SIDECAR_FILE_NAME))).toBe(false);

      flushPendingNotesBoardWrites(otherRoot);
      expect(fs.existsSync(path.join(otherRoot, BOARD_SIDECAR_FILE_NAME))).toBe(true);
    } finally {
      fs.rmSync(otherRoot, { recursive: true, force: true });
    }
  });
});

describe('furniture CRUD + line cascade-delete (§4)', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vb-notesboard-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('furnitureCreate assigns an id and writes immediately (no debounce)', () => {
    const item = furnitureCreate(root, '', { k: 'swatch', x: 10, y: 20, colors: ['#fff', '#000'] });
    expect(item.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(item.k).toBe('swatch');
    // No flush needed — structural write already landed on disk.
    const board = getBoard(root, '');
    expect(board.furniture).toEqual([item]);
  });

  it('furnitureUpdate shallow-merges a patch into the matching entry', () => {
    const created = furnitureCreate(root, '', { k: 'check', x: 0, y: 0, items: [{ t: 'one', done: false }] });
    const updated = furnitureUpdate(root, '', created.id, { x: 50, title: 'My List' });
    expect(updated).toEqual({ ...created, x: 50, title: 'My List' });
    expect(getBoard(root, '').furniture).toEqual([updated]);
  });

  it('furnitureUpdate on an unknown id returns null and touches nothing', () => {
    furnitureCreate(root, '', { k: 'swatch', x: 0, y: 0 });
    expect(furnitureUpdate(root, '', 'nonexistent', { x: 1 })).toBeNull();
  });

  it('furnitureDelete removes the item and cascade-deletes referencing line entries', () => {
    const box = furnitureCreate(root, '', { k: 'swatch', x: 0, y: 0 });
    writeNote(root, 'Note.md', 'n\n');
    const { id: noteId } = patchLayout(root, '', 'Note.md', { x: 1, y: 1 });
    flushPendingNotesBoardWrites(root);

    const line1 = furnitureCreate(root, '', {
      k: 'line',
      x: 0,
      y: 0,
      from: `x:${box.id}`,
      to: `n:${noteId}`,
    });
    const unrelatedLine = furnitureCreate(root, '', {
      k: 'line',
      x: 0,
      y: 0,
      from: `n:${noteId}`,
      to: `n:${noteId}`,
    });

    const result = furnitureDelete(root, '', box.id);
    expect(result).toEqual({ deleted: true });

    const board = getBoard(root, '');
    const furnitureIds = board.furniture.map((f) => f.id);
    expect(furnitureIds).not.toContain(box.id);
    expect(furnitureIds).not.toContain(line1.id);
    expect(furnitureIds).toContain(unrelatedLine.id);
  });

  it('furnitureDelete on an unknown id returns deleted:false', () => {
    expect(furnitureDelete(root, '', 'nonexistent')).toEqual({ deleted: false });
  });

  it('furnitureCreate throws for a folder that does not exist in Store A, instead of silently creating it', () => {
    expect(() =>
      furnitureCreate(root, 'GhostFolder', { k: 'swatch', x: 0, y: 0 }),
    ).toThrow(/not found/);
    // Store B must never be authoritative about existence (§1) — no folder,
    // no sidecar, should have been materialized as a side effect.
    expect(fs.existsSync(path.join(root, 'GhostFolder'))).toBe(false);
  });
});

describe('itemDeleteStub (§6 stub — Store B cleanup only, never touches real fs)', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vb-notesboard-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('drops the item’s own layout/colors entry from the parent board, cascades line furniture, and never touches the real file', () => {
    writeNote(root, 'A.md', 'a\n');
    const { id } = patchLayout(root, '', 'A.md', { x: 1, y: 1 });
    patchColors(root, '', 'A.md', '#123123');
    flushPendingNotesBoardWrites(root);

    const line = furnitureCreate(root, '', { k: 'line', x: 0, y: 0, from: `n:${id}`, to: `n:${id}` });

    const result = itemDeleteStub(root, '', 'A.md');
    expect(result).toEqual({ key: `n:${id}` });

    // Never touches the real fs entry.
    expect(fs.existsSync(path.join(root, 'A.md'))).toBe(true);

    const board = getBoard(root, '');
    expect(board.layout[`n:${id}`]).toBeUndefined();
    expect(board.colors[`n:${id}`]).toBeUndefined();
    expect(board.furniture.map((f) => f.id)).not.toContain(line.id);
    // The note itself is still enumerated (Store A untouched) — just with no metadata.
    const child = board.children.find((c) => c.path === 'A.md');
    expect(child?.id).toBe(id);
  });

  it('returns key: null and writes nothing for an item that was never touched', () => {
    writeNote(root, 'Untouched.md', 'x\n');
    const result = itemDeleteStub(root, '', 'Untouched.md');
    expect(result).toEqual({ key: null });
    expect(fs.existsSync(path.join(root, BOARD_SIDECAR_FILE_NAME))).toBe(false);
  });

  it('works for a folder item too, dropping its v:<id> entry', () => {
    fs.mkdirSync(path.join(root, 'Sub'));
    const { id } = patchLayout(root, '', 'Sub', { x: 3, y: 3 });
    flushPendingNotesBoardWrites(root);

    const result = itemDeleteStub(root, '', 'Sub');
    expect(result).toEqual({ key: `v:${id}` });
    expect(fs.existsSync(path.join(root, 'Sub'))).toBe(true);
    expect(getBoard(root, '').layout[`v:${id}`]).toBeUndefined();
  });

  it('drops a still-buffered (not yet flushed) debounced patch for the deleted key, so a later flush cannot resurrect it', () => {
    writeNote(root, 'B.md', 'b\n');
    // patchLayout only schedules the write — nothing on disk yet.
    const { id, key } = patchLayout(root, '', 'B.md', { x: 5, y: 5 });

    itemDeleteStub(root, '', 'B.md');
    fs.rmSync(path.join(root, 'B.md'));

    // Drain the debounce window as the real quit-time flush would.
    flushPendingNotesBoardWrites(root);

    expect(fs.existsSync(path.join(root, BOARD_SIDECAR_FILE_NAME))).toBe(false);
    expect(getBoard(root, '').layout[key]).toBeUndefined();
    expect(id).toBeTruthy();
  });
});

describe('nested folder boards (getBoard on a non-root folderRelPath)', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vb-notesboard-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('lists a subfolder’s own immediate children and stores its board file inside that subfolder', () => {
    fs.mkdirSync(path.join(root, 'Characters'));
    writeNote(root, 'Characters/Hero.md', '# Hero\n');
    writeNote(root, 'Root Note.md', '# Root\n');

    const { id } = patchLayout(root, 'Characters', 'Hero.md', { x: 7, y: 8 });
    flushPendingNotesBoardWrites(root);

    expect(fs.existsSync(path.join(root, 'Characters', BOARD_SIDECAR_FILE_NAME))).toBe(true);
    expect(fs.existsSync(path.join(root, BOARD_SIDECAR_FILE_NAME))).toBe(false);

    const board = getBoard(root, 'Characters');
    expect(board.children).toEqual([{ path: 'Hero.md', kind: 'note', id }]);
    expect(board.layout[`n:${id}`]).toEqual({ x: 7, y: 8 });
  });
});
