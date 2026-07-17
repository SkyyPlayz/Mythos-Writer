import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import GlobalRightSidebar, { DEFAULT_PANELS, type PanelConfig } from './GlobalRightSidebar';
import { PanelDragProvider } from './PanelDragContext';

// SKY-1695: renderPanelContent is now supplied by DesktopShell. Stubs map panel
// IDs to test-discoverable divs so we can assert panel body visibility.
function renderPanelContent(id: string) {
  const testIdMap: Record<string, string> = {
    'scene-notes': 'scene-notes-panel',
    'scene-properties': 'scene-properties-panel',
    'scene-outline': 'scene-outline-panel',
    'writing-assistant': 'writing-assistant-panel',
    'archive-continuity': 'archive-panel',
    'scene-preview': 'scene-preview-panel',
  };
  return <div data-testid={testIdMap[id] ?? id}>{id}</div>;
}

const noop = vi.fn();

const defaultProps = {
  visible: true,
  width: 300,
  panels: [...DEFAULT_PANELS],
  onVisibilityChange: vi.fn(),
  onWidthChange: vi.fn(),
  onPanelsChange: vi.fn(),
  renderPanelContent,
  leftPanelCount: 3,
};

function renderWithProvider(ui: React.ReactElement) {
  return render(
    <PanelDragProvider onDrop={noop}>{ui}</PanelDragProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GlobalRightSidebar', () => {
  describe('visibility', () => {
    it('renders the sidebar when visible=true', () => {
      renderWithProvider(<GlobalRightSidebar {...defaultProps} />);
      expect(screen.getByTestId('global-right-sidebar')).toBeInTheDocument();
    });

    it('renders collapsed edge with show button when visible=false', () => {
      renderWithProvider(<GlobalRightSidebar {...defaultProps} visible={false} />);
      expect(screen.queryByTestId('global-right-sidebar')).toBeNull();
      expect(screen.getByRole('button', { name: /show right sidebar/i })).toBeInTheDocument();
    });

    it('calls onVisibilityChange(false) when hide button is clicked', () => {
      const onVisibilityChange = vi.fn();
      renderWithProvider(<GlobalRightSidebar {...defaultProps} onVisibilityChange={onVisibilityChange} />);
      fireEvent.click(screen.getByRole('button', { name: /hide right sidebar/i }));
      expect(onVisibilityChange).toHaveBeenCalledWith(false);
    });

    it('calls onVisibilityChange(true) when show button is clicked from collapsed state', () => {
      const onVisibilityChange = vi.fn();
      renderWithProvider(<GlobalRightSidebar {...defaultProps} visible={false} onVisibilityChange={onVisibilityChange} />);
      fireEvent.click(screen.getByRole('button', { name: /show right sidebar/i }));
      expect(onVisibilityChange).toHaveBeenCalledWith(true);
    });
  });

  describe('panel collapse/expand', () => {
    it('renders the three default scene panels (GH #633: WA/Continuity/Preview moved to left)', () => {
      renderWithProvider(<GlobalRightSidebar {...defaultProps} />);
      expect(screen.getByLabelText(/scene notes panel/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/scene properties panel/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/outline panel/i)).toBeInTheDocument();
    });

    it('collapses a panel when header is clicked', () => {
      const onPanelsChange = vi.fn();
      const panels: PanelConfig[] = [
        { id: 'scene-notes', collapsed: false },
        { id: 'scene-properties', collapsed: false },
        { id: 'scene-outline', collapsed: false },
      ];
      renderWithProvider(<GlobalRightSidebar {...defaultProps} panels={panels} onPanelsChange={onPanelsChange} />);

      const header = screen.getByLabelText(/scene notes panel/i);
      fireEvent.click(header);

      expect(onPanelsChange).toHaveBeenCalledOnce();
      const updated: PanelConfig[] = onPanelsChange.mock.calls[0][0];
      expect(updated.find((p) => p.id === 'scene-notes')?.collapsed).toBe(true);
    });

    it('expands a collapsed panel when header is clicked', () => {
      const onPanelsChange = vi.fn();
      const panels: PanelConfig[] = [
        { id: 'scene-notes', collapsed: true },
      ];
      renderWithProvider(<GlobalRightSidebar {...defaultProps} panels={panels} onPanelsChange={onPanelsChange} />);

      const header = screen.getByLabelText(/scene notes panel/i);
      fireEvent.click(header);

      expect(onPanelsChange).toHaveBeenCalledOnce();
      const updated: PanelConfig[] = onPanelsChange.mock.calls[0][0];
      expect(updated.find((p) => p.id === 'scene-notes')?.collapsed).toBe(false);
    });

    it('hides panel body when collapsed', () => {
      const panels: PanelConfig[] = [{ id: 'scene-notes', collapsed: true }];
      renderWithProvider(<GlobalRightSidebar {...defaultProps} panels={panels} />);
      expect(screen.queryByTestId('scene-notes-panel')).toBeNull();
    });

    it('shows panel body when not collapsed', () => {
      const panels: PanelConfig[] = [{ id: 'scene-notes', collapsed: false }];
      renderWithProvider(<GlobalRightSidebar {...defaultProps} panels={panels} />);
      expect(screen.getByTestId('scene-notes-panel')).toBeInTheDocument();
    });
  });

  describe('panel remove', () => {
    it('removes a panel when × button is clicked', () => {
      const onPanelsChange = vi.fn();
      const panels: PanelConfig[] = [
        { id: 'scene-notes', collapsed: false },
        { id: 'scene-properties', collapsed: false },
      ];
      renderWithProvider(<GlobalRightSidebar {...defaultProps} panels={panels} onPanelsChange={onPanelsChange} />);

      fireEvent.click(screen.getByRole('button', { name: /remove scene notes/i }));

      expect(onPanelsChange).toHaveBeenCalledOnce();
      const updated: PanelConfig[] = onPanelsChange.mock.calls[0][0];
      expect(updated.find((p) => p.id === 'scene-notes')).toBeUndefined();
      expect(updated.find((p) => p.id === 'scene-properties')).toBeDefined();
    });
  });

  describe('add panel', () => {
    it('shows only missing scene panels in the add panel picker', () => {
      const panels: PanelConfig[] = [
        { id: 'scene-notes', collapsed: false },
        { id: 'scene-properties', collapsed: false },
      ];
      renderWithProvider(<GlobalRightSidebar {...defaultProps} panels={panels} />);

      fireEvent.click(screen.getByRole('button', { name: /add panel/i }));
      const picker = screen.getByRole('menu', { name: /available panels/i });
      expect(picker).toBeInTheDocument();
      expect(screen.queryByRole('menuitem', { name: /^scene notes$/i })).toBeNull();
      expect(screen.queryByRole('menuitem', { name: /^scene properties$/i })).toBeNull();
      expect(screen.getByRole('menuitem', { name: /outline/i })).toBeInTheDocument();
    });

    it('writing coach / continuity / scene preview are NOT in the right sidebar picker (moved to left)', () => {
      renderWithProvider(<GlobalRightSidebar {...defaultProps} panels={[]} />);
      fireEvent.click(screen.getByRole('button', { name: /add panel/i }));
      expect(screen.queryByRole('menuitem', { name: /writing coach/i })).toBeNull();
      expect(screen.queryByRole('menuitem', { name: /^continuity$/i })).toBeNull();
      expect(screen.queryByRole('menuitem', { name: /scene preview/i })).toBeNull();
    });

    it('calls onPanelsChange with new panel when picker item is clicked', () => {
      const onPanelsChange = vi.fn();
      const panels: PanelConfig[] = [{ id: 'scene-notes', collapsed: false }];
      renderWithProvider(<GlobalRightSidebar {...defaultProps} panels={panels} onPanelsChange={onPanelsChange} />);

      fireEvent.click(screen.getByRole('button', { name: /add panel/i }));
      fireEvent.click(screen.getByRole('menuitem', { name: /outline/i }));

      expect(onPanelsChange).toHaveBeenCalledOnce();
      const updated: PanelConfig[] = onPanelsChange.mock.calls[0][0];
      expect(updated.find((p) => p.id === 'scene-outline')).toBeDefined();
    });
  });

  describe('badge count', () => {
    // archive-continuity is no longer in DEFAULT_PANELS (GH #633: moved to left sidebar),
    // so supply it explicitly to test badge rendering.
    const panelsWithContinuity: PanelConfig[] = [
      ...DEFAULT_PANELS,
      { id: 'archive-continuity', collapsed: false },
    ];

    it('shows continuity badge when continuityIssueCount > 0', () => {
      renderWithProvider(
        <GlobalRightSidebar {...defaultProps} panels={panelsWithContinuity} continuityIssueCount={3} />,
      );
      expect(screen.getByLabelText(/3 issues/i)).toBeInTheDocument();
    });

    it('does not show badge when continuityIssueCount is 0', () => {
      renderWithProvider(
        <GlobalRightSidebar {...defaultProps} panels={panelsWithContinuity} continuityIssueCount={0} />,
      );
      expect(screen.queryByLabelText(/0 issues/i)).toBeNull();
    });
  });

  describe('panel drag handles', () => {
    it('renders drag handles for each panel with correct aria-labels', () => {
      const panels: PanelConfig[] = [
        { id: 'scene-notes', collapsed: false },
        { id: 'scene-properties', collapsed: false },
        { id: 'scene-outline', collapsed: false },
      ];
      renderWithProvider(<GlobalRightSidebar {...defaultProps} panels={panels} />);

      expect(screen.getByRole('button', { name: 'Move Scene Notes' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Move Scene Properties' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Move Outline' })).toBeInTheDocument();
    });

    it('drag handles are draggable', () => {
      const panels: PanelConfig[] = [{ id: 'scene-notes', collapsed: false }];
      renderWithProvider(<GlobalRightSidebar {...defaultProps} panels={panels} />);
      const handle = screen.getByRole('button', { name: 'Move Scene Notes' });
      expect(handle).toHaveAttribute('draggable', 'true');
    });
  });

  describe('brainstorm panel (SKY-3623)', () => {
    it('lists Brainstorm in the Add Panel picker when not already added', () => {
      const panels: PanelConfig[] = [
        { id: 'writing-assistant', collapsed: false },
      ];
      renderWithProvider(<GlobalRightSidebar {...defaultProps} panels={panels} />);
      fireEvent.click(screen.getByRole('button', { name: /add panel/i }));
      expect(screen.getByRole('menuitem', { name: 'Brainstorm' })).toBeInTheDocument();
    });

    it('renders the brainstorm panel body when added and expanded', () => {
      const panels: PanelConfig[] = [
        { id: 'brainstorm', collapsed: false },
      ];
      renderWithProvider(<GlobalRightSidebar {...defaultProps} panels={panels} />);
      expect(screen.getByLabelText(/brainstorm panel/i)).toBeInTheDocument();
      expect(screen.getByTestId('brainstorm')).toBeInTheDocument();
    });

    it('renders a drag handle for the brainstorm panel', () => {
      const panels: PanelConfig[] = [{ id: 'brainstorm', collapsed: false }];
      renderWithProvider(<GlobalRightSidebar {...defaultProps} panels={panels} />);
      expect(screen.getByRole('button', { name: 'Move Brainstorm' })).toBeInTheDocument();
    });
  });
});
