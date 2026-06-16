import { useState, useRef, useCallback, useEffect } from 'react';
import type { Story, Chapter, Scene, EntityEntry } from './types';
import type { ExportScope } from './ExportDialog';
import StoryNavigator from './StoryNavigator';
import EntityBrowser from './EntityBrowser';
import SuggestionReview from './SuggestionReview';
import VaultBrowser from './components/VaultBrowser';
import ProgressDashboard from './ProgressDashboard';
import './LeftRail.css';

// SKY-1694: AppView values mirrored here to avoid a circular import with DesktopShell
type NavView = 'editor' | 'brainstorm' | 'kanban' | 'timeline';

const NAV_VIEWS: { id: NavView; label: string; ariaLabel: string }[] = [
  { id: 'editor', label: '✍', ariaLabel: 'Writing' },
  { id: 'brainstorm', label: '💡', ariaLabel: 'Brainstorm' },
  { id: 'kanban', label: '📋', ariaLabel: 'Scene Crafter' },
  { id: 'timeline', label: '📅', ariaLabel: 'Timeline' },
];

const ALL_PANELS: { id: LeftPanelId; label: string }[] = [
  { id: 'stories', label: 'Story Navigator' },
  { id: 'entities', label: 'Entity Browser' },
  { id: 'vault', label: 'Vault Browser' },
  { id: 'review', label: 'Suggestion Review' },
  { id: 'progress', label: 'Writing Goals' },
];

const DEFAULT_LEFT_SIDEBAR_LAYOUT: LeftSidebarLayout = {
  panels: [
    { id: 'stories', collapsed: false },
    { id: 'entities', collapsed: true },
    { id: 'vault', collapsed: true },
  ],
  sidebarCollapsed: false,
};

export { DEFAULT_LEFT_SIDEBAR_LAYOUT };

interface Props {
  /** The currently active top-level view (for nav zone highlighting). */
  activeView: NavView | string;
  onViewChange: (view: NavView) => void;

  /** Panel zone state + collapse flag. */
  leftSidebarLayout: LeftSidebarLayout;
  onLeftSidebarLayoutChange: (layout: LeftSidebarLayout) => void;

  /** Panel content props */
  stories: Story[];
  selectedSceneId: string | null;
  selectedEntityId: string | null;
  onSelectScene: (scene: Scene, chapter: Chapter, story: Story) => void;
  onSelectEntity: (entity: EntityEntry) => void;
  onCreateStory: () => void;
  onCreateChapter: (storyId: string) => void;
  onCreateScene: (storyId: string, chapterId: string) => void;
  onReorderScenes: (storyId: string, chapterId: string, orderedSceneIds: string[]) => void;
  onOpenVaultPath?: (path: string) => void;
  onContextChange?: (context: 'file' | 'folder' | null) => void;
  onExport?: (scope: ExportScope) => void;
  journalModeEnabled?: boolean;
  showTemplateCta?: boolean;
  onTemplateCtaClick?: () => void;
  onEntityCreated?: (entity: EntityEntry) => void;
}

function PanelContent({
  id,
  stories,
  selectedSceneId,
  selectedEntityId,
  onSelectScene,
  onSelectEntity,
  onCreateStory,
  onCreateChapter,
  onCreateScene,
  onReorderScenes,
  onOpenVaultPath,
  onContextChange,
  onExport,
  journalModeEnabled,
  showTemplateCta,
  onTemplateCtaClick,
  onEntityCreated,
}: { id: LeftPanelId } & Omit<Props, 'activeView' | 'onViewChange' | 'leftSidebarLayout' | 'onLeftSidebarLayoutChange'>) {
  switch (id) {
    case 'stories':
      return (
        <StoryNavigator
          stories={stories}
          selectedSceneId={selectedSceneId}
          onSelectScene={onSelectScene}
          onCreateStory={onCreateStory}
          onCreateChapter={onCreateChapter}
          onCreateScene={onCreateScene}
          onReorderScenes={onReorderScenes}
          showTemplateCta={showTemplateCta}
          onTemplateCtaClick={onTemplateCtaClick}
        />
      );
    case 'entities':
      return (
        <EntityBrowser
          onSelectEntity={onSelectEntity}
          selectedEntityId={selectedEntityId}
          onEntityCreated={onEntityCreated}
        />
      );
    case 'vault':
      return (
        <VaultBrowser
          stories={stories}
          selectedSceneId={selectedSceneId}
          onSelectScene={onSelectScene}
          onCreateStory={onCreateStory}
          onCreateChapter={onCreateChapter}
          onCreateScene={onCreateScene}
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

export default function LeftRail({
  activeView,
  onViewChange,
  leftSidebarLayout,
  onLeftSidebarLayoutChange,
  ...panelProps
}: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const addBtnRef = useRef<HTMLButtonElement>(null);

  const { panels, sidebarCollapsed } = leftSidebarLayout;

  const toggleSidebar = useCallback(() => {
    onLeftSidebarLayoutChange({ ...leftSidebarLayout, sidebarCollapsed: !sidebarCollapsed });
  }, [leftSidebarLayout, sidebarCollapsed, onLeftSidebarLayoutChange]);

  const togglePanel = useCallback((id: LeftPanelId) => {
    onLeftSidebarLayoutChange({
      ...leftSidebarLayout,
      panels: panels.map(p => p.id === id ? { ...p, collapsed: !p.collapsed } : p),
    });
  }, [leftSidebarLayout, panels, onLeftSidebarLayoutChange]);

  const removePanel = useCallback((id: LeftPanelId) => {
    onLeftSidebarLayoutChange({
      ...leftSidebarLayout,
      panels: panels.filter(p => p.id !== id),
    });
  }, [leftSidebarLayout, panels, onLeftSidebarLayoutChange]);

  const addPanel = useCallback((id: LeftPanelId) => {
    setPickerOpen(false);
    if (panels.some(p => p.id === id)) return;
    onLeftSidebarLayoutChange({
      ...leftSidebarLayout,
      panels: [...panels, { id, collapsed: false }],
    });
  }, [leftSidebarLayout, panels, onLeftSidebarLayoutChange]);

  // Close picker on outside click
  useEffect(() => {
    if (!pickerOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (
        pickerRef.current && !pickerRef.current.contains(e.target as Node) &&
        addBtnRef.current && !addBtnRef.current.contains(e.target as Node)
      ) {
        setPickerOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [pickerOpen]);

  const availablePanels = ALL_PANELS.filter(p => !panels.some(ep => ep.id === p.id));

  return (
    <div className={`left-rail${sidebarCollapsed ? ' left-rail--collapsed' : ''}`}>
      {/* Toggle button */}
      <button
        className="lr-toggle-btn"
        onClick={toggleSidebar}
        aria-label={sidebarCollapsed ? 'Expand left sidebar' : 'Collapse left sidebar'}
        title={sidebarCollapsed ? 'Expand left sidebar (Ctrl+[)' : 'Collapse left sidebar (Ctrl+[)'}
      >
        {sidebarCollapsed ? '▶' : '◀'}
      </button>

      {/* Fixed nav zone — AC-L-01, AC-L-08: data-no-drop guards Wave 2b drag */}
      <nav
        className="lr-nav-zone"
        aria-label="Main navigation"
        data-no-drop="true"
      >
        {NAV_VIEWS.map(nav => (
          <button
            key={nav.id}
            className={`lr-nav-icon${activeView === nav.id ? ' lr-nav-icon--active' : ''}`}
            onClick={() => onViewChange(nav.id)}
            aria-label={nav.ariaLabel}
            aria-pressed={activeView === nav.id}
            title={nav.ariaLabel}
          >
            {nav.label}
            {!sidebarCollapsed && <span className="lr-nav-label">{nav.ariaLabel}</span>}
          </button>
        ))}
      </nav>

      {/* Customizable panel zone — hidden when sidebar is collapsed */}
      {!sidebarCollapsed && (
        <div className="lr-panel-zone" aria-label="Panel zone">
          {panels.map(panel => {
            const meta = ALL_PANELS.find(p => p.id === panel.id);
            if (!meta) return null;
            return (
              <section key={panel.id} className={`lr-panel${panel.collapsed ? ' lr-panel--collapsed' : ''}`} data-panel-id={panel.id}>
                <div className="lr-panel-header">
                  <button
                    className="lr-panel-collapse-btn"
                    onClick={() => togglePanel(panel.id)}
                    aria-expanded={!panel.collapsed}
                    aria-label={panel.collapsed ? `Expand ${meta.label}` : `Collapse ${meta.label}`}
                    title={panel.collapsed ? 'Expand' : 'Collapse'}
                  >
                    {panel.collapsed ? '▸' : '▾'}
                  </button>
                  <span className="lr-panel-title">{meta.label}</span>
                  <button
                    className="lr-panel-remove-btn"
                    onClick={() => removePanel(panel.id)}
                    aria-label={`Remove ${meta.label} panel`}
                    title="Remove panel"
                  >
                    ×
                  </button>
                </div>
                {!panel.collapsed && (
                  <div className="lr-panel-content">
                    <PanelContent id={panel.id} {...panelProps} />
                  </div>
                )}
              </section>
            );
          })}

          {/* Add panel button */}
          <div className="lr-add-panel-wrapper">
            <button
              ref={addBtnRef}
              className="lr-add-panel-btn"
              onClick={() => setPickerOpen(o => !o)}
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
                {availablePanels.map(p => (
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
