import { useState, useEffect } from 'react';
import type { Scene, Chapter, Story } from './types';
import './BottomBar.css';

interface Props {
  selectedScene: Scene | null;
  selectedChapter: Chapter | null;
  selectedStory: Story | null;
  onNavigateScene: (direction: 'prev' | 'next') => void;
  /** SKY-204: active vault note path (when a note is open instead of a scene). */
  activeNotePath?: string | null;
  /** SKY-204: word count for the active vault note. */
  activeNoteWordCount?: number;
  isVoiceActive?: boolean;
  /** SKY-1699 (Wave 2e): when split view is active, show per-pane word counts. */
  splitWordCounts?: { pane1: number; pane2: number } | null;
}

export default function BottomBar({
  selectedScene,
  selectedChapter,
  selectedStory,
  onNavigateScene,
  activeNotePath,
  activeNoteWordCount,
  isVoiceActive = false,
  splitWordCounts = null,
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

  // SKY-204: when a vault note is active instead of a scene, show note stats.
  const noteFileName = activeNotePath ? activeNotePath.split('/').pop()?.replace(/\.md$/, '') ?? '' : '';
  const isNoteActive = !!activeNotePath && !selectedScene;

  // SKY-2305: live daily goal progress chip
  const [goalStats, setGoalStats] = useState<{ todayWords: number; dailyGoal: number } | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchStats = () => {
      void window.api.goalsGetStats?.().then((s) => {
        if (!cancelled) setGoalStats({ todayWords: s.todayWords, dailyGoal: s.dailyGoal });
      }).catch(() => { /* non-fatal */ });
    };

    fetchStats();

    window.addEventListener('scene:saved', fetchStats);
    return () => {
      cancelled = true;
      window.removeEventListener('scene:saved', fetchStats);
    };
  }, []);

  const showGoalChip = !isNoteActive && selectedScene !== null && goalStats !== null;
  const goalMet = showGoalChip && goalStats!.dailyGoal > 0 && goalStats!.todayWords >= goalStats!.dailyGoal;
  const goalAriaLabel = goalStats !== null
    ? goalStats.dailyGoal > 0
      ? `Today: ${goalStats.todayWords.toLocaleString()} words / ${goalStats.dailyGoal.toLocaleString()} word goal`
      : `Today: ${goalStats.todayWords.toLocaleString()} words`
    : undefined;

  return (
    <div className="bottom-bar">
      <div className="bottom-nav">
        <button
          className="bottom-nav-btn"
          disabled={isNoteActive || !hasPrev}
          onClick={() => onNavigateScene('prev')}
          title="Previous scene"
        >
          ‹ Prev
        </button>
        <button
          className="bottom-nav-btn"
          disabled={isNoteActive || !hasNext}
          onClick={() => onNavigateScene('next')}
          title="Next scene"
        >
          Next ›
        </button>
      </div>

      <div className="bottom-meta">
        {splitWordCounts !== null ? (
          <span className="bottom-stats" data-testid="split-word-counts">
            Pane 1: {splitWordCounts.pane1.toLocaleString()} words
            {' '}·{' '}
            Pane 2: {splitWordCounts.pane2.toLocaleString()} words
          </span>
        ) : isNoteActive ? (
          <>
            <span className="bottom-breadcrumb">
              <span className="bottom-scene-name">{noteFileName}</span>
            </span>
            <span className="bottom-stats">
              {(activeNoteWordCount ?? 0).toLocaleString()} words
            </span>
          </>
        ) : selectedScene ? (
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

      {showGoalChip && (
        <span
          className={`bottom-daily-goal${goalMet ? ' bottom-daily-goal--met' : ''}`}
          tabIndex={0}
          aria-label={goalAriaLabel}
          data-testid="bottom-daily-goal"
        >
          {goalStats!.dailyGoal > 0
            ? `${goalStats!.todayWords.toLocaleString()} / ${goalStats!.dailyGoal.toLocaleString()} today`
            : `${goalStats!.todayWords.toLocaleString()} today`}
        </span>
      )}

      {isVoiceActive && (
        <div className="bottom-voice" aria-label="Voice input active" role="status">
          <span className="bottom-voice-dot" aria-hidden="true" />
          <span className="bottom-voice-label">Listening</span>
        </div>
      )}
    </div>
  );
}
