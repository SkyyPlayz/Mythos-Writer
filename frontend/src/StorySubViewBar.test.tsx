// SKY-3626: Writing mode (N/F/E) must NOT appear in StorySubViewBar.
// SKY-9019/M5: Scene Crafter and Timeline are rail-only destinations — exactly four tabs remain.
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import StorySubViewBar from './StorySubViewBar';

const DEFAULT_PROPS = {
  activeSubView: 'editor',
  onSubViewChange: vi.fn(),
  vaultName: 'My Story',
  aiEnabled: true,
};

describe('StorySubViewBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders exactly four sub-view tabs', () => {
    render(<StorySubViewBar {...DEFAULT_PROPS} />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(4);
    expect(screen.getByRole('tab', { name: /editor/i })).toBeInTheDocument();
    // M12 (§5.2): the Writing Coach page is a Story sub-tab.
    expect(screen.getByRole('tab', { name: /^coach$/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /structure/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^book$/i })).toBeInTheDocument();
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
    const { rerender } = render(<StorySubViewBar {...DEFAULT_PROPS} activeSubView="coach" />);
    expect(screen.queryByTestId('nfe-mode-group')).not.toBeInTheDocument();

    rerender(<StorySubViewBar {...DEFAULT_PROPS} activeSubView="structure" />);
    expect(screen.queryByTestId('nfe-mode-group')).not.toBeInTheDocument();

    rerender(<StorySubViewBar {...DEFAULT_PROPS} activeSubView="book" />);
    expect(screen.queryByTestId('nfe-mode-group')).not.toBeInTheDocument();
  });

  // SKY-10573: Coach is AI-bearing chrome — it must not render at all with AI off.
  it('omits the Coach tab when aiEnabled is false', () => {
    render(<StorySubViewBar {...DEFAULT_PROPS} aiEnabled={false} />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(3);
    expect(screen.queryByRole('tab', { name: /^coach$/i })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /editor/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /structure/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^book$/i })).toBeInTheDocument();
  });

  it('re-adds the Coach tab when aiEnabled flips back on', () => {
    const { rerender } = render(<StorySubViewBar {...DEFAULT_PROPS} aiEnabled={false} />);
    expect(screen.queryByRole('tab', { name: /^coach$/i })).not.toBeInTheDocument();
    rerender(<StorySubViewBar {...DEFAULT_PROPS} aiEnabled={true} />);
    expect(screen.getByRole('tab', { name: /^coach$/i })).toBeInTheDocument();
  });
});
