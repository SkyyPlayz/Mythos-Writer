// SKY-3626: Writing mode (N/F/E) must NOT appear in StorySubViewBar.
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import StorySubViewBar from './StorySubViewBar';

const DEFAULT_PROPS = {
  activeSubView: 'editor',
  onSubViewChange: vi.fn(),
  vaultName: 'My Story',
};

describe('StorySubViewBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders sub-view tabs', () => {
    render(<StorySubViewBar {...DEFAULT_PROPS} />);
    expect(screen.getByRole('tab', { name: /editor/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /scene crafter/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /structure/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /timeline/i })).toBeInTheDocument();
  });

  it('marks the active sub-view tab as selected', () => {
    render(<StorySubViewBar {...DEFAULT_PROPS} activeSubView="structure" />);
    expect(screen.getByRole('tab', { name: /structure/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /editor/i })).toHaveAttribute('aria-selected', 'false');
  });

  it('calls onSubViewChange when a tab is clicked', () => {
    const onSubViewChange = vi.fn();
    render(<StorySubViewBar {...DEFAULT_PROPS} onSubViewChange={onSubViewChange} />);
    fireEvent.click(screen.getByRole('tab', { name: /timeline/i }));
    expect(onSubViewChange).toHaveBeenCalledWith('timeline');
  });

  // SKY-3626: NFE (N/F/E) writing mode buttons must not appear in StorySubViewBar —
  // they were relocated to the center editor toolbar so they don't show on non-editor sub-views.
  it('does not render N/F/E writing mode buttons', () => {
    render(<StorySubViewBar {...DEFAULT_PROPS} />);
    expect(screen.queryByTestId('nfe-mode-group')).not.toBeInTheDocument();
    expect(screen.queryByTestId('writing-mode-normal')).not.toBeInTheDocument();
    expect(screen.queryByTestId('writing-mode-focus')).not.toBeInTheDocument();
    expect(screen.queryByTestId('writing-mode-edit')).not.toBeInTheDocument();
  });

  it('does not render N/F/E buttons for any sub-view', () => {
    const { rerender } = render(<StorySubViewBar {...DEFAULT_PROPS} activeSubView="kanban" />);
    expect(screen.queryByTestId('nfe-mode-group')).not.toBeInTheDocument();

    rerender(<StorySubViewBar {...DEFAULT_PROPS} activeSubView="structure" />);
    expect(screen.queryByTestId('nfe-mode-group')).not.toBeInTheDocument();

    rerender(<StorySubViewBar {...DEFAULT_PROPS} activeSubView="timeline" />);
    expect(screen.queryByTestId('nfe-mode-group')).not.toBeInTheDocument();
  });
});
