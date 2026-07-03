import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import WorkspaceTabBar, { WORKSPACE_TAB_DRAG_MIME } from './WorkspaceTabBar';

const tabs: WorkspaceTab[] = [
  { id: 'tab-story', kind: 'story-editor', title: 'Story', icon: '📖' },
  { id: 'tab-graph', kind: 'vault-graph', title: 'Graph', icon: '🕸️' },
];

function makeProps(overrides: Partial<Parameters<typeof WorkspaceTabBar>[0]> = {}) {
  return {
    tabs,
    activeTabId: 'tab-story',
    onTabSelect: vi.fn(),
    onTabClose: vi.fn(),
    onTabReorder: vi.fn(),
    onNewTab: vi.fn(),
    ...overrides,
  };
}

describe('WorkspaceTabBar split-pane hooks (GH#643)', () => {
  it('sets the workspace-tab drag payload on dragstart', () => {
    render(<WorkspaceTabBar {...makeProps()} />);
    const setData = vi.fn();
    fireEvent.dragStart(screen.getByRole('tab', { name: /Graph/ }), {
      dataTransfer: { setData, setDragImage: vi.fn(), effectAllowed: '' },
    });
    expect(setData).toHaveBeenCalledWith(
      WORKSPACE_TAB_DRAG_MIME,
      JSON.stringify({ id: 'tab-graph', kind: 'vault-graph' }),
    );
  });

  it('Shift+click routes to onTabOpenInSplit instead of onTabSelect', () => {
    const onTabOpenInSplit = vi.fn();
    const onTabSelect = vi.fn();
    render(<WorkspaceTabBar {...makeProps({ onTabOpenInSplit, onTabSelect })} />);
    fireEvent.click(screen.getByRole('tab', { name: /Graph/ }), { shiftKey: true });
    expect(onTabOpenInSplit).toHaveBeenCalledWith('tab-graph');
    expect(onTabSelect).not.toHaveBeenCalled();
  });

  it('plain click still selects', () => {
    const onTabOpenInSplit = vi.fn();
    const onTabSelect = vi.fn();
    render(<WorkspaceTabBar {...makeProps({ onTabOpenInSplit, onTabSelect })} />);
    fireEvent.click(screen.getByRole('tab', { name: /Graph/ }));
    expect(onTabSelect).toHaveBeenCalledWith('tab-graph');
    expect(onTabOpenInSplit).not.toHaveBeenCalled();
  });

  it('Shift+Enter on a focused tab opens it in the split pane', () => {
    const onTabOpenInSplit = vi.fn();
    render(<WorkspaceTabBar {...makeProps({ onTabOpenInSplit })} />);
    fireEvent.keyDown(screen.getByRole('tab', { name: /Graph/ }), { key: 'Enter', shiftKey: true });
    expect(onTabOpenInSplit).toHaveBeenCalledWith('tab-graph');
  });

  it('without onTabOpenInSplit, Shift+click falls back to select (backward compatible)', () => {
    const onTabSelect = vi.fn();
    render(<WorkspaceTabBar {...makeProps({ onTabSelect })} />);
    fireEvent.click(screen.getByRole('tab', { name: /Graph/ }), { shiftKey: true });
    expect(onTabSelect).toHaveBeenCalledWith('tab-graph');
  });
});
