// SKY-9310 (M8 spec item 6, Iconize-style icons): unit coverage for the
// path-keyed icon store (.mythos/icons.json) — read/sanitize, set/clear, and
// the rewrite-on-move / remove-on-delete logic the notesVault:move and
// notesVault:delete handlers apply so an icon assignment survives rename and
// never strands a stale entry for a deleted path.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ICONS_DIR_NAME,
  ICONS_FILE_NAME,
  readIconMap,
  writeIconMap,
  setIcon,
  rewriteIconsOnMove,
  removeIconsUnderPath,
} from './vaultIcons.js';

describe('readIconMap / writeIconMap', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vb-icons-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('returns {} when the icons file is missing', () => {
    expect(readIconMap(root)).toEqual({});
  });

  it('returns {} on malformed JSON', () => {
    fs.mkdirSync(path.join(root, ICONS_DIR_NAME), { recursive: true });
    fs.writeFileSync(path.join(root, ICONS_DIR_NAME, ICONS_FILE_NAME), '{not json');
    expect(readIconMap(root)).toEqual({});
  });

  it('returns {} on non-object payloads', () => {
    fs.mkdirSync(path.join(root, ICONS_DIR_NAME), { recursive: true });
    fs.writeFileSync(path.join(root, ICONS_DIR_NAME, ICONS_FILE_NAME), '["a.md"]');
    expect(readIconMap(root)).toEqual({});
  });

  it('drops non-string and empty-string values, keeps the rest', () => {
    fs.mkdirSync(path.join(root, ICONS_DIR_NAME), { recursive: true });
    fs.writeFileSync(
      path.join(root, ICONS_DIR_NAME, ICONS_FILE_NAME),
      JSON.stringify({ 'a.md': '📖', 'b.md': 42, 'c.md': '', 'Folder': 'pack:lucide/sword' }),
    );
    expect(readIconMap(root)).toEqual({ 'a.md': '📖', Folder: 'pack:lucide/sword' });
  });

  it('round-trips a map through write + read, creating .mythos/ on demand', () => {
    const map = { 'a.md': '🔥', Folder: '🌍', 'Folder/b.md': 'pack:lucide/sword' };
    writeIconMap(root, map);
    expect(fs.existsSync(path.join(root, ICONS_DIR_NAME, ICONS_FILE_NAME))).toBe(true);
    expect(readIconMap(root)).toEqual(map);
  });
});

describe('setIcon', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vb-icons-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('assigns an icon and persists it', () => {
    const result = setIcon(root, 'Folder', '🌍');
    expect(result).toEqual({ Folder: '🌍' });
    expect(readIconMap(root)).toEqual({ Folder: '🌍' });
  });

  it('clears an icon when icon is null, leaving no dangling key', () => {
    setIcon(root, 'Folder', '🌍');
    const result = setIcon(root, 'Folder', null);
    expect(result).toEqual({});
    expect(readIconMap(root)).toEqual({});
  });

  it('overwrites an existing assignment for the same path', () => {
    setIcon(root, 'a.md', '📖');
    const result = setIcon(root, 'a.md', 'pack:lucide/sword');
    expect(result).toEqual({ 'a.md': 'pack:lucide/sword' });
  });

  it('leaves other entries untouched', () => {
    setIcon(root, 'a.md', '📖');
    const result = setIcon(root, 'b.md', '🔥');
    expect(result).toEqual({ 'a.md': '📖', 'b.md': '🔥' });
  });
});

describe('rewriteIconsOnMove', () => {
  it('returns null when nothing references the moved path', () => {
    expect(rewriteIconsOnMove({ 'a.md': '📖' }, 'c.md', 'Folder/c.md')).toBeNull();
  });

  it('rewrites a direct key match (file rename)', () => {
    expect(rewriteIconsOnMove({ 'a.md': '📖', 'b.md': '🔥' }, 'a.md', 'z.md')).toEqual({
      'z.md': '📖',
      'b.md': '🔥',
    });
  });

  it('rewrites a folder icon and every nested descendant icon on folder move', () => {
    const map = {
      Folder: '🌍',
      'Folder/a.md': '📖',
      'Folder/Sub/b.md': '🔥',
      'Other/c.md': '⭐',
    };
    expect(rewriteIconsOnMove(map, 'Folder', 'Renamed')).toEqual({
      Renamed: '🌍',
      'Renamed/a.md': '📖',
      'Renamed/Sub/b.md': '🔥',
      'Other/c.md': '⭐',
    });
  });

  it('does not confuse a same-prefix sibling for a nested descendant', () => {
    // "FolderTwo" must not be treated as nested under "Folder".
    const map = { Folder: '🌍', FolderTwo: '🔥' };
    expect(rewriteIconsOnMove(map, 'Folder', 'Moved')).toEqual({ Moved: '🌍', FolderTwo: '🔥' });
  });
});

describe('removeIconsUnderPath', () => {
  it('returns null when nothing references the deleted path', () => {
    expect(removeIconsUnderPath({ 'a.md': '📖' }, 'b.md')).toBeNull();
  });

  it('removes a direct key match', () => {
    expect(removeIconsUnderPath({ 'a.md': '📖', 'b.md': '🔥' }, 'a.md')).toEqual({ 'b.md': '🔥' });
  });

  it('removes a folder icon and every nested descendant icon on folder delete', () => {
    const map = { Folder: '🌍', 'Folder/a.md': '📖', 'Other/c.md': '⭐' };
    expect(removeIconsUnderPath(map, 'Folder')).toEqual({ 'Other/c.md': '⭐' });
  });

  it('does not confuse a same-prefix sibling for a nested descendant', () => {
    const map = { Folder: '🌍', FolderTwo: '🔥' };
    expect(removeIconsUnderPath(map, 'Folder')).toEqual({ FolderTwo: '🔥' });
  });
});
