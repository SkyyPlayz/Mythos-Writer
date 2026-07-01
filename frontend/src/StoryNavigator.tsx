import { useState, useEffect, useRef, useMemo } from 'react';
import type { Story, Chapter, Scene } from './types';
import { countWords } from './wordStats';
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
}: Props) {
  const [expandedStories, setExpandedStories] = useState<Set<string>>(new Set(stories.map((s) => s.id)));
  const [expandedChapters, setExpandedChapters] = useState<Set<string>>(
    new Set(stories.flatMap((s) => s.chapters.map((c) => c.id)))
  );
  const [draggedSceneId, setDraggedSceneId] = useState<string | null>(null);

  // Per-scene word count cache: only recomputes scenes whose block content changed
  const wordCountCacheRef = useRef<Map<string, { contentKey: string; count: number }>>(new Map());

  // sceneWordCounts recomputes when stories changes; the cache ensures only
  // the touched scene's words are recounted on each edit.
  const sceneWordCounts = useMemo<Map<string, number>>(() => {
    const result = new Map<string, number>();
    for (const story of stories) {
      for (const chapter of story.chapters) {
        for (const scene of chapter.scenes) {
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

  return (
    <nav className="story-navigator">
      <div className="nav-header">
        <span className="nav-title">Stories</span>
        <button className="nav-add-btn" onClick={onCreateStory} aria-label="New story" title="New story">+</button>
      </div>

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
          const storyWordCount = story.chapters.reduce(
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

            {expandedStories.has(story.id) &&
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
                    return sortedScenes.map((scene) => {
                      const sceneWC = sceneWordCounts.get(scene.id) ?? 0;
                      return (
                      <div
                        key={scene.id}
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
                        <span className="nav-scene-title">{scene.title}</span>
                        {scene.draftState && scene.draftState !== 'in-progress' && (
                          <span className={`nav-draft-badge draft-${scene.draftState}`}>
                            {scene.draftState}
                          </span>
                        )}
                        {sceneWC > 0 && (
                          <span className="nav-wordcount" aria-label={`${sceneWC.toLocaleString()} words`}>
                            {sceneWC.toLocaleString()}
                          </span>
                        )}
                      </div>
                    )});
                  })()}
                </div>
              )})}
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
