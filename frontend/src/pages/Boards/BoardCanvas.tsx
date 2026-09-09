/**
 * SKY-11184: Notes Board canvas — zoom/pan/drag/resize with auto-layout fallback.
 * SKY-11186: viewport culling, 3-tier LOD, thumbnail-aware card sizes and the
 * visible zoom-out limit. BOARDS-SPEC.md §1, §6.
 *
 * The geometry (spec constants, culling rect, LOD thresholds, auto-layout)
 * lives in boardLod.ts as pure functions; this component is the state and
 * event wiring over them. Cards render through the memoised BoardCard so a
 * drag frame or a scroll bucket only re-renders the cards whose numbers moved.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent, ReactElement, WheelEvent } from 'react';
import BoardCard, { itemHasThumb } from './BoardCard';
import type { BoardItem, ItemRect } from './BoardCard';
import {
  ALIGN_THRESHOLD,
  CULL_MARGIN_X,
  CULL_MARGIN_Y,
  GRID_SNAP,
  ORIGIN_Y,
  RESIZE_MAX_H,
  RESIZE_MAX_W,
  RESIZE_MIN_H,
  RESIZE_MIN_W,
  SCROLL_BUCKET_PX,
  ZOOM_BTN_DELTA,
  ZOOM_MAX,
  ZOOM_WHEEL_DELTA,
  autoLayoutSlots,
  bucketScroll,
  clampMinZoom,
  defaultSize,
  expandRect,
  lodTierForScreenWidth,
  shouldMount,
  visibleWorldRect,
} from './boardLod';
import './BoardCanvas.css';

export type { BoardItem } from './BoardCard';

function snapToGrid(v: number): number {
  return Math.round(v / GRID_SNAP) * GRID_SNAP;
}

export interface ItemLayout {
  x: number;
  y: number;
  w?: number;
  h?: number;
}

export interface BoardCanvasProps {
  /** Direct children of this board */
  items: BoardItem[];
  /** Saved layout from SKY-11183 store, keyed by vault-relative path */
  savedLayout: Record<string, ItemLayout>;
  /** Saved zoom/pan state */
  savedView: { zoom: number; panX: number; panY: number };
  /** Grid snap enabled */
  gridSnap?: boolean;
  /**
   * SKY-11186 / owner ruling 4: the zoom-out limit, in percent. A performance
   * setting the user can see and change (Settings → Editor → Notes Board),
   * never a silent constant. Coerced to a supported stop; default 40 (spec §6).
   */
  minZoom?: number;
  /** Called when an item is dragged to a new position */
  onItemMove?: (itemPath: string, x: number, y: number) => void;
  /** Called when an item is resized */
  onItemResize?: (itemPath: string, w: number, h: number) => void;
  /** Called when view state changes (zoom/pan) */
  onViewChange?: (zoom: number, panX: number, panY: number) => void;
  /** Double-click a board tile to enter it */
  onEnterBoard?: (folderPath: string) => void;
}

interface ResolvedItem {
  item: BoardItem;
  layout: ItemLayout;
  autoLayout: boolean;
  hasThumb: boolean;
}

export default function BoardCanvas({
  items,
  savedLayout,
  savedView,
  gridSnap = true,
  minZoom: minZoomProp,
  onItemMove,
  onItemResize,
  onViewChange,
  onEnterBoard,
}: BoardCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(900);
  const [zoom, setZoom] = useState(savedView.zoom || 100);
  const [pan, setPan] = useState({ x: savedView.panX || 0, y: savedView.panY || 0 });
  // SKY-11494 BD-3: the neon rim is the mockup's *selection* affordance, so the
  // canvas needs a selection to spend it on. View-local and deliberately not
  // persisted — it is a pointer state, not board content.
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const minZoom = clampMinZoom(minZoomProp);
  const scale = zoom / 100;

  // A raised limit (Settings changed while a board is open) lifts the view
  // onto it — the floor is a hard bound, not just a stop for the buttons.
  useEffect(() => {
    setZoom((z) => (z < minZoom ? minZoom : z));
  }, [minZoom]);

  // Resolve items: merge saved layout with auto-layout for unsaved items.
  // Memoised so the item objects handed to BoardCard stay referentially
  // stable across drag frames and scroll buckets — that is what lets the
  // memoised cards skip their render.
  const resolvedItems: ResolvedItem[] = useMemo(() => {
    const slots = autoLayoutSlots(
      items.map((item) => ({ auto: !savedLayout[item.path], hasThumb: itemHasThumb(item) })),
      containerWidth,
    );
    return items.map((item, i) => {
      const saved = savedLayout[item.path];
      const hasThumb = itemHasThumb(item);
      if (saved) return { item, layout: saved, autoLayout: false, hasThumb };
      return { item, layout: slots[i]!, autoLayout: true, hasThumb };
    });
  }, [items, savedLayout, containerWidth]);

  // Observe container width for auto-layout column count
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? el.clientWidth;
      setContainerWidth(w);
    });
    ro.observe(el);
    setContainerWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // ── SKY-11186: the visible window of the world, for culling ─────────────
  // The scroll panel's size and its scroll offset are the two inputs the
  // canvas did not track before. Scroll is bucketed (boardLod.SCROLL_BUCKET_PX)
  // before it becomes state, so a wheel tick re-renders the board only when
  // the viewport crosses a bucket edge — the grid sync below stays a plain
  // style write on every scroll event.
  const [viewportSize, setViewportSize] = useState({ w: 900, h: 600 });
  const [scrollBucket, setScrollBucket] = useState({ x: 0, y: 0 });

  useLayoutEffect(() => {
    const el = scrollAreaRef.current;
    if (!el) return;
    const measure = () => setViewportSize((prev) => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      return prev.w === w && prev.h === h ? prev : { w, h };
    });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

  const trackScroll = useCallback(() => {
    const el = scrollAreaRef.current;
    if (!el) return;
    const x = bucketScroll(el.scrollLeft);
    const y = bucketScroll(el.scrollTop);
    setScrollBucket((prev) => (prev.x === x && prev.y === y ? prev : { x, y }));
  }, []);

  const cullRect = useMemo(
    () =>
      expandRect(
        visibleWorldRect(
          {
            scrollLeft: scrollBucket.x,
            scrollTop: scrollBucket.y,
            // The bucket floors the offset, so the window is widened by one
            // bucket to keep the far edge covered.
            clientWidth: viewportSize.w + SCROLL_BUCKET_PX,
            clientHeight: viewportSize.h + SCROLL_BUCKET_PX,
          },
          pan,
          zoom,
        ),
        CULL_MARGIN_X,
        CULL_MARGIN_Y,
      ),
    [scrollBucket, viewportSize, pan, zoom],
  );

  // Compute canvas height to fit all items (no fixed world size — spec §6)
  const canvasHeight = useMemo(() => {
    let max = 600;
    for (const r of resolvedItems) {
      const def = defaultSize(r.item.kind, r.hasThumb);
      max = Math.max(max, r.layout.y + (r.layout.h ?? def.h) + ORIGIN_Y);
    }
    return max;
  }, [resolvedItems]);

  // A selected item that is no longer on this board (renamed, deleted, or we
  // navigated into a sub-board) must not keep a rim alive against nothing.
  useEffect(() => {
    if (selectedPath && !items.some((item) => item.path === selectedPath)) {
      setSelectedPath(null);
    }
  }, [items, selectedPath]);

  // ── SKY-11494 BD-2: keep the dot grid on top of the world ───────────────
  // The grid is painted on the panel, but the world it describes is
  // translated by `pan`, scaled by `zoom`, and scrolled inside the panel. The
  // mockup binds background-size to `20 * scale` and background-position to
  // the pan offset; ours additionally subtracts the scroll offset, because our
  // world scrolls and the mockup's fixed 3200x2200 one does not.
  //
  // Written straight onto the element instead of through an inline style prop:
  // panning and scrolling then cost one style write, not a re-render of every
  // tile on a board that is uncapped at 200+ (spec §6).
  const syncGridToWorld = useCallback(() => {
    const root = containerRef.current;
    if (!root) return;
    const scroller = scrollAreaRef.current;
    root.style.setProperty('--board-grid-size', `${GRID_SNAP * scale}px`);
    root.style.setProperty('--board-grid-x', `${pan.x - (scroller?.scrollLeft ?? 0)}px`);
    root.style.setProperty('--board-grid-y', `${pan.y - (scroller?.scrollTop ?? 0)}px`);
  }, [scale, pan]);

  useLayoutEffect(syncGridToWorld, [syncGridToWorld]);

  const handleScroll = useCallback(() => {
    syncGridToWorld();
    trackScroll();
  }, [syncGridToWorld, trackScroll]);

  // ── Pan via middle-mouse drag ───────────────────────────────────────────
  const panDragRef = useRef<{ startX: number; startY: number; startPanX: number; startPanY: number } | null>(null);

  const handleMouseDownCanvas = useCallback((e: MouseEvent<HTMLDivElement>) => {
    if (e.button === 0) {
      // Item mousedown stops propagation, so a left press that reaches the
      // panel is empty canvas — clear the selection. The zoom pill lives
      // inside the panel and is not canvas.
      if (!(e.target as HTMLElement).closest('.board-canvas__zoom-controls')) {
        setSelectedPath(null);
      }
      return;
    }
    if (e.button !== 1) return; // middle button pans
    e.preventDefault();
    panDragRef.current = { startX: e.clientX, startY: e.clientY, startPanX: pan.x, startPanY: pan.y };
  }, [pan]);

  useEffect(() => {
    const onMouseMove = (e: globalThis.MouseEvent) => {
      if (!panDragRef.current) return;
      const dx = e.clientX - panDragRef.current.startX;
      const dy = e.clientY - panDragRef.current.startY;
      setPan({
        x: Math.min(0, panDragRef.current.startPanX + dx),
        y: Math.min(0, panDragRef.current.startPanY + dy),
      });
    };
    const onMouseUp = () => {
      if (panDragRef.current) {
        panDragRef.current = null;
        // view change persisted by effect below
      }
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  // ── Zoom via wheel ──────────────────────────────────────────────────────
  const clampZoom = useCallback((z: number) => Math.min(ZOOM_MAX, Math.max(minZoom, z)), [minZoom]);

  const handleWheel = useCallback((e: WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    setZoom((z) => clampZoom(z + (e.deltaY < 0 ? ZOOM_WHEEL_DELTA : -ZOOM_WHEEL_DELTA)));
  }, [clampZoom]);

  const handleZoomIn = useCallback(() => setZoom((z) => clampZoom(z + ZOOM_BTN_DELTA)), [clampZoom]);
  const handleZoomOut = useCallback(() => setZoom((z) => clampZoom(z - ZOOM_BTN_DELTA)), [clampZoom]);
  const handleZoomReset = useCallback(() => setZoom(100), []);
  const atZoomOutLimit = zoom <= minZoom;
  const atZoomInLimit = zoom >= ZOOM_MAX;

  // Notify parent of view changes
  useEffect(() => {
    onViewChange?.(zoom, pan.x, pan.y);
  }, [zoom, pan, onViewChange]);

  // ── Item drag ───────────────────────────────────────────────────────────
  const itemDragRef = useRef<{
    path: string;
    startMouseX: number;
    startMouseY: number;
    startItemX: number;
    startItemY: number;
  } | null>(null);

  const [draggingPath, setDraggingPath] = useState<string | null>(null);
  const [localPositions, setLocalPositions] = useState<Record<string, { x: number; y: number }>>({});

  const handleItemMouseDown = useCallback((e: MouseEvent<HTMLDivElement>, path: string, rect: ItemRect) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('.board-canvas__resize-handle')) return;
    e.stopPropagation();
    setSelectedPath(path);
    itemDragRef.current = {
      path,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startItemX: rect.x,
      startItemY: rect.y,
    };
    setDraggingPath(path);
  }, []);

  useEffect(() => {
    const onMouseMove = (e: globalThis.MouseEvent) => {
      if (!itemDragRef.current) return;
      const dx = (e.clientX - itemDragRef.current.startMouseX) / scale;
      const dy = (e.clientY - itemDragRef.current.startMouseY) / scale;
      let nx = itemDragRef.current.startItemX + dx;
      let ny = itemDragRef.current.startItemY + dy;
      if (gridSnap) { nx = snapToGrid(nx); ny = snapToGrid(ny); }
      setLocalPositions((prev) => ({ ...prev, [itemDragRef.current!.path]: { x: nx, y: ny } }));
    };
    const onMouseUp = () => {
      if (itemDragRef.current) {
        const pos = localPositions[itemDragRef.current.path];
        if (pos) {
          onItemMove?.(itemDragRef.current.path, pos.x, pos.y);
        }
        itemDragRef.current = null;
        setDraggingPath(null);
      }
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [scale, gridSnap, localPositions, onItemMove]);

  // ── Item resize ─────────────────────────────────────────────────────────
  const resizeDragRef = useRef<{
    path: string;
    startMouseX: number;
    startMouseY: number;
    startW: number;
    startH: number;
  } | null>(null);
  const [localSizes, setLocalSizes] = useState<Record<string, { w: number; h: number }>>({});

  const handleResizeMouseDown = useCallback((e: MouseEvent<HTMLDivElement>, path: string, rect: ItemRect) => {
    e.stopPropagation();
    e.preventDefault();
    setSelectedPath(path);
    resizeDragRef.current = {
      path,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startW: rect.w,
      startH: rect.h,
    };
  }, []);

  useEffect(() => {
    const onMouseMove = (e: globalThis.MouseEvent) => {
      if (!resizeDragRef.current) return;
      const dx = (e.clientX - resizeDragRef.current.startMouseX) / scale;
      const dy = (e.clientY - resizeDragRef.current.startMouseY) / scale;
      const nw = Math.min(RESIZE_MAX_W, Math.max(RESIZE_MIN_W, resizeDragRef.current.startW + dx));
      const nh = Math.min(RESIZE_MAX_H, Math.max(RESIZE_MIN_H, resizeDragRef.current.startH + dy));
      setLocalSizes((prev) => ({ ...prev, [resizeDragRef.current!.path]: { w: nw, h: nh } }));
    };
    const onMouseUp = () => {
      if (resizeDragRef.current) {
        const size = localSizes[resizeDragRef.current.path];
        if (size) {
          onItemResize?.(resizeDragRef.current.path, size.w, size.h);
        }
        resizeDragRef.current = null;
      }
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [scale, localSizes, onItemResize]);

  const handleFocusItem = useCallback((path: string) => setSelectedPath(path), []);

  // ── Align guides — collect edges/centres of all non-dragged items ───────
  const [guideLines, setGuideLines] = useState<{ axis: 'h' | 'v'; pos: number }[]>([]);

  useEffect(() => {
    if (!draggingPath) { setGuideLines([]); return; }
    const pos = localPositions[draggingPath];
    if (!pos) { setGuideLines([]); return; }
    const dragItem = resolvedItems.find((r) => r.item.path === draggingPath);
    if (!dragItem) return;
    const def = defaultSize(dragItem.item.kind, dragItem.hasThumb);
    const dw = dragItem.layout.w ?? def.w;
    const dh = dragItem.layout.h ?? def.h;
    const guides: { axis: 'h' | 'v'; pos: number }[] = [];
    for (const other of resolvedItems) {
      if (other.item.path === draggingPath) continue;
      const ox = other.layout.x;
      const oy = other.layout.y;
      const odef = defaultSize(other.item.kind, other.hasThumb);
      const ow = other.layout.w ?? odef.w;
      const oh = other.layout.h ?? odef.h;
      // vertical edges & centre
      const vCandidates = [ox, ox + ow, ox + ow / 2];
      const hCandidates = [oy, oy + oh, oy + oh / 2];
      for (const vc of vCandidates) {
        if (Math.abs(pos.x - vc) < ALIGN_THRESHOLD || Math.abs(pos.x + dw - vc) < ALIGN_THRESHOLD || Math.abs(pos.x + dw / 2 - vc) < ALIGN_THRESHOLD) {
          guides.push({ axis: 'v', pos: vc });
        }
      }
      for (const hc of hCandidates) {
        if (Math.abs(pos.y - hc) < ALIGN_THRESHOLD || Math.abs(pos.y + dh - hc) < ALIGN_THRESHOLD || Math.abs(pos.y + dh / 2 - hc) < ALIGN_THRESHOLD) {
          guides.push({ axis: 'h', pos: hc });
        }
      }
    }
    setGuideLines(guides);
  }, [draggingPath, localPositions, resolvedItems]);

  // ── SKY-11186: cull, then pick each survivor's LOD tier ─────────────────
  // Items fully outside the cull rect are not mounted at all — at any zoom.
  // The dragged and the selected item are exempt (boardLod.shouldMount).
  const mountedCards: ReactElement[] = [];
  for (const r of resolvedItems) {
    const path = r.item.path;
    const pos = localPositions[path] ?? { x: r.layout.x, y: r.layout.y };
    const size = localSizes[path] ?? { w: r.layout.w, h: r.layout.h };
    const def = defaultSize(r.item.kind, r.hasThumb);
    const w = size.w ?? def.w;
    const h = size.h ?? def.h;
    const dragging = draggingPath === path;
    const selected = selectedPath === path;
    if (!shouldMount({ rect: { x: pos.x, y: pos.y, w, h }, dragging, selected }, cullRect)) continue;
    mountedCards.push(
      <BoardCard
        key={path}
        item={r.item}
        x={pos.x}
        y={pos.y}
        w={w}
        h={h}
        tier={lodTierForScreenWidth(w * scale, r.item.kind)}
        selected={selected}
        dragging={dragging}
        onItemMouseDown={handleItemMouseDown}
        onResizeMouseDown={handleResizeMouseDown}
        onFocusItem={handleFocusItem}
        onEnterBoard={onEnterBoard}
      />,
    );
  }

  return (
    <div
      className="board-canvas__root"
      ref={containerRef}
      onMouseDown={handleMouseDownCanvas}
      onWheel={handleWheel}
      data-min-zoom={minZoom}
      data-mounted-count={mountedCards.length}
    >
      {/* Zoom controls */}
      <div className="board-canvas__zoom-controls" role="group" aria-label="Zoom controls">
        <button
          className={`board-canvas__zoom-btn${atZoomOutLimit ? ' board-canvas__zoom-btn--at-limit' : ''}`}
          onClick={handleZoomOut}
          aria-label="Zoom out"
          aria-disabled={atZoomOutLimit || undefined}
          title={
            atZoomOutLimit
              ? `Zoom-out limit: ${minZoom}%. Change it in Settings → Editor → Notes Board.`
              : 'Zoom out (−10%)'
          }
        >
          −
        </button>
        <button className="board-canvas__zoom-reset" onClick={handleZoomReset} aria-label={`Zoom: ${zoom}%. Click to reset`} title="Reset zoom">
          {zoom}%
        </button>
        <button
          className={`board-canvas__zoom-btn${atZoomInLimit ? ' board-canvas__zoom-btn--at-limit' : ''}`}
          onClick={handleZoomIn}
          aria-label="Zoom in"
          aria-disabled={atZoomInLimit || undefined}
          title={atZoomInLimit ? `Zoom-in limit: ${ZOOM_MAX}%.` : 'Zoom in (+10%)'}
        >
          +
        </button>
      </div>

      {/* Scrollable canvas area */}
      <div className="board-canvas__scroll-area" ref={scrollAreaRef} onScroll={handleScroll}>
        {/*
          The world is zoomed with a CSS transform, which leaves its layout
          box at the unscaled size — so on its own the panel would keep
          scrolling over 100%-sized emptiness at 40%, and a board zoomed out
          from deep down would sit in dead space below the last row. The
          sizer is the world's visual footprint at the current zoom and clips
          the layout box to it, so the scrollbars always describe what is
          painted.
        */}
        <div
          className="board-canvas__sizer"
          style={{ width: containerWidth * scale, height: canvasHeight * scale }}
        >
          <div
            className="board-canvas__world"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
              transformOrigin: '0 0',
              width: containerWidth,
              height: canvasHeight,
              position: 'relative',
            }}
          >
            {/* Align guides */}
            {guideLines.map((g, i) =>
              g.axis === 'v'
                ? <div key={i} className="board-canvas__guide board-canvas__guide--v" style={{ left: g.pos }} />
                : <div key={i} className="board-canvas__guide board-canvas__guide--h" style={{ top: g.pos }} />
            )}

            {mountedCards}
          </div>
        </div>
      </div>
    </div>
  );
}
