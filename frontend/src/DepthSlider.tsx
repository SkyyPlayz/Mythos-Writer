import { useEffect } from 'react';
import './DepthSlider.css';

export type ViewDepth = 'book' | 'chapter' | 'scene';
type WritingMode = 'normal' | 'focus' | 'edit';

const POSITIONS: { value: ViewDepth; label: string }[] = [
  { value: 'book', label: 'Full Book' },
  { value: 'chapter', label: 'Chapter' },
  { value: 'scene', label: 'Scene' },
];

export interface DepthSliderProps {
  depth: ViewDepth;
  onDepthChange: (depth: ViewDepth) => void;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  contextLabel: string;
  /** §4: writing mode — Focus applies visual de-emphasis */
  writingMode?: WritingMode;
  /** §6: show loading skeleton while manifest is indexing */
  isLoading?: boolean;
  /** §6: show empty message when depth=scene but chapter has no scenes */
  isEmpty?: boolean;
}

export default function DepthSlider({
  depth,
  onDepthChange,
  canPrev,
  canNext,
  onPrev,
  onNext,
  contextLabel,
  writingMode = 'normal',
  isLoading = false,
  isEmpty = false,
}: DepthSliderProps) {
  // §7: keyboard shortcuts — Ctrl/Cmd+Alt+↑↓ switches depth, ←→ steps siblings
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod || !e.altKey) return;
      const idx = POSITIONS.findIndex((p) => p.value === depth);
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (idx > 0) onDepthChange(POSITIONS[idx - 1].value);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (idx < POSITIONS.length - 1) onDepthChange(POSITIONS[idx + 1].value);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (canPrev) onPrev();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (canNext) onNext();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [depth, canPrev, canNext, onDepthChange, onPrev, onNext]);

  if (isLoading) {
    return (
      <div
        className="depth-slider-bar"
        data-writing-mode={writingMode}
        data-testid="depth-slider"
        aria-busy="true"
      >
        <div className="depth-slider-skeleton" aria-label="Loading navigation">
          <div className="depth-slider-skeleton-pill" />
          <div className="depth-slider-skeleton-pill depth-slider-skeleton-pill--wide" />
        </div>
      </div>
    );
  }

  return (
    <div className="depth-slider-bar" data-writing-mode={writingMode} data-testid="depth-slider">
      <button
        className="depth-nav-btn"
        onClick={onPrev}
        disabled={!canPrev}
        aria-label="Previous"
        title="Previous (Ctrl+Alt+←)"
      >
        ‹
      </button>

      <div className="depth-slider-track" role="group" aria-label="View depth">
        {POSITIONS.map((pos) => (
          <button
            key={pos.value}
            className={`depth-slider-btn${depth === pos.value ? ' active' : ''}`}
            onClick={() => onDepthChange(pos.value)}
            aria-pressed={depth === pos.value}
          >
            {pos.label}
          </button>
        ))}
        <div
          className="depth-slider-indicator"
          aria-hidden="true"
          style={{ left: `${(POSITIONS.findIndex((p) => p.value === depth) / (POSITIONS.length - 1)) * 100}%` }}
        />
      </div>

      <button
        className="depth-nav-btn"
        onClick={onNext}
        disabled={!canNext}
        aria-label="Next"
        title="Next (Ctrl+Alt+→)"
      >
        ›
      </button>

      {isEmpty ? (
        <span className="depth-empty-msg" role="status">No scenes in this chapter</span>
      ) : (
        <span className="depth-context-label">{contextLabel}</span>
      )}
    </div>
  );
}
