import { Menu } from '../ui/Menu';
import type { MenuItemDef } from '../ui/Menu';

interface Props {
  anchorEl: HTMLElement | null;
  onAction: (id: string) => void;
  onClose: () => void;
  hasSavedPath: boolean;
}

const BASE_ITEMS: MenuItemDef[] = [
  { id: 'edit', label: 'Edit' },
  { id: 'open-in-writing-panel', label: 'Open in writing panel' },
  { id: 'delete', label: 'Delete', destructive: true, separator: true },
  { id: 'link-entity', label: 'Link entity' },
  { id: 'add-to-scene', label: 'Add to scene draft' },
  { id: 'copy-markdown', label: 'Copy markdown' },
];

export function IdeaContextMenu({ anchorEl, onAction, onClose, hasSavedPath }: Props) {
  const items: MenuItemDef[] = [
    ...BASE_ITEMS,
    { id: 'copy-vault-path', label: 'Copy vault path', disabled: !hasSavedPath },
  ];

  return (
    <Menu
      open={!!anchorEl}
      anchorEl={anchorEl}
      onClose={onClose}
      onAction={onAction}
      items={items}
      aria-label="Idea actions"
      data-testid="idea-context-menu"
    />
  );
}
