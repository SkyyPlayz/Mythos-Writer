/**
 * SKY-1698 (Wave 2d): DockedTabBar unit tests.
 * Covers AC-T-02, AC-T-03, AC-T-04, AC-T-06, AC-T-08 label/interaction behaviours.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import DockedTabBar, { DOCKED_TAB_PANEL_LABELS } from './DockedTabBar';
import * as PanelDragContextModule from './PanelDragContext';

// ── Shared mock for usePanelDrag ──────────────────────────────────────────────

const mockCommitTabBarDrop = vi.fn();
const mockCommitTabGroupDrop = vi.fn();

vi.mock('./PanelDragContext', async () => {
  const actual = await vi.importActual<typeof PanelDragContextModule>('./PanelDragContext');
  return {
    ...actual,
    usePanelDrag: () => ({
      dragState: null,
      commitTabBarDrop: mockCommitTabBarDrop,
      commitTabGroupDrop: mockCommitTabGroupDrop,
      activeDropTarget: null,
      setActiveDropTarget: vi.fn(),
      startDrag: vi.fn(),
      commitDrop: vi.fn(),
      endDrag: vi.fn(),
      cancelDrag: vi.fn(),
      floatDrop: vi.fn(),
      wasEscapeCancelled: vi.fn(() => false),
      kbDrag: null,
      startKeyboardDrag: vi.fn(),
      moveKbTarget: vi.fn(),
      commitKbDrop: vi.fn(),
    }),
  };
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTab(id: string, panels: SidebarPanelId[]): DockedTab {
  return { id, panels };
}

const defaultProps = {
  dockedTabs: [],
  activeDockedTabId: null,
  onTabSelect: vi.fn(),
  onTabClose: vi.fn(),
  onTabReorder: vi.fn(),
  dockedPanelIds: [] as SidebarPanelId[],
  onAddPanelAsNewTab: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Label display (AC-T-02) ───────────────────────────────────────────────────

describe('DockedTabBar label display (AC-T-02)', () => {
  it('shows truncated first-panel label when name is long', () => {
    // 'writing-assistant' → 'Writing Assistant' (17 chars) → truncated to 16 chars + '…'
    const tab = makeTab('t1', ['writing-assistant']);
    render(
      <DockedTabBar
        {...defaultProps}
        dockedTabs={[tab]}
        activeDockedTabId={null}
      />,
    );
    // truncated: "Writing Assistan…" (16 chars + ellipsis)
    expect(screen.getByText('Writing Assistan…')).toBeTruthy();
  });

  it('shows full label when name is short enough', () => {
    const tab = makeTab('t1', ['vault-graph']);
    render(
      <DockedTabBar {...defaultProps} dockedTabs={[tab]} activeDockedTabId={null} />,
    );
    // 'Graph' (5 chars) — no truncation
    expect(screen.getByText('Graph')).toBeTruthy();
  });
});

// ── Multi-panel badge (AC-T-03) ───────────────────────────────────────────────

describe('DockedTabBar multi-panel badge (AC-T-03)', () => {
  it('shows +N badge for tabs with more than one panel', () => {
    const tab = makeTab('t1', ['stories', 'entities', 'vault']);
    render(
      <DockedTabBar {...defaultProps} dockedTabs={[tab]} activeDockedTabId={null} />,
    );
    expect(screen.getByText('+2')).toBeTruthy();
  });

  it('does not show badge for single-panel tab', () => {
    const tab = makeTab('t1', ['stories']);
    render(
      <DockedTabBar {...defaultProps} dockedTabs={[tab]} activeDockedTabId={null} />,
    );
    // Badge format is "+N" — the [+] add button text is just "+", badge is "+2", "+3" etc.
    expect(screen.queryByText(/^\+\d/)).toBeNull();
  });
});

// ── Close popover (AC-T-06) ───────────────────────────────────────────────────

describe('DockedTabBar close popover (AC-T-06)', () => {
  it('opens close popover with "Send back to right sidebar" without DOM nesting warnings', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const tab = makeTab('t1', ['stories']);
    render(
      <DockedTabBar
        {...defaultProps}
        dockedTabs={[tab]}
        activeDockedTabId={'t1'}
        onTabClose={defaultProps.onTabClose}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /close story navigator tab/i }));
    expect(screen.getByRole('dialog', { name: /close tab options/i })).toBeTruthy();
    expect(screen.getByText('Send back to right sidebar')).toBeTruthy();
    expect(screen.getByText('Remove panel')).toBeTruthy();

    const nestingWarnings = consoleErrorSpy.mock.calls.filter((args) =>
      args.some((arg) => String(arg).includes('validateDOMNesting')),
    );
    consoleErrorSpy.mockRestore();
    expect(nestingWarnings).toEqual([]);
  });

  it('calls onTabClose with "send-to-sidebar" when first option is selected', () => {
    const onTabClose = vi.fn();
    const tab = makeTab('t1', ['stories']);
    render(
      <DockedTabBar
        {...defaultProps}
        dockedTabs={[tab]}
        activeDockedTabId={'t1'}
        onTabClose={onTabClose}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /close story navigator tab/i }));
    fireEvent.click(screen.getByText('Send back to right sidebar'));
    expect(onTabClose).toHaveBeenCalledWith('t1', 'send-to-sidebar');
  });

  it('calls onTabClose with "remove" when "Remove panel" is selected', () => {
    const onTabClose = vi.fn();
    const tab = makeTab('t1', ['stories']);
    render(
      <DockedTabBar
        {...defaultProps}
        dockedTabs={[tab]}
        activeDockedTabId={'t1'}
        onTabClose={onTabClose}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /close story navigator tab/i }));
    fireEvent.click(screen.getByText('Remove panel'));
    expect(onTabClose).toHaveBeenCalledWith('t1', 'remove');
  });
});

// ── Tab selection ─────────────────────────────────────────────────────────────

describe('DockedTabBar tab selection', () => {
  it('calls onTabSelect when a tab is clicked', () => {
    const onTabSelect = vi.fn();
    const tab = makeTab('t1', ['stories']);
    render(
      <DockedTabBar
        {...defaultProps}
        dockedTabs={[tab]}
        activeDockedTabId={null}
        onTabSelect={onTabSelect}
      />,
    );
    // Tab button aria-label is "Story Navigator panel tab" — exact match avoids the close button
    fireEvent.click(screen.getByRole('button', { name: 'Story Navigator panel tab' }));
    expect(onTabSelect).toHaveBeenCalledWith('t1');
  });

  it('marks the active tab with aria-pressed=true', () => {
    const tab = makeTab('t1', ['stories']);
    render(
      <DockedTabBar
        {...defaultProps}
        dockedTabs={[tab]}
        activeDockedTabId={'t1'}
      />,
    );
    const btn = screen.getByRole('button', { name: 'Story Navigator panel tab' });
    expect(btn.getAttribute('aria-pressed')).toBe('true');
  });
});

// ── [+] picker (AC-T-08 partial) ─────────────────────────────────────────────

describe('DockedTabBar [+] picker', () => {
  it('opens panel picker and filters out already-docked panels', () => {
    render(
      <DockedTabBar
        {...defaultProps}
        dockedTabs={[]}
        dockedPanelIds={['stories', 'entities']}
        activeDockedTabId={null}
      />,
    );
    fireEvent.click(screen.getByTestId('dtb-add-btn'));
    // 'stories' and 'entities' should not be in the picker
    expect(screen.queryByText('Story Navigator')).toBeNull();
    expect(screen.queryByText('Entity Browser')).toBeNull();
    // Other panels should appear
    expect(screen.getByText('Vault Browser')).toBeTruthy();
  });

  it('calls onAddPanelAsNewTab when a picker item is selected', () => {
    const onAddPanelAsNewTab = vi.fn();
    render(
      <DockedTabBar
        {...defaultProps}
        dockedTabs={[]}
        dockedPanelIds={[]}
        activeDockedTabId={null}
        onAddPanelAsNewTab={onAddPanelAsNewTab}
      />,
    );
    fireEvent.click(screen.getByTestId('dtb-add-btn'));
    fireEvent.click(screen.getByText('Graph'));
    expect(onAddPanelAsNewTab).toHaveBeenCalledWith('vault-graph');
  });
});

// ── DOCKED_TAB_PANEL_LABELS export ───────────────────────────────────────────

describe('DOCKED_TAB_PANEL_LABELS', () => {
  it('covers all 10 expected panel IDs', () => {
    const expected: SidebarPanelId[] = [
      'stories', 'entities', 'vault', 'vault-graph', 'review',
      'progress', 'timeline', 'writing-assistant', 'archive-continuity', 'scene-preview',
    ];
    for (const id of expected) {
      expect(DOCKED_TAB_PANEL_LABELS[id]).toBeTruthy();
    }
  });
});
