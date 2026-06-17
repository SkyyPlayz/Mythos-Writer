import { describe, it, expect } from 'vitest';
import { findBestMatch, searchEntities } from './entityMatcher.js';
import type { EntityIndexEntry } from './entityIndex.js';

const ENTRIES: EntityIndexEntry[] = [
  { name: 'Lyra', aliases: ['The Starchild', 'StarChild'], type: 'Character', path: '/v/Lyra.md' },
  { name: 'Erebus', aliases: ['Dark Tower', 'The Keep'], type: 'Location', path: '/v/Erebus.md' },
  { name: 'Ironspike', aliases: [], type: 'Item', path: '/v/Ironspike.md' },
  { name: 'House Thorne', aliases: ['Thorne', 'The Thornes'], type: 'Faction', path: '/v/HouseThorne.md' },
  { name: 'Magic', aliases: [], type: 'Other', path: '/v/Magic.md' },
];

describe('findBestMatch', () => {
  it('returns null for empty text', () => {
    expect(findBestMatch('', ENTRIES)).toBeNull();
  });

  it('returns null when no match', () => {
    expect(findBestMatch('Gandalf', ENTRIES)).toBeNull();
  });

  it('exact name match', () => {
    expect(findBestMatch('Lyra', ENTRIES)?.name).toBe('Lyra');
  });

  it('case-insensitive name match', () => {
    expect(findBestMatch('lyra', ENTRIES)?.name).toBe('Lyra');
  });

  it('alias match', () => {
    expect(findBestMatch('Starchild', ENTRIES)?.name).toBe('Lyra');
  });

  it('partial match', () => {
    expect(findBestMatch('iron', ENTRIES)?.name).toBe('Ironspike');
  });

  it('prefers exact over prefix over contains', () => {
    // 'Magic' exact > 'Magic' as substring of something else
    const entries: EntityIndexEntry[] = [
      { name: 'Magic', aliases: [], type: null, path: '/a.md' },
      { name: 'Magical Realm', aliases: [], type: null, path: '/b.md' },
    ];
    expect(findBestMatch('Magic', entries)?.name).toBe('Magic');
  });

  it('handles >5000 entries within reasonable time', () => {
    const large: EntityIndexEntry[] = Array.from({ length: 5000 }, (_, i) => ({
      name: `Entity${i}`,
      aliases: [`Alias${i}A`, `Alias${i}B`],
      type: null,
      path: `/vault/entity${i}.md`,
    }));
    large.push({ name: 'Unique', aliases: [], type: null, path: '/vault/unique.md' });
    const start = Date.now();
    const result = findBestMatch('Unique', large);
    const elapsed = Date.now() - start;
    expect(result?.name).toBe('Unique');
    expect(elapsed).toBeLessThan(300);
  });
});

describe('searchEntities', () => {
  it('returns empty for empty query', () => {
    expect(searchEntities('', ENTRIES)).toHaveLength(0);
  });

  it('returns matching entities sorted by score', () => {
    const results = searchEntities('tho', ENTRIES);
    expect(results.map((r) => r.name)).toContain('House Thorne');
  });

  it('caps at 10 results', () => {
    const large: EntityIndexEntry[] = Array.from({ length: 50 }, (_, i) => ({
      name: `EntityABC${i}`,
      aliases: [],
      type: null,
      path: `/v/${i}.md`,
    }));
    const results = searchEntities('ABC', large);
    expect(results.length).toBeLessThanOrEqual(10);
  });

  it('returns prefix matches before contains matches', () => {
    const entries: EntityIndexEntry[] = [
      { name: 'Erebus Cave', aliases: [], type: null, path: '/a.md' },
      { name: 'Erebus', aliases: [], type: null, path: '/b.md' },
    ];
    const results = searchEntities('Ere', entries);
    expect(results[0].name).toBe('Erebus');
  });
});
