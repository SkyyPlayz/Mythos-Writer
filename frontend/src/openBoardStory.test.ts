import { describe, it, expect } from 'vitest';
import { resolveOpenBoardStoryId } from './openBoardStory';

describe('F1#2 resolveOpenBoardStoryId', () => {
  it('uses selectedStory when set', () => {
    expect(resolveOpenBoardStoryId({ id: 'a' }, [{ id: 'a' }, { id: 'b' }])).toBe('a');
  });

  it('falls back to stories[0] when selection is null', () => {
    expect(resolveOpenBoardStoryId(null, [{ id: 'first' }, { id: 'second' }])).toBe('first');
  });

  it('returns null when nothing is available', () => {
    expect(resolveOpenBoardStoryId(null, [])).toBeNull();
  });
});
