// SKY-2451 — BlockDetail popover: scene info, timestamp, edit button.
//
// Renders as a glass-morphism dialog anchored to the timeline block that was
// clicked. The parent is responsible for mounting/unmounting; the popover
// calls onClose when the user dismisses it.
//
// A11y: role="dialog" + aria-modal + focus trap (Tab/Shift+Tab cycle) +
// Escape dismiss. ARIA labels on every action button.
import { useCallback, useEffect, useRef } from 'react';
import './BlockDetail.css';

export interface BlockDetailProps {
  sceneId: string;
  sceneName: string;
  chapterNumber: number;
  /** Human-readable timestamp string, e.g. "Day 2, dawn". */
  timestamp: string;
  /** 0.0–1.0. Rendered as a progress bar; ≥0.6 = cyan, <0.6 = magenta. */
  confidence: number;
  /** Excerpt from the scene that cued the inference. */
  rawCue: string;
  isWritten: boolean;
  onEditTimestamp: () => void;
  onOpenInEditor: () => void;
  onClose: () => void;
  /** CSS color for the neon accent border. Falls back to --neon-violet. */
  accentColor?: string;
}

const RAW_CUE_MAX_CHARS = 120;

function truncateCue(cue: string): string {
  if (cue.length <= RAW_CUE_MAX_CHARS) return cue;
  return `${cue.slice(0, RAW_CUE_MAX_CHARS - 1)}…`;
}

const FOCUSABLE = 'button, [href], input, [tabindex]:not([tabindex="-1"])';

export default function BlockDetail({
  sceneId,
  sceneName,
  chapterNumber,
  timestamp,
  confidence,
  rawCue,
  isWritten,
  onEditTimestamp,
  onOpenInEditor,
  onClose,
  accentColor,
}: BlockDetailProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  const confidencePct = Math.round(confidence * 100);
  const isHighConfidence = confidence >= 0.6;
  const truncatedCue = truncateCue(rawCue);
  const isCueTruncated = rawCue.length > RAW_CUE_MAX_CHARS;

  // Focus the first focusable element on mount, then trap Tab/Shift+Tab.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const focusables = (): HTMLElement[] =>
      Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));

    focusables()[0]?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;

      const list = focusables();
      if (list.length === 0) return;

      const first = list[0];
      const last = list[list.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [onClose]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  const accentStyle = accentColor
    ? ({ '--bd-accent': accentColor } as React.CSSProperties)
    : undefined;

  return (
    <div
      className="bd-backdrop"
      onClick={handleBackdropClick}
      data-testid="block-detail-backdrop"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Scene details: ${sceneName}`}
        className="bd-root"
        data-testid="block-detail"
        data-scene-id={sceneId}
        style={accentStyle}
      >
        {/* ── Header ──────────────────────────────────────────────────── */}
        <header className="bd-header">
          <h2 className="bd-title" title={sceneName}>
            {sceneName}
          </h2>
          <div className="bd-header-meta">
            <span className="bd-chapter">Chapter {chapterNumber}</span>
            <span
              className={`bd-status bd-status--${isWritten ? 'written' : 'planned'}`}
              data-testid="bd-status"
            >
              {isWritten ? 'Written' : 'Planned'}
            </span>
          </div>
        </header>

        {/* ── Timestamp + confidence ───────────────────────────────────── */}
        <section className="bd-section" aria-label="Timestamp">
          <div className="bd-section-label">Timestamp inferred</div>
          <div className="bd-timestamp" data-testid="bd-timestamp">
            {timestamp}
          </div>
          <div className="bd-confidence-row">
            <div
              className="bd-confidence-bar"
              role="progressbar"
              aria-valuenow={confidencePct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Confidence: ${confidencePct}%`}
              data-testid="bd-confidence-bar"
            >
              <div
                className={`bd-confidence-fill bd-confidence-fill--${isHighConfidence ? 'high' : 'low'}`}
                style={{ width: `${confidencePct}%` }}
                data-testid="bd-confidence-fill"
              />
            </div>
            <span className="bd-confidence-label" data-testid="bd-confidence-label">
              {confidencePct}% confident
            </span>
          </div>
        </section>

        {/* ── Raw cue ─────────────────────────────────────────────────── */}
        {rawCue && (
          <section className="bd-section" aria-label="Source cue">
            <div className="bd-section-label">Raw cue</div>
            <blockquote
              className="bd-raw-cue"
              title={isCueTruncated ? rawCue : undefined}
              data-testid="bd-raw-cue"
            >
              {truncatedCue}
            </blockquote>
            <div className="bd-cue-source">Source: scene excerpt</div>
          </section>
        )}

        {/* ── Actions ─────────────────────────────────────────────────── */}
        <footer className="bd-footer">
          <button
            type="button"
            className="bd-btn bd-btn--primary"
            onClick={onEditTimestamp}
            aria-label="Edit timestamp for this scene"
            data-testid="bd-edit-timestamp"
          >
            Edit timestamp
          </button>
          <button
            type="button"
            className="bd-btn bd-btn--secondary"
            onClick={onOpenInEditor}
            aria-label="Open this scene in the editor"
            data-testid="bd-open-editor"
          >
            Open in editor
          </button>
          <button
            type="button"
            className="bd-btn bd-btn--ghost"
            onClick={onClose}
            aria-label="Close scene detail popover"
            data-testid="bd-close"
          >
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}
