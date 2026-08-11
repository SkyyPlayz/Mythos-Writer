import { useCallback, useRef, type ReactNode } from 'react';
import './GlobalRightSidebar.css';

// ── Constants ──────────────────────────────────────────────────────────────────

const SIDEBAR_MIN_WIDTH = 200;
const SIDEBAR_MAX_WIDTH = 600;

// ── Exports for DesktopShell backward-compat ───────────────────────────────────

export const DEFAULT_PANELS: never[] = [];
export type PanelConfig = { id: SidebarPanelId; collapsed: boolean };

// ── Props ──────────────────────────────────────────────────────────────────────

interface Props {
  /** Whether the sidebar is shown at full width (true) or collapsed to edge (false). */
  visible: boolean;
  width: number;
  onVisibilityChange: (visible: boolean) => void;
  onWidthChange: (width: number) => void;
  /** Overlay (e.g. neon border) rendered inside the sidebar. */
  neonOverlay?: ReactNode;
  /** The sidebar's main content (AgentHubPanel). */
  children?: ReactNode;
  // Kept so DesktopShell.tsx doesn't need to be changed today — ignored here:
  panels?: PanelConfig[];
  onPanelsChange?: (panels: PanelConfig[]) => void;
  renderPanelContent?: (id: SidebarPanelId) => ReactNode;
  continuityIssueCount?: number;
  reviewBadgeCount?: number;
  leftPanelCount?: number;
  onFloatPanel?: (id: SidebarPanelId) => void;
  onDockAsTab?: (id: SidebarPanelId) => void;
  headerContent?: ReactNode;
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function GlobalRightSidebar({
  visible,
  width,
  onVisibilityChange,
  onWidthChange,
  neonOverlay,
  children,
  headerContent,
}: Props) {
  const sidebarRef = useRef<HTMLElement | null>(null);

  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = width;

      const onMouseMove = (ev: MouseEvent) => {
        const delta = startX - ev.clientX;
        const next = Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, startWidth + delta));
        onWidthChange(next);
      };

      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    },
    [width, onWidthChange],
  );

  if (!visible) {
    return (
      <div className="grs-edge" data-testid="grs-edge">
        <button
          className="grs-show-btn"
          onClick={() => onVisibilityChange(true)}
          aria-label="Show right sidebar"
          title="Show right sidebar"
        >›</button>
      </div>
    );
  }

  return (
    <aside
      ref={sidebarRef}
      className="grs-sidebar"
      data-testid="global-right-sidebar"
      style={{ width }}
    >
      {neonOverlay}
      <div className="grs-topbar">
        <button
          className="grs-hide-btn"
          onClick={() => onVisibilityChange(false)}
          aria-label="Hide right sidebar"
          title="Hide right sidebar"
        >‹</button>
      </div>
      {/* M6: Getting Started used to go in headerContent; now it's inside AgentHubPanel. */}
      {/* Render headerContent here for any callers that still pass it (backward compat). */}
      {headerContent}
      <div className="grs-content">
        {children}
      </div>
      {/* Resize handle */}
      <div
        className="grs-resize-handle"
        onMouseDown={handleResizeMouseDown}
        role="separator"
        aria-label="Resize right sidebar"
        aria-orientation="vertical"
      />
    </aside>
  );
}
