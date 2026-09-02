import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildEntityIndex, aliasesVisibleBefore, parseScenePosition } from './entityIndex.js';
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
  it('extracts major from "Chapter 3"', () => {
    expect(parseScenePosition('Chapter 3')).toEqual({ major: 3, minor: 0 });
  });
  it('extracts major+minor from "Act 1 Scene 4"', () => {
    expect(parseScenePosition('Act 1 Scene 4')).toEqual({ major: 1, minor: 4 });
  });
  it('handles plain number strings', () => {
    expect(parseScenePosition('5')).toEqual({ major: 5, minor: 0 });
  });
  it('returns 0,0 for non-numeric strings', () => {
    expect(parseScenePosition('Prologue')).toEqual({ major: 0, minor: 0 });
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
});
