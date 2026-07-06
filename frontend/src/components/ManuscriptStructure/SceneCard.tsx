import { useRef, useState, type ReactElement } from 'react';
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

/** First ~14 words of the first written block — prototype card synopsis (renderVals 4400). */
export function computeSynopsis(scene: Scene): string {
  const first = [...scene.blocks]
    .sort((a, b) => a.order - b.order)
    .find((b) => b.content.trim());
  if (!first) return '';
  const words = first.content.trim().split(/\s+/);
  return words.slice(0, 14).join(' ') + (words.length > 14 ? '…' : '');
}

export interface SceneCardProps {
  scene: Scene;
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
  const cardRef = useRef<HTMLElement>(null);
  const [dragHandleHeld, setDragHandleHeld] = useState(false);
  const pickupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const wordCount = computeWordCount(scene);
  const status = draftStateToStatus(scene.draftState);
  const synopsis = computeSynopsis(scene);

  const handleDragHandleMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    // 200ms pickup delay per spec
    pickupTimerRef.current = setTimeout(() => {
      setDragHandleHeld(true);
    }, 200);
  };

  const handleDragHandleMouseUp = () => {
    if (pickupTimerRef.current) {
      clearTimeout(pickupTimerRef.current);
      pickupTimerRef.current = null;
    }
    setDragHandleHeld(false);
  };

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
      ref={cardRef}
      className={classes}
      role="option"
      aria-label={`Scene: ${scene.title}, ${wordCount} words, ${status}`}
      aria-selected={false}
      tabIndex={0}
      draggable={dragHandleHeld}
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
        <span
          className="scene-card__drag-handle"
          aria-label="Drag to reorder"
          aria-grabbed={isDragging}
          role="button"
          tabIndex={-1}
          onMouseDown={handleDragHandleMouseDown}
          onMouseUp={handleDragHandleMouseUp}
          onMouseLeave={handleDragHandleMouseUp}
        >
          ⠿
        </span>
        <StatusChip status={status} />
      </div>
      <p className="scene-card__title">{scene.title}</p>
      {synopsis && <p className="scene-card__synopsis">{synopsis}</p>}
      <span className="scene-card__wordcount">
        {wordCount > 0 ? `${wordCount.toLocaleString()} words` : 'No words yet'}
      </span>
    </article>
  );
}
