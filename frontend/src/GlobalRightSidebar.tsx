import { useState, useCallback, useRef, useEffect } from 'react';
import type { Scene, Chapter, Story } from './types';
import WritingAssistantPanel from './WritingAssistantPanel';
import ArchivePanel from './ArchivePanel';
import ScenePreviewPanel from './ScenePreviewPanel';
import './GlobalRightSidebar.css';

type PanelId = 'writing-assistant' | 'archive-continuity' | 'scene-preview';

interface PanelConfig {
  id: PanelId;
  collapsed: boolean;
}

const PANEL_LABELS: Record<PanelId, string> = {
  'writing-assistant': 'Writing Assistant',
  'archive-continuity': 'Continuity',
  'scene-preview': 'Scene Preview',
};

const ALL_PANEL_IDS: PanelId[] = ['writing-assistant', 'archive-continuity', 'scene-preview'];

const DEFAULT_PANELS: PanelConfig[] = [
  { id: 'writing-assistant', collapsed: false },
  { id: 'archive-continuity', collapsed: false },
  { id: 'scene-preview', collapsed: false },
];

const SIDEBAR_MIN_WIDTH = 200;
const SIDEBAR_MAX_WIDTH = 600;
const SIDEBAR_DEFAULT_WIDTH = 300;

export interface GlobalRightSidebarProps {
  visible: boolean;
  width: number;
  panels: PanelConfig[];
  onVisibilityChange: (visible: boolean) => void;
  onWidthChange: (width: number) => void;
  onPanelsChange: (panels: PanelConfig[]) => void;
  scene: Scene | null;
  chapter: Chapter | null;
  story: Story | null;
  archiveEnabled?: boolean;
  writingAssistantEnabled?: boolean;
  scanIntervalSeconds?: number;
  waScanInterval?: number | 'on-save' | 'manual';
  isPageFocused?: boolean;
  onJumpToText?: (text: string) => void;
  onInsertWikiLink?: (link: string, anchorText: string) => void;
  onWikiLinkSuggestionsChange?: (suggestions: Array<{ id: string; anchorText: string; wikiLink: string }>) => void;
  continuityIssueCount?: number;
}

function PanelSlot({
  config,
  isPopout,
  onToggleCollapse,
  onPopout,
  onRemove,
  dragHandleProps,
  badgeCount,
  children,
}: {
  config: PanelConfig;
  isPopout: boolean;
  onToggleCollapse: () => void;
  onPopout: () => void;
  onRemove: () => void;
  dragHandleProps: React.HTMLAttributes<HTMLSpanElement>;
  badgeCount?: number;
  children: React.ReactNode;
}) {
  const label = PANEL_LABELS[config.id];
  const showBadge = typeof badgeCount === 'number' && badgeCount > 0;

  return (
    <div
      className={`grs-panel${config.collapsed ? ' grs-panel--collapsed' : ''}${isPopout ? ' grs-panel--popout' : ''}`}
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
        <span
          className="grs-panel-drag"
          aria-label="Drag to reorder"
          role="presentation"
          {...dragHandleProps}
          onClick={(e) => e.stopPropagation()}
        >
          ≡
        </span>
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
      {!config.collapsed && (
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

export default function GlobalRightSidebar({
  visible,
  width,
  panels,
  onVisibilityChange,
  onWidthChange: _onWidthChange,
  onPanelsChange,
  scene,
  chapter,
  story,
  archiveEnabled = true,
  writingAssistantEnabled = true,
  scanIntervalSeconds = 30,
  waScanInterval,
  isPageFocused = true,
  onJumpToText,
  onInsertWikiLink,
  onWikiLinkSuggestionsChange,
  continuityIssueCount = 0,
}: GlobalRightSidebarProps) {
  const [popoutPanels, setPopoutPanels] = useState<Set<PanelId>>(new Set());
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [dragOver, setDragOver] = useState<PanelId | null>(null);
  const dragSource = useRef<PanelId | null>(null);
  const addPanelRef = useRef<HTMLDivElement | null>(null);

  const effectiveWidth = Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, width || SIDEBAR_DEFAULT_WIDTH));

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
      window.api.panelPopout?.(panelId, scene?.id ?? null).catch(() => {
        setPopoutPanels((prev) => {
          const next = new Set(prev);
          next.delete(panelId);
          return next;
        });
      });
    },
    [scene?.id],
  );

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

  const handleDragStart = (panelId: PanelId) => {
    dragSource.current = panelId;
  };

  const handleDragOver = (e: React.DragEvent, panelId: PanelId) => {
    e.preventDefault();
    setDragOver(panelId);
  };

  const handleDrop = (targetId: PanelId) => {
    const srcId = dragSource.current;
    if (!srcId || srcId === targetId) {
      dragSource.current = null;
      setDragOver(null);
      return;
    }
    const srcIdx = panels.findIndex((p) => p.id === srcId);
    const tgtIdx = panels.findIndex((p) => p.id === targetId);
    if (srcIdx < 0 || tgtIdx < 0) {
      dragSource.current = null;
      setDragOver(null);
      return;
    }
    const next = [...panels];
    const [moved] = next.splice(srcIdx, 1);
    next.splice(tgtIdx, 0, moved);
    onPanelsChange(next);
    dragSource.current = null;
    setDragOver(null);
  };

  const handleDragEnd = () => {
    dragSource.current = null;
    setDragOver(null);
  };

  const availableToAdd = ALL_PANEL_IDS.filter((id) => !panels.find((p) => p.id === id));

  if (!visible) {
    return (
      <div className="grs-collapsed-edge" role="complementary" aria-label="Right sidebar (hidden)">
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

  return (
    <aside
      className={`grs-root${dragOver ? ' grs-root--drag-active' : ''}`}
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
        {panels.map((config) => (
          <div
            key={config.id}
            className={`grs-panel-wrapper${dragOver === config.id ? ' grs-panel-wrapper--dragover' : ''}`}
            onDragOver={(e) => handleDragOver(e, config.id)}
            onDrop={() => handleDrop(config.id)}
          >
            <PanelSlot
              config={config}
              isPopout={popoutPanels.has(config.id)}
              onToggleCollapse={() => toggleCollapse(config.id)}
              onPopout={() => handlePopout(config.id)}
              onRemove={() => removePanel(config.id)}
              badgeCount={config.id === 'archive-continuity' ? continuityIssueCount : undefined}
              dragHandleProps={{
                draggable: true,
                onDragStart: () => handleDragStart(config.id),
                onDragEnd: handleDragEnd,
              }}
            >
              {config.id === 'writing-assistant' && (
                <WritingAssistantPanel
                  scene={scene}
                  enabled={writingAssistantEnabled}
                  scanIntervalSeconds={scanIntervalSeconds}
                  waScanInterval={waScanInterval}
                  isActive={isPageFocused}
                />
              )}
              {config.id === 'archive-continuity' && (
                <ArchivePanel
                  scene={scene}
                  enabled={archiveEnabled}
                  onJumpToText={onJumpToText ?? (() => {})}
                  onInsertWikiLink={onInsertWikiLink ?? (() => {})}
                  onWikiLinkSuggestionsChange={onWikiLinkSuggestionsChange}
                />
              )}
              {config.id === 'scene-preview' && (
                <ScenePreviewPanel scene={scene} chapter={chapter} story={story} />
              )}
            </PanelSlot>
          </div>
        ))}
      </div>
    </aside>
  );
}

export { DEFAULT_PANELS };
export type { PanelConfig };
