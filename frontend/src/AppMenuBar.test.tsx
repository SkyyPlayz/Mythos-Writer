/**
 * SKY-3970: Toggle button aria-label must reflect the top bar's current
 * hidden/visible state so screen-reader users get correct affordance text.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AppMenuBar } from './DesktopShell';

// Sub-components with external dependencies are stubbed so this test can
// focus purely on the toggle button's aria-label.
vi.mock('./SearchBar', () => ({ default: () => null }));
vi.mock('./ProjectSwitcher', () => ({ default: () => null }));
vi.mock('./DockedTabBar', () => ({ default: () => null }));

function makeProps(overrides: { topBarHidden?: boolean; onToggleTopBar?: () => void } = {}) {
  return {
    onOpenSettings: vi.fn(),
    onOpenHistory: vi.fn(),
    onSearchNavigate: vi.fn(),
    selectedStoryId: null,
    activeVaultRoot: '/test/vault',
    onProjectSwitched: vi.fn(),
    onOpenKeyboardShortcuts: vi.fn(),
    onToggleDistractionFree: vi.fn(),
    onToggleTopBar: vi.fn(),
    topBarHidden: false,
    onOpenTour: vi.fn(),
    requestText: vi.fn(),
    dockedTabs: [],
    activeDockedTabId: null,
    onDockedTabSelect: vi.fn(),
    onDockedTabClose: vi.fn(),
    onDockedTabReorder: vi.fn(),
    dockedPanelIds: [],
    onAddPanelAsNewTab: vi.fn(),
    ...overrides,
  };
}

describe('AppMenuBar — top bar toggle button', () => {
  it('labels the toggle button "Hide top bar" when the bar is visible', () => {
    render(<AppMenuBar {...makeProps({ topBarHidden: false })} />);
    expect(
      screen.getByRole('button', { name: 'Hide top bar' }),
    ).toBeInTheDocument();
  });

  it('labels the toggle button "Show top bar" when the bar is hidden', () => {
    render(<AppMenuBar {...makeProps({ topBarHidden: true })} />);
    expect(
      screen.getByRole('button', { name: 'Show top bar' }),
    ).toBeInTheDocument();
  });

  it('calls onToggleTopBar when the button is clicked', () => {
    const onToggleTopBar = vi.fn();
    render(<AppMenuBar {...makeProps({ onToggleTopBar })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Hide top bar' }));
    expect(onToggleTopBar).toHaveBeenCalledTimes(1);
  });
});
