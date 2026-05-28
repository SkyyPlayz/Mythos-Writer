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
}

function dirOf(row: FlatRow): string {
  if (row.node.isDirectory) return row.node.path;
  const slash = row.node.path.lastIndexOf('/');
  return slash > 0 ? row.node.path.slice(0, slash) : '';
}

export default function ContextMenu({ row, x, y, onClose, onNewNote, onNewFolder }: Props) {
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

  if (!row) return null;

  const dir = dirOf(row);

  return createPortal(
    <div
      ref={menuRef}
      className="vb-context-menu"
      style={{ position: 'fixed', top: y, left: x, zIndex: 9999 }}
      role="menu"
      data-testid="vb-context-menu"
    >
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
