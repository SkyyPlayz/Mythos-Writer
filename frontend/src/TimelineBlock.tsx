// SKY-2461 — Single scene/event block for the StoryTimeline canvas.
//
// Two visual states: written (colored neon) and planned (greyscale/muted).
// Confidence indicator: ✓ at ≥80%, ? at <80%.
// Full ARIA, keyboard nav, and reduced-motion support.
import { useCallback } from 'react';
import './TimelineBlock.css';

export interface TimelineBlockProps {
  sceneId: string;
  sceneName: string;
  chapterNumber: number;
  timestamp: string;
  /** 0.0–1.0. ≥0.8 shows ✓; <0.8 shows ? */
  confidence: number;
  /** true = colored neon; false = greyscale muted */
  isWritten: boolean;
  isSelected?: boolean;
  onClick?: (sceneId: string) => void;
  onHover?: (sceneId: string, show: boolean) => void;
  /** CSS color override for written block accent. Defaults to --neon-violet. */
  storyAccentColor?: string;
  size?: 'compact' | 'default';
}

export default function TimelineBlock({
  sceneId,
  sceneName,
  chapterNumber,
  timestamp,
  confidence,
  isWritten,
  isSelected = false,
  onClick,
  onHover,
  storyAccentColor,
  size = 'default',
}: TimelineBlockProps) {
  const isHighConfidence = confidence >= 0.8;
  const confidenceIcon = isHighConfidence ? '✓' : '?';
  const confidencePct = Math.round(confidence * 100);

  const ariaLabel = `Scene: ${sceneName}, Chapter ${chapterNumber}, ${timestamp}, ${confidencePct}% confidence`;

  const handleClick = useCallback(() => {
    onClick?.(sceneId);
  }, [onClick, sceneId]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onClick?.(sceneId);
      }
    },
    [onClick, sceneId],
  );

  const handleMouseEnter = useCallback(() => {
    onHover?.(sceneId, true);
  }, [onHover, sceneId]);

  const handleMouseLeave = useCallback(() => {
    onHover?.(sceneId, false);
  }, [onHover, sceneId]);

  const rootClass = [
    'tb-root',
    `tb-root--${size}`,
    isWritten ? 'tb-root--written' : 'tb-root--planned',
    isSelected ? 'tb-root--selected' : null,
  ]
    .filter(Boolean)
    .join(' ');

  // Pass accent color as a CSS custom property so the stylesheet can use it
  // in color-mix() without needing inline style color-mix() calls.
  const accentStyle = storyAccentColor
    ? ({ '--tb-accent': storyAccentColor } as React.CSSProperties)
    : undefined;

  return (
    <div
      className={rootClass}
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-pressed={isSelected}
      data-testid="timeline-block"
      data-scene-id={sceneId}
      style={accentStyle}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <span
        className={`tb-confidence-badge${isHighConfidence ? ' tb-confidence-badge--high' : ' tb-confidence-badge--low'}`}
        aria-hidden="true"
        data-testid="confidence-badge"
      >
        {confidenceIcon}
      </span>
      <p className="tb-scene-name" title={sceneName}>
        {sceneName}
      </p>
      <p className="tb-timestamp">{timestamp}</p>
      <p className="tb-chapter">Ch. {chapterNumber}</p>
    </div>
  );
}
