import { useState } from 'react';
import type { Story, Chapter, Scene } from './types';
import './StoryNavigator.css';

interface Props {
  stories: Story[];
  selectedSceneId: string | null;
  onSelectScene: (scene: Scene, chapter: Chapter, story: Story) => void;
  onCreateStory: () => void;
  onCreateChapter: (storyId: string) => void;
  onCreateScene: (storyId: string, chapterId: string) => void;
  onReorderScenes?: (storyId: string, chapterId: string, orderedSceneIds: string[]) => void;
}

export default function StoryNavigator({
  stories,
  selectedSceneId,
  onSelectScene,
  onCreateStory,
  onCreateChapter,
  onCreateScene,
  onReorderScenes,
}: Props) {
  const [expandedStories, setExpandedStories] = useState<Set<string>>(new Set(stories.map((s) => s.id)));
  const [expandedChapters, setExpandedChapters] = useState<Set<string>>(
    new Set(stories.flatMap((s) => s.chapters.map((c) => c.id)))
  );
  const [draggedSceneId, setDraggedSceneId] = useState<string | null>(null);

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

  return (
    <nav className="story-navigator">
      <div className="nav-header">
        <span className="nav-title">Stories</span>
        <button className="nav-add-btn" onClick={onCreateStory} title="New story">+</button>
      </div>

      <div className="nav-tree">
        {stories.length === 0 && (
          <p className="nav-empty">No stories yet. Create one to begin.</p>
        )}

        {stories.map((story) => (
          <div key={story.id} className="nav-story">
            <div className="nav-story-row" onClick={() => toggleStory(story.id)}>
              <span className="nav-chevron">{expandedStories.has(story.id) ? '▾' : '▸'}</span>
              <span className="nav-story-title">{story.title}</span>
              <button
                className="nav-inline-add"
                onClick={(e) => { e.stopPropagation(); onCreateChapter(story.id); }}
                title="Add chapter"
              >+</button>
            </div>

            {expandedStories.has(story.id) &&
              story.chapters.sort((a, b) => a.order - b.order).map((chapter) => (
                <div key={chapter.id} className="nav-chapter">
                  <div className="nav-chapter-row" onClick={() => toggleChapter(chapter.id)}>
                    <span className="nav-chevron">{expandedChapters.has(chapter.id) ? '▾' : '▸'}</span>
                    <span className="nav-chapter-title">{chapter.title}</span>
                    <button
                      className="nav-inline-add"
                      onClick={(e) => { e.stopPropagation(); onCreateScene(story.id, chapter.id); }}
                      title="Add scene"
                    >+</button>
                  </div>

                  {expandedChapters.has(chapter.id) &&
                    [...chapter.scenes].sort((a, b) => a.order - b.order).map((scene) => (
                      <div
                        key={scene.id}
                        className={`nav-scene-row${selectedSceneId === scene.id ? ' active' : ''}`}
                        draggable
                        onDragStart={() => setDraggedSceneId(scene.id)}
                        onDragEnd={() => setDraggedSceneId(null)}
                        onDragOver={(e) => e.preventDefault()}
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
                      </div>
                    ))}
                </div>
              ))}
          </div>
        ))}
      </div>
    </nav>
  );
}
