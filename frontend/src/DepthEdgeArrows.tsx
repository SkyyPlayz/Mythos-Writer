import type { ViewDepth } from './DepthSlider';

// GH #631 / AC-C-4: on-canvas prev/next arrows at the left/right page edges.
// Styling lives in DesktopShell.css (.edge-arrow); the buttons self-hide via
// :disabled when stepping is not possible at the current depth boundary.

const DEPTH_NOUN: Record<ViewDepth, string> = {
  book: 'story',
  chapter: 'chapter',
  scene: 'scene',
};

export interface DepthEdgeArrowsProps {
  depth: ViewDepth;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}

export default function DepthEdgeArrows({ depth, canPrev, canNext, onPrev, onNext }: DepthEdgeArrowsProps) {
  const noun = DEPTH_NOUN[depth];
  return (
    <>
      <button
        type="button"
        className="edge-arrow edge-arrow--prev"
        data-testid="edge-arrow-prev"
        aria-label={`Previous ${noun}`}
        title={`Previous ${noun} (Ctrl+Alt+←)`}
        disabled={!canPrev}
        // Keep typing focus in the editor — same trick as FormatToolbar.
        onMouseDown={(e) => e.preventDefault()}
        onClick={onPrev}
      >
        <span aria-hidden="true">‹</span>
      </button>
      <button
        type="button"
        className="edge-arrow edge-arrow--next"
        data-testid="edge-arrow-next"
        aria-label={`Next ${noun}`}
        title={`Next ${noun} (Ctrl+Alt+→)`}
        disabled={!canNext}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onNext}
      >
        <span aria-hidden="true">›</span>
      </button>
    </>
  );
}
