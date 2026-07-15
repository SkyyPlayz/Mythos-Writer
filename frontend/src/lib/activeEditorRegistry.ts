/**
 * Singleton registry for the currently-focused TipTap editor instance.
 *
 * Title-bar Edit menu Undo/Redo can't reach ProseMirror's transaction stack
 * via document.execCommand. Instead, the focused editor registers itself here
 * on focus and clears on blur/unmount; the Edit menu reads getActiveEditor()
 * and dispatches commands through the TipTap chain API (SKY-6011).
 */
import type { Editor } from '@tiptap/core';

let _active: Editor | null = null;

export function registerActiveEditor(editor: Editor): void {
  _active = editor;
}

export function unregisterActiveEditor(editor: Editor): void {
  if (_active === editor) _active = null;
}

export function getActiveEditor(): Editor | null {
  return _active;
}
