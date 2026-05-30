import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import KeyboardShortcutsDialog from './KeyboardShortcutsDialog';

describe('KeyboardShortcutsDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crash', () => {
    const onClose = vi.fn();
    render(<KeyboardShortcutsDialog onClose={onClose} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('renders the dialog with correct title', () => {
    const onClose = vi.fn();
    render(<KeyboardShortcutsDialog onClose={onClose} />);
    expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument();
  });

  it('renders all shortcut group labels', () => {
    const onClose = vi.fn();
    render(<KeyboardShortcutsDialog onClose={onClose} />);
    expect(screen.getByText('Global')).toBeInTheDocument();
    expect(screen.getByText('Editor — Navigation')).toBeInTheDocument();
    expect(screen.getByText('Editor — Text (Tiptap)')).toBeInTheDocument();
    expect(screen.getByText('Story Navigator')).toBeInTheDocument();
    expect(screen.getByText('Suggestion Review')).toBeInTheDocument();
    expect(screen.getByText('Brainstorm & Writing Assistant')).toBeInTheDocument();
    expect(screen.getByText('Search Bar')).toBeInTheDocument();
    expect(screen.getByText('Right Sidebar')).toBeInTheDocument();
  });

  it('renders shortcut keys and actions', () => {
    const onClose = vi.fn();
    render(<KeyboardShortcutsDialog onClose={onClose} />);
    expect(screen.getByText('Open Keyboard Shortcuts help')).toBeInTheDocument();
    expect(screen.getByText('Bold')).toBeInTheDocument();
    expect(screen.getByText('Next scene or chapter')).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(<KeyboardShortcutsDialog onClose={onClose} />);
    const closeButton = screen.getByLabelText('Close keyboard shortcuts');
    fireEvent.click(closeButton);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when backdrop is clicked', () => {
    const onClose = vi.fn();
    render(<KeyboardShortcutsDialog onClose={onClose} />);
    const backdrop = screen.getByRole('presentation');
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not call onClose when dialog content is clicked', () => {
    const onClose = vi.fn();
    render(<KeyboardShortcutsDialog onClose={onClose} />);
    const dialog = screen.getByRole('dialog');
    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose when Escape key is pressed', () => {
    const onClose = vi.fn();
    render(<KeyboardShortcutsDialog onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('has correct dialog attributes for accessibility', () => {
    const onClose = vi.fn();
    render(<KeyboardShortcutsDialog onClose={onClose} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-label', 'Keyboard shortcuts');
  });

  it('focuses dialog on mount', () => {
    const onClose = vi.fn();
    render(<KeyboardShortcutsDialog onClose={onClose} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('tabIndex', '-1');
  });
});
