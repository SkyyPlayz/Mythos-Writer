import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import GlobalSearchPanel from './GlobalSearchPanel';

describe('GlobalSearchPanel', () => {
  const mockOnClose = vi.fn();
  const mockOnNavigate = vi.fn();

  it('does not render when open is false', () => {
    const { container } = render(
      <GlobalSearchPanel open={false} onClose={mockOnClose} onNavigate={mockOnNavigate} />,
    );
    expect(container.querySelector('.gsp-backdrop')).not.toBeInTheDocument();
  });

  it('shows empty state when input is empty', () => {
    render(
      <GlobalSearchPanel open={true} onClose={mockOnClose} onNavigate={mockOnNavigate} />,
    );
    expect(screen.getByText('Start typing to search…')).toBeInTheDocument();
  });

  it('has a focused input when open is true', () => {
    render(
      <GlobalSearchPanel open={true} onClose={mockOnClose} onNavigate={mockOnNavigate} />,
    );
    const input = screen.getByRole('combobox') as HTMLInputElement;
    expect(input).toHaveFocus();
  });

  it('has scope toggle buttons', () => {
    render(
      <GlobalSearchPanel open={true} onClose={mockOnClose} onNavigate={mockOnNavigate} />,
    );
    expect(screen.getByRole('button', { name: /All/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Story/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Notes/i })).toBeInTheDocument();
  });

  it('closes on backdrop click', () => {
    render(
      <GlobalSearchPanel open={true} onClose={mockOnClose} onNavigate={mockOnNavigate} />,
    );
    const backdrop = screen.getByRole('presentation') as HTMLElement;
    expect(backdrop).toBeInTheDocument();
    backdrop.click();
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('does not close when clicking inside the panel', () => {
    const mockOnClose2 = vi.fn();
    render(
      <GlobalSearchPanel open={true} onClose={mockOnClose2} onNavigate={mockOnNavigate} />,
    );
    const panel = screen.getByRole('dialog') as HTMLElement;
    expect(panel).toBeInTheDocument();
    panel.click();
    expect(mockOnClose2).not.toHaveBeenCalled();
  });
});
