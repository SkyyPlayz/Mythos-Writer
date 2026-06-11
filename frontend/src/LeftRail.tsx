import { useRef, useCallback } from 'react';
import type { Story, Chapter, Scene, EntityEntry } from './types';
import type { ExportScope } from './ExportDialog';
import StoryNavigator from './StoryNavigator';
import EntityBrowser from './EntityBrowser';
import SuggestionReview from './SuggestionReview';
import VaultBrowser from './components/VaultBrowser';
import ProgressDashboard from './ProgressDashboard';
import './LeftRail.css';

type Tab = 'stories' | 'vault' | 'entities' | 'review' | 'progress';

const RAIL_TABS: { id: Tab; label: string; ariaLabel?: string }[] = [
  { id: 'stories', label: 'Stories' },
  { id: 'entities', label: 'Entities' },
  { id: 'vault', label: 'Vault' },
  { id: 'review', label: 'Review', ariaLabel: 'Suggestion Review inbox' },
  { id: 'progress', label: 'Goals', ariaLabel: 'Writing Goals & Progress' },
];

interface Props {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
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
  /** SKY-204: whether journal mode is enabled (shows Daily Notes section in vault tab). */
  journalModeEnabled?: boolean;
  showTemplateCta?: boolean;
  onTemplateCtaClick?: () => void;
  onEntityCreated?: (entity: EntityEntry) => void;
}

export default function LeftRail({
  activeTab,
  onTabChange,
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
  showTemplateCta = false,
  onTemplateCtaClick,
  onEntityCreated,
}: Props) {
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const handleTabKeyDown = useCallback((e: React.KeyboardEvent, idx: number) => {
    let nextIdx = idx;
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      nextIdx = (idx + 1) % RAIL_TABS.length;
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      nextIdx = (idx - 1 + RAIL_TABS.length) % RAIL_TABS.length;
    } else {
      return;
    }
    onTabChange(RAIL_TABS[nextIdx].id);
    tabRefs.current[nextIdx]?.focus();
  }, [onTabChange]);

  return (
    <div className="left-rail">
      <div className="rail-tabs" role="tablist" aria-label="Primary navigation">
        {RAIL_TABS.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => { tabRefs.current[i] = el; }}
            id={`leftrail-tab-${t.id}`}
            role="tab"
            aria-selected={activeTab === t.id}
            aria-controls="leftrail-tabpanel"
            tabIndex={activeTab === t.id ? 0 : -1}
            className={`rail-tab${activeTab === t.id ? ' active' : ''}`}
            onClick={() => onTabChange(t.id)}
            onKeyDown={(e) => handleTabKeyDown(e, i)}
            aria-label={t.ariaLabel}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div
        className="rail-content"
        id="leftrail-tabpanel"
        role="tabpanel"
        aria-labelledby={`leftrail-tab-${activeTab}`}
      >
        {activeTab === 'stories' && (
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
        )}
        {activeTab === 'entities' && (
          <EntityBrowser
            onSelectEntity={onSelectEntity}
            selectedEntityId={selectedEntityId}
            onEntityCreated={onEntityCreated}
          />
        )}
        {activeTab === 'vault' && (
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
        )}
        {activeTab === 'review' && <SuggestionReview onOpenVaultPath={onOpenVaultPath} />}
        {activeTab === 'progress' && <ProgressDashboard stories={stories} />}
      </div>
    </div>
  );
}
