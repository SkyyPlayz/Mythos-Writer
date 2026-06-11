import { useState, useCallback, type ReactElement } from 'react';
import type { Story, Scene, Chapter } from '../../types';
import { SceneCard } from './SceneCard';
import type { BeatAssignments } from './BeatSheetSidebar';
import { BEAT_ACTS } from './BEAT_STRUCTURE';
import './SceneGrid.css';

interface DragState {
  sceneId: string;
  chapterId: string;
  storyId: string;
}

type DropTarget =
  | { kind: 'before'; chapterId: string; sceneId: string }
  | { kind: 'append'; chapterId: string };

interface ContextMenuState {
  sceneId: string;
  chapterId: string;
  storyId: string;
  x: number;
  y: number;
}

interface ReorderState {
  sceneId: string;
  chapterId: string;
  storyId: string;
}

interface SceneGridProps {
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
  onBeatAssign: (sceneId: string, beatId: string | null) => void;
  announce: (msg: string) => void;
}

function resolveBeatActId(beatId: string): string | null {
  for (const act of BEAT_ACTS) {
    if (act.beats.some((b) => b.id === beatId)) return act.id;
  }
  return null;
}

function computeChapterWords(chapter: Chapter): number {
  return chapter.scenes.reduce((sum, scene) =>
    sum + scene.blocks.reduce((s, b) => {
      const t = b.content.trim();
      return t ? s + t.split(/\s+/).length : s;
    }, 0),
    0,
  );
}

export function SceneGrid({
  story,
  beatAssignments,
  focusedBeatId,
  onSelectScene,
  onReorderScenes,
  onMoveScene,
  onCreateScene,
  onBeatAssign,
  announce,
}: SceneGridProps): ReactElement {
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [reorderState, setReorderState] = useState<ReorderState | null>(null);
  const [collapsedChapters, setCollapsedChapters] = useState<Set<string>>(new Set());

  const handleDragStart = useCallback(
    (e: React.DragEvent, scene: Scene, chapter: Chapter) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', scene.id);
      setDragState({ sceneId: scene.id, chapterId: chapter.id, storyId: story.id });
    },
    [story.id],
  );

  const handleDragEnd = useCallback(() => {
    setDragState(null);
    setDropTarget(null);
  }, []);

  const handleDragOverScene = useCallback(
    (e: React.DragEvent, targetScene: Scene, targetChapter: Chapter) => {
      if (!dragState) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      setDropTarget({ kind: 'before', chapterId: targetChapter.id, sceneId: targetScene.id });
    },
    [dragState],
  );

  const handleDragOverChapterHeader = useCallback(
    (e: React.DragEvent, targetChapter: Chapter) => {
      if (!dragState) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDropTarget({ kind: 'append', chapterId: targetChapter.id });
    },
    [dragState],
  );

  const handleDragLeave = useCallback(() => {
    setDropTarget(null);
  }, []);

  const handleDrop = useCallback(
    (_e: React.DragEvent, targetChapter: Chapter, insertBeforeSceneId: string | null) => {
      if (!dragState) return;
      const { sceneId, chapterId: fromChapterId, storyId } = dragState;

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
        const dragged = sortedScenes.find((s) => s.id === sceneId)!;
        const reordered = [
          ...withoutDragged.slice(0, idx),
          dragged,
          ...withoutDragged.slice(idx),
        ];
        announce(`Scene "${dragged.title}" moved to position ${idx + 1} of ${chapter.title}`);
        onReorderScenes(storyId, fromChapterId, reordered.map((s) => s.id));
      } else {
        const scene = story.chapters.flatMap((c) => c.scenes).find((s) => s.id === sceneId);
        announce(`Scene "${scene?.title ?? sceneId}" moved to ${targetChapter.title}`);
        onMoveScene(storyId, sceneId, fromChapterId, targetChapter.id, insertBeforeSceneId);
      }

      setDragState(null);
      setDropTarget(null);
    },
    [dragState, story, onReorderScenes, onMoveScene, announce],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, scene: Scene, chapter: Chapter) => {
      e.preventDefault();
      setContextMenu({
        sceneId: scene.id,
        chapterId: chapter.id,
        storyId: story.id,
        x: e.clientX,
        y: e.clientY,
      });
    },
    [story.id],
  );

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const handleReorderStart = useCallback(
    (scene: Scene, chapter: Chapter) => {
      setReorderState({ sceneId: scene.id, chapterId: chapter.id, storyId: story.id });
    },
    [story.id],
  );

  const handleReorderKey = useCallback(
    (e: React.KeyboardEvent, scene: Scene, chapter: Chapter) => {
      if (!reorderState || reorderState.sceneId !== scene.id) return;

      const sortedScenes = [...chapter.scenes].sort((a, b) => a.order - b.order);
      const currentIdx = sortedScenes.findIndex((s) => s.id === scene.id);

      if (e.key === 'Escape') {
        e.preventDefault();
        setReorderState(null);
        return;
      }

      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (currentIdx === 0) return;
        const newOrder = [...sortedScenes];
        [newOrder[currentIdx - 1], newOrder[currentIdx]] = [
          newOrder[currentIdx],
          newOrder[currentIdx - 1],
        ];
        announce(`Scene moved to position ${currentIdx} of ${chapter.title}`);
        onReorderScenes(story.id, chapter.id, newOrder.map((s) => s.id));
        return;
      }

      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        if (currentIdx === sortedScenes.length - 1) return;
        const newOrder = [...sortedScenes];
        [newOrder[currentIdx], newOrder[currentIdx + 1]] = [
          newOrder[currentIdx + 1],
          newOrder[currentIdx],
        ];
        announce(`Scene moved to position ${currentIdx + 2} of ${chapter.title}`);
        onReorderScenes(story.id, chapter.id, newOrder.map((s) => s.id));
        return;
      }

      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        setReorderState(null);
      }
    },
    [reorderState, story.id, onReorderScenes, announce],
  );

  const toggleChapter = (chapterId: string) => {
    setCollapsedChapters((prev) => {
      const next = new Set(prev);
      if (next.has(chapterId)) next.delete(chapterId);
      else next.add(chapterId);
      return next;
    });
  };

  if (story.chapters.length === 0) {
    return (
      <div className="scene-grid scene-grid--empty">
        <p className="scene-grid__empty-msg">No chapters yet.</p>
      </div>
    );
  }

  return (
    <div
      className="scene-grid"
      role="listbox"
      aria-label={`Scenes in ${story.title}`}
      onClick={contextMenu ? closeContextMenu : undefined}
    >
      {story.chapters
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((chapter) => {
          const isCollapsed = collapsedChapters.has(chapter.id);
          const sortedScenes = [...chapter.scenes].sort((a, b) => a.order - b.order);
          const totalWords = computeChapterWords(chapter);
          const isChapterDropTarget =
            dropTarget?.kind === 'append' && dropTarget.chapterId === chapter.id;

          return (
            <section
              key={chapter.id}
              className={`chapter-section${isChapterDropTarget ? ' chapter-section--drop-target' : ''}`}
            >
              <div
                className="chapter-section__header"
                onDragOver={(e) => handleDragOverChapterHeader(e, chapter)}
                onDrop={(e) => handleDrop(e, chapter, null)}
                onDragLeave={handleDragLeave}
              >
                <button
                  className="chapter-section__collapse-btn"
                  onClick={() => toggleChapter(chapter.id)}
                  aria-expanded={!isCollapsed}
                  aria-controls={`chapter-grid-${chapter.id}`}
                  aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${chapter.title}`}
                >
                  <span aria-hidden="true">{isCollapsed ? '▶' : '▼'}</span>
                </button>
                <h2 className="chapter-section__title">{chapter.title}</h2>
                <span
                  className="chapter-section__meta"
                  aria-label={`${sortedScenes.length} scenes, ${totalWords.toLocaleString()} words`}
                >
                  {sortedScenes.length} scene{sortedScenes.length !== 1 ? 's' : ''} |{' '}
                  {totalWords >= 1000 ? `${(totalWords / 1000).toFixed(1)}K` : totalWords} wds
                </span>
                <button
                  className="chapter-section__add-btn"
                  onClick={() => onCreateScene(story.id, chapter.id)}
                  aria-label={`Add scene to ${chapter.title}`}
                  title={`Add scene to ${chapter.title}`}
                >
                  +
                </button>
              </div>

              {!isCollapsed && (
                <div id={`chapter-grid-${chapter.id}`} className="chapter-section__grid">
                  {sortedScenes.length === 0 ? (
                    <div
                      className="chapter-section__empty"
                      onDragOver={(e) => {
                        e.preventDefault();
                        setDropTarget({ kind: 'append', chapterId: chapter.id });
                      }}
                      onDrop={(e) => handleDrop(e, chapter, null)}
                      onDragLeave={handleDragLeave}
                    >
                      <p>No scenes yet.</p>
                      <button
                        className="chapter-section__create-first"
                        onClick={() => onCreateScene(story.id, chapter.id)}
                      >
                        + Create scene
                      </button>
                    </div>
                  ) : (
                    sortedScenes.map((scene) => {
                      const beatId = beatAssignments[scene.id] ?? null;
                      const beatActId = beatId ? resolveBeatActId(beatId) : null;
                      const isDropBefore =
                        dropTarget?.kind === 'before' &&
                        dropTarget.chapterId === chapter.id &&
                        dropTarget.sceneId === scene.id;

                      // If a beat is focused, dim cards not matching that beat
                      const showBeatTint =
                        focusedBeatId == null
                          ? beatActId
                          : beatAssignments[scene.id] === focusedBeatId
                            ? beatActId
                            : null;

                      return (
                        <div
                          key={scene.id}
                          className={`scene-grid__cell${isDropBefore ? ' scene-grid__cell--drop-before' : ''}`}
                          onKeyDown={
                            reorderState?.sceneId === scene.id
                              ? (e) => handleReorderKey(e, scene, chapter)
                              : undefined
                          }
                        >
                          <SceneCard
                            scene={scene}
                            beatActId={showBeatTint}
                            isDragging={dragState?.sceneId === scene.id}
                            isDragOver={isDropBefore}
                            isReordering={reorderState?.sceneId === scene.id}
                            onDragStart={(e) => handleDragStart(e, scene, chapter)}
                            onDragEnd={handleDragEnd}
                            onDragOver={(e) => handleDragOverScene(e, scene, chapter)}
                            onDragLeave={handleDragLeave}
                            onDrop={(e) => handleDrop(e, chapter, scene.id)}
                            onClick={() => onSelectScene(scene, chapter, story)}
                            onContextMenu={(e) => handleContextMenu(e, scene, chapter)}
                            onReorderStart={() => handleReorderStart(scene, chapter)}
                          />
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </section>
          );
        })}

      {contextMenu && (
        <BeatContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          sceneId={contextMenu.sceneId}
          currentBeatId={beatAssignments[contextMenu.sceneId] ?? null}
          onAssign={(beatId) => {
            onBeatAssign(contextMenu.sceneId, beatId);
            closeContextMenu();
          }}
          onClose={closeContextMenu}
        />
      )}
    </div>
  );
}

// ─── Beat assignment context menu ───

interface BeatContextMenuProps {
  x: number;
  y: number;
  sceneId: string;
  currentBeatId: string | null;
  onAssign: (beatId: string | null) => void;
  onClose: () => void;
}

function BeatContextMenu({
  x,
  y,
  currentBeatId,
  onAssign,
  onClose,
}: BeatContextMenuProps): ReactElement {
  return (
    <>
      <div
        className="context-menu-backdrop"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className="context-menu"
        role="menu"
        aria-label="Assign scene to beat"
        style={{ left: x, top: y }}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <div className="context-menu__header">Assign to beat</div>
        {BEAT_ACTS.flatMap((act) =>
          act.beats.map((beat) => (
            <button
              key={beat.id}
              role="menuitem"
              className={`context-menu__item${currentBeatId === beat.id ? ' context-menu__item--active' : ''}`}
              onClick={() => onAssign(beat.id)}
            >
              <span className={`context-menu__act-dot context-menu__act-dot--${act.id}`} aria-hidden="true" />
              {beat.name}
            </button>
          )),
        )}
        {currentBeatId && (
          <>
            <div className="context-menu__separator" role="separator" />
            <button
              role="menuitem"
              className="context-menu__item context-menu__item--danger"
              onClick={() => onAssign(null)}
            >
              Unassign beat
            </button>
          </>
        )}
      </div>
    </>
  );
}
