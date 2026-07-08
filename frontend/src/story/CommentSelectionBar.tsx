// Beta 3 M11 — text-selection comment bar (prototype 811–824).
//
// Sticky pill that appears over the manuscript page when the writer selects
// 4–219 chars of prose: shows the clipped selection, a comment input, the
// yellow Comment button, a Read affordance (disabled until the M13 reader
// wires a handler), and cancel.

import type { KeyboardEvent } from 'react';
import './CommentsGutter.css';

export interface CommentSelectionBarProps {
  /** The selected manuscript text (already length-validated by the caller). */
  selectionText: string;
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  /**
   * Read-the-selection-aloud. Optional — until the M13 TTS reader lands the
   * button renders as a clearly-marked disabled affordance (M15 pattern).
   */
  onRead?: () => void;
}

const COMMENT_ICON = (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    aria-hidden="true"
  >
    <path d="M21 12c0 4-4 7-9 7s-9-3-9-7 4-7 9-7 9 3 9 7z" />
  </svg>
);

const READ_ICON = (
  <svg
    width="11"
    height="11"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M4 10v4h4l5 4V6l-5 4z" />
    <path d="M16.5 9a4 4 0 0 1 0 6" />
  </svg>
);

const CLOSE_ICON = (
  <svg
    width="9"
    height="9"
    viewBox="0 0 12 12"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
  </svg>
);

export default function CommentSelectionBar({
  selectionText,
  value,
  onChange,
  onSave,
  onCancel,
  onRead,
}: CommentSelectionBarProps) {
  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <div className="msv-selbar-wrap">
      <div className="msv-selbar" data-testid="msv-selbar" role="toolbar" aria-label="Comment on selection">
        <span className="msv-selbar-icon">{COMMENT_ICON}</span>
        <span className="msv-selbar-quote" title={selectionText}>
          &ldquo;{selectionText}&rdquo;
        </span>
        <input
          className="msv-selbar-input"
          data-testid="msv-selbar-input"
          placeholder="Comment on this…"
          aria-label="Comment text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus
        />
        <button
          type="button"
          className="msv-selbar-save"
          data-testid="msv-selbar-save"
          onClick={onSave}
        >
          Comment
        </button>
        <button
          type="button"
          className="msv-selbar-read"
          data-testid="msv-selbar-read"
          onClick={onRead}
          disabled={!onRead}
          title={
            onRead
              ? 'Read this selection aloud'
              : 'Read aloud arrives with the TTS Reader (M13)'
          }
        >
          {READ_ICON}
          Read
        </button>
        <button
          type="button"
          className="msv-selbar-cancel"
          data-testid="msv-selbar-cancel"
          aria-label="Dismiss comment bar"
          onClick={onCancel}
        >
          {CLOSE_ICON}
        </button>
      </div>
    </div>
  );
}
