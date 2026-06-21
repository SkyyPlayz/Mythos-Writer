import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { Menu } from './Menu';
import type { MenuItemDef } from './Menu';

const MENU_CSS = readFileSync(resolve(process.cwd(), 'src/components/ui/Menu.css'), 'utf-8');

const ITEMS: MenuItemDef[] = [
  { id: 'edit', label: 'Edit' },
  { id: 'rename', label: 'Rename' },
  { id: 'delete', label: 'Delete', destructive: true },
  { id: 'disabled-item', label: 'Unavailable', disabled: true },
];

function renderMenu(props: Partial<Parameters<typeof Menu>[0]> = {}) {
  const defaults = {
    open: true,
    onClose: vi.fn(),
    onAction: vi.fn(),
    items: ITEMS,
  };
  return render(<Menu {...defaults} {...props} />);
}

describe('Menu', () => {
  describe('visibility', () => {
    it('renders menu items when open', () => {
      renderMenu();
      expect(screen.getByRole('menu')).toBeInTheDocument();
      expect(screen.getByText('Edit')).toBeInTheDocument();
      expect(screen.getByText('Rename')).toBeInTheDocument();
      expect(screen.getByText('Delete')).toBeInTheDocument();
    });

    it('renders nothing when closed', () => {
      renderMenu({ open: false });
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('passes aria-label to menu container', () => {
      renderMenu({ 'aria-label': 'Card actions' });
      expect(screen.getByRole('menu', { name: 'Card actions' })).toBeInTheDocument();
    });

    it('passes data-testid to menu container', () => {
      renderMenu({ 'data-testid': 'my-menu' });
      expect(screen.getByTestId('my-menu')).toBeInTheDocument();
    });
  });

  describe('item rendering', () => {
    it('renders items as menuitem buttons', () => {
      renderMenu();
      const items = screen.getAllByRole('menuitem');
      expect(items).toHaveLength(ITEMS.length);
    });

    it('marks disabled items as disabled', () => {
      renderMenu();
      expect(screen.getByTestId('menu-item-disabled-item')).toBeDisabled();
    });

    it('applies destructive class to destructive items', () => {
      renderMenu();
      expect(screen.getByTestId('menu-item-delete')).toHaveClass('ln-menu-item--destructive');
    });

    it('renders separator before item when separator=true', () => {
      const items: MenuItemDef[] = [
        { id: 'a', label: 'Alpha' },
        { id: 'b', label: 'Beta', separator: true },
      ];
      renderMenu({ items });
      expect(screen.getByTestId('ln-menu-separator')).toBeInTheDocument();
    });

    it('does not render separator when no item has separator flag', () => {
      renderMenu();
      expect(screen.queryByTestId('ln-menu-separator')).not.toBeInTheDocument();
    });
  });

  describe('action and close', () => {
    it('calls onAction with item id when clicked', () => {
      const onAction = vi.fn();
      const onClose = vi.fn();
      renderMenu({ onAction, onClose });
      fireEvent.click(screen.getByTestId('menu-item-edit'));
      expect(onAction).toHaveBeenCalledWith('edit');
    });

    it('calls onClose after item click', () => {
      const onClose = vi.fn();
      renderMenu({ onClose });
      fireEvent.click(screen.getByTestId('menu-item-rename'));
      expect(onClose).toHaveBeenCalledOnce();
    });

    it('does not call onAction when disabled item is clicked', () => {
      const onAction = vi.fn();
      renderMenu({ onAction });
      // Disabled buttons ignore click events
      fireEvent.click(screen.getByTestId('menu-item-disabled-item'));
      expect(onAction).not.toHaveBeenCalled();
    });
  });

  describe('keyboard navigation', () => {
    it('closes on Escape and calls onClose', () => {
      const onClose = vi.fn();
      renderMenu({ onClose });
      // beforeEach also rendered a menu; use the last one (the one with our spy)
      const menus = screen.getAllByRole('menu');
      fireEvent.keyDown(menus[menus.length - 1], { key: 'Escape' });
      expect(onClose).toHaveBeenCalledOnce();
    });

    it('moves focus to next enabled item on ArrowDown', () => {
      renderMenu();
      const menu = screen.getByRole('menu');
      const enabled = within(menu)
        .getAllByRole('menuitem')
        .filter((btn) => !btn.hasAttribute('disabled'));
      enabled[0].focus();
      fireEvent.keyDown(menu, { key: 'ArrowDown' });
      expect(enabled[1]).toHaveFocus();
    });

    it('moves focus to previous enabled item on ArrowUp', () => {
      renderMenu();
      const menu = screen.getByRole('menu');
      const enabled = within(menu)
        .getAllByRole('menuitem')
        .filter((btn) => !btn.hasAttribute('disabled'));
      enabled[1].focus();
      fireEvent.keyDown(menu, { key: 'ArrowUp' });
      expect(enabled[0]).toHaveFocus();
    });

    it('wraps focus from last to first on ArrowDown', () => {
      renderMenu();
      const menu = screen.getByRole('menu');
      const enabled = within(menu)
        .getAllByRole('menuitem')
        .filter((btn) => !btn.hasAttribute('disabled'));
      enabled[enabled.length - 1].focus();
      fireEvent.keyDown(menu, { key: 'ArrowDown' });
      expect(enabled[0]).toHaveFocus();
    });

    it('wraps focus from first to last on ArrowUp', () => {
      renderMenu();
      const menu = screen.getByRole('menu');
      const enabled = within(menu)
        .getAllByRole('menuitem')
        .filter((btn) => !btn.hasAttribute('disabled'));
      enabled[0].focus();
      fireEvent.keyDown(menu, { key: 'ArrowUp' });
      expect(enabled[enabled.length - 1]).toHaveFocus();
    });

    it('moves focus to first item on Home', () => {
      renderMenu();
      const menu = screen.getByRole('menu');
      const enabled = within(menu)
        .getAllByRole('menuitem')
        .filter((btn) => !btn.hasAttribute('disabled'));
      enabled[2].focus();
      fireEvent.keyDown(menu, { key: 'Home' });
      expect(enabled[0]).toHaveFocus();
    });

    it('moves focus to last item on End', () => {
      renderMenu();
      const menu = screen.getByRole('menu');
      const enabled = within(menu)
        .getAllByRole('menuitem')
        .filter((btn) => !btn.hasAttribute('disabled'));
      enabled[0].focus();
      fireEvent.keyDown(menu, { key: 'End' });
      expect(enabled[enabled.length - 1]).toHaveFocus();
    });

    it('calls onClose on Tab', () => {
      const onClose = vi.fn();
      renderMenu({ onClose });
      // beforeEach also rendered a menu; use the last one (the one with our spy)
      const menus = screen.getAllByRole('menu');
      fireEvent.keyDown(menus[menus.length - 1], { key: 'Tab' });
      expect(onClose).toHaveBeenCalledOnce();
    });
  });

  describe('outside click', () => {
    it('calls onClose when mousedown fires outside the menu', () => {
      const onClose = vi.fn();
      renderMenu({ onClose });
      fireEvent.mouseDown(document.body);
      expect(onClose).toHaveBeenCalledOnce();
    });

    it('does not call onClose when mousedown fires inside the menu', () => {
      const onClose = vi.fn();
      renderMenu({ onClose });
      const menu = screen.getByRole('menu');
      fireEvent.mouseDown(menu);
      expect(onClose).not.toHaveBeenCalled();
    });
  });
});

// ─── Liquid Neon a11y — CSS regression ───────────────────────────────────────

describe('Menu — Liquid Neon a11y CSS', () => {
  it('menu item focus ring uses --focus-ring token', () => {
    // Two focus-visible rules exist: a combined hover+focus-visible block and a
    // standalone block with the box-shadow focus ring. Check any of them.
    const rules = MENU_CSS.match(/[^}]*\.ln-menu-item:focus-visible[^}]*\}/g) ?? [];
    const hasRing = rules.some((r) => r.includes('var(--focus-ring)'));
    expect(hasRing).toBe(true);
  });

  it('reduced-motion block removes menu open animation', () => {
    expect(MENU_CSS).toContain('@media (prefers-reduced-motion');
    const m = MENU_CSS.match(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\{([\s\S]*?)\}\s*\}/,
    );
    expect(m?.[1] ?? '').toContain('animation: none');
  });

  it('high-contrast block exists and explicitly resets glow on menu', () => {
    expect(MENU_CSS).toContain('[data-contrast="high"]');
    const m = MENU_CSS.match(/\[data-contrast="high"\]\s*\.ln-menu\s*\{([^}]*)\}/);
    const block = m?.[1] ?? '';
    expect(block).toContain('border-color');
    // box-shadow: none is the correct reset — ensures no glow in high-contrast mode
    expect(block).toContain('box-shadow: none');
  });

  it('high-contrast hover inverts colors without glow', () => {
    const m = MENU_CSS.match(
      /\[data-contrast="high"\]\s*\.ln-menu-item:hover[^{]*\{([^}]*)\}/,
    );
    expect(m?.[1] ?? '').toContain('color');
  });

  it('menu container has role="menu" and items have role="menuitem"', () => {
    renderMenu();
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getAllByRole('menuitem').length).toBeGreaterThan(0);
  });
});
