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
  /** Beta 4 M2 (§4): current manuscript page width — renders the prototype's
   *  "Page W px — drag page edge to resize" hint when a scene is open. */
  pageWidthPx?: number | null;
}

/** "Saved just now" → "Saved 2m ago" → "Saved 1h ago" (prototype 3630). */
export function formatSavedAgo(savedAt: number, now: number): string {
  const s = Math.max(0, Math.round((now - savedAt) / 1000));
  if (s < 60) return 'Saved just now';
  const m = Math.round(s / 60);
  if (m < 60) return `Saved ${m}m ago`;
  return `Saved ${Math.round(m / 60)}h ago`;
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
  pageWidthPx = null,
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

  // Beta 3 M8: live character count + read time (prototype statChars/statRead,
  // 4130-4131 — real text replaces the prototype's mocked corpus; the ~260 wpm
  // read-rate formula is the prototype's).
  const charCount = selectedScene
    ? selectedScene.blocks.map((b) => b.content.length).reduce((a, b) => a + b, 0)
    : 0;
  const readTime = `~${Math.max(1, Math.round(wordCount / 260))} min read`;

  // SKY-204: when a vault note is active instead of a scene, show note stats.
  const noteFileName = activeNotePath ? activeNotePath.split('/').pop()?.replace(/\.md$/, '') ?? '' : '';
  const isNoteActive = !!activeNotePath && !selectedScene;

  // SKY-2305: live daily goal progress chip
  const [goalStats, setGoalStats] = useState<{ todayWords: number; dailyGoal: number } | null>(null);
  // Beta 4 M2 (§4): "Saved Xm ago" + pulse dot — armed by scene:saved events.
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;

    const fetchStats = () => {
      void window.api.goalsGetStats?.().then((s) => {
        if (!cancelled) setGoalStats({ todayWords: s.todayWords, dailyGoal: s.dailyGoal });
      }).catch(() => { /* non-fatal */ });
    };

    const onSaved = () => {
      setLastSavedAt(Date.now());
      fetchStats();
    };

    fetchStats();

    window.addEventListener('scene:saved', onSaved);
    return () => {
      cancelled = true;
      window.removeEventListener('scene:saved', onSaved);
    };
  }, []);

  // Re-render the relative "Saved Xm ago" label every 30s while armed.
  useEffect(() => {
    if (lastSavedAt === null) return;
    const id = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [lastSavedAt]);

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
            <span className="bottom-stats" data-testid="bottom-live-stats">
              {wordCount.toLocaleString()} words · {charCount.toLocaleString()} characters · {readTime}
              {currentIndex >= 0 && (
                <> · Scene {currentIndex + 1} / {allScenes.length}</>
              )}
              {/* Beta 4 M2 (§4): page-width hint (prototype 3625) */}
              {pageWidthPx !== null && (
                <span className="bottom-page-hint" data-testid="bottom-page-hint">
                  {' '}· Page {pageWidthPx.toLocaleString()} px — drag page edge to resize
                </span>
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

      {/* Beta 4 M2 (§4): "Saved Xm ago" + pulsing dot (prototype 3630) */}
      {lastSavedAt !== null && (
        <span className="bottom-saved" data-testid="bottom-saved" role="status" aria-live="polite">
          <span className="bottom-saved-dot" aria-hidden="true" />
          {formatSavedAgo(lastSavedAt, nowTick)}
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
