import type { Scene, Chapter, Story } from './types';
import './BottomBar.css';

interface Props {
  selectedScene: Scene | null;
  selectedChapter: Chapter | null;
  selectedStory: Story | null;
  onNavigateScene: (direction: 'prev' | 'next') => void;
}

export default function BottomBar({
  selectedScene,
  selectedChapter,
  selectedStory,
  onNavigateScene,
}: Props) {
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

  return (
    <div className="bottom-bar">
      <div className="bottom-nav">
        <button
          className="bottom-nav-btn"
          disabled={!hasPrev}
          onClick={() => onNavigateScene('prev')}
          title="Previous scene"
        >
          ‹ Prev
        </button>
        <button
          className="bottom-nav-btn"
          disabled={!hasNext}
          onClick={() => onNavigateScene('next')}
          title="Next scene"
        >
          Next ›
        </button>
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
              {currentIndex >= 0 && (
                <> · Scene {currentIndex + 1} / {allScenes.length}</>
              )}
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
