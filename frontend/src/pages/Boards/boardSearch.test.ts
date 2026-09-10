/**
 * SKY-11191 — cross-board search ranking and the board/item split it produces.
 *
 * The split is the load-bearing part: a hit is only useful if the panel can
 * turn it into "open THIS board, select THAT item", and `itemPath` has to be
 * relative to the board (BoardCanvas keys layout and selection by it) while
 * `boardPath` has to be vault-relative with Home as '' (SKY-11336).
 */
import { describe, it, expect } from 'vitest';
import { searchVaultIndex } from './boardSearch';
import type { VaultIndexEntry } from './boardSearch';

const entry = (path: string, isDirectory = false): VaultIndexEntry => ({
  path,
  name: path.split('/').pop()!,
  isDirectory,
});

const VAULT: VaultIndexEntry[] = [
  entry('Arc.md'),
  entry('Characters', true),
  entry('Characters/Aria.md'),
  entry('Characters/Minor', true),
  entry('Characters/Minor/Aria Notes.md'),
  entry('Places', true),
  entry('Places/Aria Bay.md'),
  entry('Places/cover.png'),
];

describe('searchVaultIndex', () => {
  it('splits a nested hit into the board that contains it and the item path within it', () => {
    const [hit] = searchVaultIndex(VAULT, 'Aria Notes');
    expect(hit).toMatchObject({
      boardPath: 'Characters/Minor',
      itemPath: 'Aria Notes.md',
      name: 'Aria Notes',
      kind: 'note',
      vaultPath: 'Characters/Minor/Aria Notes.md',
    });
  });

  it("uses '' — Home — as the board path for a vault-root item", () => {
    const [hit] = searchVaultIndex(VAULT, 'Arc');
    expect(hit.boardPath).toBe('');
    expect(hit.itemPath).toBe('Arc.md');
    expect(hit.boardLabel).toBe('Home');
  });

  it('ranks exact over prefix over substring, then shallower boards first', () => {
    const names = searchVaultIndex(VAULT, 'aria').map((h) => h.vaultPath);
    expect(names).toEqual([
      'Characters/Aria.md', // exact
      'Places/Aria Bay.md', // prefix, one level deep
      'Characters/Minor/Aria Notes.md', // prefix, two levels deep
    ]);
  });

  it('matches folders as well as notes — a board is a searchable thing too', () => {
    const [hit] = searchVaultIndex(VAULT, 'Characters');
    expect(hit).toMatchObject({ kind: 'folder', boardPath: '', itemPath: 'Characters' });
  });

  it('ignores files a board does not render — a hit must have somewhere to land', () => {
    expect(searchVaultIndex(VAULT, 'cover')).toEqual([]);
  });

  it('is case-insensitive and ignores surrounding whitespace', () => {
    expect(searchVaultIndex(VAULT, '  ARIA BAY ')).toHaveLength(1);
  });

  it('returns nothing for an empty or whitespace-only query rather than the whole vault', () => {
    expect(searchVaultIndex(VAULT, '')).toEqual([]);
    expect(searchVaultIndex(VAULT, '   ')).toEqual([]);
  });

  it('caps the result list', () => {
    const many = Array.from({ length: 60 }, (_, i) => entry(`Notes/Aria ${i}.md`));
    expect(searchVaultIndex(many, 'aria')).toHaveLength(20);
    expect(searchVaultIndex(many, 'aria', 5)).toHaveLength(5);
  });

  it('orders same-rank same-depth hits totally, so the list does not shuffle between renders', () => {
    const collide = [entry('A/Zed.md'), entry('B/Zed.md')];
    expect(searchVaultIndex(collide, 'zed').map((h) => h.vaultPath)).toEqual(['A/Zed.md', 'B/Zed.md']);
    expect(searchVaultIndex([...collide].reverse(), 'zed').map((h) => h.vaultPath)).toEqual([
      'A/Zed.md',
      'B/Zed.md',
    ]);
  });
});
