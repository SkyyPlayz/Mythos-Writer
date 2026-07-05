// Beta 3 M9 — Heading-zoom manuscript view (the centerpiece).
//
// Renders the continuous manuscript sheet from the Liquid Neon prototype
// (design-handoff/prototype/"Mythos Writer - Liquid Neon.dc.html": zoom
// control 718–722, chevrons 723–728, breadcrumbs 729–734, page-width slider
// 736–740, floating page arrows 809–810, sheet + blocks 851–906, ←/→ keys
// 3919–3922) on top of the pure model in manuscriptModel.ts.
//
// Self-contained: pure UI + local fold/width state. Persistence stays with
// the caller via onEditParagraph / onCycleStatus / onCursorChange.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type UIEvent,
} from 'react';
import {
  breadcrumbs,
  buildBlocks,
  zoomStep,
  type ManuscriptBlock,
  type ManuscriptCursor,
  type SceneStatus,
  type ZoomLevel,
} from './manuscriptModel';
import type { Story } from '../types';
import './ManuscriptView.css';

export interface ManuscriptViewProps {
  story: Story;
  cursor: ManuscriptCursor;
  onCursorChange: (cursor: ManuscriptCursor) => void;
  /** Fired on blur/Enter of an edited paragraph with the new plain text. */
  onEditParagraph: (sceneId: string, blockId: string, newText: string) => void;
  /** Fired when a scene's status dot is clicked (todo → draft → done → todo). */
  onCycleStatus: (sceneId: string) => void;
  /** Initial sheet width in px (prototype default 1000, range 520–3000). */
  pageWidth?: number;
}

const ZOOM_LEVELS: Array<[ZoomLevel, string]> = [
  ['book', 'Full Book'],
  ['part', 'Part'],
  ['chapter', 'Chapter'],
  ['scene', 'Scene'],
];

const STATUS_TIP: Record<SceneStatus, string> = {
  done: 'Complete',
  draft: 'In draft',
  todo: 'Not started',
};

// ── Lazy windowing (GH#843): render only ~WINDOW blocks around the viewport,
//    replacing everything outside with top/bottom spacers sized from an
//    average block-height estimate. Keeps a 1,000-scene story smooth.
const WINDOW = 120;
const EST_BLOCK_H = 96;
/** Re-window only after the start index moves this far (scroll hysteresis). */
const WINDOW_HYSTERESIS = 24;

const CHEVRON_RIGHT = (size: number) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M9 6l6 6-6 6" />
  </svg>
);

const CHEVRON_LEFT = (size: number) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M15 6l-6 6 6 6" />
  </svg>
);

const GRIP_ICON = (
  <svg width="9" height="14" viewBox="0 0 12 20" fill="currentColor" aria-hidden="true">
    <circle cx="4" cy="4" r="1.5" />
    <circle cx="8" cy="4" r="1.5" />
    <circle cx="4" cy="10" r="1.5" />
    <circle cx="8" cy="10" r="1.5" />
    <circle cx="4" cy="16" r="1.5" />
    <circle cx="8" cy="16" r="1.5" />
  </svg>
);

const PLUS_ICON = (
  <svg
    width="11"
    height="11"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export default function ManuscriptView({
  story,
  cursor,
  onCursorChange,
  onEditParagraph,
  onCycleStatus,
  pageWidth = 1000,
}: ManuscriptViewProps) {
  // Per-heading fold state, keyed by chapter/scene id (prototype `collapsed`).
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [pageW, setPageW] = useState(pageWidth);
  const [winStart, setWinStart] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Last text committed per paragraph block — prevents Enter+blur double-fires.
  const committedRef = useRef(new Map<string, string>());

  const blocks = useMemo(() => buildBlocks(story, cursor, collapsed), [story, cursor, collapsed]);
  const crumbs = useMemo(() => breadcrumbs(story, cursor), [story, cursor]);

  const toggleFold = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const step = useCallback(
    (dir: 1 | -1) => onCursorChange(zoomStep(story, cursor, dir)),
    [story, cursor, onCursorChange]
  );

  // Reset the window and scroll position whenever the scope changes.
  const scopeKey = `${cursor.zoom}:${cursor.part}:${cursor.chapter}:${cursor.scene}`;
  useEffect(() => {
    setWinStart(0);
    const el = scrollRef.current;
    if (el) el.scrollTop = 0;
  }, [scopeKey]);

  // ←/→ hop same-level siblings (prototype 3919–3922), except while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (cursor.zoom === 'book') return;
      const target = e.target as HTMLElement | null;
      const tag = (target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      // isContentEditable is unimplemented in jsdom — also check the attribute.
      if (target?.isContentEditable || target?.closest?.('[contenteditable="true"]')) return;
      e.preventDefault();
      step(e.key === 'ArrowRight' ? 1 : -1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cursor.zoom, step]);

  const handleScroll = useCallback(
    (e: UIEvent<HTMLDivElement>) => {
      const start = Math.max(0, Math.floor(e.currentTarget.scrollTop / EST_BLOCK_H) - WINDOW / 3);
      if (Math.abs(start - winStart) >= WINDOW_HYSTERESIS) setWinStart(start);
    },
    [winStart]
  );

  const commitParagraph = useCallback(
    (sceneId: string, blockId: string, original: string, el: HTMLElement) => {
      const text = el.textContent ?? '';
      const prev = committedRef.current.get(blockId) ?? original;
      if (text === prev) return;
      committedRef.current.set(blockId, text);
      onEditParagraph(sceneId, blockId, text);
    },
    [onEditParagraph]
  );

  // Clamp the window so it always covers real blocks (folding shrinks the list).
  const start = Math.max(0, Math.min(winStart, Math.max(0, blocks.length - WINDOW)));
  const end = Math.min(blocks.length, start + WINDOW);
  const topPad = start * EST_BLOCK_H;
  const bottomPad = (blocks.length - end) * EST_BLOCK_H;
  const visible = blocks.slice(start, end);

  const renderFoldPill = (ownerId: string, text: string) => (
    <button
      key={`pill-${ownerId}`}
      type="button"
      className="msv-fold-pill"
      data-testid={`msv-pill-${ownerId}`}
      onClick={() => toggleFold(ownerId)}
    >
      {PLUS_ICON}
      {text}
    </button>
  );

  const renderBlock = (b: ManuscriptBlock) => {
    switch (b.kind) {
      case 'h2':
        return (
          <div key={b.id}>
            <div className="msv-h2" data-testid={`msv-h2-${b.chapterId}`}>
              <button
                type="button"
                className={`msv-fold${b.folded ? '' : ' msv-fold--open'}`}
                data-testid={`msv-fold-${b.chapterId}`}
                title={b.folded ? 'Expand chapter' : 'Collapse chapter'}
                aria-expanded={!b.folded}
                onClick={() => toggleFold(b.chapterId)}
              >
                {CHEVRON_RIGHT(13)}
              </button>
              <div className="msv-h2-label">{b.label}</div>
              <div className="msv-h2-title">{b.title}</div>
            </div>
            {b.folded &&
              renderFoldPill(
                b.chapterId,
                `${b.childCount} scene${b.childCount === 1 ? '' : 's'} hidden — click to expand`
              )}
          </div>
        );
      case 'h3':
        return (
          <div key={b.id}>
            <div className="msv-h3" data-testid={`msv-h3-${b.sceneId}`}>
              <button
                type="button"
                className={`msv-fold${b.folded ? '' : ' msv-fold--open'}`}
                data-testid={`msv-fold-${b.sceneId}`}
                title={b.folded ? 'Expand scene' : 'Collapse scene'}
                aria-expanded={!b.folded}
                onClick={() => toggleFold(b.sceneId)}
              >
                {CHEVRON_RIGHT(13)}
              </button>
              <span className="msv-h3-title">{b.title}</span>
              <button
                type="button"
                className={`msv-dot msv-dot--${b.status}`}
                data-testid={`msv-dot-${b.sceneId}`}
                title={STATUS_TIP[b.status]}
                aria-label={`Scene status: ${STATUS_TIP[b.status]} — click to cycle`}
                onClick={(e) => {
                  e.stopPropagation();
                  onCycleStatus(b.sceneId);
                }}
              />
            </div>
            {b.folded && renderFoldPill(b.sceneId, 'Scene collapsed — click to expand')}
          </div>
        );
      case 'para':
        return (
          <div key={b.id} className="msv-para">
            <span className="msv-grip" title="Drag block to move it" aria-hidden="true">
              {GRIP_ICON}
            </span>
            <div
              className="msv-para-text"
              data-testid={`msv-para-${b.blockId}`}
              contentEditable
              suppressContentEditableWarning
              role="textbox"
              aria-multiline="false"
              onBlur={(e) => commitParagraph(b.sceneId, b.blockId, b.content, e.currentTarget)}
              onKeyDown={(e: ReactKeyboardEvent<HTMLDivElement>) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitParagraph(b.sceneId, b.blockId, b.content, e.currentTarget);
                  e.currentTarget.blur();
                }
              }}
            >
              {b.content}
            </div>
          </div>
        );
    }
  };

  return (
    <div className="msv-root" data-testid="msv-root">
      {/* zoom bar (prototype 717–741) */}
      <div className="msv-zoombar">
        <div className="msv-zoom-seg" role="group" aria-label="Zoom level">
          {ZOOM_LEVELS.map(([level, label]) => (
            <button
              key={level}
              type="button"
              className={`msv-zoom-opt${cursor.zoom === level ? ' msv-zoom-opt--active' : ''}`}
              data-testid={`msv-zoom-${level}`}
              aria-pressed={cursor.zoom === level}
              onClick={() => onCursorChange({ ...cursor, zoom: level })}
            >
              {label}
            </button>
          ))}
        </div>
        {cursor.zoom !== 'book' && (
          <div className="msv-zoom-nav">
            <button
              type="button"
              className="msv-zoom-arrow"
              data-testid="msv-zoom-prev"
              title="Previous (←)"
              onClick={() => step(-1)}
            >
              {CHEVRON_LEFT(11)}
            </button>
            <button
              type="button"
              className="msv-zoom-arrow"
              data-testid="msv-zoom-next"
              title="Next (→)"
              onClick={() => step(1)}
            >
              {CHEVRON_RIGHT(11)}
            </button>
          </div>
        )}
        <nav className="msv-crumbs" aria-label="Breadcrumbs" data-testid="msv-crumbs">
          {crumbs.map((c, i) => (
            <span key={`${c.cursor.zoom}-${c.label}`} className="msv-crumb-item">
              <button
                type="button"
                className={`msv-crumb${i === crumbs.length - 1 ? ' msv-crumb--current' : ''}`}
                data-testid={`msv-crumb-${i}`}
                onClick={() => onCursorChange(c.cursor)}
              >
                {c.label}
              </button>
              {i < crumbs.length - 1 && (
                <svg
                  width="9"
                  height="9"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#586a88"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="msv-crumb-sep"
                  aria-hidden="true"
                >
                  <path d="M9 6l6 6-6 6" />
                </svg>
              )}
            </span>
          ))}
        </nav>
        <div className="msv-flex-spacer" />
        <div className="msv-width-ctl" title="Page width">
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#8e9db8"
            strokeWidth="1.8"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M3 12h18M6 8l-3 4 3 4M18 8l3 4-3 4" />
          </svg>
          <input
            type="range"
            min={520}
            max={3000}
            value={pageW}
            data-testid="msv-width-slider"
            aria-label="Page width"
            onChange={(e) => setPageW(Number(e.target.value))}
          />
          <span className="msv-width-readout">{pageW}px</span>
        </div>
      </div>

      {/* page scroll area with floating arrows (prototype 808–810) */}
      <div className="msv-page" ref={scrollRef} onScroll={handleScroll} data-testid="msv-page">
        {cursor.zoom !== 'book' && (
          <>
            <button
              type="button"
              className="msv-page-arrow msv-page-arrow--prev"
              data-testid="msv-page-prev"
              title="Previous (←)"
              onClick={() => step(-1)}
            >
              {CHEVRON_LEFT(14)}
            </button>
            <button
              type="button"
              className="msv-page-arrow msv-page-arrow--next"
              data-testid="msv-page-next"
              title="Next (→)"
              onClick={() => step(1)}
            >
              {CHEVRON_RIGHT(14)}
            </button>
          </>
        )}
        <div className="msv-sheet-wrap" style={{ width: `${pageW}px` }}>
          <div className="msv-sheet" data-testid="msv-sheet">
            <div style={{ height: topPad }} data-testid="msv-spacer-top" aria-hidden="true" />
            {visible.map(renderBlock)}
            <div style={{ height: bottomPad }} data-testid="msv-spacer-bottom" aria-hidden="true" />
          </div>
        </div>
      </div>
    </div>
  );
}
