import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import GlobalRightSidebar, { DEFAULT_PANELS, type PanelConfig } from './GlobalRightSidebar';
import { PanelDragProvider } from './PanelDrag';

function withDrag(ui: React.ReactElement) {
  return <PanelDragProvider onPanelMove={() => {}}>{ui}</PanelDragProvider>;
}

// Stub heavy panel components
vi.mock('./WritingAssistantPanel', () => ({
  default: () => <div data-testid="writing-assistant-panel">WritingAssistantPanel</div>,
}));

let mockContinuityOnCountChange: ((n: number) => void) | undefined;
vi.mock('./ContinuityPanel', () => ({
  default: (props: { onCountChange?: (n: number) => void }) => {
    mockContinuityOnCountChange = props.onCountChange;
    return <div data-testid="continuity-panel">ContinuityPanel</div>;
  },
}));
vi.mock('./ScenePreviewPanel', () => ({
  default: () => <div data-testid="scene-preview-panel">ScenePreviewPanel</div>,
}));

const defaultProps = {
  visible: true,
  width: 300,
  panels: [...DEFAULT_PANELS],
  onVisibilityChange: vi.fn(),
  onWidthChange: vi.fn(),
  onPanelsChange: vi.fn(),
  scene: null,
  chapter: null,
  story: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GlobalRightSidebar', () => {
  describe('visibility', () => {
    it('renders the sidebar when visible=true', () => {
      render(withDrag(<GlobalRightSidebar {...defaultProps} />));
      expect(screen.getByTestId('global-right-sidebar')).toBeInTheDocument();
    });

    it('renders collapsed edge with show button when visible=false', () => {
      render(withDrag(<GlobalRightSidebar {...defaultProps} visible={false} />));
      expect(screen.queryByTestId('global-right-sidebar')).toBeNull();
      expect(screen.getByRole('button', { name: /show right sidebar/i })).toBeInTheDocument();
    });

    it('calls onVisibilityChange(false) when hide button is clicked', () => {
      const onVisibilityChange = vi.fn();
      render(withDrag(<GlobalRightSidebar {...defaultProps} onVisibilityChange={onVisibilityChange} />));
      fireEvent.click(screen.getByRole('button', { name: /hide right sidebar/i }));
      expect(onVisibilityChange).toHaveBeenCalledWith(false);
    });

    it('calls onVisibilityChange(true) when show button is clicked from collapsed state', () => {
      const onVisibilityChange = vi.fn();
      render(withDrag(<GlobalRightSidebar {...defaultProps} visible={false} onVisibilityChange={onVisibilityChange} />));
      fireEvent.click(screen.getByRole('button', { name: /show right sidebar/i }));
      expect(onVisibilityChange).toHaveBeenCalledWith(true);
    });
  });

  describe('panel collapse/expand', () => {
    it('renders all three default panels', () => {
      render(withDrag(<GlobalRightSidebar {...defaultProps} />));
      expect(screen.getByLabelText(/writing assistant panel/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/continuity panel/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/scene preview panel/i)).toBeInTheDocument();
    });

    it('collapses a panel when header is clicked', () => {
      const onPanelsChange = vi.fn();
      const panels: PanelConfig[] = [
        { id: 'writing-assistant', collapsed: false },
        { id: 'archive-continuity', collapsed: false },
        { id: 'scene-preview', collapsed: false },
      ];
      render(withDrag(<GlobalRightSidebar {...defaultProps} panels={panels} onPanelsChange={onPanelsChange} />));

      const header = screen.getByLabelText(/writing assistant panel/i);
      fireEvent.click(header);

      expect(onPanelsChange).toHaveBeenCalledOnce();
      const updated: PanelConfig[] = onPanelsChange.mock.calls[0][0];
      expect(updated.find((p) => p.id === 'writing-assistant')?.collapsed).toBe(true);
    });

    it('expands a collapsed panel when header is clicked', () => {
      const onPanelsChange = vi.fn();
      const panels: PanelConfig[] = [
        { id: 'writing-assistant', collapsed: true },
      ];
      render(withDrag(<GlobalRightSidebar {...defaultProps} panels={panels} onPanelsChange={onPanelsChange} />));

      const header = screen.getByLabelText(/writing assistant panel/i);
      fireEvent.click(header);

      expect(onPanelsChange).toHaveBeenCalledOnce();
      const updated: PanelConfig[] = onPanelsChange.mock.calls[0][0];
      expect(updated.find((p) => p.id === 'writing-assistant')?.collapsed).toBe(false);
    });

    it('hides panel body when collapsed', () => {
      const panels: PanelConfig[] = [{ id: 'writing-assistant', collapsed: true }];
      render(withDrag(<GlobalRightSidebar {...defaultProps} panels={panels} />));
      expect(screen.queryByTestId('writing-assistant-panel')).toBeNull();
    });

    it('shows panel body when not collapsed', () => {
      const panels: PanelConfig[] = [{ id: 'writing-assistant', collapsed: false }];
      render(withDrag(<GlobalRightSidebar {...defaultProps} panels={panels} />));
      expect(screen.getByTestId('writing-assistant-panel')).toBeInTheDocument();
    });
  });

  describe('panel remove', () => {
    it('removes a panel when × button is clicked', () => {
      const onPanelsChange = vi.fn();
      const panels: PanelConfig[] = [
        { id: 'writing-assistant', collapsed: false },
        { id: 'scene-preview', collapsed: false },
      ];
      render(withDrag(<GlobalRightSidebar {...defaultProps} panels={panels} onPanelsChange={onPanelsChange} />));

      fireEvent.click(screen.getByRole('button', { name: /remove writing assistant/i }));

      expect(onPanelsChange).toHaveBeenCalledOnce();
      const updated: PanelConfig[] = onPanelsChange.mock.calls[0][0];
      expect(updated.find((p) => p.id === 'writing-assistant')).toBeUndefined();
      expect(updated.find((p) => p.id === 'scene-preview')).toBeDefined();
    });
  });

  describe('add panel', () => {
    it('shows only missing panels in the add panel picker', () => {
      const panels: PanelConfig[] = [
        { id: 'writing-assistant', collapsed: false },
        { id: 'archive-continuity', collapsed: false },
      ];
      render(withDrag(<GlobalRightSidebar {...defaultProps} panels={panels} />));

      fireEvent.click(screen.getByRole('button', { name: /add panel/i }));
      const picker = screen.getByRole('menu', { name: /available panels/i });
      expect(picker).toBeInTheDocument();
      expect(screen.queryByRole('menuitem', { name: /writing assistant/i })).toBeNull();
      expect(screen.queryByRole('menuitem', { name: /continuity/i })).toBeNull();
      expect(screen.getByRole('menuitem', { name: /scene preview/i })).toBeInTheDocument();
    });

    it('calls onPanelsChange with new panel when picker item is clicked', () => {
      const onPanelsChange = vi.fn();
      const panels: PanelConfig[] = [{ id: 'writing-assistant', collapsed: false }];
      render(withDrag(<GlobalRightSidebar {...defaultProps} panels={panels} onPanelsChange={onPanelsChange} />));

      fireEvent.click(screen.getByRole('button', { name: /add panel/i }));
      fireEvent.click(screen.getByRole('menuitem', { name: /scene preview/i }));

      expect(onPanelsChange).toHaveBeenCalledOnce();
      const updated: PanelConfig[] = onPanelsChange.mock.calls[0][0];
      expect(updated.find((p) => p.id === 'scene-preview')).toBeDefined();
    });
  });

  describe('badge count', () => {
    it('shows continuity badge when ContinuityPanel reports count > 0', () => {
      render(withDrag(<GlobalRightSidebar {...defaultProps} />));
      act(() => { mockContinuityOnCountChange?.(3); });
      expect(screen.getByLabelText(/3 issues/i)).toBeInTheDocument();
    });

    it('does not show badge when count is 0', () => {
      render(withDrag(<GlobalRightSidebar {...defaultProps} />));
      act(() => { mockContinuityOnCountChange?.(0); });
      expect(screen.queryByLabelText(/0 issues/i)).toBeNull();
    });
  });

  describe('panel drag handles', () => {
    it('renders a DragHandle for each panel with correct aria-label', () => {
      const panels: PanelConfig[] = [
        { id: 'writing-assistant', collapsed: false },
        { id: 'archive-continuity', collapsed: false },
        { id: 'scene-preview', collapsed: false },
      ];
      render(withDrag(<GlobalRightSidebar {...defaultProps} panels={panels} onPanelsChange={vi.fn()} />));

      expect(screen.getByRole('button', { name: /^move writing assistant$/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^move continuity$/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^move scene preview$/i })).toBeInTheDocument();
    });
  });
});
