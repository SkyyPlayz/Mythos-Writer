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
  /** M15: open the note in a new tab (falls back to the regular open behavior upstream). */
  onOpenInNewTab?: (row: FlatRow) => void;
  /** M15: delete the note (confirm + deleteNotesVault upstream). */
  onDelete?: (row: FlatRow) => void;
  /** M15: queue the Beta Reader agent on this note. Item disabled until wired. */
  onBetaRead?: (row: FlatRow) => void;
  /** M15: run an Archive continuity check on this note. Item disabled until wired. */
  onContinuityCheck?: (row: FlatRow) => void;
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
  onOpenInNewTab,
  onDelete,
  onBetaRead,
  onContinuityCheck,
}: Props) {
  if (!row) return null;

  const isFile = !row.node.isDirectory;
  const dir = dirOf(row);

  // M15: file rows get the five prototype actions (treeCtxItems in the Liquid
  // Neon prototype): Open in new tab / Beta read / Continuity check / Rename… /
  // Delete. New Note / New Folder stay below a separator so the pre-existing
  // creation flows remain reachable from the same menu.
  const items: MenuItemDef[] = [
    ...(isFile
      ? [
          { id: 'open-tab', label: 'Open in new tab', disabled: !onOpenInNewTab } as MenuItemDef,
          { id: 'beta-read', label: 'Beta read', disabled: !onBetaRead } as MenuItemDef,
          { id: 'continuity-check', label: 'Continuity check', disabled: !onContinuityCheck } as MenuItemDef,
          ...(onRename ? [{ id: 'rename', label: 'Rename…' } as MenuItemDef] : []),
          { id: 'delete', label: 'Delete', destructive: true, disabled: !onDelete } as MenuItemDef,
          { id: 'new-note', label: 'New Note', separator: true } as MenuItemDef,
        ]
      : [{ id: 'new-note', label: 'New Note' } as MenuItemDef]),
    { id: 'new-folder', label: 'New Folder' },
  ];

  // Menu already calls onClose() after invoking onAction; don't duplicate here.
  const handleAction = (id: string) => {
    if (id === 'open-tab') {
      onOpenInNewTab?.(row);
    } else if (id === 'beta-read') {
      onBetaRead?.(row);
    } else if (id === 'continuity-check') {
      onContinuityCheck?.(row);
    } else if (id === 'rename' && onRename) {
      onRename(row);
    } else if (id === 'delete') {
      onDelete?.(row);
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
      className="vb-ctx-menu"
      data-testid="vb-context-menu"
    />
  );
}
