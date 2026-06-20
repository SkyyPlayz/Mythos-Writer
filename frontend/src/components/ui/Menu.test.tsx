import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { Menu } from './Menu';
import type { MenuItemDef } from './Menu';

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
      fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
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
      fireEvent.keyDown(screen.getByRole('menu'), { key: 'Tab' });
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
