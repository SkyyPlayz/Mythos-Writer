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
  onDelete?: (row: FlatRow) => void;
  onOpenNewTab?: (path: string) => void;
  onBetaRead?: (path: string) => void;
  onContinuityCheck?: (path: string) => void;
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
  onDelete,
  onOpenNewTab,
  onBetaRead,
  onContinuityCheck,
}: Props) {
  if (!row) return null;

  const isFile = !row.node.isDirectory;
  const dir = dirOf(row);

  const items: MenuItemDef[] = [
    // File-only actions
    ...(isFile ? [
      { id: 'open-new-tab', label: 'Open in new tab', disabled: !onOpenNewTab },
      { id: 'beta-read', label: 'Beta read', disabled: !onBetaRead },
      { id: 'continuity-check', label: 'Continuity check', disabled: !onContinuityCheck },
      { id: 'sep1', label: '', separator: true },
    ] : []),
    // File or folder actions
    ...(isFile && onRename ? [{ id: 'rename', label: 'Rename' }] : []),
    ...(isFile && onDelete ? [{ id: 'delete', label: 'Delete', destructive: true }] : []),
    ...(isFile ? [{ id: 'sep2', label: '', separator: true }] : []),
    { id: 'new-note', label: 'New Note' },
    { id: 'new-folder', label: 'New Folder' },
  ];

  // Menu already calls onClose() after invoking onAction; don't duplicate here.
  const handleAction = (id: string) => {
    if (id === 'open-new-tab' && isFile && onOpenNewTab) {
      onOpenNewTab(row.node.path);
    } else if (id === 'beta-read' && isFile && onBetaRead) {
      onBetaRead(row.node.path);
    } else if (id === 'continuity-check' && isFile && onContinuityCheck) {
      onContinuityCheck(row.node.path);
    } else if (id === 'rename' && row && onRename) {
      onRename(row);
    } else if (id === 'delete' && row && onDelete) {
      onDelete(row);
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
