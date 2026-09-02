import { useCallback, useRef, type ReactNode } from 'react';
import './GlobalRightSidebar.css';
import { RightSidebarSlotTarget, useRightSidebarSlotOccupied } from './RightSidebarSlot';

const SIDEBAR_MIN_WIDTH = 200;
const SIDEBAR_MAX_WIDTH = 600;

// Kept for DesktopShell backward-compat import
export const DEFAULT_PANELS: never[] = [];
export type PanelConfig = RightSidebarPanel;

interface Props {
  visible: boolean;
  width: number;
  onVisibilityChange: (visible: boolean) => void;
  onWidthChange: (width: number) => void;
  /** Overlay (e.g. neon border) rendered inside the sidebar. */
  neonOverlay?: ReactNode;
  /** The sidebar's main content — pass <AgentHubPanel /> here (M6). */
  children?: ReactNode;
  /**
   * Legacy props accepted but ignored — panel system removed in M6.
   * Kept as optional unknowns so DesktopShell doesn't need simultaneous update.
   */
  panels?: unknown;
  onPanelsChange?: unknown;
  renderPanelContent?: unknown;
  continuityIssueCount?: number;
  reviewBadgeCount?: number;
  leftPanelCount?: number;
  onFloatPanel?: unknown;
  onDockAsTab?: unknown;
  /** Legacy — rendered above content if passed (backward compat during M6 transition). */
  headerContent?: ReactNode;
}

export default function GlobalRightSidebar({
  visible,
  width,
  onVisibilityChange,
  onWidthChange,
  neonOverlay,
  children,
  headerContent,
}: Props) {
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);
  // SKY-11211: a page (e.g. Brainstorm) can claim the sidebar via
  // <RightSidebarSlot> from anywhere in the tree — when it has, its content
  // replaces `children` (the default Assistant panel) instead of stacking a
  // second column next to it. Falls back to `children` the instant nothing
  // has claimed it (route left / never claimed).
  const routeSlotOccupied = useRightSidebarSlotOccupied();

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    startXRef.current = e.clientX;
    startWidthRef.current = width;

    const onMouseMove = (mv: MouseEvent) => {
      const delta = startXRef.current - mv.clientX;
      const next = Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, startWidthRef.current + delta));
      onWidthChange(next);
    };
    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [width, onWidthChange]);

  if (!visible) {
    return (
      <div
        className="grs-collapsed-edge"
        data-testid="grs-edge"
        role="complementary"
        aria-label="Right sidebar (hidden)"
      >
        <button
          className="grs-show-btn"
          onClick={() => onVisibilityChange(true)}
          aria-label="Show right sidebar"
          title="Show right sidebar"
        >
          ‹
        </button>
      </div>
    );
  }

  return (
    <aside
      className="grs-sidebar"
      data-testid="global-right-sidebar"
      aria-label="Right sidebar"
      style={{ width }}
    >
      {neonOverlay}
      <div
        className="grs-resize-handle"
        onMouseDown={handleResizeMouseDown}
        role="separator"
        aria-label="Resize right sidebar"
        aria-orientation="vertical"
      />
      <div className="grs-topbar">
        <button
          className="grs-hide-btn"
          onClick={() => onVisibilityChange(false)}
          aria-label="Hide right sidebar"
          title="Hide right sidebar"
        >
          ›
        </button>
      </div>
      {/* headerContent: legacy slot, rendered for backward compat during M6 transition */}
      {headerContent}
      <div className="grs-content">
        {/* SKY-11211: always mount the route-slot target so a page claiming
            it mid-render has somewhere to portal into immediately; hide it
            (rather than unmount) when nothing's claimed so the DOM node —
            and any active claim's portal — survives a claim flicker. */}
        <RightSidebarSlotTarget className={routeSlotOccupied ? 'grs-route-slot' : 'grs-route-slot grs-route-slot--empty'} />
        {!routeSlotOccupied && children}
      </div>
    </aside>
  );
}
