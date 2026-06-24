import { Eye } from 'lucide-react';
import type { Scene, Chapter, Story } from './types';
import { PanelHeader } from './components/ui/PanelChrome';
import './ScenePreviewPanel.css';

interface Props {
  scene: Scene | null;
  chapter: Chapter | null;
  story: Story | null;
}

export default function ScenePreviewPanel({ scene, chapter, story }: Props) {
  const wordCount = scene
    ? scene.blocks
        .map((b) => b.content.trim().split(/\s+/).filter(Boolean).length)
        .reduce((a, b) => a + b, 0)
    : 0;

  const firstProse = scene?.blocks.find((b) => b.type === 'prose' && b.content.trim()) ?? null;

  return (
    <div className="scene-preview-root">
      <PanelHeader
        icon={<Eye size={14} aria-hidden="true" />}
        title="Scene Preview"
        subtitle={scene?.title}
      />
      {!scene ? (
        <div className="scene-preview-empty">
          <p>Select a scene to preview its details.</p>
        </div>
      ) : (
        <div className="scene-preview-panel">
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
      )}
    </div>
  );
}
