import { describe, it, expect } from 'vitest';
import { gsReducer, makeInitialGsState, GS_ITEMS, type GsState } from './gettingStartedReducer';

const empty: GsState = { completedItems: [], dismissed: false };

describe('makeInitialGsState', () => {
  it('returns default state when no persisted data', () => {
    expect(makeInitialGsState(null)).toEqual(empty);
    expect(makeInitialGsState(undefined)).toEqual(empty);
  });

  it('restores valid persisted state', () => {
    const s = makeInitialGsState({ completedItems: ['write-scene', 'brainstorm'], dismissed: false });
    expect(s.completedItems).toEqual(['write-scene', 'brainstorm']);
    expect(s.dismissed).toBe(false);
  });

  it('filters out unknown item keys from persisted data', () => {
    const s = makeInitialGsState({ completedItems: ['write-scene', 'invalid-key'], dismissed: false });
    expect(s.completedItems).toEqual(['write-scene']);
  });

  it('restores dismissed=true', () => {
    const s = makeInitialGsState({ completedItems: [], dismissed: true });
    expect(s.dismissed).toBe(true);
  });
});

describe('gsReducer — CHECK_ITEM', () => {
  it('adds item to completedItems', () => {
    const next = gsReducer(empty, { type: 'CHECK_ITEM', item: 'write-scene' });
    expect(next.completedItems).toContain('write-scene');
    expect(next.dismissed).toBe(false);
  });

  it('is idempotent — checking the same item twice does not duplicate', () => {
    const s1 = gsReducer(empty, { type: 'CHECK_ITEM', item: 'brainstorm' });
    const s2 = gsReducer(s1, { type: 'CHECK_ITEM', item: 'brainstorm' });
    expect(s2.completedItems.filter((k) => k === 'brainstorm')).toHaveLength(1);
  });

  it('auto-dismisses when all 4 items are checked', () => {
    let s = empty;
    for (const { key } of GS_ITEMS) {
      s = gsReducer(s, { type: 'CHECK_ITEM', item: key });
    }
    expect(s.completedItems).toHaveLength(4);
    expect(s.dismissed).toBe(true);
  });

  it('does not modify state when already dismissed', () => {
    const dismissed: GsState = { completedItems: [], dismissed: true };
    const next = gsReducer(dismissed, { type: 'CHECK_ITEM', item: 'write-scene' });
    expect(next).toBe(dismissed);
  });
});

describe('gsReducer — DISMISS', () => {
  it('sets dismissed=true', () => {
    const next = gsReducer(empty, { type: 'DISMISS' });
    expect(next.dismissed).toBe(true);
  });

  it('preserves completedItems on dismiss', () => {
    const s: GsState = { completedItems: ['write-scene'], dismissed: false };
    const next = gsReducer(s, { type: 'DISMISS' });
    expect(next.completedItems).toEqual(['write-scene']);
  });
});

describe('gsReducer — RESET', () => {
  it('resets to empty state', () => {
    const s: GsState = { completedItems: ['write-scene', 'brainstorm'], dismissed: true };
    expect(gsReducer(s, { type: 'RESET' })).toEqual(empty);
  });
});
