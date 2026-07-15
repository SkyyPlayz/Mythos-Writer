// Structure list view — Beta 4 M14 refresh (FULL-SPEC §5.3 grid/list parity).
//
// Prototype: "Mythos Writer - Liquid Neon.dc.html" 796–804 (list rows:
// status chip · title (flex) · POV · words 74px right) under the same
// chapter group headers as the grid.
//
// M14 change vs Beta 3: rows are mouse-draggable with full grid parity —
// reorder within a chapter AND move across chapters (drop on a row inserts
// before it; drop on a chapter header appends). Keyboard reorder
// (Space → arrows) is unchanged.

import { useState, useCallback, type ReactElement } from 'react';
import type { Story, Scene, Chapter } from '../../types';
import { StatusChip, draftStateToStatus } from './StatusBadge';
import type { BeatAssignments } from './BeatSheetSidebar';
import { computeWordCount, scenePov } from './SceneCard';
import './ListView.css';

interface ListViewProps {
  story: Story;
  beatAssignments: BeatAssignments;
  focusedBeatId?: string | null;
  onSelectScene: (scene: Scene, chapter: Chapter, story: Story) => void;
  onReorderScenes: (storyId: string, chapterId: string, orderedIds: string[]) => void;
  onMoveScene: (
    storyId: string,
    sceneId: string,
    fromChapterId: string,
    toChapterId: string,
    insertBeforeSceneId: string | null,
  ) => void;
  onCreateScene: (storyId: string, chapterId: string) => void;
  announce: (msg: string) => void;
}

interface ReorderState {
  sceneId: string;
  chapterId: string;
}

interface DragState {
  sceneId: string;
  chapterId: string;
}

type DropTarget =
  | { kind: 'before'; chapterId: string; sceneId: string }
  | { kind: 'append'; chapterId: string };

export function ListView({
  story,
  beatAssignments,
  focusedBeatId,
  onSelectScene,
  onReorderScenes,
  onMoveScene,
  onCreateScene,
  announce,
}: ListViewProps): ReactElement {
  const [collapsedChapters, setCollapsedChapters] = useState<Set<string>>(new Set());
  const [reorderState, setReorderState] = useState<ReorderState | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);

  const toggleChapter = (chapterId: string) => {
    setCollapsedChapters((prev) => {
      const next = new Set(prev);
      if (next.has(chapterId)) next.delete(chapterId);
      else next.add(chapterId);
      return next;
    });
  };

  // ── Mouse drag (M14 grid parity) ──

  const handleDragStart = useCallback((e: React.DragEvent, scene: Scene, chapter: Chapter) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', scene.id);
    setDragState({ sceneId: scene.id, chapterId: chapter.id });
  }, []);

  const handleDragEnd = useCallback(() => {
    setDragState(null);
    setDropTarget(null);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, targetChapter: Chapter, insertBeforeSceneId: string | null) => {
      e.preventDefault();
      if (!dragState) return;
      const { sceneId, chapterId: fromChapterId } = dragState;

      if (fromChapterId === targetChapter.id) {
        const chapter = story.chapters.find((c) => c.id === fromChapterId);
        if (!chapter) return;
        const sortedScenes = [...chapter.scenes].sort((a, b) => a.order - b.order);
        const withoutDragged = sortedScenes.filter((s) => s.id !== sceneId);
        const insertIdx =
          insertBeforeSceneId !== null
            ? withoutDragged.findIndex((s) => s.id === insertBeforeSceneId)
            : withoutDragged.length;
        const idx = insertIdx === -1 ? withoutDragged.length : insertIdx;
        const dragged = sortedScenes.find((s) => s.id === sceneId);
        if (!dragged) return;
        const reordered = [
          ...withoutDragged.slice(0, idx),
          dragged,
          ...withoutDragged.slice(idx),
        ];
        announce(`Scene "${dragged.title}" moved to position ${idx + 1} of ${chapter.title}`);
        onReorderScenes(story.id, fromChapterId, reordered.map((s) => s.id));
      } else {
        const scene = story.chapters.flatMap((c) => c.scenes).find((s) => s.id === sceneId);
        announce(`Scene "${scene?.title ?? sceneId}" moved to ${targetChapter.title}`);
        onMoveScene(story.id, sceneId, fromChapterId, targetChapter.id, insertBeforeSceneId);
      }

      setDragState(null);
      setDropTarget(null);
    },
    [dragState, story, onReorderScenes, onMoveScene, announce],
  );

  // ── Keyboard reorder (unchanged from Beta 3) ──

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
        .map((chapter, chapterIdx) => {
          const isCollapsed = collapsedChapters.has(chapter.id);
          const sortedScenes = [...chapter.scenes].sort((a, b) => a.order - b.order);
          const isChapterDropTarget =
            dropTarget?.kind === 'append' && dropTarget.chapterId === chapter.id;

          return (
            <div key={chapter.id} className="list-chapter" role="treeitem" aria-label={chapter.title} aria-expanded={!isCollapsed}>
              <div
                className={`list-chapter__header${isChapterDropTarget ? ' list-chapter__header--drop' : ''}`}
                onDragOver={(e) => {
                  if (!dragState) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  setDropTarget({ kind: 'append', chapterId: chapter.id });
                }}
                onDragLeave={() => setDropTarget(null)}
                onDrop={(e) => handleDrop(e, chapter, null)}
              >
                <button
                  className="list-chapter__toggle"
                  onClick={() => toggleChapter(chapter.id)}
                  aria-expanded={!isCollapsed}
                  aria-controls={`list-chapter-${chapter.id}`}
                  aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${chapter.title}`}
                >
                  <span aria-hidden="true">{isCollapsed ? '▶' : '▼'}</span>
                </button>
                <span className="list-chapter__eyebrow" aria-hidden="true">CHAPTER {chapterIdx + 1}</span>
                <span className="list-chapter__name">{chapter.title}</span>
                <span className="list-chapter__meta">
                  {sortedScenes.length} scene{sortedScenes.length !== 1 ? 's' : ''}
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
                    <li
                      className="list-scene list-scene--empty"
                      onDragOver={(e) => {
                        if (!dragState) return;
                        e.preventDefault();
                        setDropTarget({ kind: 'append', chapterId: chapter.id });
                      }}
                      onDragLeave={() => setDropTarget(null)}
                      onDrop={(e) => handleDrop(e, chapter, null)}
                    >
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
                      const pov = scenePov(scene);
                      const isReordering = reorderState?.sceneId === scene.id;
                      const isDragging = dragState?.sceneId === scene.id;
                      const isDropBefore =
                        dropTarget?.kind === 'before' &&
                        dropTarget.chapterId === chapter.id &&
                        dropTarget.sceneId === scene.id;
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
                            isDragging ? 'list-scene--dragging' : '',
                            isDropBefore ? 'list-scene--drop-before' : '',
                            isDimmed ? 'list-scene--dimmed' : '',
                            isFocusedBeat ? 'list-scene--beat-highlighted' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          tabIndex={0}
                          draggable
                          aria-label={`Scene: ${scene.title}, ${wordCount} words, ${status}`}
                          onClick={() => onSelectScene(scene, chapter, story)}
                          onKeyDown={(e) => handleSceneKeyDown(e, scene, chapter)}
                          onDragStart={(e) => handleDragStart(e, scene, chapter)}
                          onDragEnd={handleDragEnd}
                          onDragOver={(e) => {
                            if (!dragState) return;
                            e.preventDefault();
                            e.stopPropagation();
                            e.dataTransfer.dropEffect = 'move';
                            setDropTarget({ kind: 'before', chapterId: chapter.id, sceneId: scene.id });
                          }}
                          onDragLeave={() => setDropTarget(null)}
                          onDrop={(e) => handleDrop(e, chapter, scene.id)}
                        >
                          <StatusChip status={status} />
                          <span className="list-scene__title">{scene.title}</span>
                          {pov && <span className="list-scene__pov">{pov}</span>}
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
