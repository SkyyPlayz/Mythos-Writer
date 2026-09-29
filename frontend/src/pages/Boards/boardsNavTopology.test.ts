import { describe, it, expect } from 'vitest';
import { shouldBumpNavTreeOnVaultEvent, collectBoardsNavFolderPaths } from './boardsNavTopology';

describe('F1 H5 boardsNavTopology', () => {
  const known = new Set(['Characters', 'Characters/Locations', 'World']);

  it('never bumps on note content-save paths (*.md)', () => {
    expect(shouldBumpNavTreeOnVaultEvent('Alice.md', known)).toBe(false);
    expect(shouldBumpNavTreeOnVaultEvent('Characters/Alice.md', known)).toBe(false);
    expect(shouldBumpNavTreeOnVaultEvent('World/lore.md', new Set())).toBe(false);
  });

  it('never bumps on asset paths with extensions', () => {
    expect(shouldBumpNavTreeOnVaultEvent('cover.png', known)).toBe(false);
    expect(shouldBumpNavTreeOnVaultEvent('Characters/map.webp', known)).toBe(false);
  });

  it('bumps on untargeted events (no path) — call sites / watcher unlink', () => {
    expect(shouldBumpNavTreeOnVaultEvent(undefined, known)).toBe(true);
    expect(shouldBumpNavTreeOnVaultEvent('', known)).toBe(true);
  });

  it('bumps on known-folder and extension-less board paths', () => {
    expect(shouldBumpNavTreeOnVaultEvent('Characters', known)).toBe(true);
    expect(shouldBumpNavTreeOnVaultEvent('New board', known)).toBe(true);
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
