import { beforeEach, describe, expect, it } from 'vitest';
import { getBookTitle, loadBookTitles, setBookTitle } from './bookTitles';

describe('bookTitles (Slice E)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('falls back to story title when unset', () => {
    expect(getBookTitle('/v', 's1', 'Fall of Veynn')).toBe('Fall of Veynn');
  });

  it('persists per vault+story', () => {
    setBookTitle('/v-a', 's1', 'Book A');
    setBookTitle('/v-b', 's1', 'Book B');
    expect(getBookTitle('/v-a', 's1', 'fallback')).toBe('Book A');
    expect(getBookTitle('/v-b', 's1', 'fallback')).toBe('Book B');
    expect(Object.keys(loadBookTitles()).length).toBe(2);
  });
});
