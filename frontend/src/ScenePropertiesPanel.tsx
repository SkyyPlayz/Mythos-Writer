import type { Scene, Story, Chapter } from './types';
import DraftHistoryPanel from './DraftHistoryPanel';
import './ScenePropertiesPanel.css';

interface Props {
  scene: Scene | null;
  chapter: Chapter | null;
  story: Story | null;
  currentContent?: string;
  onDraftRestore?: (content: string) => void;
}

export default function ScenePropertiesPanel({ scene, chapter, story, currentContent, onDraftRestore }: Props) {
  if (!scene || !chapter || !story) {
    return (
      <div className="spp-empty">
        <div className="spp-empty-icon" aria-hidden="true">🏷️</div>
        <p>Select a scene to see its properties.</p>
        <p className="spp-empty-sub">Word count, draft state, creation date, and more.</p>
      </div>
    );
  }

  const wordCount = scene.blocks
    .map((b) => b.content.trim().split(/\s+/).filter(Boolean).length)
    .reduce((a, b) => a + b, 0);

  const blocksByType = scene.blocks.reduce<Record<string, number>>((acc, b) => {
    acc[b.type] = (acc[b.type] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <>
      <div className="spp-root">
        <div className="spp-group">
          <div className="spp-label">Scene</div>
          <div className="spp-value spp-title">{scene.title}</div>
        </div>
        <div className="spp-row">
          <div className="spp-group">
            <div className="spp-label">Story</div>
            <div className="spp-value">{story.title}</div>
          </div>
          <div className="spp-group">
            <div className="spp-label">Chapter</div>
            <div className="spp-value">{chapter.title}</div>
          </div>
        </div>
        <div className="spp-row">
          <div className="spp-group">
            <div className="spp-label">Words</div>
            <div className="spp-value spp-stat">{wordCount.toLocaleString()}</div>
          </div>
          <div className="spp-group">
            <div className="spp-label">Blocks</div>
            <div className="spp-value spp-stat">{scene.blocks.length}</div>
          </div>
        </div>
        <div className="spp-group">
          <div className="spp-label">Draft state</div>
          <div className={`spp-value spp-draft spp-draft--${scene.draftState ?? 'in-progress'}`}>
            {scene.draftState ?? 'in-progress'}
          </div>
        </div>
        {Object.keys(blocksByType).length > 0 && (
          <div className="spp-group">
            <div className="spp-label">Block breakdown</div>
            <div className="spp-breakdown">
              {Object.entries(blocksByType).map(([type, count]) => (
                <span key={type} className="spp-breakdown-item">
                  {type}: {count}
                </span>
              ))}
            </div>
          </div>
        )}
        <div className="spp-group">
          <div className="spp-label">Last updated</div>
          <div className="spp-value spp-date">{new Date(scene.updatedAt).toLocaleString()}</div>
        </div>
        <div className="spp-group">
          <div className="spp-label">Created</div>
          <div className="spp-value spp-date">{new Date(scene.createdAt).toLocaleString()}</div>
        </div>
      </div>
      {currentContent !== undefined && onDraftRestore && (
        <DraftHistoryPanel
          sceneId={scene.id}
          currentContent={currentContent}
          onRestore={onDraftRestore}
        />
      )}
    </>
  );
}
