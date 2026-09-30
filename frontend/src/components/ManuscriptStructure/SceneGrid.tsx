import { useState, useCallback, type ReactElement } from 'react';
import type { Story, Scene, Chapter } from '../../types';
import { SceneCard } from './SceneCard';
import type { BeatAssignments } from './BeatSheetSidebar';
import { ALL_BEATS, type BeatTemplate } from './BEAT_STRUCTURE';
import './SceneGrid.css';

const CARD_MIN_KEY = 'mythos-msv-card-min-v1';
const CARD_MIN_DEFAULT = 218;
const CARD_MIN_LO = 160;
const CARD_MIN_HI = 360;

function readCardMin(): number {
  try {
    const n = Number(localStorage.getItem(CARD_MIN_KEY));
    if (Number.isFinite(n)) return Math.max(CARD_MIN_LO, Math.min(CARD_MIN_HI, n));
  } catch { /* ignore */ }
  return CARD_MIN_DEFAULT;
}

interface DragState {
  sceneId: string;
  chapterId: string;
  storyId: string;
}

type DropTarget =
  | { kind: 'before'; chapterId: string; sceneId: string }
  | { kind: 'append'; chapterId: string }
  | { kind: 'part'; partId: string };

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
  /** Active beat-sheet template — drives the right-click assign menu (M14). */
  template: BeatTemplate;
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
  /** F1#3: create a chapter inside a specific part (empty-part drop / add). */
  onCreateChapterInPart?: (storyId: string, partId: string) => void;
  /** F1#3: move a chapter into another part (drag chapter onto part header). */
  onMoveChapterToPart?: (storyId: string, chapterId: string, targetPartId: string) => void;
  onBeatAssign: (sceneId: string, beatId: string | null) => void;
  announce: (msg: string) => void;
}

const ORDINAL_WORDS = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN'];

function partOrdinal(n: number): string {
  return n <= ORDINAL_WORDS.length ? ORDINAL_WORDS[n - 1] : String(n);
}

function isSimpleSinglePart(story: Story): boolean {
  return !story.parts || story.parts.length === 0 || (story.parts.length === 1 && story.parts[0].title === '');
}

/** Act of a beat id — searched across every template (ids are globally unique). */
function resolveBeatActId(beatId: string): string | null {
  return ALL_BEATS.find((b) => b.id === beatId)?.act ?? null;
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
  template,
  focusedBeatId,
  onSelectScene,
  onReorderScenes,
  onMoveScene,
  onCreateScene,
  onCreateChapterInPart,
  onMoveChapterToPart,
  onBeatAssign,
  announce,
}: SceneGridProps): ReactElement {
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [chapterDragId, setChapterDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [reorderState, setReorderState] = useState<ReorderState | null>(null);
  const [collapsedChapters, setCollapsedChapters] = useState<Set<string>>(new Set());
  const [cardMin, setCardMin] = useState(readCardMin);

  const handleDragStart = useCallback(
    (e: React.DragEvent, scene: Scene, chapter: Chapter) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', scene.id);
      setChapterDragId(null);
      setDragState({ sceneId: scene.id, chapterId: chapter.id, storyId: story.id });
    },
    [story.id],
  );

  const handleChapterDragStart = useCallback((e: React.DragEvent, chapterId: string) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', `chapter:${chapterId}`);
    setDragState(null);
    setChapterDragId(chapterId);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDragState(null);
    setChapterDragId(null);
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

  const handlePartDragOver = useCallback(
    (e: React.DragEvent, partId: string) => {
      if (!chapterDragId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDropTarget({ kind: 'part', partId });
    },
    [chapterDragId],
  );

  const handlePartDrop = useCallback(
    (e: React.DragEvent, partId: string) => {
      e.preventDefault();
      if (!chapterDragId || !onMoveChapterToPart) {
        setChapterDragId(null);
        setDropTarget(null);
        return;
      }
      onMoveChapterToPart(story.id, chapterDragId, partId);
      announce('Chapter moved to part');
      setChapterDragId(null);
      setDropTarget(null);
    },
    [chapterDragId, onMoveChapterToPart, story.id, announce],
  );

  const simple = isSimpleSinglePart(story);
  const hasAnyChapter =
    story.chapters.length > 0 ||
    (story.parts ?? []).some((p) => p.chapters.length > 0);
  const hasParts = !simple && (story.parts?.length ?? 0) > 0;

  // F1#3/#4: empty parts still render (header + empty drop zone).
  type ChapterEntry =
    | { kind: 'chapter'; partId?: string; partIdx?: number; chapter: Chapter; chapterIdx: number }
    | { kind: 'empty-part'; partId: string; partIdx: number; partTitle: string };
  const chapterEntries: ChapterEntry[] = simple
    ? story.chapters
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((chapter, chapterIdx) => ({ kind: 'chapter' as const, chapter, chapterIdx }))
    : (story.parts ?? [])
        .slice()
        .sort((a, b) => a.order - b.order)
        .flatMap((part, partIdx): ChapterEntry[] => {
          const chapters = part.chapters.slice().sort((a, b) => a.order - b.order);
          if (chapters.length === 0) {
            return [{ kind: 'empty-part', partId: part.id, partIdx, partTitle: part.title }];
          }
          return chapters.map((chapter, chapterIdx) => ({
            kind: 'chapter' as const,
            partId: part.id,
            partIdx,
            chapter,
            chapterIdx,
          }));
        });

  if (!hasAnyChapter && !hasParts) {
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
      style={{ ['--msv-card-min' as string]: `${cardMin}px` }}
      onClick={contextMenu ? closeContextMenu : undefined}
    >
      <div className="scene-grid__resize" data-testid="msv-card-resize">
        <label htmlFor="msv-card-min">
          Card size
          <input
            id="msv-card-min"
            type="range"
            min={CARD_MIN_LO}
            max={CARD_MIN_HI}
            step={8}
            value={cardMin}
            aria-valuetext={`${cardMin}px`}
            onChange={(e) => {
              const next = Number(e.target.value);
              setCardMin(next);
              try { localStorage.setItem(CARD_MIN_KEY, String(next)); } catch { /* ignore */ }
            }}
            data-testid="msv-card-min-slider"
          />
        </label>
        <button
          type="button"
          className="scene-grid__resize-reset"
          onClick={() => {
            setCardMin(CARD_MIN_DEFAULT);
            try { localStorage.setItem(CARD_MIN_KEY, String(CARD_MIN_DEFAULT)); } catch { /* ignore */ }
          }}
          data-testid="msv-card-min-reset"
        >
          {cardMin}px
        </button>
      </div>
      {chapterEntries.map((entry, entryIdx) => {
        if (entry.kind === 'empty-part') {
          const isPartDrop =
            dropTarget?.kind === 'part' && dropTarget.partId === entry.partId;
          return (
            <div key={`empty-${entry.partId}`} data-testid={`msv-struct-part-${entry.partId}`}>
              <div
                className={`msv-struct-part-header${isPartDrop ? ' msv-struct-part-header--drop' : ''}`}
                data-testid={`msv-struct-part-header-${entry.partId}`}
                onDragOver={(e) => handlePartDragOver(e, entry.partId)}
                onDrop={(e) => handlePartDrop(e, entry.partId)}
                onDragLeave={handleDragLeave}
              >
                PART {partOrdinal(entry.partIdx + 1)}
                {entry.partTitle ? `: ${entry.partTitle}` : ''}
              </div>
              <div className="msv-struct-part-empty" data-testid={`msv-struct-part-empty-${entry.partId}`}>
                <p>No chapters yet.</p>
                {onCreateChapterInPart && (
                  <button
                    type="button"
                    className="chapter-section__create-first"
                    onClick={() => onCreateChapterInPart(story.id, entry.partId)}
                    data-testid={`msv-struct-add-chapter-${entry.partId}`}
                  >
                    + Add chapter
                  </button>
                )}
              </div>
            </div>
          );
        }

        const { partId, partIdx, chapter, chapterIdx } = entry;
        const isFirstInPart =
          !simple &&
          partId !== undefined &&
          (entryIdx === 0 ||
            chapterEntries[entryIdx - 1].kind === 'empty-part' ||
            (chapterEntries[entryIdx - 1].kind === 'chapter' &&
              chapterEntries[entryIdx - 1].partId !== partId));
        const isCollapsed = collapsedChapters.has(chapter.id);
        const sortedScenes = [...chapter.scenes].sort((a, b) => a.order - b.order);
        const totalWords = computeChapterWords(chapter);
        const isChapterDropTarget =
          dropTarget?.kind === 'append' && dropTarget.chapterId === chapter.id;
        const isPartDrop =
          partId !== undefined &&
          dropTarget?.kind === 'part' &&
          dropTarget.partId === partId;

          return (
            <div key={`${partId ?? 'flat'}-${chapter.id}`}>
              {isFirstInPart && partIdx !== undefined && partId && (
                <div
                  className={`msv-struct-part-header${isPartDrop ? ' msv-struct-part-header--drop' : ''}`}
                  data-testid={`msv-struct-part-header-${partId}`}
                  onDragOver={(e) => handlePartDragOver(e, partId)}
                  onDrop={(e) => handlePartDrop(e, partId)}
                  onDragLeave={handleDragLeave}
                >
                  PART {partOrdinal(partIdx + 1)}
                </div>
              )}
            <section
              className={`chapter-section${isChapterDropTarget ? ' chapter-section--drop-target' : ''}`}
            >
              <div
                className="chapter-section__header"
                draggable={!!onMoveChapterToPart}
                onDragStart={(e) => handleChapterDragStart(e, chapter.id)}
                onDragEnd={handleDragEnd}
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
                <span className="chapter-section__eyebrow" aria-hidden="true">
                  CHAPTER {chapterIdx + 1}
                </span>
                <h2 className="chapter-section__title">{chapter.title}</h2>
                <span
                  className="chapter-section__meta"
                  aria-label={`${sortedScenes.length} scenes, ${totalWords.toLocaleString()} words`}
                >
                  {sortedScenes.length} scene{sortedScenes.length !== 1 ? 's' : ''} ·{' '}
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
                    sortedScenes.map((scene, sceneIdx) => {
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
                            sceneNumber={sceneIdx + 1}
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
            </div>
          );
        })}

      {contextMenu && (
        <BeatContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          sceneId={contextMenu.sceneId}
          template={template}
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
  /** Active beat-sheet template (M14 — menu lists its beats). */
  template: BeatTemplate;
  currentBeatId: string | null;
  onAssign: (beatId: string | null) => void;
  onClose: () => void;
}

function BeatContextMenu({
  x,
  y,
  template,
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
        {template.acts.flatMap((act) =>
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
