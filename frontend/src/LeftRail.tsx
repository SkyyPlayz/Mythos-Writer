import { useState, useRef, useCallback, useEffect, type ReactNode } from 'react';
import { usePanelDrag } from './PanelDragContext';
import type { DragSidebar } from './PanelDragContext';
import './LeftRail.css';
import './PanelDragContext.css';

// SKY-1694/SKY-1760: AppView values mirrored here to avoid a circular import with DesktopShell
type NavView = 'editor' | 'brainstorm' | 'kanban' | 'graph' | 'timeline';

const NAV_VIEWS: { id: NavView; label: string; ariaLabel: string }[] = [
  { id: 'editor', label: '✍', ariaLabel: 'Writing' },
  { id: 'brainstorm', label: '💡', ariaLabel: 'Brainstorm' },
  { id: 'kanban', label: '📋', ariaLabel: 'Scene Crafter' },
  { id: 'graph', label: '◎', ariaLabel: 'Graph' },
  { id: 'timeline', label: '📅', ariaLabel: 'Timeline' },
];

/** All panels that can appear in the left sidebar — used for the add-panel picker. */
const LEFT_PANELS: { id: LeftPanelId; label: string }[] = [
  { id: 'stories', label: 'Story Navigator' },
  { id: 'entities', label: 'Entity Browser' },
  { id: 'vault', label: 'Vault Browser' },
  { id: 'vault-graph', label: 'Graph' },
  { id: 'review', label: 'Suggestion Review' },
  { id: 'progress', label: 'Writing Goals' },
];

/** All right-sidebar panels (can be dragged into the left rail). */
const RIGHT_PANEL_LABELS: Record<string, string> = {
  'writing-assistant': 'Writing Assistant',
  'archive-continuity': 'Continuity',
  'scene-preview': 'Scene Preview',
};

/** Return a human-readable label for any sidebar panel ID. */
function getPanelLabel(id: SidebarPanelId): string {
  const left = LEFT_PANELS.find((p) => p.id === id);
  if (left) return left.label;
  return RIGHT_PANEL_LABELS[id] ?? id;
}

const DEFAULT_LEFT_SIDEBAR_LAYOUT: LeftSidebarLayout = {
  panels: [
    { id: 'stories', collapsed: false },
    { id: 'entities', collapsed: true },
    { id: 'vault', collapsed: true },
  ],
  sidebarCollapsed: false,
};

export { DEFAULT_LEFT_SIDEBAR_LAYOUT };

// ── Drop-zone helpers ──────────────────────────────────────────────────────────

/** Renders the 2px accent line between panels. */
function DropZone({
  sidebar,
  index,
  active,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  sidebar: DragSidebar;
  index: number;
  active: boolean;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
}) {
  return (
    <div
      className={`lr-drop-zone${active ? ' lr-drop-zone--active' : ''}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      data-drop-sidebar={sidebar}
      data-drop-index={index}
      aria-hidden="true"
    >
      <div className="lr-drop-zone-inner">
        <div className="drop-zone-cap" />
        <div className="drop-zone-line" />
        <div className="drop-zone-cap" />
      </div>
    </div>
  );
}

// ── Props ──────────────────────────────────────────────────────────────────────

interface Props {
  /** The currently active top-level view (for nav zone highlighting). */
  activeView: NavView | string;
  onViewChange: (view: NavView) => void;

  /** Panel zone state + collapse flag. */
  leftSidebarLayout: LeftSidebarLayout;
  onLeftSidebarLayoutChange: (layout: LeftSidebarLayout) => void;

  /**
   * SKY-1695: Renders the content for any panel ID. Called by LeftRail to
   * display panel body when a panel is expanded. Supplied by DesktopShell so
   * panels from either sidebar can render their content here.
   */
  renderPanelContent: (id: SidebarPanelId) => ReactNode;

  /**
   * Count of panels currently in the right sidebar — needed to bound the
   * keyboard-drag target range when initiating a keyboard drag from the left.
   */
  rightPanelCount: number;

  /** SKY-1697: Float a panel to a free-floating window. */
  onFloatPanel?: (panelId: SidebarPanelId) => void;
  /** SKY-1698: Dock a panel as a new custom tab in the main tab bar. */
  onDockAsTab?: (panelId: SidebarPanelId) => void;
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function LeftRail({
  activeView,
  onViewChange,
  leftSidebarLayout,
  onLeftSidebarLayoutChange,
  renderPanelContent,
  rightPanelCount,
  onFloatPanel,
  onDockAsTab,
}: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const addBtnRef = useRef<HTMLButtonElement>(null);

  // Hover-to-reveal: when dragging toward a collapsed left sidebar, expand temporarily.
  const [tempExpanded, setTempExpanded] = useState(false);
  const hoverRevealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    dragState,
    activeDropTarget,
    setActiveDropTarget,
    startDrag,
    commitDrop,
    endDrag,
    cancelDrag,
    floatDrop,
    wasEscapeCancelled,
    kbDrag,
    startKeyboardDrag,
    moveKbTarget,
    commitKbDrop,
  } = usePanelDrag();

  const { panels, sidebarCollapsed } = leftSidebarLayout;
  const effectivelyCollapsed = sidebarCollapsed && !tempExpanded;

  // ── Sidebar-level helpers ────────────────────────────────────────────────────

  const toggleSidebar = useCallback(() => {
    onLeftSidebarLayoutChange({ ...leftSidebarLayout, sidebarCollapsed: !sidebarCollapsed });
  }, [leftSidebarLayout, sidebarCollapsed, onLeftSidebarLayoutChange]);

  const togglePanel = useCallback(
    (id: SidebarPanelId) => {
      onLeftSidebarLayoutChange({
        ...leftSidebarLayout,
        panels: panels.map((p) => (p.id === id ? { ...p, collapsed: !p.collapsed } : p)),
      });
    },
    [leftSidebarLayout, panels, onLeftSidebarLayoutChange],
  );

  const removePanel = useCallback(
    (id: SidebarPanelId) => {
      onLeftSidebarLayoutChange({
        ...leftSidebarLayout,
        panels: panels.filter((p) => p.id !== id),
      });
    },
    [leftSidebarLayout, panels, onLeftSidebarLayoutChange],
  );

  const addPanel = useCallback(
    (id: SidebarPanelId) => {
      setPickerOpen(false);
      if (panels.some((p) => p.id === id)) return;
      onLeftSidebarLayoutChange({
        ...leftSidebarLayout,
        panels: [...panels, { id, collapsed: false }],
      });
    },
    [leftSidebarLayout, panels, onLeftSidebarLayoutChange],
  );

  // ── Picker close on outside click ───────────────────────────────────────────

  useEffect(() => {
    if (!pickerOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (
        pickerRef.current &&
        !pickerRef.current.contains(e.target as Node) &&
        addBtnRef.current &&
        !addBtnRef.current.contains(e.target as Node)
      ) {
        setPickerOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [pickerOpen]);

  // ── Hover-to-reveal cleanup ──────────────────────────────────────────────────

  useEffect(() => {
    if (!dragState) {
      // Drag ended — collapse back if we temp-expanded
      if (tempExpanded) {
        setTempExpanded(false);
      }
    }
  }, [dragState, tempExpanded]);

  // ── Drag event handlers ──────────────────────────────────────────────────────

  const handleDragStart = useCallback(
    (e: React.DragEvent, panelId: SidebarPanelId, index: number) => {
      // Replace the browser drag image with a transparent pixel
      const img = new Image();
      img.src =
        'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
      e.dataTransfer.setDragImage(img, 0, 0);
      e.dataTransfer.effectAllowed = 'move';

      startDrag({
        panelId,
        label: getPanelLabel(panelId),
        sourceSidebar: 'left',
        sourceIndex: index,
      });
    },
    [startDrag],
  );

  const handleDragEnd = useCallback(
    (e: React.DragEvent, panelId: SidebarPanelId) => {
      if (e.dataTransfer.dropEffect === 'none') {
        if (!wasEscapeCancelled()) {
          // Dropped outside all valid zones — float the panel (AC-F-01).
          floatDrop(panelId, 'left');
        } else {
          cancelDrag();
        }
      } else {
        endDrag();
      }
    },
    [cancelDrag, endDrag, floatDrop, wasEscapeCancelled],
  );

  // Drop zone activation
  const handleDropZoneDragOver = useCallback(
    (e: React.DragEvent, index: number) => {
      if (!dragState) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setActiveDropTarget({ sidebar: 'left', index });
    },
    [dragState, setActiveDropTarget],
  );

  const handleDropZoneDragLeave = useCallback(() => {
    setActiveDropTarget(null);
  }, [setActiveDropTarget]);

  const handleDropZoneDrop = useCallback(
    (e: React.DragEvent, index: number) => {
      e.preventDefault();
      commitDrop({ sidebar: 'left', index });
    },
    [commitDrop],
  );

  // Hover-to-reveal when dragging toward a collapsed sidebar
  const handleRailDragEnter = useCallback(() => {
    if (!dragState || !sidebarCollapsed) return;
    hoverRevealTimer.current = setTimeout(() => {
      setTempExpanded(true);
    }, 200);
  }, [dragState, sidebarCollapsed]);

  const handleRailDragLeave = useCallback(
    (e: React.DragEvent) => {
      if (hoverRevealTimer.current) {
        clearTimeout(hoverRevealTimer.current);
        hoverRevealTimer.current = null;
      }
      // Collapse again if cursor left the entire rail
      if (!e.currentTarget.contains(e.relatedTarget as Node)) {
        if (sidebarCollapsed) setTempExpanded(false);
      }
    },
    [sidebarCollapsed],
  );

  // ── Keyboard drag ────────────────────────────────────────────────────────────

  const handleDragHandleKeyDown = useCallback(
    (e: React.KeyboardEvent, panelId: SidebarPanelId, index: number) => {
      if (e.key === ' ') {
        e.preventDefault();
        startKeyboardDrag(
          { panelId, label: getPanelLabel(panelId), sourceSidebar: 'left', sourceIndex: index },
          panels.length,
          rightPanelCount,
        );
      } else if (kbDrag) {
        if (e.key === 'ArrowUp') { e.preventDefault(); moveKbTarget('up'); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); moveKbTarget('down'); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); moveKbTarget('left'); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); moveKbTarget('right'); }
        else if (e.key === 'Enter') { e.preventDefault(); commitKbDrop(); }
      }
    },
    [kbDrag, panels.length, rightPanelCount, startKeyboardDrag, moveKbTarget, commitKbDrop],
  );

  // ── Available panels for the add picker ─────────────────────────────────────

  const availablePanels = LEFT_PANELS.filter((p) => !panels.some((ep) => ep.id === p.id));

  // Drag-active drop target helper
  const isDropZoneActive = (index: number) =>
    activeDropTarget?.sidebar === 'left' && activeDropTarget.index === index;

  // Keyboard drop target indicators
  const kbTargetHere = (index: number) =>
    kbDrag?.sidebar === 'left' && kbDrag.index === index;

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div
      className={`left-rail${effectivelyCollapsed ? ' left-rail--collapsed' : ''}`}
      onDragEnter={handleRailDragEnter}
      onDragLeave={handleRailDragLeave}
    >
      {/* Expand / collapse toggle */}
      <button
        className="lr-toggle-btn"
        onClick={toggleSidebar}
        aria-label={sidebarCollapsed ? 'Expand left sidebar' : 'Collapse left sidebar'}
        title={sidebarCollapsed ? 'Expand left sidebar (Ctrl+[)' : 'Collapse left sidebar (Ctrl+[)'}
      >
        {effectivelyCollapsed ? '▶' : '◀'}
      </button>

      {/* Fixed nav zone — AC-L-08: data-no-drop guards Wave 2b drag */}
      <nav className="lr-nav-zone" aria-label="Main navigation" data-no-drop="true">
        {NAV_VIEWS.map((nav) => (
          <button
            key={nav.id}
            className={`lr-nav-icon${activeView === nav.id ? ' lr-nav-icon--active' : ''}`}
            onClick={() => onViewChange(nav.id)}
            aria-label={nav.ariaLabel}
            aria-pressed={activeView === nav.id}
            title={nav.ariaLabel}
          >
            {nav.label}
            {!effectivelyCollapsed && (
              <span className="lr-nav-label">{nav.ariaLabel}</span>
            )}
          </button>
        ))}
      </nav>

      {/* Customizable panel zone — hidden when sidebar is collapsed */}
      {!effectivelyCollapsed && (
        <div className="lr-panel-zone" aria-label="Panel zone">
          {/* Drop zone before first panel */}
          <DropZone
            sidebar="left"
            index={0}
            active={isDropZoneActive(0) || kbTargetHere(0)}
            onDragOver={(e) => handleDropZoneDragOver(e, 0)}
            onDragLeave={handleDropZoneDragLeave}
            onDrop={(e) => handleDropZoneDrop(e, 0)}
          />

          {panels.map((panel, i) => {
            const label = getPanelLabel(panel.id);
            const isDraggingThis =
              dragState?.sourceSidebar === 'left' && dragState?.sourceIndex === i;
            const isKbSource =
              kbDrag?.sourceSidebar === 'left' && kbDrag?.sourceIndex === i;

            return (
              <section
                key={panel.id}
                className={`lr-panel${panel.collapsed ? ' lr-panel--collapsed' : ''}${isDraggingThis ? ' lr-panel--dragging' : ''}`}
                data-panel-id={panel.id}
              >
                <div className="lr-panel-header">
                  {/* Drag handle — AC-D-01 */}
                  <button
                    className="panel-drag-handle"
                    draggable
                    aria-label={`Move ${label}`}
                    aria-grabbed={isDraggingThis || isKbSource}
                    title="Drag to reorder"
                    onDragStart={(e) => handleDragStart(e, panel.id, i)}
                    onDragEnd={(e) => handleDragEnd(e, panel.id)}
                    onKeyDown={(e) => handleDragHandleKeyDown(e, panel.id, i)}
                    tabIndex={0}
                  >
                    ⠿
                  </button>

                  {/* Collapse toggle */}
                  <button
                    className="lr-panel-collapse-btn"
                    onClick={() => togglePanel(panel.id)}
                    aria-expanded={!panel.collapsed}
                    aria-label={
                      panel.collapsed ? `Expand ${label}` : `Collapse ${label}`
                    }
                    title={panel.collapsed ? 'Expand' : 'Collapse'}
                  >
                    {panel.collapsed ? '▸' : '▾'}
                  </button>

                  <span className="lr-panel-title">{label}</span>

                  {/* Float panel — SKY-1697 */}
                  <button
                    className="lr-panel-float-btn"
                    onClick={() => onFloatPanel?.(panel.id)}
                    aria-label={`Float ${label} panel`}
                    title="Float panel"
                  >
                    ⧉
                  </button>

                  {/* Dock as tab — SKY-1698 */}
                  {onDockAsTab && (
                    <button
                      className="lr-panel-float-btn"
                      onClick={() => onDockAsTab(panel.id)}
                      aria-label={`Dock ${label} as tab`}
                      title="Dock as tab"
                    >
                      ⊞
                    </button>
                  )}

                  <button
                    className="lr-panel-remove-btn"
                    onClick={() => removePanel(panel.id)}
                    aria-label={`Remove ${label} panel`}
                    title="Remove panel"
                  >
                    ×
                  </button>
                </div>

                {!panel.collapsed && !isDraggingThis && (
                  <div className="lr-panel-content">
                    {renderPanelContent(panel.id)}
                  </div>
                )}

                {/* Drop zone after each panel */}
                <DropZone
                  sidebar="left"
                  index={i + 1}
                  active={isDropZoneActive(i + 1) || kbTargetHere(i + 1)}
                  onDragOver={(e) => handleDropZoneDragOver(e, i + 1)}
                  onDragLeave={handleDropZoneDragLeave}
                  onDrop={(e) => handleDropZoneDrop(e, i + 1)}
                />
              </section>
            );
          })}

          {/* Full-height drop target when panel zone is empty */}
          {panels.length === 0 && dragState && (
            <div
              className={`panel-zone-empty-drop${activeDropTarget?.sidebar === 'left' ? ' panel-zone-empty-drop--active' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setActiveDropTarget({ sidebar: 'left', index: 0 });
              }}
              onDragLeave={() => setActiveDropTarget(null)}
              onDrop={(e) => {
                e.preventDefault();
                commitDrop({ sidebar: 'left', index: 0 });
              }}
              aria-hidden="true"
            />
          )}

          {/* Add panel button */}
          <div className="lr-add-panel-wrapper">
            <button
              ref={addBtnRef}
              className="lr-add-panel-btn"
              onClick={() => setPickerOpen((o) => !o)}
              aria-haspopup="listbox"
              aria-expanded={pickerOpen}
              aria-label="Add panel"
              disabled={availablePanels.length === 0}
            >
              + Add Panel
            </button>
            {pickerOpen && (
              <div
                ref={pickerRef}
                className="lr-panel-picker"
                role="listbox"
                aria-label="Available panels"
              >
                {availablePanels.map((p) => (
                  <button
                    key={p.id}
                    role="option"
                    aria-selected={false}
                    className="lr-panel-picker-item"
                    onClick={() => addPanel(p.id)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
