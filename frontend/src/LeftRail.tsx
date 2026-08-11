import { useState, useMemo } from 'react';
import type { Story, Chapter, Scene } from './types';
import StoryNavigator from './StoryNavigator';
import { countWords } from './wordStats';
import './LeftRail.css';

export const DEFAULT_LEFT_SIDEBAR_LAYOUT: LeftSidebarLayout = {
  panels: [{ id: 'stories', collapsed: false }],
  sidebarCollapsed: false,
};

interface Props {
  stories: Story[];
  selectedStory: Story | null;
  selectedScene: Scene | null;
  selectedSceneId: string | null;
  onSelectScene: (scene: Scene, chapter: Chapter, story: Story) => void;
  onSelectStory?: (story: Story) => void;
  onCreateStory: () => void;
  onCreateChapter: (storyId: string) => void;
  onCreateScene: (storyId: string, chapterId: string) => void;
  onReorderScenes?: (storyId: string, chapterId: string, orderedSceneIds: string[]) => void;
  showTemplateCta?: boolean;
  onTemplateCtaClick?: () => void;
  sidebarCollapsed: boolean;
  onToggleCollapsed: () => void;
  /** Badge count for suggestion review — shown in nav if non-zero. */
  reviewBadgeCount?: number;
}

export default function LeftRail({
  stories,
  selectedStory,
  selectedSceneId,
  onSelectScene,
  onSelectStory,
  onCreateStory,
  onCreateChapter,
  onCreateScene,
  onReorderScenes,
  showTemplateCta,
  onTemplateCtaClick,
  sidebarCollapsed,
  onToggleCollapsed,
}: Props) {
  const [navCollapsed, setNavCollapsed] = useState(false);

  const { totalWords, totalScenes } = useMemo(() => {
    let words = 0;
    let scenes = 0;
    for (const story of stories) {
      for (const chapter of story.chapters) {
        for (const scene of chapter.scenes) {
          scenes++;
          for (const block of scene.blocks) {
            words += countWords(block.content);
          }
        }
      }
    }
    return { totalWords: words, totalScenes: scenes };
  }, [stories]);

  const progress = Math.min(100, Math.round((totalWords / 80000) * 100));
  const onTrackPct = progress;

  if (sidebarCollapsed) {
    return (
      <div className="left-rail left-rail--collapsed">
        <button
          className="lr-expand-btn"
          onClick={onToggleCollapsed}
          aria-label="Expand left sidebar"
          title="Expand sidebar"
        >
          »
        </button>
      </div>
    );
  }

  const genre = selectedStory?.genre ?? 'Fiction';

  return (
    <div className="left-rail">
      {/* Zone 1 — Story Card */}
      {selectedStory && (
        <div className="lr-story-card">
          <span className="lr-story-icon">✦</span>
          <h2 className="lr-story-title">{selectedStory.title}</h2>
          <p className="lr-story-meta">{genre} · {totalWords.toLocaleString()} words</p>
          <div className="lr-progress-bar">
            <div className="lr-progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <button
            className="lr-story-collapse"
            onClick={onToggleCollapsed}
            aria-label="Collapse left sidebar"
            title="Collapse sidebar"
          >
            «
          </button>
        </div>
      )}

      {/* Zone 2 — Story Navigator */}
      <div className="lr-nav-zone">
        <div className="lr-nav-header">
          <span className="lr-nav-label">STORY NAVIGATOR</span>
          <button
            className="lr-nav-add"
            onClick={() => selectedStory && onCreateChapter(selectedStory.id)}
            aria-label="Add chapter"
            disabled={!selectedStory}
          >
            +
          </button>
          <button
            className="lr-nav-collapse"
            onClick={() => setNavCollapsed((c) => !c)}
            aria-label={navCollapsed ? 'Expand navigator' : 'Collapse navigator'}
          >
            {navCollapsed ? '▸' : '▾'}
          </button>
        </div>
        {!navCollapsed && (
          <StoryNavigator
            stories={stories}
            selectedSceneId={selectedSceneId}
            onSelectScene={onSelectScene}
            onSelectStory={onSelectStory}
            onCreateStory={onCreateStory}
            onCreateChapter={onCreateChapter}
            onCreateScene={onCreateScene}
            onReorderScenes={onReorderScenes}
            showTemplateCta={showTemplateCta}
            onTemplateCtaClick={onTemplateCtaClick}
          />
        )}
      </div>

      {/* Zone 3 — Project Footer */}
      <div className="lr-project-footer">
        <div className="lr-footer-stats">
          <div className="lr-stat">
            <span className="lr-stat-val">{totalWords.toLocaleString()}</span>
            <span className="lr-stat-key">Words</span>
          </div>
          <div className="lr-stat">
            <span className="lr-stat-val">{totalScenes}</span>
            <span className="lr-stat-key">Scenes</span>
          </div>
          <div className="lr-stat">
            <span className="lr-stat-val">{onTrackPct}%</span>
            <span className="lr-stat-key">On Track</span>
          </div>
        </div>
      </div>
    </div>
  );
}
