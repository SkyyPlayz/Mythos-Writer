import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildEntityIndex } from './entityIndex.js';
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
});
