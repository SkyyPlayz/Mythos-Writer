import { describe, it, expect } from 'vitest';
import { buildWikiLinkPickerItems, matchesWikiLinkQuery, type WikiLinkCandidate } from './WikiLinkPicker';

function candidate(overrides: Partial<WikiLinkCandidate> = {}): WikiLinkCandidate {
  return { key: 'scene:scene-1', vault: 'story', kind: 'scene', title: 'Opening Scene', ...overrides };
}

describe('matchesWikiLinkQuery', () => {
  it('matches a case-insensitive substring of the title', () => {
    expect(matchesWikiLinkQuery(candidate({ title: 'Opening Scene' }), 'open')).toBe(true);
    expect(matchesWikiLinkQuery(candidate({ title: 'Opening Scene' }), 'SCENE')).toBe(true);
  });

  it('does not match an unrelated query', () => {
    expect(matchesWikiLinkQuery(candidate({ title: 'Opening Scene' }), 'zzz')).toBe(false);
  });

  it('does not match a blank query', () => {
    expect(matchesWikiLinkQuery(candidate(), '')).toBe(false);
  });
});

describe('buildWikiLinkPickerItems', () => {
  it('returns no items for an empty query, regardless of candidates', () => {
    expect(buildWikiLinkPickerItems([], '')).toEqual([]);
    expect(buildWikiLinkPickerItems([candidate()], '')).toEqual([]);
  });

  it('filters candidates by a case-insensitive substring match on title', () => {
    const items = buildWikiLinkPickerItems([candidate({ title: 'Opening Scene' }), candidate({ key: 'x', title: 'Unrelated' })], 'Opening');
    const titles = items.filter((i) => i.type === 'candidate').map((i) => i.type === 'candidate' ? i.candidate.title : '');
    expect(titles).toEqual(['Opening Scene']);
  });

  it('appends a trailing "create" item when the query has no exact-title match', () => {
    const items = buildWikiLinkPickerItems([candidate({ title: 'Opening Scene' })], 'Opening');
    expect(items).toHaveLength(2); // candidate + trailing "create" (title differs from query)
    expect(items[items.length - 1]).toEqual({ type: 'create', title: 'Opening' });
  });

  it('appends only a "create" item when no candidate matches the query at all', () => {
    const items = buildWikiLinkPickerItems([candidate({ title: 'Opening Scene' })], 'New Note');
    expect(items).toEqual([{ type: 'create', title: 'New Note' }]);
  });

  it('does not append a "create" item when a candidate title matches exactly (case-insensitive)', () => {
    const items = buildWikiLinkPickerItems([candidate({ title: 'Opening Scene' })], 'opening scene');
    expect(items.every((i) => i.type === 'candidate')).toBe(true);
  });

  it('returns no items for a blank/whitespace query', () => {
    expect(buildWikiLinkPickerItems([candidate()], '   ')).toEqual([]);
  });

  it('caps matched candidates at 8 results, still appending "create" after the cap', () => {
    const many = Array.from({ length: 12 }, (_, i) => candidate({ key: `s${i}`, title: `Scene ${i}` }));
    const items = buildWikiLinkPickerItems(many, 'Scene');
    const candidates = items.filter((i) => i.type === 'candidate');
    expect(candidates).toHaveLength(8);
    expect(items[items.length - 1]).toEqual({ type: 'create', title: 'Scene' });
  });
});
