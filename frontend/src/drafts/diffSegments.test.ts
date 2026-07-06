// M12 — exact-value tests for the word-level LCS diff behind the drafts
// compare views (insert / delete / replace / same, paragraph splitting).
import { describe, it, expect } from 'vitest';
import { countWords, diffSegments, sideParagraphs } from './diffSegments';

describe('diffSegments', () => {
  it('returns a single same segment for identical text', () => {
    expect(diffSegments('a b c', 'a b c')).toEqual([{ t: 'a b c', k: 's' }]);
  });

  it('returns [] when both sides are empty', () => {
    expect(diffSegments('', '')).toEqual([]);
  });

  it('marks an inserted word as a single added segment', () => {
    expect(diffSegments('The cat sat', 'The black cat sat')).toEqual([
      { t: 'The ', k: 's' },
      { t: 'black ', k: 'a' },
      { t: 'cat sat', k: 's' },
    ]);
  });

  it('marks a deleted word as a single removed segment', () => {
    expect(diffSegments('The black cat sat', 'The cat sat')).toEqual([
      { t: 'The ', k: 's' },
      { t: 'black ', k: 'd' },
      { t: 'cat sat', k: 's' },
    ]);
  });

  it('emits removed-then-added pairs at each replace point', () => {
    expect(diffSegments('Cold air drifted up', 'Damp air rolled up')).toEqual([
      { t: 'Cold ', k: 'd' },
      { t: 'Damp ', k: 'a' },
      { t: 'air ', k: 's' },
      { t: 'drifted ', k: 'd' },
      { t: 'rolled ', k: 'a' },
      { t: 'up', k: 's' },
    ]);
  });

  it('handles a prototype-style sentence edit as clean word runs', () => {
    expect(
      diffSegments(
        'Kael pulled his hood up and signaled for Mira to move first.',
        'Kael tightened his hood and signaled for Mira to move first.',
      ),
    ).toEqual([
      { t: 'Kael ', k: 's' },
      { t: 'pulled ', k: 'd' },
      { t: 'tightened ', k: 'a' },
      { t: 'his hood ', k: 's' },
      { t: 'up ', k: 'd' },
      { t: 'and signaled for Mira to move first.', k: 's' },
    ]);
  });

  it('treats everything as added when the old side is empty', () => {
    expect(diffSegments('', 'brand new text')).toEqual([{ t: 'brand new text', k: 'a' }]);
  });

  it('treats everything as removed when the new side is empty', () => {
    expect(diffSegments('all gone now', '')).toEqual([{ t: 'all gone now', k: 'd' }]);
  });
});

describe('sideParagraphs', () => {
  const segments = diffSegments('One.\n\nTwo old.', 'One.\n\nTwo new.');

  it('keeps same + removed segments on the old side, split on blank lines', () => {
    expect(sideParagraphs(segments, 'old')).toEqual([
      [{ t: 'One.', k: 's' }],
      [{ t: 'Two ', k: 's' }, { t: 'old.', k: 'd' }],
    ]);
  });

  it('keeps same + added segments on the new side', () => {
    expect(sideParagraphs(segments, 'new')).toEqual([
      [{ t: 'One.', k: 's' }],
      [{ t: 'Two ', k: 's' }, { t: 'new.', k: 'a' }],
    ]);
  });

  it('drops whitespace-only paragraphs', () => {
    const same = diffSegments('A.\n\n\n\nB.', 'A.\n\n\n\nB.');
    expect(sideParagraphs(same, 'old')).toEqual([
      [{ t: 'A.', k: 's' }],
      [{ t: 'B.', k: 's' }],
    ]);
  });
});

describe('countWords', () => {
  it('counts whitespace-separated words', () => {
    expect(countWords('one two  three\nfour')).toBe(4);
    expect(countWords('   ')).toBe(0);
    expect(countWords('')).toBe(0);
  });
});
