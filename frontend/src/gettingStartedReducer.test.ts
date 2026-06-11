import { describe, it, expect } from 'vitest';
import {
  CHECKLIST_ITEM_IDS,
  createInitialGettingStartedProgress,
  gettingStartedReducer,
  isGettingStartedVisible,
  type GettingStartedProgress,
} from './gettingStartedReducer';

function withCompleted(...completedItems: Array<(typeof CHECKLIST_ITEM_IDS)[number]>): GettingStartedProgress {
  return { completedItems, dismissed: false };
}

describe('gettingStartedReducer', () => {
  it('creates visible initial state for non-skip onboarding', () => {
    const state = createInitialGettingStartedProgress(undefined, 'blank');
    expect(state.completedItems).toEqual([]);
    expect(state.dismissed).toBe(false);
    expect(isGettingStartedVisible(state)).toBe(true);
  });

  it('creates dismissed state for skip onboarding', () => {
    const state = createInitialGettingStartedProgress(undefined, 'skip');
    expect(state.dismissed).toBe(true);
    expect(isGettingStartedVisible(state)).toBe(false);
  });

  it.each(CHECKLIST_ITEM_IDS)('checks %s', (itemId) => {
    const state = gettingStartedReducer(createInitialGettingStartedProgress(), {
      type: 'CHECK_ITEM',
      itemId,
    });
    expect(state.completedItems).toContain(itemId);
    expect(state.dismissed).toBe(false);
  });

  it('keeps completion order stable and does not duplicate items', () => {
    const once = gettingStartedReducer(createInitialGettingStartedProgress(), {
      type: 'CHECK_ITEM',
      itemId: 'brainstorm',
    });
    const twice = gettingStartedReducer(once, {
      type: 'CHECK_ITEM',
      itemId: 'brainstorm',
    });
    expect(twice.completedItems).toEqual(['brainstorm']);
  });

  it('dismisses explicitly', () => {
    const state = gettingStartedReducer(withCompleted('write-scene'), { type: 'DISMISS' });
    expect(state.dismissed).toBe(true);
    expect(isGettingStartedVisible(state)).toBe(false);
  });

  it('auto-dismisses when all items are complete', () => {
    const almostDone = withCompleted('write-scene', 'add-character', 'brainstorm');
    const state = gettingStartedReducer(almostDone, {
      type: 'CHECK_ITEM',
      itemId: 'notes-vault',
    });
    expect(state.completedItems).toEqual([...CHECKLIST_ITEM_IDS]);
    expect(state.dismissed).toBe(true);
    expect(isGettingStartedVisible(state)).toBe(false);
  });

  it('normalizes persisted legacy completed maps', () => {
    const state = createInitialGettingStartedProgress(undefined, 'blank', {
      completed: { writeScene: true, addCharacter: true, openNotes: true },
    });
    expect(state.completedItems).toEqual(['write-scene', 'add-character', 'notes-vault']);
  });

  it('preserves persisted dismissal', () => {
    const state = createInitialGettingStartedProgress(undefined, 'blank', {
      completedItems: ['write-scene'],
      dismissed: true,
    });
    expect(state.dismissed).toBe(true);
    expect(isGettingStartedVisible(state)).toBe(false);
  });
});
