import { useRef, useCallback } from 'react';
import type { Story, Chapter, Scene, EntityEntry } from './types';
import StoryNavigator from './StoryNavigator';
import EntityBrowser from './EntityBrowser';
import SuggestionReview from './SuggestionReview';
import VaultBrowser from './components/VaultBrowser';
import './LeftRail.css';

type Tab = 'stories' | 'vault' | 'entities' | 'review';

const TABS: Tab[] = ['stories', 'entities', 'vault', 'review'];
const TAB_LABELS: Record<Tab, string> = {
  stories: 'Stories',
  entities: 'Entities',
  vault: 'Vault',
  review: 'Review',
};

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
}: Props) {
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const handleTabKeyDown = useCallback((e: React.KeyboardEvent, index: number) => {
    let nextIndex = -1;
    if (e.key === 'ArrowRight') {
      nextIndex = (index + 1) % TABS.length;
    } else if (e.key === 'ArrowLeft') {
      nextIndex = (index - 1 + TABS.length) % TABS.length;
    } else if (e.key === 'Home') {
      nextIndex = 0;
    } else if (e.key === 'End') {
      nextIndex = TABS.length - 1;
    }
    if (nextIndex !== -1) {
      e.preventDefault();
      onTabChange(TABS[nextIndex]);
      tabRefs.current[nextIndex]?.focus();
    }
  }, [onTabChange]);

  return (
    <div className="left-rail">
      <div className="rail-tabs" role="tablist" aria-label="Primary navigation">
        {TABS.map((tab, index) => (
          <button
            key={tab}
            id={`leftrail-tab-${tab}`}
            role="tab"
            aria-selected={activeTab === tab}
            aria-controls="leftrail-tabpanel"
            className={`rail-tab${activeTab === tab ? ' active' : ''}`}
            tabIndex={activeTab === tab ? 0 : -1}
            ref={(el) => { tabRefs.current[index] = el; }}
            onClick={() => onTabChange(tab)}
            onKeyDown={(e) => handleTabKeyDown(e, index)}
            aria-label={tab === 'review' ? 'Suggestion Review inbox' : undefined}
          >
            {TAB_LABELS[tab]}
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
          />
        )}
        {activeTab === 'entities' && (
          <EntityBrowser
            onSelectEntity={onSelectEntity}
            selectedEntityId={selectedEntityId}
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
          />
        )}
        {activeTab === 'review' && <SuggestionReview onOpenVaultPath={onOpenVaultPath} />}
      </div>
    </div>
  );
}
