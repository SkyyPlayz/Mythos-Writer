import { useState, useCallback, useEffect, useRef, type ReactElement } from 'react';
import { BookOpen, Pen } from 'lucide-react';
import type { Story, Scene, Chapter } from './types';
import { ViewToggle } from './components/ManuscriptStructure/ViewToggle';
import type { ManuscriptViewMode } from './components/ManuscriptStructure/ViewToggle';
import { SceneGrid } from './components/ManuscriptStructure/SceneGrid';
import { ListView } from './components/ManuscriptStructure/ListView';
import { BeatSheetSidebar } from './components/ManuscriptStructure/BeatSheetSidebar';
import type { BeatAssignments } from './components/ManuscriptStructure/BeatSheetSidebar';
import { useLiveAnnounce } from './hooks/useLiveAnnounce';
import './ManuscriptStructureView.css';

interface ManuscriptStructureViewProps {
  story: Story | null;
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
  onCreateChapter: (storyId: string) => void;
  /** Vault root used to scope beat assignment persistence */
  vaultRoot: string;
}

const STORAGE_KEY_VIEW_MODE = 'mythos-msv-view-mode-v1';

function loadViewMode(): ManuscriptViewMode {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_VIEW_MODE);
    if (saved === 'list' || saved === 'card') return saved;
  } catch {
    // localStorage unavailable
  }
  return 'card';
}

export default function ManuscriptStructureView({
  story,
  onSelectScene,
  onReorderScenes,
  onMoveScene,
  onCreateScene,
  onCreateChapter,
  vaultRoot,
}: ManuscriptStructureViewProps): ReactElement {
  const [viewMode, setViewMode] = useState<ManuscriptViewMode>(loadViewMode);
  const [beatAssignments, setBeatAssignments] = useState<BeatAssignments>({});
  const [focusedBeatId, setFocusedBeatId] = useState<string | null>(null);
  const { announce, liveText } = useLiveAnnounce();

  // ── Drag-and-drop undo (Ctrl+Z, 1+ levels) ──
  type UndoEntry =
    | { type: 'reorder'; storyId: string; chapterId: string; orderedIds: string[] }
    | { type: 'move'; storyId: string; sceneId: string; fromChapterId: string; toChapterId: string; insertBeforeSceneId: string | null };

  const undoStackRef = useRef<UndoEntry[]>([]);

  // Latest callback refs so the stable keydown handler never captures stale props
  const onReorderScenesRef = useRef(onReorderScenes);
  const onMoveSceneRef = useRef(onMoveScene);
  const announceRef = useRef(announce);
  useEffect(() => { onReorderScenesRef.current = onReorderScenes; });
  useEffect(() => { onMoveSceneRef.current = onMoveScene; });
  useEffect(() => { announceRef.current = announce; });

  // Intercept same-chapter reorders to snapshot before-state for undo
  const handleReorderScenes = useCallback(
    (storyId: string, chapterId: string, orderedIds: string[]) => {
      if (story) {
        const chapter = story.chapters.find((c) => c.id === chapterId);
        if (chapter) {
          const prevOrder = [...chapter.scenes]
            .sort((a, b) => a.order - b.order)
            .map((s) => s.id);
          undoStackRef.current = [
            ...undoStackRef.current,
            { type: 'reorder', storyId, chapterId, orderedIds: prevOrder },
          ];
        }
      }
      onReorderScenes(storyId, chapterId, orderedIds);
    },
    [story, onReorderScenes],
  );

  // Intercept cross-chapter moves to snapshot before-state for undo
  const handleMoveScene = useCallback(
    (
      storyId: string,
      sceneId: string,
      fromChapterId: string,
      toChapterId: string,
      insertBeforeSceneId: string | null,
    ) => {
      if (story) {
        const fromChapter = story.chapters.find((c) => c.id === fromChapterId);
        if (fromChapter) {
          const sortedFrom = [...fromChapter.scenes].sort((a, b) => a.order - b.order);
          const draggedIdx = sortedFrom.findIndex((s) => s.id === sceneId);
          const restoreInsertBefore =
            draggedIdx >= 0 && draggedIdx < sortedFrom.length - 1
              ? sortedFrom[draggedIdx + 1].id
              : null;
          undoStackRef.current = [
            ...undoStackRef.current,
            {
              type: 'move',
              storyId,
              sceneId,
              fromChapterId: toChapterId,
              toChapterId: fromChapterId,
              insertBeforeSceneId: restoreInsertBefore,
            },
          ];
        }
      }
      onMoveScene(storyId, sceneId, fromChapterId, toChapterId, insertBeforeSceneId);
    },
    [story, onMoveScene],
  );

  // Ctrl+Z / Cmd+Z: undo the last drag-and-drop reorder (required v1, min 1 level)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod || e.key !== 'z' || e.shiftKey) return;
      // Don't intercept undo when focus is inside a text-editing surface
      const target = e.target as HTMLElement;
      if (
        target.isContentEditable ||
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA'
      ) return;
      if (undoStackRef.current.length === 0) return;
      e.preventDefault();
      const entry = undoStackRef.current[undoStackRef.current.length - 1];
      undoStackRef.current = undoStackRef.current.slice(0, -1);
      if (entry.type === 'reorder') {
        onReorderScenesRef.current(entry.storyId, entry.chapterId, entry.orderedIds);
      } else {
        onMoveSceneRef.current(
          entry.storyId,
          entry.sceneId,
          entry.fromChapterId,
          entry.toChapterId,
          entry.insertBeforeSceneId,
        );
      }
      announceRef.current('Undo: scene order restored');
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []); // stable — all mutable state read from refs

  const handleViewModeChange = (mode: ManuscriptViewMode) => {
    setViewMode(mode);
    try {
      localStorage.setItem(STORAGE_KEY_VIEW_MODE, mode);
    } catch {
      // ignore
    }
  };

  const handleBeatAssign = useCallback(
    (sceneId: string, beatId: string | null) => {
      setBeatAssignments((prev) => {
        const next = { ...prev };
        if (beatId === null) {
          delete next[sceneId];
        } else {
          next[sceneId] = beatId;
        }
        try {
          localStorage.setItem(`mythos-beats-v1:${vaultRoot}`, JSON.stringify(next));
        } catch {
          // ignore
        }
        return next;
      });
    },
    [vaultRoot],
  );

  // Keyboard shortcut: Ctrl+1 → list, Ctrl+2 → card
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === '1') { e.preventDefault(); handleViewModeChange('list'); }
      if (e.key === '2') { e.preventDefault(); handleViewModeChange('card'); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  if (!story) {
    return (
      <div className="msv msv--no-story">
        <div className="msv__empty-state">
          <div className="msv__empty-icon" aria-hidden="true"><BookOpen size={40} /></div>
          <h2 className="msv__empty-title">Select a story to view its timeline.</h2>
        </div>
      </div>
    );
  }

  const hasScenes = story.chapters.some((ch) => ch.scenes.length > 0);

  return (
    <div className="msv" data-view={viewMode}>
      {/* ── Header (prototype 558–565: toggle · meta · spacer · hint) ── */}
      <div className="msv__header">
        <div className="msv__header-left">
          <ViewToggle mode={viewMode} onChange={handleViewModeChange} />
          <h1 className="msv__story-title">{story.title}</h1>
          <span className="msv__story-meta">
            {story.chapters.reduce((sum, ch) => sum + ch.scenes.length, 0)} scenes ·{' '}
            {story.chapters.length} chapter{story.chapters.length !== 1 ? 's' : ''} · grouped by
            chapter
          </span>
        </div>
        <div className="msv__header-right">
          <span className="msv__hint">Click a scene to open it in the editor</span>
          <button
            className="msv__add-chapter-btn"
            onClick={() => onCreateChapter(story.id)}
            aria-label="Add chapter"
            title="Add chapter"
          >
            + Chapter
          </button>
        </div>
      </div>

      {/* ── Main content area ── */}
      {!hasScenes && story.chapters.length === 0 ? (
        <div className="msv__empty-state">
          <div className="msv__empty-icon" aria-hidden="true"><Pen size={40} /></div>
          <h2 className="msv__empty-title">Create scenes in your story to see them here.</h2>
          <button
            className="msv__create-chapter-btn"
            onClick={() => onCreateChapter(story.id)}
          >
            + Create First Chapter
          </button>
          <div className="msv__beats-placeholder">
            <BeatSheetSidebar
              scenes={[]}
              vaultKey={vaultRoot}
              focusedBeatId={focusedBeatId}
              onBeatFocus={setFocusedBeatId}
              onAssignmentsChange={setBeatAssignments}
            />
          </div>
        </div>
      ) : (
        <div className="msv__body">
          {/* ── Fade-transition wrapper ── */}
          <div className="msv__content" aria-live="polite">
            {viewMode === 'card' ? (
              <SceneGrid
                story={story}
                beatAssignments={beatAssignments}
                focusedBeatId={focusedBeatId}
                onSelectScene={onSelectScene}
                onReorderScenes={handleReorderScenes}
                onMoveScene={handleMoveScene}
                onCreateScene={onCreateScene}
                onBeatAssign={handleBeatAssign}
                announce={announce}
              />
            ) : (
              <ListView
                story={story}
                beatAssignments={beatAssignments}
                focusedBeatId={focusedBeatId}
                onSelectScene={onSelectScene}
                onReorderScenes={handleReorderScenes}
                onCreateScene={onCreateScene}
                announce={announce}
              />
            )}
          </div>

          {/* ── Beat sheet sidebar ── */}
          <BeatSheetSidebar
            scenes={story.chapters.flatMap((ch) => ch.scenes)}
            vaultKey={vaultRoot}
            focusedBeatId={focusedBeatId}
            onBeatFocus={setFocusedBeatId}
            onAssignmentsChange={setBeatAssignments}
          />
        </div>
      )}

      {/* ── Screen reader live region ── */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {liveText}
      </div>
    </div>
  );
}
