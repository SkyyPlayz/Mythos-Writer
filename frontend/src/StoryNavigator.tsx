import { useState, useEffect, useRef, useMemo } from 'react';
import type { Story, Chapter, Scene, Part } from './types';
import { countWords } from './wordStats';
import { draftStateLabel, isSimpleSinglePart, sceneStatus } from './story/manuscriptModel';
import { SCENE_NOTE_DRAG_MIME, type SceneNoteDragPayload } from './sceneNotes';
import './StoryNavigator.css';

interface Props {
  stories: Story[];
  selectedSceneId: string | null;
  onSelectScene: (scene: Scene, chapter: Chapter, story: Story) => void;
  onSelectStory?: (story: Story) => void;
  onCreateStory: () => void;
  onCreateChapter: (storyId: string) => void;
  onCreateScene: (storyId: string, chapterId: string) => void;
  onReorderScenes?: (storyId: string, chapterId: string, orderedSceneIds: string[]) => void;
  showTemplateCta?: boolean;
  onTemplateCtaClick?: () => void;
  onCreatePart?: () => void;
  /** M9b (SKY-9823): a scene note dropped anywhere on the navigator promotes it to the vault. */
  onPromoteSceneNote?: (payload: SceneNoteDragPayload) => void;
  /**
   * M6 (SKY-9022): a scene row's status dot cycles that scene's draftState —
   * same chain the editor's status chip uses. Without it the dot is a
   * read-only indicator.
   */
  onCycleSceneStatus?: (sceneId: string) => void;
  /**
   * M6 (SKY-9022): suppress the internal "Stories" header when an outer
   * wrapper (LeftRail's STORY NAVIGATOR zone) already provides one.
   */
  hideHeader?: boolean;
}

export default function StoryNavigator({
  stories,
  selectedSceneId,
  onSelectScene,
  onSelectStory,
  onCreateStory,
  onCreateChapter,
  onCreateScene,
  onReorderScenes,
  showTemplateCta = false,
  onTemplateCtaClick,
  onCreatePart: _onCreatePart,
  onPromoteSceneNote,
  onCycleSceneStatus,
  hideHeader = false,
}: Props) {
  const [expandedStories, setExpandedStories] = useState<Set<string>>(new Set(stories.map((s) => s.id)));
  const [expandedChapters, setExpandedChapters] = useState<Set<string>>(
    new Set(stories.flatMap((s) => s.chapters.map((c) => c.id)))
  );
  const [expandedParts, setExpandedParts] = useState<Set<string>>(
    new Set(stories.flatMap((s) => s.parts?.map((p) => p.id) ?? []))
  );
  const [draggedSceneId, setDraggedSceneId] = useState<string | null>(null);
  const [noteDropActive, setNoteDropActive] = useState(false);

  // M9b (SKY-9823): the whole navigator is one drop target for scene-note
  // drags (filtered by MIME so scene-reorder drags never hit this path).
  const isSceneNoteDrag = (e: React.DragEvent) =>
    !!onPromoteSceneNote && e.dataTransfer.types.includes(SCENE_NOTE_DRAG_MIME);

  const handleNoteDragOver = (e: React.DragEvent) => {
    if (!isSceneNoteDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setNoteDropActive(true);
  };

  const handleNoteDragLeave = (e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setNoteDropActive(false);
  };

  const handleNoteDrop = (e: React.DragEvent) => {
    setNoteDropActive(false);
    if (!isSceneNoteDrag(e)) return;
    e.preventDefault();
    let payload: SceneNoteDragPayload;
    try {
      payload = JSON.parse(e.dataTransfer.getData(SCENE_NOTE_DRAG_MIME));
    } catch {
      return;
    }
    if (!payload || typeof payload.sceneId !== 'string' || typeof payload.text !== 'string') return;
    onPromoteSceneNote?.(payload);
  };

  // Per-scene word count cache: only recomputes scenes whose block content changed
  const wordCountCacheRef = useRef<Map<string, { contentKey: string; count: number }>>(new Map());

  // sceneWordCounts recomputes when stories changes; the cache ensures only
  // the touched scene's words are recounted on each edit.
  const sceneWordCounts = useMemo<Map<string, number>>(() => {
    const result = new Map<string, number>();

    const processChapter = (chapter: Chapter) => {
      for (const scene of chapter.scenes) {
        if (result.has(scene.id)) continue; // deduplicate
        const contentKey = scene.blocks.map((b) => b.content).join('\x00');
        const cached = wordCountCacheRef.current.get(scene.id);
        let count: number;
        if (cached?.contentKey === contentKey) {
          count = cached.count;
        } else {
          count = scene.blocks.reduce((sum, b) => sum + countWords(b.content), 0);
          wordCountCacheRef.current.set(scene.id, { contentKey, count });
        }
        result.set(scene.id, count);
      }
    };

    for (const story of stories) {
      for (const chapter of story.chapters) {
        processChapter(chapter);
      }
      for (const part of story.parts ?? []) {
        for (const chapter of part.chapters) {
          processChapter(chapter);
        }
      }
    }
    return result;
  }, [stories]);

  // Auto-expand newly created stories/chapters so their children are visible
  // immediately (otherwise a just-created chapter/scene stays hidden under a
  // collapsed parent). Only acts on ids not seen before, so user collapses stick.
  const seenStoryIds = useRef<Set<string>>(new Set(stories.map((s) => s.id)));
  const seenChapterIds = useRef<Set<string>>(
    new Set(stories.flatMap((s) => s.chapters.map((c) => c.id)))
  );
  useEffect(() => {
    const newStoryIds = stories
      .map((s) => s.id)
      .filter((id) => !seenStoryIds.current.has(id));
    const newChapterIds = stories
      .flatMap((s) => s.chapters.map((c) => c.id))
      .filter((id) => !seenChapterIds.current.has(id));
    if (newStoryIds.length) {
      setExpandedStories((prev) => {
        const next = new Set(prev);
        newStoryIds.forEach((id) => next.add(id));
        return next;
      });
      newStoryIds.forEach((id) => seenStoryIds.current.add(id));
    }
    if (newChapterIds.length) {
      setExpandedChapters((prev) => {
        const next = new Set(prev);
        newChapterIds.forEach((id) => next.add(id));
        return next;
      });
      newChapterIds.forEach((id) => seenChapterIds.current.add(id));
    }
  }, [stories]);

  // M6 (SKY-9022): reveal the active scene — scenes opened elsewhere (graph,
  // timeline, palette, doc tabs…) expand their story/part/chapter so the
  // `.active` row is visible. Additive and ref-guarded per selection change,
  // so the user can still deliberately collapse the active scene's chapter.
  const lastRevealedSceneIdRef = useRef<string | null>(null);
  const activeSceneRowRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!selectedSceneId || lastRevealedSceneIdRef.current === selectedSceneId) return;
    for (const story of stories) {
      const chapterSlots: Array<{ chapter: Chapter; partId?: string }> = isSimpleSinglePart(story)
        ? story.chapters.map((chapter) => ({ chapter }))
        : (story.parts ?? []).flatMap((part) => part.chapters.map((chapter) => ({ chapter, partId: part.id })));
      for (const { chapter, partId } of chapterSlots) {
        if (!chapter.scenes.some((sc) => sc.id === selectedSceneId)) continue;
        lastRevealedSceneIdRef.current = selectedSceneId;
        setExpandedStories((prev) => (prev.has(story.id) ? prev : new Set(prev).add(story.id)));
        setExpandedChapters((prev) => (prev.has(chapter.id) ? prev : new Set(prev).add(chapter.id)));
        if (partId) setExpandedParts((prev) => (prev.has(partId) ? prev : new Set(prev).add(partId)));
        return;
      }
    }
  }, [selectedSceneId, stories]);

  // Scroll the revealed row into view once it exists in the DOM (the reveal
  // above may only expand it on this same commit). No smooth behavior —
  // 'auto' is instant, so prefers-reduced-motion is respected by default.
  const lastScrolledSceneIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedSceneId || lastScrolledSceneIdRef.current === selectedSceneId) return;
    const row = activeSceneRowRef.current;
    if (!row) return;
    lastScrolledSceneIdRef.current = selectedSceneId;
    row.scrollIntoView?.({ block: 'nearest' });
  }, [selectedSceneId, stories, expandedStories, expandedChapters, expandedParts]);

  const toggleStory = (id: string) =>
    setExpandedStories((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const toggleChapter = (id: string) =>
    setExpandedChapters((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const togglePart = (id: string) =>
    setExpandedParts((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const handleSceneKeyDown = (
    e: React.KeyboardEvent,
    scene: Scene,
    chapter: Chapter,
    story: Story,
    sortedScenes: Scene[]
  ) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelectScene(scene, chapter, story);
      return;
    }
    const idx = sortedScenes.findIndex((s) => s.id === scene.id);
    if (e.key === 'ArrowUp' && idx > 0) {
      e.preventDefault();
      const reordered = sortedScenes.map((s) => s.id);
      reordered.splice(idx, 1);
      reordered.splice(idx - 1, 0, scene.id);
      onReorderScenes?.(story.id, chapter.id, reordered);
    } else if (e.key === 'ArrowDown' && idx < sortedScenes.length - 1) {
      e.preventDefault();
      const reordered = sortedScenes.map((s) => s.id);
      reordered.splice(idx, 1);
      reordered.splice(idx + 1, 0, scene.id);
      onReorderScenes?.(story.id, chapter.id, reordered);
    }
  };

  // M6 (SKY-9022): status dot per prototype row anatomy (proto 5895) — a real
  // button when cycling is wired, a read-only indicator otherwise. Status
  // vocabulary maps through sceneStatus (todo/draft/done).
  const renderStatusDot = (scene: Scene) => {
    const status = sceneStatus(scene);
    if (!onCycleSceneStatus) {
      return (
        <span
          className={`nav-status-dot nav-status-dot--${status}`}
          role="img"
          aria-label={`Scene status: ${draftStateLabel(scene.draftState)}`}
        />
      );
    }
    return (
      <button
        type="button"
        className={`nav-status-dot nav-status-dot--${status}`}
        title="Click to cycle status"
        aria-label={`Scene status: ${draftStateLabel(scene.draftState)} — click to cycle`}
        onClick={(e) => { e.stopPropagation(); onCycleSceneStatus(scene.id); }}
        onKeyDown={(e) => e.stopPropagation()}
      />
    );
  };

  return (
    <nav
      className={`story-navigator${noteDropActive ? ' story-navigator--note-drop' : ''}`}
      onDragOver={handleNoteDragOver}
      onDragLeave={handleNoteDragLeave}
      onDrop={handleNoteDrop}
    >
      {!hideHeader && (
        <div className="nav-header">
          <span className="nav-title">Stories</span>
          <button className="nav-add-btn" onClick={onCreateStory} aria-label="New story" title="New story">+</button>
        </div>
      )}

      <div className="nav-tree">
        {stories.length === 0 && (
          <div className="nav-empty">
            <p>No stories yet.</p>
            <button
              className="nav-empty-cta"
              onClick={onCreateStory}
              data-testid="nav-empty-cta"
            >
              New Story
            </button>
          </div>
        )}

        {stories.map((story) => {
          const allChapters = isSimpleSinglePart(story)
            ? story.chapters
            : (story.parts ?? []).flatMap((p) => p.chapters);
          const storyWordCount = allChapters.reduce(
            (sum, ch) => sum + ch.scenes.reduce((s, sc) => s + (sceneWordCounts.get(sc.id) ?? 0), 0),
            0,
          );
          return (
          <div key={story.id} className="nav-story">
            <div className="nav-story-row">
              <button
                className="nav-story-toggle"
                aria-expanded={expandedStories.has(story.id)}
                onClick={() => toggleStory(story.id)}
              >
                <span className="nav-chevron">{expandedStories.has(story.id) ? '▾' : '▸'}</span>
                <span
                  className="nav-story-title"
                  onClick={(e) => { e.stopPropagation(); onSelectStory?.(story); }}
                >
                  {story.title}
                </span>
              </button>
              {storyWordCount > 0 && (
                <span className="nav-wordcount" aria-label={`${storyWordCount.toLocaleString()} words`}>
                  {storyWordCount.toLocaleString()}
                </span>
              )}
              <button
                className="nav-inline-add"
                onClick={(e) => { e.stopPropagation(); onCreateChapter(story.id); }}
                aria-label="Add chapter"
                title="Add chapter"
              >+</button>
            </div>

            {expandedStories.has(story.id) && isSimpleSinglePart(story) &&
              [...story.chapters].sort((a, b) => a.order - b.order).map((chapter) => {
                const chapterWordCount = chapter.scenes.reduce(
                  (sum, sc) => sum + (sceneWordCounts.get(sc.id) ?? 0),
                  0,
                );
                return (
                <div key={chapter.id} className="nav-chapter">
                  <div className="nav-chapter-row">
                    <button
                      className="nav-chapter-toggle"
                      aria-expanded={expandedChapters.has(chapter.id)}
                      onClick={() => toggleChapter(chapter.id)}
                    >
                      <span className="nav-chevron">{expandedChapters.has(chapter.id) ? '▾' : '▸'}</span>
                      <span className="nav-chapter-title">{chapter.title}</span>
                    </button>
                    {chapterWordCount > 0 && (
                      <span className="nav-wordcount" aria-label={`${chapterWordCount.toLocaleString()} words`}>
                        {chapterWordCount.toLocaleString()}
                      </span>
                    )}
                    <button
                      className="nav-inline-add"
                      onClick={(e) => { e.stopPropagation(); onCreateScene(story.id, chapter.id); }}
                      aria-label="Add scene"
                      title="Add scene"
                    >+</button>
                  </div>

                  {expandedChapters.has(chapter.id) && (() => {
                    const sortedScenes = [...chapter.scenes].sort((a, b) => a.order - b.order);
                    return sortedScenes.map((scene, sceneIdx) => {
                      const sceneWC = sceneWordCounts.get(scene.id) ?? 0;
                      return (
                      <div
                        key={scene.id}
                        ref={(el) => { if (selectedSceneId === scene.id) activeSceneRowRef.current = el; }}
                        className={`nav-scene-row${selectedSceneId === scene.id ? ' active' : ''}`}
                        role="button"
                        tabIndex={0}
                        aria-current={selectedSceneId === scene.id ? 'true' : undefined}
                        aria-label={`${scene.title}${onReorderScenes ? ' — use Up/Down arrow keys to reorder' : ''}`}
                        draggable
                        onDragStart={() => setDraggedSceneId(scene.id)}
                        onDragEnd={() => setDraggedSceneId(null)}
                        onDragOver={(e) => e.preventDefault()}
                        onKeyDown={(e) => handleSceneKeyDown(e, scene, chapter, story, sortedScenes)}
                        onDrop={() => {
                          if (!draggedSceneId || draggedSceneId === scene.id) return;
                          const orderedSceneIds = [...chapter.scenes]
                            .sort((a, b) => a.order - b.order)
                            .map((s) => s.id);
                          const sourceIndex = orderedSceneIds.indexOf(draggedSceneId);
                          const targetIndex = orderedSceneIds.indexOf(scene.id);
                          if (sourceIndex === -1 || targetIndex === -1) return;

                          orderedSceneIds.splice(sourceIndex, 1);
                          orderedSceneIds.splice(targetIndex, 0, draggedSceneId);
                          onReorderScenes?.(story.id, chapter.id, orderedSceneIds);
                          setDraggedSceneId(null);
                        }}
                        onClick={() => onSelectScene(scene, chapter, story)}
                      >
                        <span className="nav-scene-icon">◆</span>
                        <span className="nav-scene-title">{`Scene ${sceneIdx + 1} · ${scene.title}`}</span>
                        {sceneWC > 0 && (
                          <span className="nav-wordcount" aria-label={`${sceneWC.toLocaleString()} words`}>
                            {sceneWC.toLocaleString()}
                          </span>
                        )}
                        {renderStatusDot(scene)}
                      </div>
                    )});
                  })()}
                </div>
              )})}

            {expandedStories.has(story.id) && !isSimpleSinglePart(story) &&
              [...(story.parts ?? [])].sort((a, b) => a.order - b.order).map((part: Part, partIdx) => (
                <div key={part.id} className="nav-part">
                  <div className="nav-part-row">
                    <button
                      className="nav-part-toggle"
                      aria-expanded={expandedParts.has(part.id)}
                      onClick={() => togglePart(part.id)}
                    >
                      <span className="nav-chevron">{expandedParts.has(part.id) ? '▾' : '▸'}</span>
                      <span className="nav-part-label">
                        {part.title ? `Part ${partIdx + 1}: ${part.title}` : `Part ${partIdx + 1}`}
                      </span>
                    </button>
                  </div>
                  {expandedParts.has(part.id) &&
                    [...part.chapters].sort((a, b) => a.order - b.order).map((chapter) => {
                      const chapterWordCount = chapter.scenes.reduce(
                        (sum, sc) => sum + (sceneWordCounts.get(sc.id) ?? 0),
                        0,
                      );
                      return (
                        <div key={chapter.id} className="nav-chapter">
                          <div className="nav-chapter-row">
                            <button
                              className="nav-chapter-toggle"
                              aria-expanded={expandedChapters.has(chapter.id)}
                              onClick={() => toggleChapter(chapter.id)}
                            >
                              <span className="nav-chevron">{expandedChapters.has(chapter.id) ? '▾' : '▸'}</span>
                              <span className="nav-chapter-title">{chapter.title}</span>
                            </button>
                            {chapterWordCount > 0 && (
                              <span className="nav-wordcount" aria-label={`${chapterWordCount.toLocaleString()} words`}>
                                {chapterWordCount.toLocaleString()}
                              </span>
                            )}
                            <button
                              className="nav-inline-add"
                              onClick={(e) => { e.stopPropagation(); onCreateScene(story.id, chapter.id); }}
                              aria-label="Add scene"
                              title="Add scene"
                            >+</button>
                          </div>
                          {expandedChapters.has(chapter.id) && (() => {
                            const sortedScenes = [...chapter.scenes].sort((a, b) => a.order - b.order);
                            return sortedScenes.map((scene, sceneIdx) => {
                              const sceneWC = sceneWordCounts.get(scene.id) ?? 0;
                              return (
                                <div
                                  key={scene.id}
                                  ref={(el) => { if (selectedSceneId === scene.id) activeSceneRowRef.current = el; }}
                                  className={`nav-scene-row${selectedSceneId === scene.id ? ' active' : ''}`}
                                  role="button"
                                  tabIndex={0}
                                  aria-current={selectedSceneId === scene.id ? 'true' : undefined}
                                  aria-label={`${scene.title}${onReorderScenes ? ' — use Up/Down arrow keys to reorder' : ''}`}
                                  draggable
                                  onDragStart={() => setDraggedSceneId(scene.id)}
                                  onDragEnd={() => setDraggedSceneId(null)}
                                  onDragOver={(e) => e.preventDefault()}
                                  onKeyDown={(e) => handleSceneKeyDown(e, scene, chapter, story, sortedScenes)}
                                  onDrop={() => {
                                    if (!draggedSceneId || draggedSceneId === scene.id) return;
                                    const orderedSceneIds = [...chapter.scenes]
                                      .sort((a, b) => a.order - b.order)
                                      .map((s) => s.id);
                                    const sourceIndex = orderedSceneIds.indexOf(draggedSceneId);
                                    const targetIndex = orderedSceneIds.indexOf(scene.id);
                                    if (sourceIndex === -1 || targetIndex === -1) return;
                                    orderedSceneIds.splice(sourceIndex, 1);
                                    orderedSceneIds.splice(targetIndex, 0, draggedSceneId);
                                    onReorderScenes?.(story.id, chapter.id, orderedSceneIds);
                                    setDraggedSceneId(null);
                                  }}
                                  onClick={() => onSelectScene(scene, chapter, story)}
                                >
                                  <span className="nav-scene-icon">◆</span>
                                  <span className="nav-scene-title">{`Scene ${sceneIdx + 1} · ${scene.title}`}</span>
                                  {sceneWC > 0 && (
                                    <span className="nav-wordcount" aria-label={`${sceneWC.toLocaleString()} words`}>
                                      {sceneWC.toLocaleString()}
                                    </span>
                                  )}
                                  {renderStatusDot(scene)}
                                </div>
                              );
                            });
                          })()}
                        </div>
                      );
                    })}
                </div>
              ))}
          </div>
        )})}
      </div>
      {showTemplateCta && onTemplateCtaClick && (
        <button
          className="vs-template-cta"
          onClick={onTemplateCtaClick}
          data-testid="vs-template-cta"
          aria-label="Start from a template"
        >
          Start from a template →
        </button>
      )}
    </nav>
  );
}
