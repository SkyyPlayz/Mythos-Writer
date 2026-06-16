/* eslint-disable react/prop-types */
import { useState, useCallback, useRef, useEffect } from 'react';
import type { Scene, Chapter, Story } from './types';
import WritingAssistantPanel from './WritingAssistantPanel';
import ContinuityPanel from './ContinuityPanel';
import ScenePreviewPanel from './ScenePreviewPanel';
import StoryNavigator from './StoryNavigator';
import EntityBrowser from './EntityBrowser';
import VaultBrowser from './components/VaultBrowser';
import SuggestionReview from './SuggestionReview';
import ProgressDashboard from './ProgressDashboard';
import type { EntityEntry } from './types';
import type { ExportScope } from './ExportDialog';
import { DragHandle, DropZoneLine, DragPlaceholder, usePanelDrag } from './PanelDrag';
import type { SidebarPanelId } from './PanelDrag';
import './GlobalRightSidebar.css';

type PanelId = SidebarPanelId;

interface PanelConfig {
  id: PanelId;
  collapsed: boolean;
}

const PANEL_LABELS: Record<string, string> = {
  'writing-assistant': 'Writing Assistant',
  'archive-continuity': 'Continuity',
  'scene-preview': 'Scene Preview',
  stories: 'Story Navigator',
  entities: 'Entity Browser',
  vault: 'Vault Browser',
  review: 'Suggestion Review',
  progress: 'Writing Goals',
};

const ALL_GRS_PANEL_IDS: Array<'writing-assistant' | 'archive-continuity' | 'scene-preview'> = [
  'writing-assistant', 'archive-continuity', 'scene-preview',
];

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
  /** @deprecated use internal continuity count from ContinuityPanel — kept for backward compat */
  continuityIssueCount?: number;
  archiveScanScope?: 'active_scene' | 'active_chapter' | 'full_manuscript';
  archiveStoryEditConsentGiven?: boolean;
  onOpenSettings?: () => void;
  /** Left-sidebar panel props — needed when those panels are dragged into GRS (Wave 2b). */
  stories?: Story[];
  selectedSceneId?: string | null;
  selectedEntityId?: string | null;
  onSelectScene?: (scene: Scene, chapter: Chapter, story: Story) => void;
  onSelectEntity?: (entity: EntityEntry) => void;
  onCreateStory?: () => void;
  onCreateChapter?: (storyId: string) => void;
  onCreateScene?: (storyId: string, chapterId: string) => void;
  onReorderScenes?: (storyId: string, chapterId: string, orderedSceneIds: string[]) => void;
  onOpenVaultPath?: (path: string) => void;
  onContextChange?: (context: 'file' | 'folder' | null) => void;
  onExport?: (scope: ExportScope) => void;
  onEntityCreated?: (entity: EntityEntry) => void;
  journalModeEnabled?: boolean;
}

function PanelContent({
  config,
  props,
  onContinuityCountChange,
}: {
  config: PanelConfig;
  props: GlobalRightSidebarProps;
  onContinuityCountChange?: (n: number) => void;
}) {
  const {
    scene, chapter, story,
    archiveEnabled, writingAssistantEnabled, scanIntervalSeconds, waScanInterval,
    isPageFocused, archiveScanScope, archiveStoryEditConsentGiven, onOpenSettings,
    stories = [], selectedSceneId = null, selectedEntityId = null,
    onSelectScene, onSelectEntity, onCreateStory, onCreateChapter,
    onCreateScene, onReorderScenes, onOpenVaultPath, onContextChange,
    onExport, onEntityCreated, journalModeEnabled,
  } = props;

  const noop = () => {};

  switch (config.id) {
    case 'writing-assistant':
      return (
        <WritingAssistantPanel
          scene={scene}
          enabled={writingAssistantEnabled}
          scanIntervalSeconds={scanIntervalSeconds}
          waScanInterval={waScanInterval}
          isActive={isPageFocused}
        />
      );
    case 'archive-continuity':
      return (
        <ContinuityPanel
          scene={scene}
          enabled={archiveEnabled}
          archiveScanScope={archiveScanScope}
          archiveStoryEditConsentGiven={archiveStoryEditConsentGiven}
          onOpenSettings={onOpenSettings}
          onCountChange={onContinuityCountChange}
        />
      );
    case 'scene-preview':
      return <ScenePreviewPanel scene={scene} chapter={chapter} story={story} />;
    // SKY-1695: left-sidebar panels dragged into GRS
    case 'stories':
      return (
        <StoryNavigator
          stories={stories}
          selectedSceneId={selectedSceneId}
          onSelectScene={onSelectScene ?? noop}
          onCreateStory={onCreateStory ?? noop}
          onCreateChapter={onCreateChapter ?? noop}
          onCreateScene={onCreateScene ?? noop}
          onReorderScenes={onReorderScenes ?? noop}
        />
      );
    case 'entities':
      return (
        <EntityBrowser
          onSelectEntity={onSelectEntity ?? noop}
          selectedEntityId={selectedEntityId}
          onEntityCreated={onEntityCreated}
        />
      );
    case 'vault':
      return (
        <VaultBrowser
          stories={stories}
          selectedSceneId={selectedSceneId}
          onSelectScene={onSelectScene ?? noop}
          onCreateStory={onCreateStory ?? noop}
          onCreateChapter={onCreateChapter ?? noop}
          onCreateScene={onCreateScene ?? noop}
          onOpenFile={onOpenVaultPath}
          onContextChange={onContextChange}
          onExport={onExport}
          journalModeEnabled={journalModeEnabled}
        />
      );
    case 'review':
      return <SuggestionReview onOpenVaultPath={onOpenVaultPath} />;
    case 'progress':
      return <ProgressDashboard stories={stories} />;
    default:
      return null;
  }
}

function PanelSlot({
  config,
  isPopout,
  badgeCount,
  onToggleCollapse,
  onPopout,
  onRemove,
  insertIndex,
  children,
}: {
  config: PanelConfig;
  isPopout: boolean;
  badgeCount?: number;
  onToggleCollapse: () => void;
  onPopout: () => void;
  onRemove: () => void;
  insertIndex: number;
  children: React.ReactNode;
}) {
  const label = PANEL_LABELS[config.id] ?? config.id;
  const { dragState } = usePanelDrag();
  const isBeingDragged =
    dragState?.panelId === config.id && dragState.sourceSidebar === 'right';
  const showBadge = typeof badgeCount === 'number' && badgeCount > 0;

  if (isBeingDragged) {
    return <DragPlaceholder />;
  }

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
        <DragHandle panelId={config.id} sidebar="right" label={label} insertIndex={insertIndex} />
        <span className="grs-panel-label">{label}</span>
        {showBadge && (
          <span className="grs-panel-badge" aria-label={`${badgeCount} issues`}>
            {badgeCount}
          </span>
        )}
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

export default function GlobalRightSidebar(props: GlobalRightSidebarProps) {
  const {
    visible, width, panels, onVisibilityChange,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    onWidthChange: _onWidthChange,
    onPanelsChange, scene,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    onJumpToText: _onJumpToText,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    onInsertWikiLink: _onInsertWikiLink,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    onWikiLinkSuggestionsChange: _onWikiLinkSuggestionsChange,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    continuityIssueCount: _continuityIssueCount = 0,
  } = props;

  const [popoutPanels, setPopoutPanels] = useState<Set<PanelId>>(new Set());
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [localContinuityCount, setLocalContinuityCount] = useState(0);
  const addPanelRef = useRef<HTMLDivElement | null>(null);
  const { dragState } = usePanelDrag();

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
    (panelId: 'writing-assistant' | 'archive-continuity' | 'scene-preview') => {
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

  const availableToAdd = ALL_GRS_PANEL_IDS.filter((id) => !panels.find((p) => p.id === id));
  const isDragActive = !!dragState;

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
      className={`grs-root${isDragActive ? ' grs-root--drag-active' : ''}`}
      style={{ width: effectiveWidth }}
      aria-label="Right sidebar"
      data-testid="global-right-sidebar"
      data-sidebar-zone="right"
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
        {panels.length === 0
          ? <DropZoneLine sidebar="right" insertIndex={0} isEmpty />
          : <DropZoneLine sidebar="right" insertIndex={0} />
        }

        {panels.map((config, i) => (
          <div key={config.id}>
            <PanelSlot
              config={config}
              isPopout={popoutPanels.has(config.id)}
              badgeCount={config.id === 'archive-continuity' ? localContinuityCount : undefined}
              onToggleCollapse={() => toggleCollapse(config.id)}
              onPopout={() => handlePopout(config.id)}
              onRemove={() => removePanel(config.id)}
              insertIndex={i}
            >
              <PanelContent
                config={config}
                props={props}
                onContinuityCountChange={config.id === 'archive-continuity' ? setLocalContinuityCount : undefined}
              />
            </PanelSlot>
            <DropZoneLine sidebar="right" insertIndex={i + 1} />
          </div>
        ))}
      </div>
    </aside>
  );
}

export { DEFAULT_PANELS };
export type { PanelConfig };
