/**
 * F2 N5 — unresolved wiki-link "Create note?" dialog.
 * Escape = Cancel, autofocus Create, Tab trap inside the dialog.
 */
import { useEffect, useRef } from 'react';

export interface CreateNotePromptProps {
  noteName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function CreateNotePrompt({ noteName, onConfirm, onCancel }: CreateNotePromptProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusable = [confirmRef.current, cancelRef.current].filter(
        (el): el is HTMLButtonElement => Boolean(el),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || !dialogRef.current?.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !dialogRef.current?.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onCancel]);

  return (
    <div
      ref={dialogRef}
      className="cross-tab-link-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Create note"
      data-testid="create-note-prompt"
    >
      <div className="cross-tab-link-modal__card">
        <h2>Create note?</h2>
        <p>
          No note named &ldquo;{noteName}&rdquo; exists yet.
          Create it in the Notes Vault?
        </p>
        <div className="cross-tab-link-modal__list">
          <button
            ref={confirmRef}
            type="button"
            data-testid="create-note-confirm"
            onClick={onConfirm}
          >
            Create
          </button>
          <button
            ref={cancelRef}
            type="button"
            data-testid="create-note-cancel"
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
