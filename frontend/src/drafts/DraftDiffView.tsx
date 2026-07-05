// Beta 3 "Liquid Neon" M12 — the drafts diff renderer (prototype 779–804,
// dSeg 4512, splitParas2 4713–4714). Two variants:
//   · 'full'      — the full compare mode: header (draft selector → current
//                   pill · legend · close) over two Lora serif columns, old
//                   (red border, 'd' segments struck) and new (green border,
//                   'a' segments highlighted).
//   · 'highlight' — the split-pane "Highlight changes" ON body: a single
//                   Lora column of the OLD draft's segments (prototype uses
//                   diffData.old), for hosts that wrap it in their own sheet.
// Diffing is local via diffSegments — no IPC, no dependencies.
import { useMemo } from 'react';
import { diffSegments, sideParagraphs, type DiffSegment } from './diffSegments';
import './DraftDiffView.css';

export interface DraftDiffOption {
  id: string;
  label: string;
}

export interface DraftDiffViewProps {
  /** Document label for the header, e.g. "Scene 4". */
  documentLabel: string;
  /** Label of the older draft, e.g. "Draft 6". */
  oldLabel: string;
  /** Label of the newer draft; rendered as "{newLabel} · current". */
  newLabel: string;
  /** Full text of the older draft. */
  oldText: string;
  /** Full text of the newer (usually live) draft. */
  newText: string;
  /** 'full' two-column compare (default) or single-pane 'highlight' body. */
  variant?: 'full' | 'highlight';
  /** Full variant: other drafts selectable as the old side. Omit for a static pill. */
  oldOptions?: DraftDiffOption[];
  /** Full variant: id of the currently selected old draft (with oldOptions). */
  selectedOldId?: string;
  /** Full variant: user picked a different old draft. */
  onSelectOld?: (id: string) => void;
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
  oldLabel,
  newLabel,
  oldText,
  newText,
  variant = 'full',
  oldOptions,
  selectedOldId,
  onSelectOld,
  onClose,
}: DraftDiffViewProps) {
  const segments = useMemo(() => diffSegments(oldText, newText), [oldText, newText]);
  const oldParas = useMemo(() => sideParagraphs(segments, 'old'), [segments]);
  const newParas = useMemo(() => sideParagraphs(segments, 'new'), [segments]);

  if (variant === 'highlight') {
    // Split-pane "Highlight changes" ON: the old draft with its removed
    // segments struck (prototype splitParas2 → diffData.old via dSeg).
    return (
      <div
        className="ln-diff-highlight"
        aria-label={`${oldLabel} with changes highlighted`}
        data-testid="ln-diff-highlight"
      >
        <DiffParagraphs paragraphs={oldParas} />
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
        {oldOptions && oldOptions.length > 0 ? (
          <select
            className="ln-diff-old-select"
            value={selectedOldId}
            onChange={(e) => onSelectOld?.(e.target.value)}
            aria-label="Draft to compare against"
          >
            {oldOptions.map((opt) => (
              <option value={opt.id} key={opt.id}>{opt.label}</option>
            ))}
          </select>
        ) : (
          <span className="ln-diff-old-pill">{oldLabel}</span>
        )}
        <svg
          className="ln-diff-arrow"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#8e9db8"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M4 12h16M14 6l6 6-6 6" />
        </svg>
        <span className="ln-diff-new-pill">{newLabel} · current</span>
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
      <div className="ln-diff-columns">
        <div className="ln-diff-col ln-diff-col-old" data-testid="ln-diff-col-old">
          <DiffParagraphs paragraphs={oldParas} />
        </div>
        <div className="ln-diff-col ln-diff-col-new" data-testid="ln-diff-col-new">
          <DiffParagraphs paragraphs={newParas} />
        </div>
      </div>
    </div>
  );
}
