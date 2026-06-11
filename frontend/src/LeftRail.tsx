import type { Story, Chapter, Scene, EntityEntry } from './types';
import StoryNavigator from './StoryNavigator';
import EntityBrowser from './EntityBrowser';
import SuggestionReview from './SuggestionReview';
import VaultBrowser from './components/VaultBrowser';
import './LeftRail.css';

type Tab = 'stories' | 'vault' | 'entities' | 'review';

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
  showTemplateCta = false,
  onTemplateCtaClick,
  onEntityCreated,
}: Props) {
  return (
    <div className="left-rail">
      <div className="rail-tabs" role="tablist" aria-label="Primary navigation">
        <button
          id="leftrail-tab-stories"
          role="tab"
          aria-selected={activeTab === 'stories'}
          aria-controls="leftrail-tabpanel"
          className={`rail-tab${activeTab === 'stories' ? ' active' : ''}`}
          onClick={() => onTabChange('stories')}
        >
          Stories
        </button>
        <button
          id="leftrail-tab-entities"
          role="tab"
          aria-selected={activeTab === 'entities'}
          aria-controls="leftrail-tabpanel"
          className={`rail-tab${activeTab === 'entities' ? ' active' : ''}`}
          onClick={() => onTabChange('entities')}
        >
          Entities
        </button>
        <button
          id="leftrail-tab-vault"
          role="tab"
          aria-selected={activeTab === 'vault'}
          aria-controls="leftrail-tabpanel"
          className={`rail-tab${activeTab === 'vault' ? ' active' : ''}`}
          onClick={() => onTabChange('vault')}
        >
          Vault
        </button>
        <button
          id="leftrail-tab-review"
          role="tab"
          aria-selected={activeTab === 'review'}
          aria-controls="leftrail-tabpanel"
          className={`rail-tab${activeTab === 'review' ? ' active' : ''}`}
          onClick={() => onTabChange('review')}
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
          />
        )}
        {activeTab === 'review' && <SuggestionReview onOpenVaultPath={onOpenVaultPath} />}
      </div>
    </div>
  );
}
