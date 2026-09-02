/**
 * SKY-11184: Notes Board canvas — zoom/pan/drag/resize with auto-layout fallback.
 * BOARDS-SPEC.md §1, §6.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MouseEvent, WheelEvent } from 'react';
import './BoardCanvas.css';

// ── spec §6 constants ───────────────────────────────────────────────────────
const CELL_W = 268;
const CELL_H = 216;
const ORIGIN_X = 48;
const ORIGIN_Y = 44;
const BOARD_DEFAULT_W = 190;
const BOARD_DEFAULT_H = 138;
const CARD_DEFAULT_W = 236;
const CARD_DEFAULT_H = 154;
const RESIZE_MIN_W = 150;
const RESIZE_MAX_W = 720;
const RESIZE_MIN_H = 100;
const RESIZE_MAX_H = 760;
const GRID_SNAP = 20;
const ZOOM_MIN = 40;
const ZOOM_MAX = 170;
const ZOOM_WHEEL_DELTA = 8;
const ZOOM_BTN_DELTA = 10;
const ALIGN_THRESHOLD = 7;

function snapToGrid(v: number): number {
  return Math.round(v / GRID_SNAP) * GRID_SNAP;
}

export interface BoardItem {
  /** vault-relative path */
  path: string;
  kind: 'folder' | 'note';
  name: string;
  /** count of direct children (boards/cards) — for board tile subtitle */
  childBoards?: number;
  childCards?: number;
  /** preview text excerpt (first ~120 chars of note content) */
  excerpt?: string;
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
  /** Called when an item is dragged to a new position */
  onItemMove?: (itemPath: string, x: number, y: number) => void;
  /** Called when an item is resized */
  onItemResize?: (itemPath: string, w: number, h: number) => void;
  /** Called when view state changes (zoom/pan) */
  onViewChange?: (zoom: number, panX: number, panY: number) => void;
  /** Double-click a board tile to enter it */
  onEnterBoard?: (folderPath: string) => void;
}

interface ResolvedItem extends BoardItem {
  layout: ItemLayout;
  autoLayout: boolean;
}

function autoLayoutItem(index: number, canvasWidth: number): ItemLayout {
  const cols = Math.max(1, Math.floor((canvasWidth - ORIGIN_X) / CELL_W));
  return {
    x: ORIGIN_X + (index % cols) * CELL_W,
    y: ORIGIN_Y + Math.floor(index / cols) * CELL_H,
  };
}

function defaultSize(kind: 'folder' | 'note'): { w: number; h: number } {
  return kind === 'folder'
    ? { w: BOARD_DEFAULT_W, h: BOARD_DEFAULT_H }
    : { w: CARD_DEFAULT_W, h: CARD_DEFAULT_H };
}

export default function BoardCanvas({
  items,
  savedLayout,
  savedView,
  gridSnap = true,
  onItemMove,
  onItemResize,
  onViewChange,
  onEnterBoard,
}: BoardCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(900);
  const [zoom, setZoom] = useState(savedView.zoom || 100);
  const [pan, setPan] = useState({ x: savedView.panX || 0, y: savedView.panY || 0 });

  // Resolve items: merge saved layout with auto-layout for unsaved items
  const resolvedItems: ResolvedItem[] = items.map((item, i) => {
    const saved = savedLayout[item.path];
    if (saved) {
      return { ...item, layout: saved, autoLayout: false };
    }
    return {
      ...item,
      layout: autoLayoutItem(i, containerWidth),
      autoLayout: true,
    };
  });

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

  // Compute canvas height to fit all items (no fixed world size — spec §6)
  const canvasHeight = Math.max(
    600,
    ...resolvedItems.map((item) => {
      const def = defaultSize(item.kind);
      return item.layout.y + (item.layout.h ?? def.h) + ORIGIN_Y;
    }),
  );

  // ── Pan via middle-mouse drag ───────────────────────────────────────────
  const panDragRef = useRef<{ startX: number; startY: number; startPanX: number; startPanY: number } | null>(null);

  const handleMouseDownCanvas = useCallback((e: MouseEvent<HTMLDivElement>) => {
    if (e.button !== 1) return; // middle button only
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
  const handleWheel = useCallback((e: WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z + (e.deltaY < 0 ? ZOOM_WHEEL_DELTA : -ZOOM_WHEEL_DELTA))));
  }, []);

  const handleZoomIn = useCallback(() => setZoom((z) => Math.min(ZOOM_MAX, z + ZOOM_BTN_DELTA)), []);
  const handleZoomOut = useCallback(() => setZoom((z) => Math.max(ZOOM_MIN, z - ZOOM_BTN_DELTA)), []);
  const handleZoomReset = useCallback(() => setZoom(100), []);

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

  const handleItemMouseDown = useCallback((e: MouseEvent<HTMLDivElement>, item: ResolvedItem) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('.board-canvas__resize-handle')) return;
    e.stopPropagation();
    itemDragRef.current = {
      path: item.path,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startItemX: item.layout.x,
      startItemY: item.layout.y,
    };
    setDraggingPath(item.path);
  }, []);

  useEffect(() => {
    const scale = zoom / 100;
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
  }, [zoom, gridSnap, localPositions, onItemMove]);

  // ── Item resize ─────────────────────────────────────────────────────────
  const resizeDragRef = useRef<{
    path: string;
    startMouseX: number;
    startMouseY: number;
    startW: number;
    startH: number;
  } | null>(null);
  const [localSizes, setLocalSizes] = useState<Record<string, { w: number; h: number }>>({});

  const handleResizeMouseDown = useCallback((e: MouseEvent<HTMLDivElement>, item: ResolvedItem) => {
    e.stopPropagation();
    e.preventDefault();
    const def = defaultSize(item.kind);
    resizeDragRef.current = {
      path: item.path,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startW: item.layout.w ?? def.w,
      startH: item.layout.h ?? def.h,
    };
  }, []);

  useEffect(() => {
    const scale = zoom / 100;
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
  }, [zoom, localSizes, onItemResize]);

  // ── Align guides — collect edges/centres of all non-dragged items ───────
  const [guideLines, setGuideLines] = useState<{ axis: 'h' | 'v'; pos: number }[]>([]);

  useEffect(() => {
    if (!draggingPath) { setGuideLines([]); return; }
    const pos = localPositions[draggingPath];
    if (!pos) { setGuideLines([]); return; }
    const dragItem = resolvedItems.find((i) => i.path === draggingPath);
    if (!dragItem) return;
    const def = defaultSize(dragItem.kind);
    const dw = dragItem.layout.w ?? def.w;
    const dh = dragItem.layout.h ?? def.h;
    const guides: { axis: 'h' | 'v'; pos: number }[] = [];
    for (const other of resolvedItems) {
      if (other.path === draggingPath) continue;
      const ox = other.layout.x;
      const oy = other.layout.y;
      const odef = defaultSize(other.kind);
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

  return (
    <div className="board-canvas__root" ref={containerRef} onMouseDown={handleMouseDownCanvas} onWheel={handleWheel}>
      {/* Zoom controls */}
      <div className="board-canvas__zoom-controls" role="group" aria-label="Zoom controls">
        <button className="board-canvas__zoom-btn" onClick={handleZoomOut} aria-label="Zoom out" title="Zoom out (−10%)">−</button>
        <button className="board-canvas__zoom-reset" onClick={handleZoomReset} aria-label={`Zoom: ${zoom}%. Click to reset`} title="Reset zoom">
          {zoom}%
        </button>
        <button className="board-canvas__zoom-btn" onClick={handleZoomIn} aria-label="Zoom in" title="Zoom in (+10%)">+</button>
      </div>

      {/* Scrollable canvas area */}
      <div className="board-canvas__scroll-area">
        <div
          className="board-canvas__world"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom / 100})`,
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

          {resolvedItems.map((item) => {
            const pos = localPositions[item.path] ?? { x: item.layout.x, y: item.layout.y };
            const size = localSizes[item.path] ?? { w: item.layout.w, h: item.layout.h };
            const def = defaultSize(item.kind);
            const w = size.w ?? def.w;
            const h = size.h ?? def.h;
            const isDragging = draggingPath === item.path;

            return (
              <div
                key={item.path}
                className={`board-canvas__item board-canvas__item--${item.kind}${isDragging ? ' board-canvas__item--dragging' : ''}`}
                style={{ left: pos.x, top: pos.y, width: w, height: h }}
                onMouseDown={(e) => handleItemMouseDown(e, { ...item, layout: { ...item.layout, x: pos.x, y: pos.y, w, h } })}
                onDoubleClick={item.kind === 'folder' ? () => onEnterBoard?.(item.path) : undefined}
                role={item.kind === 'folder' ? 'button' : 'article'}
                aria-label={item.kind === 'folder' ? `Board: ${item.name}. Double-click to open.` : `Note card: ${item.name}`}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (item.kind === 'folder' && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    onEnterBoard?.(item.path);
                  }
                }}
              >
                <div className="board-canvas__item-header">
                  <span className="board-canvas__item-name">{item.name}</span>
                </div>
                {item.kind === 'folder' && (
                  <div className="board-canvas__item-meta">
                    {item.childBoards ?? 0} boards, {item.childCards ?? 0} cards
                  </div>
                )}
                {item.kind === 'note' && item.excerpt && (
                  <div className="board-canvas__item-excerpt">{item.excerpt}</div>
                )}
                <div
                  className="board-canvas__resize-handle"
                  onMouseDown={(e) => handleResizeMouseDown(e, { ...item, layout: { ...item.layout, x: pos.x, y: pos.y, w, h } })}
                  aria-hidden="true"
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
