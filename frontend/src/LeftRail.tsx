import type { Scene, Chapter, Story, EntityEntry } from './types';
import { useVaultStore } from './stores/vaultStore';
import { useUIStore } from './stores/uiStore';
import StoryNavigator from './StoryNavigator';
import EntityBrowser from './EntityBrowser';
import SuggestionReview from './SuggestionReview';
import VaultBrowser from './components/VaultBrowser';
import './LeftRail.css';

interface Props {
  onCreateStory: () => void;
  onCreateChapter: (storyId: string) => void;
  onCreateScene: (storyId: string, chapterId: string) => void;
  onReorderScenes: (storyId: string, chapterId: string, orderedSceneIds: string[]) => void;
  onOpenVaultPath?: (path: string) => void;
}

export default function LeftRail({
  onCreateStory,
  onCreateChapter,
  onCreateScene,
  onReorderScenes,
  onOpenVaultPath,
}: Props) {
  const stories = useVaultStore((s) => s.stories);
  const activeSceneId = useVaultStore((s) => s.activeSceneId);
  const activeEntityId = useVaultStore((s) => s.activeEntityId);
  const setActiveScene = useVaultStore((s) => s.setActiveScene);
  const setActiveEntity = useVaultStore((s) => s.setActiveEntity);
  const layout = useUIStore((s) => s.layout);
  const setLayout = useUIStore((s) => s.setLayout);

  const activeTab = layout.leftTab;

  const handleSelectScene = (scene: Scene, chapter: Chapter, story: Story) => {
    setActiveScene(story.id, chapter.id, scene.id);
  };

  const handleSelectEntity = (entity: EntityEntry) => {
    setActiveEntity(entity);
  };

  const handleTabChange = (tab: 'stories' | 'vault' | 'entities' | 'review') => {
    setLayout({ ...layout, leftTab: tab });
  };

  return (
    <div className="left-rail">
      <div className="rail-tabs" role="tablist" aria-label="Primary navigation">
        <button
          id="leftrail-tab-stories"
          role="tab"
          aria-selected={activeTab === 'stories'}
          aria-controls="leftrail-tabpanel"
          className={`rail-tab${activeTab === 'stories' ? ' active' : ''}`}
          onClick={() => handleTabChange('stories')}
        >
          Stories
        </button>
        <button
          id="leftrail-tab-entities"
          role="tab"
          aria-selected={activeTab === 'entities'}
          aria-controls="leftrail-tabpanel"
          className={`rail-tab${activeTab === 'entities' ? ' active' : ''}`}
          onClick={() => handleTabChange('entities')}
        >
          Entities
        </button>
        <button
          id="leftrail-tab-vault"
          role="tab"
          aria-selected={activeTab === 'vault'}
          aria-controls="leftrail-tabpanel"
          className={`rail-tab${activeTab === 'vault' ? ' active' : ''}`}
          onClick={() => handleTabChange('vault')}
        >
          Vault
        </button>
        <button
          id="leftrail-tab-review"
          role="tab"
          aria-selected={activeTab === 'review'}
          aria-controls="leftrail-tabpanel"
          className={`rail-tab${activeTab === 'review' ? ' active' : ''}`}
          onClick={() => handleTabChange('review')}
          aria-label="Suggestion Review inbox"
        >
          Review
        </button>
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
            selectedSceneId={activeSceneId}
            onSelectScene={handleSelectScene}
            onCreateStory={onCreateStory}
            onCreateChapter={onCreateChapter}
            onCreateScene={onCreateScene}
            onReorderScenes={onReorderScenes}
          />
        )}
        {activeTab === 'entities' && (
          <EntityBrowser
            onSelectEntity={handleSelectEntity}
            selectedEntityId={activeEntityId}
          />
        )}
        {activeTab === 'vault' && (
          <VaultBrowser
            stories={stories}
            selectedSceneId={activeSceneId}
            onSelectScene={handleSelectScene}
            onCreateStory={onCreateStory}
            onCreateChapter={onCreateChapter}
            onCreateScene={onCreateScene}
            onOpenFile={onOpenVaultPath}
          />
        )}
        {activeTab === 'review' && <SuggestionReview onOpenVaultPath={onOpenVaultPath} />}
      </div>
    </div>
  );
}
