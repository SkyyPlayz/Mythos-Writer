import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildEntityIndex,
  aliasesVisibleBefore,
  parseScenePosition,
  compareScenePositions,
} from './entityIndex.js';
import type { Dirent } from 'fs';

vi.mock('fs');

import fs from 'fs';

type MockDirent = { name: string; isFile: () => boolean; isDirectory: () => boolean };

function mockDirent(name: string, isFile: boolean): Dirent {
  return { name, isFile: () => isFile, isDirectory: () => !isFile } as unknown as Dirent;
}

describe('buildEntityIndex', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns empty when directories do not exist', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const result = buildEntityIndex('/vault');
    expect(result).toEqual([]);
  });

  it('builds index from Universes directory', () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      const ps = String(p);
      return ps.includes('Universes') || ps.includes('Stories');
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(fs.readdirSync).mockImplementation((dir: any) => {
      const d = String(dir);
      if (d.endsWith('Universes')) return [mockDirent('Lyra.md', true)] as unknown as any;
      if (d.endsWith('Stories')) return [] as unknown as any;
      return [] as unknown as any;
    });
    vi.mocked(fs.readFileSync).mockReturnValue('---\naliases: [The Starchild]\ntype: Character\n---\nA hero.' as unknown as ReturnType<typeof fs.readFileSync>);

    const result = buildEntityIndex('/vault');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Lyra');
    expect(result[0].aliases).toEqual(['The Starchild']);
    expect(result[0].type).toBe('Character');
  });

  it('skips files that cannot be read', () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => String(p).includes('Universes'));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(fs.readdirSync).mockImplementation((dir: any) => {
      if (String(dir).endsWith('Universes')) return [mockDirent('broken.md', true)] as unknown as any;
      return [] as unknown as any;
    });
    vi.mocked(fs.readFileSync).mockImplementation(() => { throw new Error('EACCES'); });

    const result = buildEntityIndex('/vault');
    expect(result).toHaveLength(0);
  });

  it('recurses into subdirectories', () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => String(p).includes('Universes'));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(fs.readdirSync).mockImplementation((dir: any) => {
      const d = String(dir);
      if (d.endsWith('Universes')) return [mockDirent('Characters', false)] as unknown as any;
      if (d.endsWith('Characters')) return [mockDirent('Arya.md', true)] as unknown as any;
      return [] as unknown as any;
    });
    vi.mocked(fs.readFileSync).mockReturnValue('---\ntype: Character\n---\n' as unknown as ReturnType<typeof fs.readFileSync>);

    const result = buildEntityIndex('/vault');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Arya');
  });

  it('parses reveal_point from frontmatter (AC1)', () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => String(p).includes('Universes'));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(fs.readdirSync).mockImplementation((dir: any) => {
      if (String(dir).endsWith('Universes')) return [mockDirent('Mab.md', true)] as unknown as any;
      return [] as unknown as any;
    });
    vi.mocked(fs.readFileSync).mockReturnValue('---\naliases: [The Shadow]\ntype: Character\nreveal_point: Chapter 5\n---\n' as unknown as ReturnType<typeof fs.readFileSync>);

    const result = buildEntityIndex('/vault');
    expect(result[0].reveal_point).toBe('Chapter 5');
  });

  it('sets reveal_point to null when not present (AC5 backward compat)', () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => String(p).includes('Universes'));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(fs.readdirSync).mockImplementation((dir: any) => {
      if (String(dir).endsWith('Universes')) return [mockDirent('Lyra.md', true)] as unknown as any;
      return [] as unknown as any;
    });
    vi.mocked(fs.readFileSync).mockReturnValue('---\naliases: [The Starchild]\ntype: Character\n---\n' as unknown as ReturnType<typeof fs.readFileSync>);

    const result = buildEntityIndex('/vault');
    expect(result[0].reveal_point).toBeNull();
  });
});

describe('parseScenePosition', () => {
  const pos = (p: Partial<ReturnType<typeof parseScenePosition>>) => ({
    stage: 0,
    part: 0,
    chapter: 0,
    scene: 0,
    ...p,
  });

  it('binds "Chapter 3" to the chapter axis', () => {
    expect(parseScenePosition('Chapter 3')).toEqual(pos({ chapter: 3 }));
  });
  it('folds "Act" onto the chapter axis (same structural level)', () => {
    expect(parseScenePosition('Act 2')).toEqual(pos({ chapter: 2 }));
  });
  it('binds label-qualified numbers to their own axis, regardless of order', () => {
    expect(parseScenePosition('Act 1 Scene 4')).toEqual(pos({ chapter: 1, scene: 4 }));
    expect(parseScenePosition('Scene 4 Chapter 1')).toEqual(pos({ chapter: 1, scene: 4 }));
  });
  it('binds "Scene 12" to the scene axis, NOT the chapter axis (SKY-11318 fix)', () => {
    // The old digit-scraper made this {major:12}, which miscompared against
    // "Chapter 3" ({major:3}). Now the scene index stays on the scene axis.
    expect(parseScenePosition('Scene 12')).toEqual(pos({ scene: 12 }));
  });
  it('parses a fully-qualified Part/Chapter/Scene triple', () => {
    expect(parseScenePosition('Part 2 Chapter 3 Scene 5')).toEqual(
      pos({ part: 2, chapter: 3, scene: 5 }),
    );
  });
  it('is case-insensitive', () => {
    expect(parseScenePosition('chapter 7')).toEqual(pos({ chapter: 7 }));
  });
  it('marks Prologue before the body and Epilogue after it', () => {
    expect(parseScenePosition('Prologue')).toEqual(pos({ stage: -1 }));
    expect(parseScenePosition('Epilogue')).toEqual(pos({ stage: 1 }));
  });
  it('falls back to legacy positional parse for bare numbers', () => {
    expect(parseScenePosition('5')).toEqual(pos({ chapter: 5 }));
    expect(parseScenePosition('3.2')).toEqual(pos({ chapter: 3, scene: 2 }));
  });
  it('returns the origin for label-free, number-free strings', () => {
    expect(parseScenePosition('Somewhere')).toEqual(pos({}));
  });
});

describe('compareScenePositions', () => {
  const p = parseScenePosition;
  it('orders Prologue < body < Epilogue', () => {
    expect(compareScenePositions(p('Prologue'), p('Chapter 1'))).toBeLessThan(0);
    expect(compareScenePositions(p('Epilogue'), p('Chapter 99'))).toBeGreaterThan(0);
  });
  it('orders Act and Chapter on the same axis', () => {
    expect(compareScenePositions(p('Act 2'), p('Chapter 3'))).toBeLessThan(0);
    expect(compareScenePositions(p('Chapter 3'), p('Act 2'))).toBeGreaterThan(0);
  });
  it('breaks chapter ties by scene', () => {
    expect(compareScenePositions(p('Chapter 3 Scene 1'), p('Chapter 3 Scene 4'))).toBeLessThan(0);
    expect(compareScenePositions(p('Chapter 3 Scene 4'), p('Chapter 3 Scene 4'))).toBe(0);
  });
  it('prioritizes part over chapter', () => {
    expect(compareScenePositions(p('Part 1 Chapter 99'), p('Part 2 Chapter 1'))).toBeLessThan(0);
  });
});

describe('aliasesVisibleBefore', () => {
  const entries = [
    { name: 'Ghost', aliases: ['Specter'], type: 'Character', path: '/Ghost.md', reveal_point: 'Chapter 5' },
    { name: 'King', aliases: ['His Majesty'], type: 'Character', path: '/King.md', reveal_point: null },
    { name: 'Shadow', aliases: [], type: 'Character', path: '/Shadow.md', reveal_point: 'Chapter 10' },
  ];

  it('includes entries with no reveal_point (AC5)', () => {
    const result = aliasesVisibleBefore(entries, 'Chapter 1');
    expect(result.find((e) => e.name === 'King')).toBeDefined();
  });

  it('excludes entries whose reveal_point has not been reached (AC2)', () => {
    const result = aliasesVisibleBefore(entries, 'Chapter 4');
    expect(result.find((e) => e.name === 'Ghost')).toBeUndefined();
    expect(result.find((e) => e.name === 'Shadow')).toBeUndefined();
  });

  it('includes entries exactly at the current position', () => {
    const result = aliasesVisibleBefore(entries, 'Chapter 5');
    expect(result.find((e) => e.name === 'Ghost')).toBeDefined();
  });

  it('includes all entries after all reveal points are passed', () => {
    const result = aliasesVisibleBefore(entries, 'Chapter 11');
    expect(result).toHaveLength(3);
  });

  it('does not miscompare a scene-axis reveal against a chapter-axis position (SKY-11318 fix)', () => {
    // "Scene 2" is a scene index with no chapter; under the old digit-scraper it
    // parsed to major=2 and was hidden until currentPosition's first integer
    // reached 2. It must not be gated by an unrelated chapter number.
    const sceneEntries = [
      { name: 'Twist', aliases: [], type: 'Character', path: '/Twist.md', reveal_point: 'Scene 2' },
    ];
    // Chapter 3 (chapter axis) does not accidentally satisfy a scene-2 reveal
    // via raw digit order (3 >= 2); the scene reveal is on its own axis.
    const atCh3Sc1 = aliasesVisibleBefore(sceneEntries, 'Chapter 3 Scene 1');
    expect(atCh3Sc1.find((e) => e.name === 'Twist')).toBeDefined();
  });

  it('treats Prologue as before Chapter 1 and Epilogue as after the last chapter', () => {
    const prologueEntry = [
      { name: 'Seer', aliases: [], type: 'Character', path: '/Seer.md', reveal_point: 'Prologue' },
    ];
    expect(aliasesVisibleBefore(prologueEntry, 'Chapter 1')).toHaveLength(1);

    const epilogueEntry = [
      { name: 'Fate', aliases: [], type: 'Character', path: '/Fate.md', reveal_point: 'Epilogue' },
    ];
    expect(aliasesVisibleBefore(epilogueEntry, 'Chapter 99')).toHaveLength(0);
    expect(aliasesVisibleBefore(epilogueEntry, 'Epilogue')).toHaveLength(1);
  });
});
