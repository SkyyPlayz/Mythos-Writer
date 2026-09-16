/**
 * SKY-11191 (Notes Board 8/9): the board minimap.
 *
 * A scaled projection of the board's item boxes plus the viewport rectangle,
 * pinned to the bottom-left of the canvas panel. Nothing here is persisted —
 * the boxes come from the same resolved layout the cards render from, so the
 * map is reconstructed from the board on every mount (ticket AC 3).
 *
 * Accessibility: the map is a POINTER shortcut for something already fully
 * reachable without it — the canvas scroll panel scrolls with the keyboard,
 * and every card is in the tab order and selects on focus (BoardCard). So the
 * surface is `aria-hidden` and the toolbar's "Minimap" toggle carries the
 * announced state, rather than inventing a widget role that screen readers
 * would have to be taught to drive.
 *
 * Named `...Panel` rather than `BoardMinimap` on purpose: the geometry lives
 * next door in `boardMinimap.ts`, and two module paths that differ only in
 * case are one file on Windows (SKY-11718). Same split as `boardLinks.ts` /
 * `BoardLinkOverlay.tsx`. `moduleCaseCollisions.test.ts` keeps it that way.
 */
import { memo, useCallback, useRef } from 'react';
import type { MouseEvent } from 'react';
import { minimapProjection, projectRect } from './boardMinimap';
import type { MinimapBox } from './boardMinimap';

/** Frame size in CSS px. Must match `.board-canvas__minimap` in BoardCanvas.css. */
export const MINIMAP_W = 168;
export const MINIMAP_H = 116;

export interface BoardMinimapPanelProps {
  boxes: readonly MinimapBox[];
  world: { w: number; h: number };
  /** The visible slice of the world, in world coordinates. */
  viewport: { x: number; y: number; w: number; h: number };
  /** A world point the user picked — the canvas centres the viewport on it. */
  onNavigate: (point: { x: number; y: number }) => void;
}

function BoardMinimapPanelImpl({ boxes, world, viewport, onNavigate }: BoardMinimapPanelProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const projection = minimapProjection(world, { w: MINIMAP_W, h: MINIMAP_H });

  const navigateTo = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      const rect = frameRef.current?.getBoundingClientRect();
      if (!rect || projection.scale <= 0) return;
      onNavigate({
        x: (e.clientX - rect.left - projection.offsetX) / projection.scale,
        y: (e.clientY - rect.top - projection.offsetY) / projection.scale,
      });
    },
    [onNavigate, projection.offsetX, projection.offsetY, projection.scale],
  );

  const handleMouseDown = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      // The canvas panel treats a left press as "clear the selection" and, with
      // a placement tool armed, as "create an item here" — neither is what a
      // press on the map means.
      e.stopPropagation();
      e.preventDefault();
      navigateTo(e);
    },
    [navigateTo],
  );

  const viewRect = projectRect(viewport, projection);

  return (
    <div
      className="board-canvas__minimap"
      ref={frameRef}
      data-testid="board-minimap"
      data-box-count={boxes.length}
      onMouseDown={handleMouseDown}
      onMouseMove={(e) => { if (e.buttons === 1) navigateTo(e); }}
      aria-hidden="true"
    >
      {boxes.map((box) => {
        const r = projectRect(box, projection);
        return (
          <span
            key={box.key}
            className={`board-canvas__minimap-box board-canvas__minimap-box--${box.kind}`}
            style={{ left: r.left, top: r.top, width: r.width, height: r.height }}
          />
        );
      })}
      <span
        className="board-canvas__minimap-viewport"
        data-testid="board-minimap-viewport"
        style={{ left: viewRect.left, top: viewRect.top, width: viewRect.width, height: viewRect.height }}
      />
    </div>
  );
}

/**
 * Memoised: the canvas re-renders on every drag frame and scroll bucket, and
 * the map only moves when a box or the viewport does.
 */
const BoardMinimapPanel = memo(BoardMinimapPanelImpl);
export default BoardMinimapPanel;
