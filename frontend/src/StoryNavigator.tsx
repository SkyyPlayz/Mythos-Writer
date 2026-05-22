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
}

export default function StoryNavigator({
  stories,
  selectedSceneId,
  onSelectScene,
  onCreateStory,
  onCreateChapter,
  onCreateScene,
}: Props) {
  const [expandedStories, setExpandedStories] = useState<Set<string>>(new Set(stories.map((s) => s.id)));
  const [expandedChapters, setExpandedChapters] = useState<Set<string>>(
    new Set(stories.flatMap((s) => s.chapters.map((c) => c.id)))
  );

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
                    chapter.scenes.sort((a, b) => a.order - b.order).map((scene) => (
                      <div
                        key={scene.id}
                        className={`nav-scene-row${selectedSceneId === scene.id ? ' active' : ''}`}
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
