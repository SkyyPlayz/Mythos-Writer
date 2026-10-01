import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CreateNotePrompt from './CreateNotePrompt';

describe('CreateNotePrompt (F2 N5)', () => {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();

  beforeEach(() => {
    onConfirm.mockReset();
    onCancel.mockReset();
  });

  it('autofocuses Create on mount', () => {
    render(
      <CreateNotePrompt noteName="Ghost" onConfirm={onConfirm} onCancel={onCancel} />,
    );
    expect(screen.getByTestId('create-note-confirm')).toHaveFocus();
  });

  it('Escape cancels without creating', () => {
    render(
      <CreateNotePrompt noteName="Ghost" onConfirm={onConfirm} onCancel={onCancel} />,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('Tab cycles focus between Create and Cancel (trap)', () => {
    render(
      <CreateNotePrompt noteName="Ghost" onConfirm={onConfirm} onCancel={onCancel} />,
    );
    const create = screen.getByTestId('create-note-confirm');
    const cancel = screen.getByTestId('create-note-cancel');
    expect(create).toHaveFocus();
    fireEvent.keyDown(window, { key: 'Tab' });
    // native tab may move; trap handler on last → first
    cancel.focus();
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(create).toHaveFocus();
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(cancel).toHaveFocus();
  });

  it('Create / Cancel buttons invoke handlers', () => {
    render(
      <CreateNotePrompt noteName="Ghost" onConfirm={onConfirm} onCancel={onCancel} />,
    );
    fireEvent.click(screen.getByTestId('create-note-confirm'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('create-note-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
