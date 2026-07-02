import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import WorkspaceTabPicker from './WorkspaceTabPicker';
import { PICKABLE_TAB_KINDS } from './workspaceTabKinds';

function makeProps(overrides: Partial<Parameters<typeof WorkspaceTabPicker>[0]> = {}) {
  return {
    open: true,
    onClose: vi.fn(),
    onPick: vi.fn(),
    ...overrides,
  };
}

describe('WorkspaceTabPicker (GH #643)', () => {
  it('renders a dialog listing every pickable tab kind', () => {
    render(<WorkspaceTabPicker {...makeProps()} />);
    expect(screen.getByRole('dialog', { name: 'New tab' })).toBeInTheDocument();
    for (const kind of PICKABLE_TAB_KINDS) {
      expect(screen.getByTestId(`wtp-item-${kind}`)).toBeInTheDocument();
    }
  });

  it('picks a kind and closes on click', () => {
    const onPick = vi.fn();
    const onClose = vi.fn();
    render(<WorkspaceTabPicker {...makeProps({ onPick, onClose })} />);
    fireEvent.click(screen.getByTestId('wtp-item-kanban'));
    expect(onPick).toHaveBeenCalledWith('kanban');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape without picking', () => {
    const onPick = vi.fn();
    const onClose = vi.fn();
    render(<WorkspaceTabPicker {...makeProps({ onPick, onClose })} />);
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'New tab' }), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
    expect(onPick).not.toHaveBeenCalled();
  });

  it('renders nothing when closed', () => {
    render(<WorkspaceTabPicker {...makeProps({ open: false })} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
