import { describe, it, expect } from 'vitest';
import { shouldBumpNavTreeOnVaultEvent, collectBoardsNavFolderPaths } from './boardsNavTopology';

describe('F1 H5 boardsNavTopology', () => {
  const known = new Set(['Characters', 'Characters/Locations', 'World']);

  it('never bumps on note content-save paths (*.md)', () => {
    expect(shouldBumpNavTreeOnVaultEvent('Alice.md', known)).toBe(false);
    expect(shouldBumpNavTreeOnVaultEvent('Characters/Alice.md', known)).toBe(false);
    expect(shouldBumpNavTreeOnVaultEvent('World/lore.md', new Set())).toBe(false);
  });

  it('never bumps when path is missing (call sites own those mutations)', () => {
    expect(shouldBumpNavTreeOnVaultEvent(undefined, known)).toBe(false);
    expect(shouldBumpNavTreeOnVaultEvent('', known)).toBe(false);
  });

  it('bumps on board/folder paths (new or known)', () => {
    expect(shouldBumpNavTreeOnVaultEvent('New board', known)).toBe(true);
    expect(shouldBumpNavTreeOnVaultEvent('Characters', known)).toBe(true);
    expect(shouldBumpNavTreeOnVaultEvent('Characters/Locations/Cities', known)).toBe(true);
  });

  it('collectBoardsNavFolderPaths walks nested nodes', () => {
    const paths = collectBoardsNavFolderPaths([
      {
        path: 'Characters',
        children: [{ path: 'Characters/Locations', children: [] }],
      },
    ]);
    expect([...paths].sort()).toEqual(['Characters', 'Characters/Locations']);
  });
});
