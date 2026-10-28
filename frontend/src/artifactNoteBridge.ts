// Apply an artifact edit to the open note buffer as one undoable step. The editor save writes the file.

export interface UndoableNoteBuffer {
  getText: () => string;
  applyEdit: (next: string) => void;
  undo: () => void;
}

export function createNoteBuffer(initial: string): UndoableNoteBuffer {
  const history = [initial];
  let index = 0;
  return {
    getText: () => history[index] ?? '',
    applyEdit(next: string): void {
      history.splice(index + 1);
      history.push(next);
      index = history.length - 1;
    },
    undo(): void {
      if (index > 0) index -= 1;
    },
  };
}

/** User edits and the write-back are separate steps, so undo restores the unsaved user text. */
export function applyWriteBackToOpenEditor(buffer: UndoableNoteBuffer, next: string): void {
  buffer.applyEdit(next);
}
