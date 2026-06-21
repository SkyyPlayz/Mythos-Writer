import { useState, useCallback, useRef, useEffect, type ReactNode } from 'react';
import { usePanelDrag } from './PanelDragContext';
import type { DragSidebar } from './PanelDragContext';
import './GlobalRightSidebar.css';
import './PanelDragContext.css';

// ── Types ──────────────────────────────────────────────────────────────────────

type PanelId = SidebarPanelId;

interface PanelConfig {
  id: PanelId;
  collapsed: boolean;
}

const PANEL_LABELS: Record<string, string> = {
  'scene-notes': 'Scene Notes',
  'scene-properties': 'Scene Properties',
  'scene-outline': 'Outline',
  'writing-assistant': 'Writing Assistant',
  'archive-continuity': 'Continuity',
  'scene-preview': 'Scene Preview',
  // Left panels that may be dragged over:
  stories: 'Story Navigator',
  entities: 'Entity Browser',
  vault: 'Vault Browser',
  'vault-graph': 'Graph',
  review: 'Suggestion Review',
  progress: 'Writing Goals',
  timeline: 'Timeline',
};

/** Right-sidebar-native panel IDs shown in the "Add Panel" picker. */
const RIGHT_PANEL_IDS: PanelId[] = [
  'scene-notes',
  'scene-properties',
  'scene-outline',
  'writing-assistant',
  'archive-continuity',
  'scene-preview',
];

const DEFAULT_PANELS: PanelConfig[] = [
  { id: 'scene-notes', collapsed: false },
  { id: 'scene-properties', collapsed: false },
  { id: 'scene-outline', collapsed: true },
  { id: 'writing-assistant', collapsed: false },
  { id: 'archive-continuity', collapsed: false },
  { id: 'scene-preview', collapsed: true },
];

const SIDEBAR_MIN_WIDTH = 200;
const SIDEBAR_MAX_WIDTH = 600;
const SIDEBAR_DEFAULT_WIDTH = 300;

// ── DropZone ───────────────────────────────────────────────────────────────────

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
      className={`grs-drop-zone${active ? ' grs-drop-zone--active' : ''}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      data-drop-sidebar={sidebar}
      data-drop-index={index}
      aria-hidden="true"
    >
      <div className="grs-drop-zone-inner">
        <div className="drop-zone-cap" />
        <div className="drop-zone-line" />
        <div className="drop-zone-cap" />
      </div>
    </div>
  );
}

// ── PanelSlot ──────────────────────────────────────────────────────────────────

function PanelSlot({
  config,
  isPopout,
  onToggleCollapse,
  onPopout,
  onFloat,
  onDockAsTab,
  onRemove,
  onDragStart,
  onDragEnd,
  onKeyDown,
  isDragging,
  badgeCount,
  children,
}: {
  config: PanelConfig;
  isPopout: boolean;
  onToggleCollapse: () => void;
  onPopout: () => void;
  onFloat: () => void;
  onDockAsTab?: () => void;
  onRemove: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: (e: React.DragEvent) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  isDragging: boolean;
  badgeCount?: number;
  children: ReactNode;
}) {
  const label = PANEL_LABELS[config.id] ?? config.id;
  const showBadge = typeof badgeCount === 'number' && badgeCount > 0;

  return (
    <div
      className={`grs-panel${config.collapsed ? ' grs-panel--collapsed' : ''}${isPopout ? ' grs-panel--popout' : ''}${isDragging ? ' grs-panel--dragging' : ''}`}
      data-panel-id={config.id}
    >
      <div
        className="grs-panel-header"
        role="button"
        tabIndex={0}
        aria-expanded={!config.collapsed}
        aria-label={`${label} panel`}
        onClick={onToggleCollapse}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggleCollapse();
          }
        }}
      >
        {/* Drag handle — AC-D-01 */}
        <button
          className="panel-drag-handle"
          draggable
          aria-label={`Move ${label}`}
          aria-grabbed={isDragging}
          title="Drag to reorder"
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onKeyDown={onKeyDown}
          onClick={(e) => e.stopPropagation()}
          tabIndex={0}
        >
          ⠿
        </button>

        <span className="grs-panel-label">
          {label}
          {showBadge && (
            <span className="grs-panel-badge" aria-label={`${badgeCount} issues`}>
              {badgeCount}
            </span>
          )}
        </span>

        <span className="grs-panel-controls" onClick={(e) => e.stopPropagation()}>
          <button
            className="grs-panel-btn"
            aria-label={`Float ${label} to window`}
            title="Float to window"
            onClick={onFloat}
          >
            ⧉
          </button>
          {onDockAsTab && (
            <button
              className="grs-panel-btn"
              aria-label={`Dock ${label} as tab`}
              title="Dock as tab"
              onClick={onDockAsTab}
            >
              ⊞
            </button>
          )}
          <button
            className="grs-panel-btn"
            aria-label={`Pop out ${label}`}
            title="Pop out"
            onClick={onPopout}
            disabled={isPopout}
          >
            ⇱
          </button>
          <button
            className="grs-panel-btn"
            aria-label={`Remove ${label}`}
            title="Remove panel"
            onClick={onRemove}
          >
            ×
          </button>
        </span>
      </div>

      {!config.collapsed && !isDragging && (
        <div className="grs-panel-body">
          {isPopout ? (
            <div className="grs-panel-popout-placeholder">Panel is open in a window.</div>
          ) : (
            children
          )}
        </div>
      )}
    </div>
  );
}

// ── Props ──────────────────────────────────────────────────────────────────────

export interface GlobalRightSidebarProps {
  visible: boolean;
  width: number;
  panels: PanelConfig[];
  onVisibilityChange: (visible: boolean) => void;
  onWidthChange: (width: number) => void;
  onPanelsChange: (panels: PanelConfig[]) => void;

  /**
   * SKY-1695: Renders the content for any panel ID. Supplied by DesktopShell
   * so that left-sidebar panels dragged into the right sidebar render correctly.
   */
  renderPanelContent: (id: SidebarPanelId) => ReactNode;

  /** Badge count for the archive-continuity panel header. */
  continuityIssueCount?: number;

  /** Count of left sidebar panels (needed for keyboard-drag bounds). */
  leftPanelCount: number;

  /** SKY-1697: Float a panel to a free-floating window. */
  onFloatPanel?: (panelId: SidebarPanelId) => void;
  /** SKY-1698: Dock a panel as a new custom tab in the main tab bar. */
  onDockAsTab?: (panelId: SidebarPanelId) => void;
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function GlobalRightSidebar({
  visible,
  width,
  panels,
  onVisibilityChange,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onWidthChange: _onWidthChange,
  onPanelsChange,
  renderPanelContent,
  continuityIssueCount = 0,
  leftPanelCount,
  onFloatPanel,
  onDockAsTab,
}: GlobalRightSidebarProps) {
  const [popoutPanels, setPopoutPanels] = useState<Set<PanelId>>(new Set());
  const [showAddPanel, setShowAddPanel] = useState(false);
  const addPanelRef = useRef<HTMLDivElement | null>(null);

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

  const effectiveWidth = Math.max(
    SIDEBAR_MIN_WIDTH,
    Math.min(SIDEBAR_MAX_WIDTH, width || SIDEBAR_DEFAULT_WIDTH),
  );

  // ── Panel mutation helpers ───────────────────────────────────────────────────

  const toggleCollapse = useCallback(
    (panelId: PanelId) => {
      onPanelsChange(panels.map((p) => (p.id === panelId ? { ...p, collapsed: !p.collapsed } : p)));
    },
    [panels, onPanelsChange],
  );

  const removePanel = useCallback(
    (panelId: PanelId) => {
      onPanelsChange(panels.filter((p) => p.id !== panelId));
    },
    [panels, onPanelsChange],
  );

  const addPanel = useCallback(
    (panelId: PanelId) => {
      if (!panels.find((p) => p.id === panelId)) {
        onPanelsChange([...panels, { id: panelId, collapsed: false }]);
      }
      setShowAddPanel(false);
    },
    [panels, onPanelsChange],
  );

  const handlePopout = useCallback(
    (panelId: PanelId) => {
      setPopoutPanels((prev) => {
        const next = new Set(prev);
        next.add(panelId);
        return next;
      });
      window.api.panelPopout?.(panelId, null).catch(() => {
        setPopoutPanels((prev) => {
          const next = new Set(prev);
          next.delete(panelId);
          return next;
        });
      });
    },
    [],
  );

  // ── Add-panel picker close on outside click ──────────────────────────────────

  useEffect(() => {
    if (!showAddPanel) return;
    const handler = (e: MouseEvent) => {
      if (addPanelRef.current && !addPanelRef.current.contains(e.target as Node)) {
        setShowAddPanel(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showAddPanel]);

  // ── Drag event handlers ──────────────────────────────────────────────────────

  const handleDragStart = useCallback(
    (e: React.DragEvent, panelId: PanelId, index: number) => {
      const img = new Image();
      img.src =
        'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
      e.dataTransfer.setDragImage(img, 0, 0);
      e.dataTransfer.effectAllowed = 'move';

      startDrag({
        panelId,
        label: PANEL_LABELS[panelId] ?? panelId,
        sourceSidebar: 'right',
        sourceIndex: index,
      });
    },
    [startDrag],
  );

  const handleDragEnd = useCallback(
    (e: React.DragEvent, panelId: PanelId, sourceSidebar: DragSidebar) => {
      if (e.dataTransfer.dropEffect === 'none') {
        if (!wasEscapeCancelled()) {
          // Dropped outside all valid zones — float the panel (AC-F-01).
          floatDrop(panelId, sourceSidebar);
        } else {
          cancelDrag();
        }
      } else {
        endDrag();
      }
    },
    [cancelDrag, endDrag, floatDrop, wasEscapeCancelled],
  );

  const handleDropZoneDragOver = useCallback(
    (e: React.DragEvent, index: number) => {
      if (!dragState) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setActiveDropTarget({ sidebar: 'right', index });
    },
    [dragState, setActiveDropTarget],
  );

  const handleDropZoneDragLeave = useCallback(() => {
    setActiveDropTarget(null);
  }, [setActiveDropTarget]);

  const handleDropZoneDrop = useCallback(
    (e: React.DragEvent, index: number) => {
      e.preventDefault();
      commitDrop({ sidebar: 'right', index });
    },
    [commitDrop],
  );

  // ── Keyboard drag ────────────────────────────────────────────────────────────

  const handleDragHandleKeyDown = useCallback(
    (e: React.KeyboardEvent, panelId: PanelId, index: number) => {
      if (e.key === ' ') {
        e.preventDefault();
        startKeyboardDrag(
          {
            panelId,
            label: PANEL_LABELS[panelId] ?? panelId,
            sourceSidebar: 'right',
            sourceIndex: index,
          },
          leftPanelCount,
          panels.length,
        );
      } else if (kbDrag) {
        if (e.key === 'ArrowUp') { e.preventDefault(); moveKbTarget('up'); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); moveKbTarget('down'); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); moveKbTarget('left'); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); moveKbTarget('right'); }
        else if (e.key === 'Enter') { e.preventDefault(); commitKbDrop(); }
      }
    },
    [kbDrag, leftPanelCount, panels.length, startKeyboardDrag, moveKbTarget, commitKbDrop],
  );

  // ── Render helpers ───────────────────────────────────────────────────────────

  const isDropZoneActive = (index: number) =>
    activeDropTarget?.sidebar === 'right' && activeDropTarget.index === index;

  const kbTargetHere = (index: number) =>
    kbDrag?.sidebar === 'right' && kbDrag.index === index;

  const availableToAdd = RIGHT_PANEL_IDS.filter((id) => !panels.find((p) => p.id === id));

  // ── Collapsed edge ───────────────────────────────────────────────────────────

  if (!visible) {
    return (
      <div
        className="grs-collapsed-edge"
        role="complementary"
        aria-label="Right sidebar (hidden)"
      >
        <button
          className="grs-toggle-btn"
          aria-label="Show right sidebar"
          title="Show sidebar"
          onClick={() => onVisibilityChange(true)}
        >
          ⇐
        </button>
      </div>
    );
  }

  // ── Main render ──────────────────────────────────────────────────────────────

  return (
    <aside
      className="grs-root"
      style={{ width: effectiveWidth }}
      aria-label="Right sidebar"
      data-testid="global-right-sidebar"
    >
      <div className="grs-header">
        <div className="grs-header-left" ref={addPanelRef}>
          <button
            className="grs-header-btn"
            aria-label="Add panel"
            onClick={() => setShowAddPanel((v) => !v)}
            aria-expanded={showAddPanel}
          >
            + Add Panel
          </button>
          {showAddPanel && (
            <div className="grs-add-panel-picker" role="menu" aria-label="Available panels">
              {availableToAdd.length === 0 ? (
                <div className="grs-add-panel-empty">All panels added</div>
              ) : (
                availableToAdd.map((id) => (
                  <button
                    key={id}
                    role="menuitem"
                    className="grs-add-panel-item"
                    onClick={() => addPanel(id)}
                  >
                    {PANEL_LABELS[id]}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
        <button
          className="grs-header-btn grs-toggle-btn"
          aria-label="Hide right sidebar"
          title="Hide sidebar"
          onClick={() => onVisibilityChange(false)}
        >
          ⇒
        </button>
      </div>

      <div className="grs-panel-list">
        {/* Drop zone before first panel */}
        <DropZone
          sidebar="right"
          index={0}
          active={isDropZoneActive(0) || kbTargetHere(0)}
          onDragOver={(e) => handleDropZoneDragOver(e, 0)}
          onDragLeave={handleDropZoneDragLeave}
          onDrop={(e) => handleDropZoneDrop(e, 0)}
        />

        {panels.map((config, i) => {
          const isDraggingThis =
            dragState?.sourceSidebar === 'right' && dragState?.sourceIndex === i;

          return (
            <div key={config.id} className="grs-panel-wrapper">
              <PanelSlot
                config={config}
                isPopout={popoutPanels.has(config.id)}
                onToggleCollapse={() => toggleCollapse(config.id)}
                onPopout={() => handlePopout(config.id)}
                onFloat={() => onFloatPanel?.(config.id)}
                onDockAsTab={onDockAsTab ? () => onDockAsTab(config.id) : undefined}
                onRemove={() => removePanel(config.id)}
                onDragStart={(e) => handleDragStart(e, config.id, i)}
                onDragEnd={(e) => handleDragEnd(e, config.id, 'right')}
                onKeyDown={(e) => handleDragHandleKeyDown(e, config.id, i)}
                isDragging={isDraggingThis}
                badgeCount={
                  config.id === 'archive-continuity' ? continuityIssueCount : undefined
                }
              >
                {renderPanelContent(config.id)}
              </PanelSlot>

              {/* Drop zone after each panel */}
              <DropZone
                sidebar="right"
                index={i + 1}
                active={isDropZoneActive(i + 1) || kbTargetHere(i + 1)}
                onDragOver={(e) => handleDropZoneDragOver(e, i + 1)}
                onDragLeave={handleDropZoneDragLeave}
                onDrop={(e) => handleDropZoneDrop(e, i + 1)}
              />
            </div>
          );
        })}

        {/* Full-height drop target when panel zone is empty */}
        {panels.length === 0 && dragState && (
          <div
            className={`panel-zone-empty-drop${activeDropTarget?.sidebar === 'right' ? ' panel-zone-empty-drop--active' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setActiveDropTarget({ sidebar: 'right', index: 0 });
            }}
            onDragLeave={() => setActiveDropTarget(null)}
            onDrop={(e) => {
              e.preventDefault();
              commitDrop({ sidebar: 'right', index: 0 });
            }}
            aria-hidden="true"
          />
        )}
      </div>
    </aside>
  );
}

export { DEFAULT_PANELS };
export type { PanelConfig };
