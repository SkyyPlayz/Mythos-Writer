import type { Scene, Chapter, Story } from './types';
import { useVaultStore } from './stores/vaultStore';
import './BottomBar.css';

export default function BottomBar() {
  const stories = useVaultStore((s) => s.stories);
  const activeStoryId = useVaultStore((s) => s.activeStoryId);
  const activeChapterId = useVaultStore((s) => s.activeChapterId);
  const activeSceneId = useVaultStore((s) => s.activeSceneId);
  const setActiveScene = useVaultStore((s) => s.setActiveScene);

  const selectedStory = stories.find((s) => s.id === activeStoryId) ?? null;
  const selectedChapter = selectedStory?.chapters.find((c) => c.id === activeChapterId) ?? null;
  const selectedScene = selectedChapter?.scenes.find((s) => s.id === activeSceneId) ?? null;

  const allScenes: { scene: Scene; chapter: Chapter; story: Story }[] = [];
  if (selectedStory) {
    for (const ch of [...selectedStory.chapters].sort((a, b) => a.order - b.order)) {
      for (const sc of [...ch.scenes].sort((a, b) => a.order - b.order)) {
        allScenes.push({ scene: sc, chapter: ch, story: selectedStory });
      }
    }
  }

  const currentIndex = selectedScene
    ? allScenes.findIndex((s) => s.scene.id === selectedScene.id)
    : -1;

  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < allScenes.length - 1;

  const wordCount = selectedScene
    ? selectedScene.blocks
        .map((b) => b.content.trim().split(/\s+/).filter(Boolean).length)
        .reduce((a, b) => a + b, 0)
    : 0;

  const handleNavigateScene = (direction: 'prev' | 'next') => {
    if (!selectedStory || !selectedScene) return;
    const nextIdx = direction === 'prev' ? currentIndex - 1 : currentIndex + 1;
    if (nextIdx >= 0 && nextIdx < allScenes.length) {
      const { scene, chapter } = allScenes[nextIdx];
      setActiveScene(selectedStory.id, chapter.id, scene.id);
    }
  };

  return (
    <div className="bottom-bar">
      <div className="bottom-nav">
        <button className="bottom-nav-btn" disabled={!hasPrev} onClick={() => handleNavigateScene('prev')} title="Previous scene">‹ Prev</button>
        <button className="bottom-nav-btn" disabled={!hasNext} onClick={() => handleNavigateScene('next')} title="Next scene">Next ›</button>
      </div>
      <div className="bottom-meta">
        {selectedScene ? (
          <>
            <span className="bottom-breadcrumb">
              {selectedStory?.title}
              <span className="bottom-sep">›</span>
              {selectedChapter?.title}
              <span className="bottom-sep">›</span>
              <span className="bottom-scene-name">{selectedScene.title}</span>
            </span>
            <span className="bottom-stats">
              {wordCount.toLocaleString()} words
              {selectedScene.blocks.length > 0 && ` · ${selectedScene.blocks.length} blocks`}
              {currentIndex >= 0 && <> · Scene {currentIndex + 1} / {allScenes.length}</>}
            </span>
          </>
        ) : (
          <span className="bottom-hint">
            {allScenes.length > 0
              ? `${allScenes.length} scene${allScenes.length !== 1 ? 's' : ''} in this story`
              : 'Select a scene to begin writing'}
          </span>
        )}
      </div>
      <div className="bottom-draft">
        {selectedScene?.draftState && (
          <span className={`bottom-draft-badge draft-${selectedScene.draftState}`}>
            {selectedScene.draftState}
          </span>
        )}
      </div>
    </div>
  );
}
