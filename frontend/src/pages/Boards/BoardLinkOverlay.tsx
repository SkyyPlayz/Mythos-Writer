/**
 * SKY-11191 (Notes Board 8/9): the wiki-link overlay layer.
 *
 * One SVG sitting inside the zoomed world, so a connector shares the cards'
 * coordinate space and stays attached to them through pan, zoom and drag
 * without a single extra calculation. `pointer-events: none` — the overlay
 * describes the board, it never intercepts a gesture aimed at a card.
 *
 * Purely derived: the segments come from boardLinks.connectorSegments over
 * the live layout, so nothing about the overlay is persisted (ticket AC 3).
 *
 * Accessibility: the layer is decorative (`aria-hidden`) because the same
 * relationships already have a non-visual home — the note's Links/Backlinks
 * tab lists them as text. A screen reader should not have to parse a field of
 * line elements to learn what a list already says.
 */
import { memo } from 'react';
import type { ConnectorSegment } from './boardLinks';

export interface BoardLinkOverlayProps {
  segments: readonly ConnectorSegment[];
  /** World size, so the SVG covers exactly the area the cards live in. */
  width: number;
  height: number;
  /** Marker ids must be unique per canvas instance (two boards in a split view). */
  instanceId: string;
}

function BoardLinkOverlayImpl({ segments, width, height, instanceId }: BoardLinkOverlayProps) {
  const arrowId = `board-link-arrow-${instanceId}`;
  return (
    <svg
      className="board-canvas__links"
      data-testid="board-link-overlay"
      data-connector-count={segments.length}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <marker
          id={arrowId}
          markerWidth="7"
          markerHeight="7"
          refX="6"
          refY="3.5"
          orient="auto-start-reverse"
          markerUnits="userSpaceOnUse"
        >
          <path d="M0,0 L7,3.5 L0,7 z" className="board-canvas__link-arrow" />
        </marker>
      </defs>
      {segments.map((s) => (
        <line
          key={s.id}
          className="board-canvas__link"
          data-link-id={s.id}
          data-link-label={s.label}
          x1={s.x1}
          y1={s.y1}
          x2={s.x2}
          y2={s.y2}
          markerEnd={`url(#${arrowId})`}
        />
      ))}
    </svg>
  );
}

const BoardLinkOverlay = memo(BoardLinkOverlayImpl);
export default BoardLinkOverlay;
