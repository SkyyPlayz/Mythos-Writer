// SKY-8891: unit coverage for the notes-tree manual-order store — the
// read/sanitize path and the rewrite-on-move logic the NOTES_VAULT_MOVE
// handler applies so a rename/move can't strand stale paths in .vb-order.json.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ORDER_FILE_NAME,
  readOrderMap,
  writeOrderMap,
  rewriteOrderOnMove,
} from './vaultOrder.js';

describe('readOrderMap / writeOrderMap', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vb-order-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('returns {} when the order file is missing', () => {
    expect(readOrderMap(root)).toEqual({});
  });

  it('returns {} on malformed JSON', () => {
    fs.writeFileSync(path.join(root, ORDER_FILE_NAME), '{not json');
    expect(readOrderMap(root)).toEqual({});
  });

  it('returns {} on non-object payloads', () => {
    fs.writeFileSync(path.join(root, ORDER_FILE_NAME), '["a.md"]');
    expect(readOrderMap(root)).toEqual({});
  });

  it('drops wrong-shaped keys and non-string entries, keeps the rest', () => {
    fs.writeFileSync(
      path.join(root, ORDER_FILE_NAME),
      JSON.stringify({ '': ['b.md', 42, 'a.md'], Folder: 'nope', Other: ['x.md'] }),
    );
    expect(readOrderMap(root)).toEqual({ '': ['b.md', 'a.md'], Other: ['x.md'] });
  });

  it('round-trips a map through write + read', () => {
    const map = { '': ['Folder', 'b.md', 'a.md'], Folder: ['Folder/z.md', 'Folder/a.md'] };
    writeOrderMap(root, map);
    expect(readOrderMap(root)).toEqual(map);
  });
});

describe('rewriteOrderOnMove', () => {
  it('returns null when nothing references the moved path', () => {
    expect(rewriteOrderOnMove({ '': ['a.md', 'b.md'] }, 'c.md', 'Folder/c.md')).toBeNull();
  });

  it('same-parent rename keeps the entry slot', () => {
    const next = rewriteOrderOnMove(
      { '': ['b.md', 'a.md', 'c.md'] },
      'a.md',
      'renamed.md',
    );
    expect(next).toEqual({ '': ['b.md', 'renamed.md', 'c.md'] });
  });

  it('cross-parent move removes from the old array and appends to the new one', () => {
    const next = rewriteOrderOnMove(
      { '': ['a.md', 'b.md'], Folder: ['Folder/x.md'] },
      'a.md',
      'Folder/a.md',
    );
    expect(next).toEqual({ '': ['b.md'], Folder: ['Folder/x.md', 'Folder/a.md'] });
  });

  it('does not create an order array for an unordered destination folder', () => {
    const next = rewriteOrderOnMove({ '': ['a.md', 'b.md'] }, 'a.md', 'Folder/a.md');
    expect(next).toEqual({ '': ['b.md'] });
  });

  it('directory move rewrites keys and descendant entries by prefix', () => {
    const next = rewriteOrderOnMove(
      {
        '': ['Dir', 'note.md'],
        Dir: ['Dir/z.md', 'Dir/Sub'],
        'Dir/Sub': ['Dir/Sub/deep.md'],
        Other: ['Other/x.md'],
      },
      'Dir',
      'Other/Dir',
    );
    expect(next).toEqual({
      '': ['note.md'],
      'Other/Dir': ['Other/Dir/z.md', 'Other/Dir/Sub'],
      'Other/Dir/Sub': ['Other/Dir/Sub/deep.md'],
      Other: ['Other/x.md', 'Other/Dir'],
    });
  });

  it('does not rewrite same-prefix sibling names (Dir vs Dir2)', () => {
    const next = rewriteOrderOnMove(
      { '': ['Dir', 'Dir2'], Dir2: ['Dir2/a.md'] },
      'Dir',
      'Renamed',
    );
    expect(next).toEqual({ '': ['Renamed', 'Dir2'], Dir2: ['Dir2/a.md'] });
  });

  it('drops the old parent key when its array empties, appends to the root order', () => {
    const next = rewriteOrderOnMove(
      { Folder: ['Folder/only.md'], '': ['Folder'] },
      'Folder/only.md',
      'only.md',
    );
    expect(next).toEqual({ '': ['Folder', 'only.md'] });
  });

  it('does not double-append when the destination array already lists the path', () => {
    const next = rewriteOrderOnMove(
      { '': ['a.md'], Folder: ['Folder/a.md'] },
      'a.md',
      'Folder/a.md',
    );
    expect(next).toEqual({ Folder: ['Folder/a.md'] });
  });
});
