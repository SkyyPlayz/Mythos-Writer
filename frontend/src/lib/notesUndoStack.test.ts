// SKY-11189 (Notes Board 6/9) §8: the shared, session-scoped undo stack.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pushUndo, undo, canUndo, peekUndoLabel, subscribeUndoStack, resetUndoStackForTests } from './notesUndoStack';

beforeEach(() => {
  resetUndoStackForTests();
});

describe('notesUndoStack', () => {
  it('is empty and a no-op undo by default', async () => {
    expect(canUndo()).toBe(false);
    expect(peekUndoLabel()).toBeNull();
    await expect(undo()).resolves.toBeUndefined();
  });

  it('pops entries LIFO — "walks both back in order" (§8)', async () => {
    const calls: string[] = [];
    pushUndo({ label: 'first', undo: () => { calls.push('first'); } });
    pushUndo({ label: 'second', undo: () => { calls.push('second'); } });

    expect(peekUndoLabel()).toBe('second');
    await undo();
    expect(calls).toEqual(['second']);
    expect(peekUndoLabel()).toBe('first');
    await undo();
    expect(calls).toEqual(['second', 'first']);
    expect(canUndo()).toBe(false);
  });

  it('awaits an async undo closure before resolving', async () => {
    let resolved = false;
    pushUndo({
      label: 'slow',
      undo: async () => {
        await new Promise((r) => setTimeout(r, 0));
        resolved = true;
      },
    });
    await undo();
    expect(resolved).toBe(true);
  });

  it('notifies subscribers on push and on pop', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeUndoStack(listener);
    pushUndo({ label: 'x', undo: () => {} });
    expect(listener).toHaveBeenCalledTimes(1);
    await undo();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    pushUndo({ label: 'y', undo: () => {} });
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
