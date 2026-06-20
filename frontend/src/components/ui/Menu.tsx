import { useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import './Menu.css';

export interface MenuItemDef {
  id: string;
  label: string;
  disabled?: boolean;
  destructive?: boolean;
  /** When true, a separator line is rendered above this item. */
  separator?: boolean;
}

export interface MenuProps {
  open: boolean;
  onClose: () => void;
  onAction: (id: string) => void;
  items: MenuItemDef[];
  /** Anchor element for action menus — menu opens adjacent to this element. */
  anchorEl?: HTMLElement | null;
  /** Absolute screen position for context menus (right-click at cursor). */
  position?: { x: number; y: number };
  'aria-label'?: string;
  'data-testid'?: string;
}

const MARGIN = 8;
const FALLBACK_W = 200;
const FALLBACK_H = 180;

function clampToBounds(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function Menu({
  open,
  onClose,
  onAction,
  items,
  anchorEl,
  position,
  'aria-label': ariaLabel,
  'data-testid': testId,
}: MenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  // Remember the trigger so Escape can return focus to it.
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open) {
      triggerRef.current = anchorEl ?? null;
    }
  }, [open, anchorEl]);

  // Position after DOM paint so offsetWidth/Height are available.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!open || !menu) return;

    const mW = menu.offsetWidth || FALLBACK_W;
    const mH = menu.offsetHeight || FALLBACK_H;
    const vW = window.innerWidth;
    const vH = window.innerHeight;

    let left = 0;
    let top = 0;

    if (anchorEl) {
      const rect = anchorEl.getBoundingClientRect();
      left = rect.left;
      top = rect.bottom + 4;
      // Flip right edge if menu would overflow viewport
      if (left + mW > vW - MARGIN) {
        left = rect.right - mW;
      }
      // Flip above if menu would overflow bottom
      if (top + mH > vH - MARGIN) {
        top = rect.top - mH - 4;
      }
    } else if (position) {
      left = position.x;
      top = position.y;
    }

    menu.style.left = `${clampToBounds(left, MARGIN, Math.max(MARGIN, vW - mW - MARGIN))}px`;
    menu.style.top = `${clampToBounds(top, MARGIN, Math.max(MARGIN, vH - mH - MARGIN))}px`;

    // Auto-focus first enabled item.
    const first = menu.querySelector<HTMLButtonElement>('button:not([disabled])');
    first?.focus();
  }, [open, anchorEl, position]);

  // Dismiss on outside click.
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', onMouseDown, true);
    return () => document.removeEventListener('mousedown', onMouseDown, true);
  }, [open, onClose]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const menu = menuRef.current;
    if (!menu) return;
    const btns = Array.from(
      menu.querySelectorAll<HTMLButtonElement>('button:not([disabled])'),
    );
    const idx = btns.indexOf(document.activeElement as HTMLButtonElement);

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        btns[(idx + 1) % btns.length]?.focus();
        break;
      case 'ArrowUp':
        e.preventDefault();
        btns[(idx - 1 + btns.length) % btns.length]?.focus();
        break;
      case 'Home':
        e.preventDefault();
        btns[0]?.focus();
        break;
      case 'End':
        e.preventDefault();
        btns[btns.length - 1]?.focus();
        break;
      case 'Escape':
        e.preventDefault();
        onClose();
        triggerRef.current?.focus();
        break;
      case 'Tab':
        // Let Tab move focus out; close the menu.
        onClose();
        break;
    }
  };

  if (!open) return null;

  return createPortal(
    <div
      ref={menuRef}
      className="ln-menu"
      role="menu"
      aria-label={ariaLabel}
      data-testid={testId}
      onKeyDown={handleKeyDown}
      style={{ position: 'fixed', zIndex: 9999 }}
    >
      {items.map((item) => (
        <div key={item.id}>
          {item.separator && (
            <div
              className="ln-menu-separator"
              role="separator"
              data-testid="ln-menu-separator"
            />
          )}
          <button
            className={[
              'ln-menu-item',
              item.destructive ? 'ln-menu-item--destructive' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            role="menuitem"
            type="button"
            disabled={item.disabled}
            data-testid={`menu-item-${item.id}`}
            onClick={() => {
              onAction(item.id);
              onClose();
            }}
          >
            {item.label}
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}

/**
 * Semantic alias — use ContextMenu when the trigger is a right-click or
 * long-press event. Same component and props as Menu.
 */
export { Menu as ContextMenu };
