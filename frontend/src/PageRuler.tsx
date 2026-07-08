// GH #842 (Beta 3 M10) — Word-style draggable ruler above the story page.
//
// Direct manipulation for the same StoryPagePrefs the PageChromeToolbar
// sliders write: outer page-edge handles drag the page width (snapping to
// size presets when close), inner margin handles drag the symmetric
// horizontal margins. Live preview goes through the same CSS custom
// properties applyStoryPageTokens owns; prefs commit on release so the
// toolbar and ruler always agree. Keyboard: every handle is a slider —
// arrows nudge width ±10px / margins ±4px.

import { useCallback, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react';
import type { StoryPagePrefs } from './theme';
import {
  MARGIN_NUDGE_PX,
  RULER_MARGIN_MAX,
  RULER_MARGIN_MIN,
  RULER_WIDTH_MAX,
  RULER_WIDTH_MIN,
  WIDTH_NUDGE_PX,
  clampMargin,
  clampWidth,
  effectiveWidth,
  marginFromDrag,
  prefsWithMargin,
  prefsWithWidth,
  snapWidth,
  widthFromEdgeDrag,
  type RulerSide,
} from './pageRulerMath';
import './PageRuler.css';

interface Props {
  prefs: StoryPagePrefs;
  onPrefsChange: (updated: StoryPagePrefs) => void;
}

/** Live-preview writers — the same custom properties applyStoryPageTokens sets. */
function previewWidth(px: number): void {
  document.documentElement.style.setProperty('--page-width-story', `${px}px`);
}

function previewMargin(px: number): void {
  document.documentElement.style.setProperty('--story-page-pad-horiz', `${px}px`);
}

export default function PageRuler({ prefs, onPrefsChange }: Props) {
  // Live values while a handle is mid-drag; null = follow prefs.
  const [liveWidth, setLiveWidth] = useState<number | null>(null);
  const [liveMargin, setLiveMargin] = useState<number | null>(null);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  const width = liveWidth ?? clampWidth(effectiveWidth(prefs));
  const margin = liveMargin ?? clampMargin(prefs.marginHorizPx);
  const dragging = liveWidth != null || liveMargin != null;

  const startWidthDrag = useCallback(
    (side: RulerSide) => (e: MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = clampWidth(effectiveWidth(prefsRef.current));
      const mv = (ev: globalThis.MouseEvent) => {
        const snapped = snapWidth(widthFromEdgeDrag(startW, ev.clientX - startX, side));
        setLiveWidth(snapped.widthPx);
        previewWidth(snapped.widthPx);
      };
      const up = (ev: globalThis.MouseEvent) => {
        window.removeEventListener('mousemove', mv);
        window.removeEventListener('mouseup', up);
        setLiveWidth(null);
        const snapped = snapWidth(widthFromEdgeDrag(startW, ev.clientX - startX, side));
        previewWidth(snapped.widthPx);
        onPrefsChange(prefsWithWidth(prefsRef.current, snapped));
      };
      window.addEventListener('mousemove', mv);
      window.addEventListener('mouseup', up);
    },
    [onPrefsChange]
  );

  const startMarginDrag = useCallback(
    (side: RulerSide) => (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startM = clampMargin(prefsRef.current.marginHorizPx);
      const mv = (ev: globalThis.MouseEvent) => {
        const m = marginFromDrag(startM, ev.clientX - startX, side);
        setLiveMargin(m);
        previewMargin(m);
      };
      const up = (ev: globalThis.MouseEvent) => {
        window.removeEventListener('mousemove', mv);
        window.removeEventListener('mouseup', up);
        setLiveMargin(null);
        const m = marginFromDrag(startM, ev.clientX - startX, side);
        previewMargin(m);
        onPrefsChange(prefsWithMargin(prefsRef.current, m));
      };
      window.addEventListener('mousemove', mv);
      window.addEventListener('mouseup', up);
    },
    [onPrefsChange]
  );

  // Keyboard nudges commit immediately (precise — no snap) per WCAG 2.1 AA.
  const widthKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const dir = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
      if (!dir) return;
      e.preventDefault();
      const next = clampWidth(effectiveWidth(prefsRef.current) + dir * WIDTH_NUDGE_PX);
      onPrefsChange(prefsWithWidth(prefsRef.current, { widthPx: next, preset: null }));
    },
    [onPrefsChange]
  );

  const marginKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const dir = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
      if (!dir) return;
      e.preventDefault();
      onPrefsChange(prefsWithMargin(prefsRef.current, prefsRef.current.marginHorizPx + dir * MARGIN_NUDGE_PX));
    },
    [onPrefsChange]
  );

  const trackStyle: CSSProperties = { maxWidth: `${width}px` };

  return (
    <div className="pgr-ruler" data-testid="page-ruler">
      <div className={`pgr-track${dragging ? ' pgr-track--dragging' : ''}`} style={trackStyle}>
        <div
          className="pgr-handle pgr-edge pgr-edge--l"
          data-testid="pgr-edge-l"
          role="slider"
          tabIndex={0}
          aria-label="Page width (left edge)"
          aria-orientation="horizontal"
          aria-valuemin={RULER_WIDTH_MIN}
          aria-valuemax={RULER_WIDTH_MAX}
          aria-valuenow={width}
          aria-valuetext={`${width} pixels`}
          title="Drag to resize the page — snaps to presets"
          onMouseDown={startWidthDrag(-1)}
          onKeyDown={widthKeyDown}
        />
        <div
          className="pgr-handle pgr-margin pgr-margin--l"
          data-testid="pgr-margin-l"
          style={{ left: `${margin}px` }}
          role="slider"
          tabIndex={0}
          aria-label="Horizontal margins (left handle)"
          aria-orientation="horizontal"
          aria-valuemin={RULER_MARGIN_MIN}
          aria-valuemax={RULER_MARGIN_MAX}
          aria-valuenow={margin}
          aria-valuetext={`${margin} pixel margins`}
          title="Drag to adjust the page margins"
          onMouseDown={startMarginDrag(-1)}
          onKeyDown={marginKeyDown}
        />
        <div className="pgr-margin-zone" style={{ left: `${margin}px`, right: `${margin}px` }} aria-hidden="true" />
        <div
          className="pgr-handle pgr-margin pgr-margin--r"
          data-testid="pgr-margin-r"
          style={{ right: `${margin}px` }}
          role="slider"
          tabIndex={0}
          aria-label="Horizontal margins (right handle)"
          aria-orientation="horizontal"
          aria-valuemin={RULER_MARGIN_MIN}
          aria-valuemax={RULER_MARGIN_MAX}
          aria-valuenow={margin}
          aria-valuetext={`${margin} pixel margins`}
          title="Drag to adjust the page margins"
          onMouseDown={startMarginDrag(1)}
          onKeyDown={marginKeyDown}
        />
        <div
          className="pgr-handle pgr-edge pgr-edge--r"
          data-testid="pgr-edge-r"
          role="slider"
          tabIndex={0}
          aria-label="Page width (right edge)"
          aria-orientation="horizontal"
          aria-valuemin={RULER_WIDTH_MIN}
          aria-valuemax={RULER_WIDTH_MAX}
          aria-valuenow={width}
          aria-valuetext={`${width} pixels`}
          title="Drag to resize the page — snaps to presets"
          onMouseDown={startWidthDrag(1)}
          onKeyDown={widthKeyDown}
        />
        {dragging && (
          <span className="pgr-readout" data-testid="pgr-readout" aria-hidden="true">
            {liveMargin != null ? `${margin}px margins` : `${width}px`}
          </span>
        )}
      </div>
    </div>
  );
}
