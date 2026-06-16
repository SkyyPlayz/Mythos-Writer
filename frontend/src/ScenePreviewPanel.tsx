import type { Scene, Chapter, Story } from './types';
import './ScenePreviewPanel.css';

interface Props {
  scene: Scene | null;
  chapter: Chapter | null;
  story: Story | null;
}

export default function ScenePreviewPanel({ scene, chapter, story }: Props) {
  if (!scene) {
    return (
      <div className="scene-preview-empty">
        <p>Select a scene to preview its details.</p>
      </div>
    );
  }

  const wordCount = scene.blocks
    .map((b) => b.content.trim().split(/\s+/).filter(Boolean).length)
    .reduce((a, b) => a + b, 0);

  const firstProse = scene.blocks.find((b) => b.type === 'prose' && b.content.trim());

  return (
    <div className="scene-preview-panel">
      <div className="scene-preview-title">{scene.title}</div>
      {story && chapter && (
        <div className="scene-preview-breadcrumb">
          {story.title} › {chapter.title}
        </div>
      )}
      <div className="scene-preview-meta">
        <span className="scene-preview-words">{wordCount.toLocaleString()} words</span>
        {scene.draftState && (
          <span className={`scene-preview-draft draft-${scene.draftState}`}>{scene.draftState}</span>
        )}
      </div>
      {firstProse && (
        <p className="scene-preview-excerpt">
          {firstProse.content.trim().slice(0, 200)}
          {firstProse.content.trim().length > 200 ? '…' : ''}
        </p>
      )}
    </div>
  );
}
