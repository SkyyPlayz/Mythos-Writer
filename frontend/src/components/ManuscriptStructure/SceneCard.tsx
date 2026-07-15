// Scene card — Beta 4 M14 refresh (FULL-SPEC §5.3).
//
// Prototype: "Mythos Writer - Liquid Neon.dc.html" 786–792 (grid card:
// status chip · spacer · POV, "Scene N · title", italic Lora synopsis,
// "1,500 words") + renderVals 6360–6369 (card st: cursor grab, whole card
// drags; hover lifts −2px with slot-1 rim).
//
// M14 change vs Beta 3: the WHOLE card is the drag handle (prototype
// cursor:grab) — the 6-dot grip and its 200 ms pickup delay are gone.
// Keyboard reorder (Space → arrows) is unchanged.

import { type ReactElement } from 'react';
import type { Scene } from '../../types';
import { StatusChip, draftStateToStatus } from './StatusBadge';
import './SceneCard.css';

export function computeWordCount(scene: Scene): number {
  return scene.blocks.reduce((sum, block) => {
    const text = block.content.trim();
    if (!text) return sum;
    return sum + text.split(/\s+/).length;
  }, 0);
}

/** First ~14 words of the first written block — prototype card synopsis (6363). */
export function computeSynopsis(scene: Scene): string {
  const first = [...scene.blocks]
    .sort((a, b) => a.order - b.order)
    .find((b) => b.content.trim());
  if (!first) return '';
  const words = first.content.trim().split(/\s+/);
  return words.slice(0, 14).join(' ') + (words.length > 14 ? '…' : '');
}

/** Scene POV label (prototype card top-right, e.g. "POV Mira"). */
export function scenePov(scene: Scene): string | null {
  const pov = scene.timelineMetadata?.pov?.trim();
  return pov ? `POV ${pov}` : null;
}

export interface SceneCardProps {
  scene: Scene;
  /** 1-based position within the chapter — prototype "Scene N · <title>". */
  sceneNumber: number;
  /** Beat color class applied as a tint when the scene has a beat assignment */
  beatActId?: string | null;
  isDragging?: boolean;
  isDragOver?: boolean;
  /** Keyboard reorder mode is active */
  isReordering?: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  /** Space pressed → enter keyboard reorder mode */
  onReorderStart: () => void;
}

export function SceneCard({
  scene,
  sceneNumber,
  beatActId,
  isDragging,
  isDragOver,
  isReordering,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  onClick,
  onContextMenu,
  onReorderStart,
}: SceneCardProps): ReactElement {
  const wordCount = computeWordCount(scene);
  const status = draftStateToStatus(scene.draftState);
  const synopsis = computeSynopsis(scene);
  const pov = scenePov(scene);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === ' ') {
      e.preventDefault();
      onReorderStart();
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      onClick();
    }
  };

  const classes = [
    'scene-card',
    isDragging ? 'scene-card--dragging' : '',
    isDragOver ? 'scene-card--drag-over' : '',
    isReordering ? 'scene-card--reordering' : '',
    beatActId ? `scene-card--beat-${beatActId}` : '',
    status === 'cut' ? 'scene-card--cut' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <article
      className={classes}
      role="option"
      aria-label={`Scene: ${scene.title}, ${wordCount} words, ${status}`}
      aria-selected={false}
      tabIndex={0}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onKeyDown={handleKeyDown}
    >
      <div className="scene-card__header">
        <StatusChip status={status} />
        {pov && <span className="scene-card__pov">{pov}</span>}
      </div>
      <p className="scene-card__title">Scene {sceneNumber} · {scene.title}</p>
      {synopsis && <p className="scene-card__synopsis">{synopsis}</p>}
      <span className="scene-card__wordcount">
        {wordCount > 0 ? `${wordCount.toLocaleString()} words` : 'No words yet'}
      </span>
    </article>
  );
}
