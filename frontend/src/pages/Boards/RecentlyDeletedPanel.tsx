/**
 * SKY-11189 (Notes Board 6/9) §8: "'Recently Deleted' panel. Lists everything
 * currently pending-delete for this vault, each with a per-item Restore ...
 * not a second permanent store: an item leaves the list the instant it
 * flushes."
 *
 * Vault-wide by design (not scoped to the currently-open board) — a delete
 * from the Notes tab tree lands here exactly like a canvas delete, since both
 * share the one deferred-delete registry (notesTrash.ts).
 */
import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import './RecentlyDeletedPanel.css';

export interface RecentlyDeletedPanelProps {
  open: boolean;
  onClose: () => void;
  entries: NotesBoardPendingEntry[];
  onRestore: (id: string) => void;
  onEmpty: () => void;
  anchorRef: RefObject<HTMLElement>;
}

function displayPath(entry: NotesBoardPendingEntry): string {
  if (entry.kind === 'furniture') return entry.boardPath || 'Home';
  return entry.vaultPath ?? entry.label;
}

export default function RecentlyDeletedPanel({
  open,
  onClose,
  entries,
  onRestore,
  onEmpty,
  anchorRef,
}: RecentlyDeletedPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Same "click elsewhere / Escape closes it" convention as BoardCanvas's
  // item context menu — a transient affordance, not a modal to click out of.
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: globalThis.MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    };
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, anchorRef]);

  if (!open) return null;

  return (
    <div
      className="recently-deleted-panel"
      role="dialog"
      aria-label="Recently Deleted"
      ref={panelRef}
    >
      <div className="recently-deleted-panel__header">
        <span className="recently-deleted-panel__title">Recently Deleted</span>
        <button
          type="button"
          className="recently-deleted-panel__empty-btn"
          onClick={onEmpty}
          disabled={entries.length === 0}
        >
          Empty
        </button>
      </div>
      {entries.length === 0 ? (
        <p className="recently-deleted-panel__empty-msg">Nothing pending deletion.</p>
      ) : (
        <ul className="recently-deleted-panel__list">
          {entries.map((entry) => (
            <li key={entry.id} className="recently-deleted-panel__row">
              <span className="recently-deleted-panel__row-icon" aria-hidden="true">
                {entry.kind === 'folder' ? '📁' : entry.kind === 'furniture' ? '▦' : '📄'}
              </span>
              <span className="recently-deleted-panel__row-text">
                <span className="recently-deleted-panel__row-label">{entry.label}</span>
                <span className="recently-deleted-panel__row-path">{displayPath(entry)}</span>
              </span>
              <button
                type="button"
                className="recently-deleted-panel__restore-btn"
                onClick={() => onRestore(entry.id)}
              >
                Restore
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
