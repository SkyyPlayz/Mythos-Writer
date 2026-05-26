import './DepthSlider.css';

export type ViewDepth = 'book' | 'chapter' | 'scene';

const POSITIONS: { value: ViewDepth; label: string }[] = [
  { value: 'book', label: 'Full Book' },
  { value: 'chapter', label: 'Chapter' },
  { value: 'scene', label: 'Scene' },
];

interface Props {
  depth: ViewDepth;
  onDepthChange: (depth: ViewDepth) => void;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  contextLabel: string;
}

export default function DepthSlider({
  depth,
  onDepthChange,
  canPrev,
  canNext,
  onPrev,
  onNext,
  contextLabel,
}: Props) {
  return (
    <div className="depth-slider-bar">
      <button
        className="depth-nav-btn"
        onClick={onPrev}
        disabled={!canPrev}
        aria-label="Previous"
        title="Previous"
      >
        ‹
      </button>

      <div className="depth-slider-track">
        {POSITIONS.map((pos) => (
          <button
            key={pos.value}
            className={`depth-slider-btn${depth === pos.value ? ' active' : ''}`}
            onClick={() => onDepthChange(pos.value)}
          >
            {pos.label}
          </button>
        ))}
        <div
          className="depth-slider-indicator"
          style={{ left: `${(POSITIONS.findIndex((p) => p.value === depth) / (POSITIONS.length - 1)) * 100}%` }}
        />
      </div>

      <button
        className="depth-nav-btn"
        onClick={onNext}
        disabled={!canNext}
        aria-label="Next"
        title="Next"
      >
        ›
      </button>

      <span className="depth-context-label">{contextLabel}</span>
    </div>
  );
}
