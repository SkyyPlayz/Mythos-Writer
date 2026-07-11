import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import PageSetupPopover from './PageSetupPopover';
import type { PageStyle } from './PageSetupPopover';
import { STORY_PAGE_DEFAULTS } from './theme';

const defaultProps = {
  isOpen: true,
  onClose: vi.fn(),
  prefs: STORY_PAGE_DEFAULTS,
  onPrefsChange: vi.fn(),
  pageStyle: 'off' as PageStyle,
  onPageStyleChange: vi.fn(),
};

describe('PageSetupPopover', () => {
  it('renders nothing when isOpen is false', () => {
    const { container } = render(<PageSetupPopover {...defaultProps} isOpen={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the popover when isOpen is true', () => {
    render(<PageSetupPopover {...defaultProps} />);
    expect(screen.getByRole('dialog', { name: /page setup/i })).toBeInTheDocument();
  });

  it('renders all 5 page style buttons', () => {
    render(<PageSetupPopover {...defaultProps} />);
    expect(screen.getByRole('button', { name: /neon/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /no glow/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /scroll/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /texture/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^off$/i })).toBeInTheDocument();
  });

  it('calls onPageStyleChange with the correct key when a style button is clicked', () => {
    const onPageStyleChange = vi.fn();
    render(<PageSetupPopover {...defaultProps} onPageStyleChange={onPageStyleChange} />);
    fireEvent.click(screen.getByRole('button', { name: /neon/i }));
    expect(onPageStyleChange).toHaveBeenCalledWith('neon');
  });

  it('calls onPageStyleChange with "scroll" when Scroll is clicked', () => {
    const onPageStyleChange = vi.fn();
    render(<PageSetupPopover {...defaultProps} onPageStyleChange={onPageStyleChange} />);
    fireEvent.click(screen.getByRole('button', { name: /scroll/i }));
    expect(onPageStyleChange).toHaveBeenCalledWith('scroll');
  });

  it('shows texture upload button when pageStyle is texture', () => {
    render(<PageSetupPopover {...defaultProps} pageStyle="texture" />);
    expect(screen.getByRole('button', { name: /choose texture image/i })).toBeInTheDocument();
  });

  it('does not show texture upload button for other styles', () => {
    render(<PageSetupPopover {...defaultProps} pageStyle="off" />);
    expect(screen.queryByRole('button', { name: /choose texture image/i })).not.toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(<PageSetupPopover {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /close page setup/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
