import { ContextMenu as LNContextMenu } from '../ui/Menu';
import type { MenuItemDef } from '../ui/Menu';
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

export default function ContextMenu({
  row,
  x,
  y,
  onClose,
  onNewNote,
  onNewFolder,
  onRename,
}: Props) {
  if (!row) return null;

  const isFile = !row.node.isDirectory;
  const dir = dirOf(row);

  const items: MenuItemDef[] = [
    ...(isFile && onRename ? [{ id: 'rename', label: 'Rename' } as MenuItemDef] : []),
    { id: 'new-note', label: 'New Note' },
    { id: 'new-folder', label: 'New Folder' },
  ];

  // Menu already calls onClose() after invoking onAction; don't duplicate here.
  const handleAction = (id: string) => {
    if (id === 'rename' && row && onRename) {
      onRename(row);
    } else if (id === 'new-note') {
      onNewNote(dir);
    } else if (id === 'new-folder') {
      onNewFolder(dir);
    }
  };

  return (
    <LNContextMenu
      open
      position={{ x, y }}
      onClose={onClose}
      onAction={handleAction}
      items={items}
      data-testid="vb-context-menu"
    />
  );
}
