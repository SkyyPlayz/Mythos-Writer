// Open-note write-back is one undo step, so unsaved typing survives undo.
import { describe, expect, it } from 'vitest';
import { applyWriteBackToOpenEditor, createNoteBuffer } from './artifactNoteBridge';

describe('artifact note bridge (S3.1)', () => {
  it('keeps the unsaved edit and the write-back, and undo restores the unsaved text', () => {
    const buffer = createNoteBuffer('hello');
    buffer.applyEdit('hello user');
    applyWriteBackToOpenEditor(buffer, 'hello user\nfrom artifact');
    expect(buffer.getText()).toBe('hello user\nfrom artifact');
    buffer.undo();
    expect(buffer.getText()).toBe('hello user');
  });
});
