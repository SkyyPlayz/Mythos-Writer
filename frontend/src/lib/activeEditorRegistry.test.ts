// SKY-6011/SKY-6059 — title-bar Edit → Undo/Redo needs a reference to
// whichever TipTap editor currently has focus, since document.execCommand
// never reaches ProseMirror's transaction-based undo stack.
import { describe, it, expect } from 'vitest';
import type { Editor } from '@tiptap/core';
import { registerActiveEditor, unregisterActiveEditor, getActiveEditor } from './activeEditorRegistry';

function fakeEditor(): Editor {
  return {} as Editor;
}

describe('activeEditorRegistry', () => {
  it('returns null when no editor has ever registered', () => {
    expect(getActiveEditor()).toBeNull();
  });

  it('returns the most recently registered editor', () => {
    const editor = fakeEditor();
    registerActiveEditor(editor);
    expect(getActiveEditor()).toBe(editor);
    unregisterActiveEditor(editor);
  });

  it('a later registration (e.g. a second focused editor) replaces the active one', () => {
    const first = fakeEditor();
    const second = fakeEditor();
    registerActiveEditor(first);
    registerActiveEditor(second);
    expect(getActiveEditor()).toBe(second);
    unregisterActiveEditor(second);
  });

  it('unregister clears the active editor when it matches', () => {
    const editor = fakeEditor();
    registerActiveEditor(editor);
    unregisterActiveEditor(editor);
    expect(getActiveEditor()).toBeNull();
  });

  it('unregister is a no-op when called for an editor that is not currently active (stale blur)', () => {
    const first = fakeEditor();
    const second = fakeEditor();
    registerActiveEditor(first);
    registerActiveEditor(second);
    // `first`'s blur fires after `second` already focused — must not clear `second`.
    unregisterActiveEditor(first);
    expect(getActiveEditor()).toBe(second);
    unregisterActiveEditor(second);
  });
});
