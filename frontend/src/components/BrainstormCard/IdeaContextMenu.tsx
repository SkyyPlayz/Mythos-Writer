import { useEffect, useRef } from 'react';
import './IdeaContextMenu.css';

interface MenuItem {
  id: string;
  label: string;
  disabled?: boolean;
}

interface Props {
  anchorEl: HTMLElement | null;
  onAction: (id: string) => void;
  onClose: () => void;
  hasSavedPath: boolean;
}

const BASE_ITEMS: MenuItem[] = [
  { id: 'edit', label: 'Edit' },
  { id: 'delete', label: 'Delete' },
  { id: 'link-entity', label: 'Link entity' },
  { id: 'add-to-scene', label: 'Add to scene draft' },
  { id: 'copy-markdown', label: 'Copy markdown' },
];

export function IdeaContextMenu({ anchorEl, onAction, onClose, hasSavedPath }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);

  const items: MenuItem[] = [
    ...BASE_ITEMS,
    { id: 'copy-vault-path', label: 'Copy vault path', disabled: !hasSavedPath },
  ];

  useEffect(() => {
    const menu = menuRef.current;
    if (!menu || !anchorEl) return;

    const rect = anchorEl.getBoundingClientRect();
    const menuWidth = 192;
    const spaceRight = window.innerWidth - rect.right;

    if (spaceRight >= menuWidth + 8) {
      menu.style.left = `${rect.right + 4}px`;
    } else {
      menu.style.left = `${Math.max(8, rect.left - menuWidth - 4)}px`;
    }
    menu.style.top = `${rect.bottom + 4}px`;

    const firstBtn = menu.querySelector<HTMLButtonElement>('button:not([disabled])');
    firstBtn?.focus();
  }, [anchorEl]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler, true);
    return () => document.removeEventListener('mousedown', handler, true);
  }, [onClose]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const menu = menuRef.current;
    if (!menu) return;
    const btns = Array.from(menu.querySelectorAll<HTMLButtonElement>('button:not([disabled])'));
    const idx = btns.indexOf(document.activeElement as HTMLButtonElement);

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      btns[(idx + 1) % btns.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      btns[(idx - 1 + btns.length) % btns.length]?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      ref={menuRef}
      className="idea-context-menu"
      role="menu"
      aria-label="Idea actions"
      onKeyDown={handleKeyDown}
      data-testid="idea-context-menu"
    >
      {items.map((item) => (
        <button
          key={item.id}
          className="idea-context-menu-item"
          role="menuitem"
          type="button"
          disabled={item.disabled}
          data-testid={`menu-item-${item.id}`}
          onClick={() => onAction(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
