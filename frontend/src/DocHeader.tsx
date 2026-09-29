import { useCallback, useRef } from 'react';
import './DocHeader.css';

const ZOOM_OPTIONS = [
  { label: '75%', value: 0.75 },
  { label: '100%', value: 1.0 },
  { label: '125%', value: 1.25 },
  { label: 'Fit', value: 0 },
];

interface Props {
  title: string;
  onTitleChange: (t: string) => void;
  wordCount: number;
  breadcrumb: string[];
  zoom: number;
  onZoomChange: (z: number) => void;
  isFocusMode: boolean;
  onFocusToggle: () => void;
}

export default function DocHeader({
  title,
  onTitleChange,
  wordCount,
  breadcrumb,
  zoom,
  onZoomChange,
  isFocusMode,
  onFocusToggle,
}: Props) {
  const titleRef = useRef<HTMLSpanElement>(null);

  const handleTitleBlur = useCallback(() => {
    const text = (titleRef.current?.textContent ?? '').trim();
    if (!text) {
      // Reject a blank commit — restore the last known title instead of
      // leaving the field visually empty while state still holds the old value.
      if (titleRef.current) titleRef.current.textContent = title;
      return;
    }
    if (text !== title) onTitleChange(text);
  }, [onTitleChange, title]);

  const handleTitleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      titleRef.current?.blur();
    }
  }, []);

  return (
    <div className="doc-header" role="banner">
      {/* Left zone */}
      <div className="doc-header__left">
        {/* Zoom segmented control */}
        <div className="doc-header__zoom" role="group" aria-label="Zoom level">
          {ZOOM_OPTIONS.map(opt => (
            <button
              key={opt.label}
              className={`doc-header__zoom-btn${zoom === opt.value ? ' doc-header__zoom-btn--active' : ''}`}
              onClick={() => onZoomChange(opt.value)}
              aria-pressed={zoom === opt.value}
              type="button"
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Breadcrumb */}
        {breadcrumb.length > 0 && (
          <nav className="doc-header__breadcrumb" aria-label="Document breadcrumb">
            {breadcrumb.map((crumb, i) => (
              <span key={i} className="doc-header__breadcrumb-item">
                {i > 0 && <span className="doc-header__breadcrumb-sep" aria-hidden="true"> &rsaquo; </span>}
                {crumb}
              </span>
            ))}
          </nav>
        )}
      </div>

      {/* Center zone */}
      <div className="doc-header__center">
        <span
          ref={titleRef}
          className="doc-header-title"
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-label="Scene title"
          aria-multiline="false"
          onBlur={handleTitleBlur}
          onKeyDown={handleTitleKeyDown}
          data-placeholder="Untitled scene"
        >
          {title}
        </span>
        <button
          className="doc-header__star"
          aria-label="Toggle favorite"
          type="button"
          title="Add to favorites"
        >
          ☆
        </button>
      </div>

      {/* Right zone */}
      <div className="doc-header__right">
        <span
          className="doc-header-wordcount"
          aria-label={`${wordCount} words`}
          aria-live="polite"
        >
          {wordCount.toLocaleString()} words
        </span>
        <button className="doc-header__drafts-btn" type="button" aria-label="View drafts">
          Drafts
        </button>
        <button
          className={`doc-header__focus-btn${isFocusMode ? ' doc-header__focus-btn--active' : ''}`}
          type="button"
          aria-pressed={isFocusMode}
          aria-label={isFocusMode ? 'Exit focus mode' : 'Enter focus mode'}
          onClick={onFocusToggle}
        >
          Focus
        </button>
        <button
          className="doc-header__overflow-btn"
          type="button"
          aria-label="More options"
          aria-haspopup="menu"
        >
          ⋯
        </button>
      </div>
    </div>
  );
}
