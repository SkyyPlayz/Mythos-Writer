// Beta 4 M10 — the drafts diff renderer, refreshed from Beta 3 M12 to the v2
// prototype (Liquid Neon.dc.html 1002–1030, dSeg 6500, diffRows 6501).
// Two variants:
//   · 'full'      — full compare mode: header (title · GREEN "current" pill ·
//                   "vs" · RED previous-draft select · legend · close) over a
//                   labels row and two Lora serif columns. The CURRENT draft
//                   is ALWAYS the left/green column ('a' segments highlighted)
//                   and the previous draft the right/red column ('d' struck),
//                   each labeled "<DRAFT> — CURRENT" / "<DRAFT> — PREVIOUS".
//   · 'highlight' — the split-pane "Highlight changes" ON body: a single Lora
//                   column of the PREVIOUS draft's segments (prototype
//                   splitParas2 → diffData old side), for hosts that wrap it
//                   in their own sheet.
// Diffing is local via diffSegments — no IPC, no dependencies.
import { useMemo } from 'react';
import { diffSegments, sideParagraphs, type DiffSegment } from './diffSegments';
import './DraftDiffView.css';

export interface DraftDiffOption {
  id: string;
  label: string;
}

export interface DraftDiffViewProps {
  /** Compare scope for the header — always the OPEN scene/chapter. */
  documentLabel: string;
  /** Label of the current (live) draft, e.g. "Draft 7". */
  currentLabel: string;
  /** Label of the previous draft being compared, e.g. "Draft 6". */
  previousLabel: string;
  /** Full text of the current (live) draft. */
  currentText: string;
  /** Full text of the previous draft. */
  previousText: string;
  /** 'full' two-column compare (default) or single-pane 'highlight' body. */
  variant?: 'full' | 'highlight';
  /** Full variant: other drafts selectable as the previous side. Omit for a static pill. */
  previousOptions?: DraftDiffOption[];
  /** Full variant: id of the currently selected previous draft (with previousOptions). */
  selectedPreviousId?: string;
  /** Full variant: user picked a different previous draft. */
  onSelectPrevious?: (id: string) => void;
  /** Full variant: close button. */
  onClose?: () => void;
}

const SEG_CLASS: Record<DiffSegment['k'], string> = {
  s: 'ln-diff-seg-s',
  d: 'ln-diff-seg-d',
  a: 'ln-diff-seg-a',
};

function DiffParagraphs({ paragraphs }: { paragraphs: DiffSegment[][] }) {
  return (
    <>
      {paragraphs.map((row, i) => (
        <p className="ln-diff-para" key={i}>
          {row.map((seg, j) => (
            <span className={SEG_CLASS[seg.k]} key={j}>{seg.t}</span>
          ))}
        </p>
      ))}
    </>
  );
}

export default function DraftDiffView({
  documentLabel,
  currentLabel,
  previousLabel,
  currentText,
  previousText,
  variant = 'full',
  previousOptions,
  selectedPreviousId,
  onSelectPrevious,
  onClose,
}: DraftDiffViewProps) {
  // diffSegments(old, new): 'd' = only in the previous draft, 'a' = only in
  // the current draft. sideParagraphs keeps s+d for 'old', s+a for 'new'.
  const segments = useMemo(() => diffSegments(previousText, currentText), [previousText, currentText]);
  const previousParas = useMemo(() => sideParagraphs(segments, 'old'), [segments]);
  const currentParas = useMemo(() => sideParagraphs(segments, 'new'), [segments]);

  if (variant === 'highlight') {
    // Split-pane "Highlight changes" ON: the previous draft with the segments
    // that differ from the current draft struck red (prototype splitParas2).
    return (
      <div
        className="ln-diff-highlight"
        aria-label={`${previousLabel} with changes highlighted`}
        data-testid="ln-diff-highlight"
      >
        <DiffParagraphs paragraphs={previousParas} />
      </div>
    );
  }

  return (
    <div
      className="ln-diff-view"
      role="region"
      aria-label={`Compare drafts — ${documentLabel}`}
      data-testid="ln-diff-view"
    >
      <div className="ln-diff-header">
        <span className="ln-diff-title">Compare drafts — {documentLabel}</span>
        <span className="ln-diff-current-pill" data-testid="ln-diff-current-pill">
          {currentLabel} · current
        </span>
        <span className="ln-diff-vs">vs</span>
        {previousOptions && previousOptions.length > 0 ? (
          <select
            className="ln-diff-previous-select"
            value={selectedPreviousId}
            onChange={(e) => onSelectPrevious?.(e.target.value)}
            aria-label="Draft to compare against"
          >
            {previousOptions.map((opt) => (
              <option value={opt.id} key={opt.id}>{opt.label}</option>
            ))}
          </select>
        ) : (
          <span className="ln-diff-previous-pill">{previousLabel}</span>
        )}
        <div className="ln-diff-spacer" />
        <span className="ln-diff-legend">
          <span className="ln-diff-legend-added">green = added</span>
          {' · '}
          <span className="ln-diff-legend-removed">red = removed</span>
        </span>
        {onClose && (
          <button type="button" className="ln-diff-close" onClick={onClose} aria-label="Close compare view">
            <svg width="11" height="11" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true" focusable="false">
              <path d="M2 2l8 8M10 2l-8 8" />
            </svg>
          </button>
        )}
      </div>
      {/* Column labels (prototype 1012–1015): current ALWAYS left/green. */}
      <div className="ln-diff-col-labels">
        <span className="ln-diff-col-label ln-diff-col-label-current" data-testid="ln-diff-label-current">
          {currentLabel} — current
        </span>
        <span className="ln-diff-col-label ln-diff-col-label-previous" data-testid="ln-diff-label-previous">
          {previousLabel} — previous
        </span>
      </div>
      <div className="ln-diff-columns">
        <div className="ln-diff-col ln-diff-col-current" data-testid="ln-diff-col-current">
          <DiffParagraphs paragraphs={currentParas} />
        </div>
        <div className="ln-diff-col ln-diff-col-previous" data-testid="ln-diff-col-previous">
          <DiffParagraphs paragraphs={previousParas} />
        </div>
      </div>
    </div>
  );
}
