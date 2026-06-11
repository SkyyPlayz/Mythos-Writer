import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import RightSidebar from './RightSidebar';
import { createInitialGettingStartedProgress } from './gettingStartedReducer';

describe('RightSidebar getting started slot', () => {
  it('renders Getting Started above the tab bar and routes actions', () => {
    const onGettingStartedAction = vi.fn();
    const progress = createInitialGettingStartedProgress();

    render(
      <RightSidebar
        activeTab="notes"
        onTabChange={vi.fn()}
        selectedScene={null}
        selectedChapter={null}
        selectedStory={null}
        gettingStartedProgress={progress}
        onGettingStartedAction={onGettingStartedAction}
        onDismissGettingStarted={vi.fn()}
        onToggleGsCollapsed={vi.fn()}
      />,
    );

    const panel = screen.getByRole('region', { name: /getting started/i });
    const tablist = screen.getByRole('tablist', { name: /sidebar panels/i });
    expect(panel.compareDocumentPosition(tablist) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(screen.getByRole('checkbox', { name: /add a character/i }));
    expect(onGettingStartedAction).toHaveBeenCalledWith('add-character');
  });

  it('does not render the panel when progress is dismissed', () => {
    const progress = createInitialGettingStartedProgress();
    progress.dismissed = true;

    render(
      <RightSidebar
        activeTab="notes"
        onTabChange={vi.fn()}
        selectedScene={null}
        selectedChapter={null}
        selectedStory={null}
        gettingStartedProgress={progress}
        onGettingStartedAction={vi.fn()}
        onDismissGettingStarted={vi.fn()}
        onToggleGsCollapsed={vi.fn()}
      />,
    );

    expect(screen.queryByRole('region', { name: /getting started checklist/i })).not.toBeInTheDocument();
  });
});
