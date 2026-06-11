import { useState, useCallback, type ReactElement } from 'react';
import type { Story, Scene, Chapter } from '../../types';
import { StatusBadge, draftStateToStatus } from './StatusBadge';
import type { BeatAssignments } from './BeatSheetSidebar';
import { computeWordCount } from './SceneCard';
import './ListView.css';

interface ListViewProps {
  story: Story;
  beatAssignments: BeatAssignments;
  focusedBeatId?: string | null;
  onSelectScene: (scene: Scene, chapter: Chapter, story: Story) => void;
  onReorderScenes: (storyId: string, chapterId: string, orderedIds: string[]) => void;
  onCreateScene: (storyId: string, chapterId: string) => void;
  announce: (msg: string) => void;
}

interface ReorderState {
  sceneId: string;
  chapterId: string;
}

export function ListView({
  story,
  beatAssignments,
  focusedBeatId,
  onSelectScene,
  onReorderScenes,
  onCreateScene,
  announce,
}: ListViewProps): ReactElement {
  const [collapsedChapters, setCollapsedChapters] = useState<Set<string>>(new Set());
  const [reorderState, setReorderState] = useState<ReorderState | null>(null);

  const toggleChapter = (chapterId: string) => {
    setCollapsedChapters((prev) => {
      const next = new Set(prev);
      if (next.has(chapterId)) next.delete(chapterId);
      else next.add(chapterId);
      return next;
    });
  };

  const handleSceneKeyDown = useCallback(
    (e: React.KeyboardEvent, scene: Scene, chapter: Chapter) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        onSelectScene(scene, chapter, story);
        return;
      }

      if (e.key === ' ') {
        e.preventDefault();
        setReorderState({ sceneId: scene.id, chapterId: chapter.id });
        announce(`Reorder mode: use arrow keys to move "${scene.title}", Escape to cancel.`);
        return;
      }

      if (!reorderState || reorderState.sceneId !== scene.id) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        setReorderState(null);
        return;
      }

      const sortedScenes = [...chapter.scenes].sort((a, b) => a.order - b.order);
      const idx = sortedScenes.findIndex((s) => s.id === scene.id);

      if ((e.key === 'ArrowUp') && idx > 0) {
        e.preventDefault();
        const newOrder = [...sortedScenes];
        [newOrder[idx - 1], newOrder[idx]] = [newOrder[idx], newOrder[idx - 1]];
        announce(`"${scene.title}" moved to position ${idx} of ${chapter.title}`);
        onReorderScenes(story.id, chapter.id, newOrder.map((s) => s.id));
        return;
      }

      if ((e.key === 'ArrowDown') && idx < sortedScenes.length - 1) {
        e.preventDefault();
        const newOrder = [...sortedScenes];
        [newOrder[idx], newOrder[idx + 1]] = [newOrder[idx + 1], newOrder[idx]];
        announce(`"${scene.title}" moved to position ${idx + 2} of ${chapter.title}`);
        onReorderScenes(story.id, chapter.id, newOrder.map((s) => s.id));
        return;
      }
    },
    [reorderState, story, onSelectScene, onReorderScenes, announce],
  );

  if (story.chapters.length === 0) {
    return (
      <div className="list-view list-view--empty">
        <p className="list-view__empty-msg">No chapters yet.</p>
      </div>
    );
  }

  return (
    <div className="list-view" role="tree" aria-label={`Scene outline for ${story.title}`}>
      {story.chapters
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((chapter) => {
          const isCollapsed = collapsedChapters.has(chapter.id);
          const sortedScenes = [...chapter.scenes].sort((a, b) => a.order - b.order);

          return (
            <div key={chapter.id} className="list-chapter" role="treeitem" aria-label={chapter.title} aria-expanded={!isCollapsed}>
              <div className="list-chapter__header">
                <button
                  className="list-chapter__toggle"
                  onClick={() => toggleChapter(chapter.id)}
                  aria-expanded={!isCollapsed}
                  aria-controls={`list-chapter-${chapter.id}`}
                  aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${chapter.title}`}
                >
                  <span aria-hidden="true">{isCollapsed ? '▶' : '▼'}</span>
                </button>
                <span className="list-chapter__icon" aria-hidden="true">📄</span>
                <span className="list-chapter__name">{chapter.title}</span>
                <span className="list-chapter__meta">
                  ({sortedScenes.length} scene{sortedScenes.length !== 1 ? 's' : ''})
                </span>
                <button
                  className="list-chapter__add"
                  onClick={() => onCreateScene(story.id, chapter.id)}
                  aria-label={`Add scene to ${chapter.title}`}
                  title="Add scene"
                >
                  +
                </button>
              </div>

              {!isCollapsed && (
                <ul
                  id={`list-chapter-${chapter.id}`}
                  className="list-chapter__scenes"
                  role="group"
                >
                  {sortedScenes.length === 0 ? (
                    <li className="list-scene list-scene--empty">
                      <span className="list-scene__empty-text">No scenes yet.</span>
                      <button
                        className="list-scene__create-first"
                        onClick={() => onCreateScene(story.id, chapter.id)}
                      >
                        + Create scene
                      </button>
                    </li>
                  ) : (
                    sortedScenes.map((scene) => {
                      const status = draftStateToStatus(scene.draftState);
                      const wordCount = computeWordCount(scene);
                      const isReordering = reorderState?.sceneId === scene.id;
                      const beatId = beatAssignments[scene.id] ?? null;
                      const isFocusedBeat = focusedBeatId != null && beatId === focusedBeatId;
                      const isDimmed = focusedBeatId != null && !isFocusedBeat;

                      return (
                        <li
                          key={scene.id}
                          role="treeitem"
                          className={[
                            'list-scene',
                            isReordering ? 'list-scene--reordering' : '',
                            isDimmed ? 'list-scene--dimmed' : '',
                            isFocusedBeat ? 'list-scene--beat-highlighted' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          tabIndex={0}
                          aria-label={`Scene: ${scene.title}, ${wordCount} words, ${status}`}
                          onClick={() => onSelectScene(scene, chapter, story)}
                          onKeyDown={(e) => handleSceneKeyDown(e, scene, chapter)}
                        >
                          <span className="list-scene__drag-handle" aria-hidden="true">⠿</span>
                          <StatusBadge status={status} size={10} />
                          <span className="list-scene__title">{scene.title}</span>
                          <span className="list-scene__wordcount">
                            {wordCount > 0 ? `${wordCount.toLocaleString()} words` : '—'}
                          </span>
                          {isReordering && (
                            <span className="sr-only" aria-live="polite">
                              Reorder mode. Arrow Up/Down to move. Escape to cancel.
                            </span>
                          )}
                        </li>
                      );
                    })
                  )}
                </ul>
              )}
            </div>
          );
        })}
    </div>
  );
}
