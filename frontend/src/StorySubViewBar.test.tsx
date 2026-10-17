// Slice B: Story strip = Editor · Book · Structure (Coach removed).
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import StorySubViewBar from './StorySubViewBar';

const DEFAULT_PROPS = {
  activeSubView: 'editor',
  onSubViewChange: vi.fn(),
  vaultName: 'My Story',
  aiEnabled: true,
  writingMode: 'normal' as const,
  onWritingModeChange: vi.fn(),
  onOpenFocusPrefs: vi.fn(),
};

describe('StorySubViewBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders exactly three sub-view tabs: Editor · Book · Structure', () => {
    render(<StorySubViewBar {...DEFAULT_PROPS} />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(3);
    expect(screen.getByRole('tab', { name: /editor/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^book$/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /structure/i })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /^coach$/i })).not.toBeInTheDocument();
  });

  it('does not render Scene Crafter or Timeline tabs (rail-only destinations)', () => {
    render(<StorySubViewBar {...DEFAULT_PROPS} />);
    expect(screen.queryByRole('tab', { name: /scene crafter/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /timeline/i })).not.toBeInTheDocument();
  });

  it('marks the active sub-view tab as selected', () => {
    render(<StorySubViewBar {...DEFAULT_PROPS} activeSubView="structure" />);
    expect(screen.getByRole('tab', { name: /structure/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /editor/i })).toHaveAttribute('aria-selected', 'false');
  });

  it('calls onSubViewChange when a tab is clicked', () => {
    const onSubViewChange = vi.fn();
    render(<StorySubViewBar {...DEFAULT_PROPS} onSubViewChange={onSubViewChange} />);
    fireEvent.click(screen.getByRole('tab', { name: /^book$/i }));
    expect(onSubViewChange).toHaveBeenCalledWith('book');
  });

  it('renders N/F/E writing mode buttons in the sub-view bar', () => {
    render(<StorySubViewBar {...DEFAULT_PROPS} />);
    expect(screen.getByTestId('nfe-mode-group')).toBeInTheDocument();
    expect(screen.getByTestId('writing-mode-normal')).toBeInTheDocument();
    expect(screen.getByTestId('writing-mode-focus')).toBeInTheDocument();
    expect(screen.getByTestId('writing-mode-edit')).toBeInTheDocument();
  });

  it('treats legacy coach sub-view as Editor selected', () => {
    render(<StorySubViewBar {...DEFAULT_PROPS} activeSubView="coach" />);
    expect(screen.getByRole('tab', { name: /editor/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('keeps three tabs when aiEnabled is false (Coach already gone)', () => {
    render(<StorySubViewBar {...DEFAULT_PROPS} aiEnabled={false} />);
    expect(screen.getAllByRole('tab')).toHaveLength(3);
    expect(screen.queryByRole('tab', { name: /^coach$/i })).not.toBeInTheDocument();
  });
});
