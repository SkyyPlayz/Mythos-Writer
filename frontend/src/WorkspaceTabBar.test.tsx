/**
 * SKY-3097 (v0.3): WorkspaceTabBar unit tests.
 * Covers: tab selection, tab close, reorder, keyboard navigation, empty state.
 * Beta 3 M6: right-click context menu + agents status chip.
 */
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import WorkspaceTabBar from './WorkspaceTabBar';

function makeTab(id: string, title: string, kind: WorkspaceTabKind = 'story-editor'): WorkspaceTab {
  return { id, kind, title, icon: 'X' };
}

const TAB_A = makeTab('tab-a', 'Chapter One');
const TAB_B = makeTab('tab-b', 'Chapter Two');
const TAB_C = makeTab('tab-c', 'Chapter Three');

function defaultProps(overrides: Partial<Parameters<typeof WorkspaceTabBar>[0]> = {}) {
  return {
    tabs: [TAB_A, TAB_B],
    activeTabId: 'tab-a',
    onTabSelect: vi.fn(),
    onTabClose: vi.fn(),
    onTabReorder: vi.fn(),
    onNewTab: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { cleanup(); });

// ── ARIA structure (AC-LN-09) ─────────────────────────────────────────────────

describe('WorkspaceTabBar ARIA structure (AC-LN-09)', () => {
  it('renders a tablist container', () => {
    render(<WorkspaceTabBar {...defaultProps()} />);
    expect(screen.getByRole('tablist', { name: 'Workspace tabs' })).toBeTruthy();
  });

  it('each tab has role="tab" with aria-selected', () => {
    render(<WorkspaceTabBar {...defaultProps()} />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(2);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(tabs[1].getAttribute('aria-selected')).toBe('false');
  });

  it('each tab has aria-controls and id', () => {
    render(<WorkspaceTabBar {...defaultProps()} />);
    const tabA = screen.getByRole('tab', { name: 'Chapter One' });
    expect(tabA.getAttribute('aria-controls')).toBe('workspace-panel-tab-a');
    expect(tabA.id).toBe('workspace-tab-tab-a');
  });

  it('active tab has tabIndex 0; inactive has -1', () => {
    render(<WorkspaceTabBar {...defaultProps()} />);
    const tabA = screen.getByRole('tab', { name: 'Chapter One' });
    const tabB = screen.getByRole('tab', { name: 'Chapter Two' });
    expect(tabA.getAttribute('tabindex')).toBe('0');
    expect(tabB.getAttribute('tabindex')).toBe('-1');
  });
});

// ── Tab selection ─────────────────────────────────────────────────────────────

describe('WorkspaceTabBar tab selection', () => {
  it('calls onTabSelect when a tab is clicked', () => {
    const onTabSelect = vi.fn();
    render(<WorkspaceTabBar {...defaultProps({ onTabSelect })} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Chapter Two' }));
    expect(onTabSelect).toHaveBeenCalledWith('tab-b');
  });

  it('calls onTabSelect with tab id when active tab is re-clicked', () => {
    const onTabSelect = vi.fn();
    render(<WorkspaceTabBar {...defaultProps({ onTabSelect })} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Chapter One' }));
    expect(onTabSelect).toHaveBeenCalledWith('tab-a');
  });
});

// ── Tab close (AC-LN-06) ─────────────────────────────────────────────────────

describe('WorkspaceTabBar tab close (AC-LN-06)', () => {
  it('calls onTabClose immediately on non-active tab close', () => {
    const onTabClose = vi.fn();
    const onTabSelect = vi.fn();
    render(<WorkspaceTabBar {...defaultProps({ onTabClose, onTabSelect })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close Chapter Two' }));
    expect(onTabClose).toHaveBeenCalledWith('tab-b');
    expect(onTabSelect).not.toHaveBeenCalled();
  });

  it('selects left neighbor before closing active tab', () => {
    const onTabClose = vi.fn();
    const onTabSelect = vi.fn();
    render(
      <WorkspaceTabBar
        {...defaultProps({ tabs: [TAB_A, TAB_B, TAB_C], activeTabId: 'tab-b', onTabClose, onTabSelect })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close Chapter Two' }));
    expect(onTabSelect).toHaveBeenCalledWith('tab-a');
    expect(onTabClose).toHaveBeenCalledWith('tab-b');
  });

  it('selects right neighbor when closing first active tab', () => {
    const onTabClose = vi.fn();
    const onTabSelect = vi.fn();
    render(
      <WorkspaceTabBar
        {...defaultProps({ tabs: [TAB_A, TAB_B], activeTabId: 'tab-a', onTabClose, onTabSelect })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close Chapter One' }));
    expect(onTabSelect).toHaveBeenCalledWith('tab-b');
    expect(onTabClose).toHaveBeenCalledWith('tab-a');
  });

  it('does not call onTabSelect when closing the only active tab', () => {
    const onTabClose = vi.fn();
    const onTabSelect = vi.fn();
    render(
      <WorkspaceTabBar
        {...defaultProps({ tabs: [TAB_A], activeTabId: 'tab-a', onTabClose, onTabSelect })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close Chapter One' }));
    expect(onTabSelect).not.toHaveBeenCalled();
    expect(onTabClose).toHaveBeenCalledWith('tab-a');
  });
});

// ── Drag-to-reorder ───────────────────────────────────────────────────────────

function makeDT() {
  return { effectAllowed: '', dropEffect: '', setDragImage: vi.fn() };
}

describe('WorkspaceTabBar drag-to-reorder', () => {
  it('calls onTabReorder when a tab is dropped onto another', () => {
    const onTabReorder = vi.fn();
    render(<WorkspaceTabBar {...defaultProps({ onTabReorder })} />);
    const [tabA, tabB] = screen.getAllByRole('tab');
    const dt = makeDT();
    fireEvent.dragStart(tabA, { dataTransfer: dt });
    fireEvent.dragOver(tabB, { dataTransfer: dt });
    fireEvent.drop(tabB, { dataTransfer: dt });
    expect(onTabReorder).toHaveBeenCalledWith(0, 1);
  });

  it('does not call onTabReorder when dropped on same tab', () => {
    const onTabReorder = vi.fn();
    render(<WorkspaceTabBar {...defaultProps({ onTabReorder })} />);
    const [tabA] = screen.getAllByRole('tab');
    const dt = makeDT();
    fireEvent.dragStart(tabA, { dataTransfer: dt });
    fireEvent.dragOver(tabA, { dataTransfer: dt });
    fireEvent.drop(tabA, { dataTransfer: dt });
    expect(onTabReorder).not.toHaveBeenCalled();
  });
});

// ── Arrow-key focus management (AC-LN-09) ────────────────────────────────────

describe('WorkspaceTabBar arrow-key focus', () => {
  it('ArrowRight moves focus to next tab', async () => {
    render(<WorkspaceTabBar {...defaultProps()} />);
    const [tabA, tabB] = screen.getAllByRole('tab');
    await act(async () => { tabA.focus(); });
    fireEvent.keyDown(tabA, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(tabB);
  });

  it('ArrowLeft wraps from first to last', async () => {
    render(<WorkspaceTabBar {...defaultProps()} />);
    const [tabA, tabB] = screen.getAllByRole('tab');
    await act(async () => { tabA.focus(); });
    fireEvent.keyDown(tabA, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(tabB);
  });

  it('ArrowRight wraps from last to first', async () => {
    render(<WorkspaceTabBar {...defaultProps()} />);
    const [tabA, tabB] = screen.getAllByRole('tab');
    await act(async () => { tabB.focus(); });
    fireEvent.keyDown(tabB, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(tabA);
  });

  it('Home moves focus to first tab', async () => {
    render(<WorkspaceTabBar {...defaultProps({ tabs: [TAB_A, TAB_B, TAB_C] })} />);
    const tabs = screen.getAllByRole('tab');
    await act(async () => { tabs[2].focus(); });
    fireEvent.keyDown(tabs[2], { key: 'Home' });
    expect(document.activeElement).toBe(tabs[0]);
  });

  it('End moves focus to last tab', async () => {
    render(<WorkspaceTabBar {...defaultProps({ tabs: [TAB_A, TAB_B, TAB_C] })} />);
    const tabs = screen.getAllByRole('tab');
    await act(async () => { tabs[0].focus(); });
    fireEvent.keyDown(tabs[0], { key: 'End' });
    expect(document.activeElement).toBe(tabs[2]);
  });
});

// ── Keyboard reorder (SKY-5704) ───────────────────────────────────────────────

describe('WorkspaceTabBar keyboard reorder', () => {
  it('Ctrl+Shift+ArrowRight moves the focused tab one slot right', async () => {
    const onTabReorder = vi.fn();
    render(<WorkspaceTabBar {...defaultProps({ onTabReorder })} />);
    const [tabA] = screen.getAllByRole('tab');
    await act(async () => { tabA.focus(); });
    fireEvent.keyDown(tabA, { key: 'ArrowRight', ctrlKey: true, shiftKey: true });
    expect(onTabReorder).toHaveBeenCalledWith(0, 1);
  });

  it('Ctrl+Shift+ArrowLeft moves the focused tab one slot left', async () => {
    const onTabReorder = vi.fn();
    render(<WorkspaceTabBar {...defaultProps({ onTabReorder })} />);
    const [, tabB] = screen.getAllByRole('tab');
    await act(async () => { tabB.focus(); });
    fireEvent.keyDown(tabB, { key: 'ArrowLeft', ctrlKey: true, shiftKey: true });
    expect(onTabReorder).toHaveBeenCalledWith(1, 0);
  });

  it('does not reorder past the first or last slot', async () => {
    const onTabReorder = vi.fn();
    render(<WorkspaceTabBar {...defaultProps({ onTabReorder })} />);
    const [tabA, tabB] = screen.getAllByRole('tab');
    await act(async () => { tabA.focus(); });
    fireEvent.keyDown(tabA, { key: 'ArrowLeft', ctrlKey: true, shiftKey: true });
    await act(async () => { tabB.focus(); });
    fireEvent.keyDown(tabB, { key: 'ArrowRight', ctrlKey: true, shiftKey: true });
    expect(onTabReorder).not.toHaveBeenCalled();
  });

  it('keeps focus on the moved tab after the parent re-sorts the tabs prop', async () => {
    const onTabReorder = vi.fn();
    const { rerender } = render(<WorkspaceTabBar {...defaultProps({ onTabReorder })} />);
    const [tabA] = screen.getAllByRole('tab');
    await act(async () => { tabA.focus(); });
    fireEvent.keyDown(tabA, { key: 'ArrowRight', ctrlKey: true, shiftKey: true });
    // Simulate the parent applying the reorder and passing new tabs down.
    await act(async () => {
      rerender(<WorkspaceTabBar {...defaultProps({ tabs: [TAB_B, TAB_A], activeTabId: 'tab-a', onTabReorder })} />);
    });
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Chapter One' }));
  });

  it('announces the move via the live region for assistive tech', async () => {
    const onTabReorder = vi.fn();
    render(<WorkspaceTabBar {...defaultProps({ onTabReorder })} />);
    const [tabA] = screen.getAllByRole('tab');
    await act(async () => { tabA.focus(); });
    fireEvent.keyDown(tabA, { key: 'ArrowRight', ctrlKey: true, shiftKey: true });
    expect(screen.getByRole('status')).toHaveTextContent('Chapter One moved to position 2 of 2');
  });

  it('plain ArrowRight without Ctrl+Shift still only moves focus, not order', async () => {
    const onTabReorder = vi.fn();
    render(<WorkspaceTabBar {...defaultProps({ onTabReorder })} />);
    const [tabA] = screen.getAllByRole('tab');
    await act(async () => { tabA.focus(); });
    fireEvent.keyDown(tabA, { key: 'ArrowRight' });
    expect(onTabReorder).not.toHaveBeenCalled();
  });
});

// ── Drag affordance (SKY-5704) ────────────────────────────────────────────────

describe('WorkspaceTabBar drag affordance', () => {
  it('applies a dragging class to the source tab slot while dragging', () => {
    render(<WorkspaceTabBar {...defaultProps()} />);
    const [tabA] = screen.getAllByRole('tab');
    const dt = makeDT();
    fireEvent.dragStart(tabA, { dataTransfer: dt });
    expect(tabA.closest('.wtb-tab-slot')).toHaveClass('wtb-tab-slot--dragging');
    fireEvent.dragEnd(tabA, { dataTransfer: dt });
    expect(tabA.closest('.wtb-tab-slot')).not.toHaveClass('wtb-tab-slot--dragging');
  });

  it('announces the move via the live region when dropped', () => {
    const onTabReorder = vi.fn();
    render(<WorkspaceTabBar {...defaultProps({ onTabReorder })} />);
    const [tabA, tabB] = screen.getAllByRole('tab');
    const dt = makeDT();
    fireEvent.dragStart(tabA, { dataTransfer: dt });
    fireEvent.dragOver(tabB, { dataTransfer: dt });
    fireEvent.drop(tabB, { dataTransfer: dt });
    expect(screen.getByRole('status')).toHaveTextContent('Chapter One moved to position 2 of 2');
  });
});

// ── Overflow scroll strip (SKY-5704) ──────────────────────────────────────────

describe('WorkspaceTabBar overflow scroll strip', () => {
  it('renders tabs inside a dedicated scroll container, with + button outside it', () => {
    render(<WorkspaceTabBar {...defaultProps()} />);
    const scrollStrip = document.querySelector('.wtb-tabs-scroll');
    expect(scrollStrip).toBeTruthy();
    expect(scrollStrip?.contains(screen.getByRole('tab', { name: 'Chapter One' }))).toBe(true);
    expect(scrollStrip?.contains(screen.getByTestId('wtb-new-tab-btn'))).toBe(false);
  });

  it('scrolls the active tab into view when activeTabId changes', async () => {
    const { rerender } = render(<WorkspaceTabBar {...defaultProps({ tabs: [TAB_A, TAB_B, TAB_C], activeTabId: 'tab-a' })} />);
    const tabC = screen.getByRole('tab', { name: 'Chapter Three' });
    const spy = vi.spyOn(tabC, 'scrollIntoView');
    await act(async () => {
      rerender(<WorkspaceTabBar {...defaultProps({ tabs: [TAB_A, TAB_B, TAB_C], activeTabId: 'tab-c' })} />);
    });
    expect(spy).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
  });
});

// ── Global keyboard shortcuts ─────────────────────────────────────────────────

describe('WorkspaceTabBar global keyboard shortcuts', () => {
  it('Ctrl+W closes the active tab', () => {
    const onTabClose = vi.fn();
    render(<WorkspaceTabBar {...defaultProps({ onTabClose })} />);
    fireEvent.keyDown(document.body, { ctrlKey: true, key: 'w' });
    expect(onTabClose).toHaveBeenCalledWith('tab-a');
  });

  it('Ctrl+Tab cycles to next tab', () => {
    const onTabSelect = vi.fn();
    render(<WorkspaceTabBar {...defaultProps({ onTabSelect })} />);
    fireEvent.keyDown(document.body, { ctrlKey: true, key: 'Tab', shiftKey: false });
    expect(onTabSelect).toHaveBeenCalledWith('tab-b');
  });

  it('Ctrl+Shift+Tab wraps to last tab from first', () => {
    const onTabSelect = vi.fn();
    render(
      <WorkspaceTabBar
        {...defaultProps({ tabs: [TAB_A, TAB_B, TAB_C], activeTabId: 'tab-a', onTabSelect })}
      />,
    );
    fireEvent.keyDown(document.body, { ctrlKey: true, key: 'Tab', shiftKey: true });
    expect(onTabSelect).toHaveBeenCalledWith('tab-c');
  });

  it('Ctrl+W with no active tab does nothing', () => {
    const onTabClose = vi.fn();
    render(<WorkspaceTabBar {...defaultProps({ activeTabId: null, onTabClose })} />);
    fireEvent.keyDown(document.body, { ctrlKey: true, key: 'w' });
    expect(onTabClose).not.toHaveBeenCalled();
  });

  it('Ctrl+Tab does nothing when tab list is empty', () => {
    const onTabSelect = vi.fn();
    render(<WorkspaceTabBar {...defaultProps({ tabs: [], activeTabId: null, onTabSelect })} />);
    fireEvent.keyDown(document.body, { ctrlKey: true, key: 'Tab' });
    expect(onTabSelect).not.toHaveBeenCalled();
  });
});

// ── Empty state ───────────────────────────────────────────────────────────────

describe('WorkspaceTabBar empty state', () => {
  it('renders no tabs but shows the + button', () => {
    render(<WorkspaceTabBar {...defaultProps({ tabs: [], activeTabId: null })} />);
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    expect(screen.getByTestId('wtb-new-tab-btn')).toBeTruthy();
  });

  it('tablist accessible name is correct when empty', () => {
    render(<WorkspaceTabBar {...defaultProps({ tabs: [], activeTabId: null })} />);
    expect(screen.getByRole('tablist', { name: 'Workspace tabs' })).toBeTruthy();
  });
});

// ── New tab button ────────────────────────────────────────────────────────────

describe('WorkspaceTabBar + button', () => {
  it('calls onNewTab when + is clicked', () => {
    const onNewTab = vi.fn();
    render(<WorkspaceTabBar {...defaultProps({ onNewTab })} />);
    fireEvent.click(screen.getByTestId('wtb-new-tab-btn'));
    expect(onNewTab).toHaveBeenCalledTimes(1);
  });
});

// ── Tab context menu (Beta 3 M6) ──────────────────────────────────────────────

describe('WorkspaceTabBar context menu (M6)', () => {
  it('right-click opens the menu with the three prototype items and the hint', () => {
    render(<WorkspaceTabBar {...defaultProps()} />);
    fireEvent.contextMenu(screen.getByRole('tab', { name: 'Chapter Two' }));
    const menu = screen.getByTestId('wtb-tab-context-menu');
    expect(menu).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Open to the side' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Pop out into new window' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Close tab' })).toBeTruthy();
    expect(menu).toHaveTextContent('Drag tabs to reorder · right-click for this menu');
  });

  it('right-click does not select the tab', () => {
    const onTabSelect = vi.fn();
    render(<WorkspaceTabBar {...defaultProps({ onTabSelect })} />);
    fireEvent.contextMenu(screen.getByRole('tab', { name: 'Chapter Two' }));
    expect(onTabSelect).not.toHaveBeenCalled();
  });

  it('right-clicking the same tab again toggles the menu closed', () => {
    render(<WorkspaceTabBar {...defaultProps()} />);
    const tab = screen.getByRole('tab', { name: 'Chapter Two' });
    fireEvent.contextMenu(tab);
    fireEvent.contextMenu(tab);
    expect(screen.queryByTestId('wtb-tab-context-menu')).toBeNull();
  });

  it('right-clicking another tab moves the menu to that tab', () => {
    render(<WorkspaceTabBar {...defaultProps()} />);
    fireEvent.contextMenu(screen.getByRole('tab', { name: 'Chapter One' }));
    fireEvent.contextMenu(screen.getByRole('tab', { name: 'Chapter Two' }));
    expect(screen.getByRole('menu', { name: 'Chapter Two tab actions' })).toBeTruthy();
  });

  it('"Open to the side" routes to onTabOpenInSplit and closes the menu', () => {
    const onTabOpenInSplit = vi.fn();
    render(<WorkspaceTabBar {...defaultProps({ onTabOpenInSplit })} />);
    fireEvent.contextMenu(screen.getByRole('tab', { name: 'Chapter Two' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open to the side' }));
    expect(onTabOpenInSplit).toHaveBeenCalledWith('tab-b');
    expect(screen.queryByTestId('wtb-tab-context-menu')).toBeNull();
  });

  it('"Pop out into new window" routes to onTabPopOut and closes the menu', () => {
    const onTabPopOut = vi.fn();
    render(<WorkspaceTabBar {...defaultProps({ onTabPopOut })} />);
    fireEvent.contextMenu(screen.getByRole('tab', { name: 'Chapter Two' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Pop out into new window' }));
    expect(onTabPopOut).toHaveBeenCalledWith('tab-b');
    expect(screen.queryByTestId('wtb-tab-context-menu')).toBeNull();
  });

  it('"Pop out into new window" without onTabPopOut still closes the menu', () => {
    render(<WorkspaceTabBar {...defaultProps()} />);
    fireEvent.contextMenu(screen.getByRole('tab', { name: 'Chapter Two' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Pop out into new window' }));
    expect(screen.queryByTestId('wtb-tab-context-menu')).toBeNull();
  });

  it('"Close tab" on the active tab selects the left neighbor before closing (AC-LN-06)', () => {
    const onTabClose = vi.fn();
    const onTabSelect = vi.fn();
    render(
      <WorkspaceTabBar
        {...defaultProps({ tabs: [TAB_A, TAB_B, TAB_C], activeTabId: 'tab-b', onTabClose, onTabSelect })}
      />,
    );
    fireEvent.contextMenu(screen.getByRole('tab', { name: 'Chapter Two' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close tab' }));
    expect(onTabSelect).toHaveBeenCalledWith('tab-a');
    expect(onTabClose).toHaveBeenCalledWith('tab-b');
  });

  it('"Close tab" on a non-active tab closes without changing selection', () => {
    const onTabClose = vi.fn();
    const onTabSelect = vi.fn();
    render(<WorkspaceTabBar {...defaultProps({ onTabClose, onTabSelect })} />);
    fireEvent.contextMenu(screen.getByRole('tab', { name: 'Chapter Two' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close tab' }));
    expect(onTabClose).toHaveBeenCalledWith('tab-b');
    expect(onTabSelect).not.toHaveBeenCalled();
  });

  it('Escape closes the menu', () => {
    render(<WorkspaceTabBar {...defaultProps()} />);
    fireEvent.contextMenu(screen.getByRole('tab', { name: 'Chapter One' }));
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByTestId('wtb-tab-context-menu')).toBeNull();
  });

  it('mousedown outside the menu closes it', () => {
    render(<WorkspaceTabBar {...defaultProps()} />);
    fireEvent.contextMenu(screen.getByRole('tab', { name: 'Chapter One' }));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId('wtb-tab-context-menu')).toBeNull();
  });
});

// ── Agents status chip (Beta 3 M6) ────────────────────────────────────────────

describe('WorkspaceTabBar agents status chip (M6)', () => {
  it('shows the prototype idle state by default', () => {
    render(<WorkspaceTabBar {...defaultProps()} />);
    const chip = screen.getByTestId('wtb-agents-chip');
    expect(chip).toHaveTextContent('All agents idle');
    expect(chip.querySelector('.wtb-agents-dot')).not.toHaveClass('wtb-agents-dot--active');
  });

  it('shows the working state when agentsActive is true', () => {
    render(<WorkspaceTabBar {...defaultProps({ agentsActive: true })} />);
    const chip = screen.getByTestId('wtb-agents-chip');
    expect(chip).toHaveTextContent('Agents working');
    expect(chip.querySelector('.wtb-agents-dot')).toHaveClass('wtb-agents-dot--active');
  });

  it('renders the chip even when there are no tabs', () => {
    render(<WorkspaceTabBar {...defaultProps({ tabs: [], activeTabId: null })} />);
    expect(screen.getByTestId('wtb-agents-chip')).toHaveTextContent('All agents idle');
  });
});
