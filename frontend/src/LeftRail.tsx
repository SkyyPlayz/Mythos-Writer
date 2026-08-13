import { useState, useMemo } from 'react';
import type { Story, Chapter, Scene } from './types';
import StoryNavigator from './StoryNavigator';
import type { SceneNoteDragPayload } from './sceneNotes';
import { countWords } from './wordStats';
import './LeftRail.css';

// 80k words = 100% On Track (typical novel goal)
const WORD_GOAL = 80_000;

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
  onPromoteSceneNote?: (payload: SceneNoteDragPayload) => void;
  /** M6 (SKY-9022): scene status dot click — cycles the scene's draftState. */
  onCycleSceneStatus?: (sceneId: string) => void;
  sidebarCollapsed: boolean;
  onToggleCollapsed: () => void;
}

/** Kept for DesktopShell import backward-compat; only sidebarCollapsed is used. */
export const DEFAULT_LEFT_SIDEBAR_LAYOUT: LeftSidebarLayout = {
  panels: [{ id: 'stories' as SidebarPanelId, collapsed: false }],
  sidebarCollapsed: false,
};

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
  onPromoteSceneNote,
  onCycleSceneStatus,
  sidebarCollapsed,
  onToggleCollapsed,
}: Props) {
  const [navCollapsed, setNavCollapsed] = useState(false);

  // Aggregate stats across all stories
  const { totalWords, totalScenes } = useMemo(() => {
    let words = 0;
    let scenes = 0;
    for (const story of stories) {
      for (const chapter of story.chapters) {
        for (const scene of chapter.scenes) {
          scenes++;
          words += scene.blocks.reduce((s, b) => s + countWords(b.content), 0);
        }
      }
    }
    return { totalWords: words, totalScenes: scenes };
  }, [stories]);

  const storyWordCount = useMemo(() => {
    if (!selectedStory) return 0;
    return selectedStory.chapters.reduce(
      (sum, ch) => sum + ch.scenes.reduce(
        (s, sc) => s + sc.blocks.reduce((w, b) => w + countWords(b.content), 0),
        0,
      ),
      0,
    );
  }, [selectedStory]);

  const progressPct = Math.min(100, Math.round(totalWords / WORD_GOAL * 100));
  const onTrackPct = progressPct;

  if (sidebarCollapsed) {
    return (
      <div className="left-rail left-rail--collapsed" data-testid="left-rail-collapsed">
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

  return (
    <div className="left-rail" data-testid="left-rail">
      {/* Zone 1 — Story Card */}
      {selectedStory && (
        <div className="lr-story-card" data-testid="lr-story-card">
          <div className="lr-story-card-top">
            <span className="lr-story-icon" aria-hidden="true">✦</span>
            <div className="lr-story-info">
              <h2 className="lr-story-title">{selectedStory.title}</h2>
              <p className="lr-story-meta">
                {selectedStory.genre ?? 'Fiction'} · {storyWordCount.toLocaleString()} words
              </p>
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
          <div className="lr-progress-bar" role="progressbar" aria-valuenow={progressPct} aria-valuemin={0} aria-valuemax={100}>
            <div className="lr-progress-fill" style={{ width: `${progressPct}%` }} />
          </div>
        </div>
      )}

      {/* Collapse button when no story selected */}
      {!selectedStory && (
        <div className="lr-story-card lr-story-card--empty">
          <button
            className="lr-story-collapse lr-story-collapse--standalone"
            onClick={onToggleCollapsed}
            aria-label="Collapse left sidebar"
            title="Collapse sidebar"
          >
            «
          </button>
        </div>
      )}

      {/* Zone 2 — Story Navigator */}
      <div className="lr-nav-zone" data-testid="lr-nav-zone">
        <div className="lr-nav-header">
          <span className="lr-nav-label">STORY NAVIGATOR</span>
          <button
            className="lr-nav-add"
            onClick={() => selectedStory ? onCreateChapter(selectedStory.id) : onCreateStory()}
            aria-label={selectedStory ? 'Add chapter' : 'New story'}
            title={selectedStory ? 'Add chapter' : 'New story'}
          >
            +
          </button>
          <button
            className="lr-nav-collapse-btn"
            onClick={() => setNavCollapsed((c) => !c)}
            aria-label={navCollapsed ? 'Expand navigator' : 'Collapse navigator'}
            aria-expanded={!navCollapsed}
            title={navCollapsed ? 'Expand' : 'Collapse'}
          >
            {navCollapsed ? '▸' : '▾'}
          </button>
        </div>
        {!navCollapsed && (
          <div className="lr-nav-tree">
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
              onPromoteSceneNote={onPromoteSceneNote}
              onCycleSceneStatus={onCycleSceneStatus}
              hideHeader
            />
          </div>
        )}
      </div>

      {/* Zone 3 — Project Footer */}
      <div className="lr-project-footer" data-testid="lr-project-footer">
        <div className="lr-footer-label">PROJECT</div>
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
            <span className="lr-stat-val lr-stat-val--accent">{onTrackPct}%</span>
            <span className="lr-stat-key">On Track</span>
          </div>
        </div>
      </div>
    </div>
  );
}
