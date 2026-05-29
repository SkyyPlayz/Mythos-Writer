import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { FlatRow } from './treeUtils';

interface Props {
  row: FlatRow | null;
  x: number;
  y: number;
  onClose: () => void;
  onNewNote: (dirPath: string) => void;
  onNewFolder: (dirPath: string) => void;
  onRename?: (row: FlatRow) => void;
}

function dirOf(row: FlatRow): string {
  if (row.node.isDirectory) return row.node.path;
  const slash = row.node.path.lastIndexOf('/');
  return slash > 0 ? row.node.path.slice(0, slash) : '';
}

export default function ContextMenu({ row, x, y, onClose, onNewNote, onNewFolder, onRename }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!row) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [row, onClose]);

  // Auto-focus the first menu item when the menu opens
  useEffect(() => {
    if (!row || !menuRef.current) return;
    const firstItem = menuRef.current.querySelector<HTMLElement>('[role="menuitem"]');
    firstItem?.focus();
  }, [row]);

  if (!row) return null;

  const dir = dirOf(row);
  const isMd = !row.node.isDirectory && row.node.name.endsWith('.md');

  function handleMenuKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
    );
    const idx = items.indexOf(document.activeElement as HTMLElement);
    const next =
      e.key === 'ArrowDown'
        ? items[(idx + 1) % items.length]
        : items[(idx - 1 + items.length) % items.length];
    next?.focus();
  }

  return createPortal(
    <div
      ref={menuRef}
      className="vb-context-menu"
      style={{ position: 'fixed', top: y, left: x, zIndex: 9999 }}
      role="menu"
      data-testid="vb-context-menu"
      onKeyDown={handleMenuKeyDown}
    >
      {isMd && onRename && (
        <button
          className="vb-context-item"
          role="menuitem"
          onClick={() => { onRename(row); onClose(); }}
        >
          Rename
        </button>
      )}
      <button
        className="vb-context-item"
        role="menuitem"
        onClick={() => { onNewNote(dir); onClose(); }}
      >
        New Note
      </button>
      <button
        className="vb-context-item"
        role="menuitem"
        onClick={() => { onNewFolder(dir); onClose(); }}
      >
        New Folder
      </button>
    </div>,
    document.body,
  );
}
