import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { DockEdge } from '../../frame/widgetRegistry';
import './PanelChrome.css';
import './Menu.css';

/** F2#12 — re-export shared top-bar metrics for F1 Story toolbar consumers. */
export {
  PANEL_TOP_BAR_HEIGHT_PX,
  PANEL_TOP_BAR_HEIGHT_VAR,
} from '../../lib/panelChromeMetrics';

interface PanelChromeProps {
  children: React.ReactNode;
  className?: string;
}

interface PanelHeaderProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

interface PanelBodyProps {
  children: React.ReactNode;
  className?: string;
}

interface PanelFooterProps {
  children: React.ReactNode;
  className?: string;
}

export function PanelChrome({ children, className }: PanelChromeProps) {
  const cls = className ? `pc-chrome ${className}` : 'pc-chrome';
  return <div className={cls}>{children}</div>;
}

export function PanelHeader({ title, subtitle, icon, actions, className }: PanelHeaderProps) {
  const cls = className ? `pc-header ${className}` : 'pc-header';
  // Critic #6 / N7: production never mounts PanelChrome (.pc-chrome), so the
  // @container wrap must live on a real ancestor of .pc-header. This host is
  // that ancestor — at ≤320px the header wraps instead of clipping.
  return (
    <div className="pc-header-host">
      <div className={cls}>
        <div className="pc-header-start">
          {icon !== undefined && <div className="pc-header-icon">{icon}</div>}
          <div className="pc-header-title-group">
            <div className="pc-header-title">{title}</div>
            {subtitle !== undefined && <div className="pc-header-subtitle">{subtitle}</div>}
          </div>
        </div>
        {actions !== undefined && <div className="pc-header-actions">{actions}</div>}
      </div>
    </div>
  );
}

export function PanelBody({ children, className }: PanelBodyProps) {
  const cls = className ? `pc-body ${className}` : 'pc-body';
  return <div className={cls}>{children}</div>;
}

export function PanelFooter({ children, className }: PanelFooterProps) {
  const cls = className ? `pc-footer ${className}` : 'pc-footer';
  return <div className={cls}>{children}</div>;
}

// ─── Widget header menu (0.5.9 widget frame) ────────────────────────────────
// Adapter-neutral: the frame adapter only supplies a header host element; DesktopShell portals one
// WidgetMenuButton into each widget header. WAI-ARIA menu button pattern, menu portaled to document.body.

export type WidgetMenuAction =
  | { type: 'move'; edge: DockEdge }
  | { type: 'duplicate' }
  | { type: 'close' }
  | { type: 'lock' };

export interface WidgetMenuButtonProps {
  /** Widget instance id (`leftSidebar`, `leftSidebar:copy:2`, …). */
  widgetId: string;
  /** Visible widget title; names the button and the menu ("<Title> widget options"). */
  title: string;
  /** Current edge: its "Move to …" item is aria-disabled. */
  edge: DockEdge;
  duplicable: boolean;
  /** Copies offer "Close copy"; originals don't. */
  isCopy: boolean;
  /** Called after the menu closes. The caller owns focus afterwards (moved widget's tab, lock toggle). */
  onAction: (action: WidgetMenuAction) => void;
}

interface WidgetMenuItem {
  key: string;
  label: string;
  disabled: boolean;
  action: WidgetMenuAction;
}

const MOVE_ITEMS: ReadonlyArray<{ edge: DockEdge; label: string }> = [
  { edge: 'left', label: 'Move to left' },
  { edge: 'right', label: 'Move to right' },
  { edge: 'top', label: 'Move to top' },
  { edge: 'bottom', label: 'Move to bottom' },
];

const MENU_MARGIN = 8;

function widgetMenuItems(edge: DockEdge, duplicable: boolean, isCopy: boolean): WidgetMenuItem[] {
  const items: WidgetMenuItem[] = MOVE_ITEMS.map((m) => ({
    key: `move-${m.edge}`,
    label: m.label,
    disabled: m.edge === edge,
    action: { type: 'move', edge: m.edge },
  }));
  if (duplicable) items.push({ key: 'duplicate', label: 'Duplicate', disabled: false, action: { type: 'duplicate' } });
  if (isCopy) items.push({ key: 'close', label: 'Close copy', disabled: false, action: { type: 'close' } });
  items.push({ key: 'lock', label: 'Lock layout', disabled: false, action: { type: 'lock' } });
  return items;
}

export function WidgetMenuButton({ widgetId, title, edge, duplicable, isCopy, onAction }: WidgetMenuButtonProps) {
  const [open, setOpen] = useState<false | 'first' | 'last'>(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const label = `${title} widget options`;
  const items = widgetMenuItems(edge, duplicable, isCopy);

  const enabledItems = (): HTMLElement[] =>
    Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? []);

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }, []);

  // Place the menu under the button (flip/clamp to the viewport), then focus the first or last enabled item.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    const button = buttonRef.current;
    if (!open || !menu || !button) return;
    const rect = button.getBoundingClientRect();
    const mW = menu.offsetWidth;
    const mH = menu.offsetHeight;
    const vW = window.innerWidth;
    const vH = window.innerHeight;
    let left = rect.right - mW;
    let top = rect.bottom + 4;
    if (top + mH > vH - MENU_MARGIN) top = rect.top - mH - 4;
    left = Math.min(Math.max(left, MENU_MARGIN), Math.max(MENU_MARGIN, vW - mW - MENU_MARGIN));
    top = Math.min(Math.max(top, MENU_MARGIN), Math.max(MENU_MARGIN, vH - mH - MENU_MARGIN));
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    const list = enabledItems();
    (open === 'last' ? list[list.length - 1] : list[0])?.focus();
  }, [open]);

  // Click outside (not on the button, which toggles) closes without moving focus.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown, true);
    return () => document.removeEventListener('mousedown', onPointerDown, true);
  }, [open]);

  const activate = (item: WidgetMenuItem) => {
    if (item.disabled) return;
    setOpen(false);
    onAction(item.action);
  };

  const onButtonKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen('first');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen('last');
    }
  };

  const onMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const list = enabledItems();
    const idx = list.indexOf(document.activeElement as HTMLElement);
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        list[(idx + 1) % list.length]?.focus();
        break;
      case 'ArrowUp':
        e.preventDefault();
        list[(idx - 1 + list.length) % list.length]?.focus();
        break;
      case 'Home':
        e.preventDefault();
        list[0]?.focus();
        break;
      case 'End':
        e.preventDefault();
        list[list.length - 1]?.focus();
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        close(true);
        break;
      case 'Tab':
        // Close and hand focus back to the button; the browser's Tab then moves on from there.
        close(true);
        break;
      case 'Enter':
      case ' ': {
        e.preventDefault();
        const current = items.find((item) => item.key === (document.activeElement as HTMLElement | null)?.dataset.menuKey);
        if (current) activate(current);
        break;
      }
      default:
        break;
    }
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="mythos-widget-menu-button"
        data-testid={`widget-menu-button-${widgetId}`}
        aria-haspopup="menu"
        aria-expanded={open ? 'true' : 'false'}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        title={label}
        onClick={() => setOpen((was) => (was ? false : 'first'))}
        onKeyDown={onButtonKeyDown}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 24,
          height: 24,
          padding: 0,
          border: 'none',
          borderRadius: 6,
          background: 'transparent',
          color: 'var(--text-body, #bfd6e8)',
          cursor: 'pointer',
          font: 'inherit',
          lineHeight: 1,
        }}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          id={menuId}
          className="ln-menu ln-overlay-surface mythos-widget-menu"
          role="menu"
          aria-label={label}
          data-testid="widget-menu"
          data-widget-menu-for={widgetId}
          onKeyDown={onMenuKeyDown}
          style={{ position: 'fixed', left: 0, top: 0 }}
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className="ln-menu-item"
              data-menu-key={item.key}
              aria-disabled={item.disabled ? 'true' : undefined}
              onClick={() => activate(item)}
              style={item.disabled ? { color: 'var(--text-muted)', opacity: 0.6, cursor: 'default' } : undefined}
            >
              {item.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
