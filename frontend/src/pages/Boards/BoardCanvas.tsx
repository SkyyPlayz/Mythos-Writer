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
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent, ReactElement, WheelEvent } from 'react';
import BoardCard, { itemHasThumb } from './BoardCard';
import type { BoardItem, ItemRect } from './BoardCard';
import BoardFurniture from './BoardFurniture';
import type { BoardFurnitureItemData } from './BoardFurniture';
import BoardLinkOverlay from './BoardLinkOverlay';
import BoardMinimapPanel from './BoardMinimapPanel';
import { connectorSegments, furnitureAnchorKey } from './boardLinks';
import type { AnchorRect, BoardWikiLink } from './boardLinks';
import { minimapViewportRect, scrollToCentreWorldPoint } from './boardMinimap';
import type { MinimapBox } from './boardMinimap';
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
  defaultFurnitureSize,
  defaultSize,
  expandRect,
  lodTierForScreenWidth,
  shouldMount,
  visibleWorldRect,
} from './boardLod';
import './BoardCanvas.css';

export type { BoardItem } from './BoardCard';
export type { BoardFurnitureItemData } from './BoardFurniture';

/**
 * A furniture item's resolved on-screen box — the live one, drag and resize
 * already applied. Collected twice: by furniture id (`furnitureRects`, what
 * the box is painted at and what a wiki-link connector anchors on) and by
 * item key `v:/n:/x:` (`keyRects`, what a `line` looks its endpoints up in).
 */
interface KeyRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function snapToGrid(v: number): number {
  return Math.round(v / GRID_SNAP) * GRID_SNAP;
}

export interface ItemLayout {
  x: number;
  y: number;
  w?: number;
  h?: number;
}

/**
 * SKY-11187 §5: the canvas tools. `select` is the ordinary pointer; `note`
 * and `board` are one-shot placement tools — the next click on empty canvas
 * creates a real file/folder there and hands the tool back to `select`, so
 * the canvas is never left in a state where a stray click writes to the vault.
 */
export type BoardTool = 'select' | 'note' | 'board';

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
  /**
   * SKY-11187 §5: the active placement tool. `select` (the default) leaves
   * every existing gesture exactly as it was — no tool, no vault writes.
   */
  activeTool?: BoardTool;
  /**
   * A placement tool was used on empty canvas at world position (x, y).
   * The canvas does not create anything itself — it reports the intent and
   * the panel owns the filesystem call (§5).
   */
  onCreateItem?: (kind: 'note' | 'folder', x: number, y: number) => void;
  /** Path (board-relative) of the item currently in inline rename, if any. */
  renamingPath?: string | null;
  /** The user asked to rename this item (F2 or the context menu). */
  onRequestRename?: (itemPath: string) => void;
  /** Commit a typed name. Empty/unchanged is resolved as a no-op in main. */
  onRenameCommit?: (itemPath: string, newName: string) => void;
  onRenameCancel?: () => void;
  /**
   * SKY-11189 §7/§8: Delete/Backspace or the context menu's Delete entry, for
   * the current selection (one or more paths, board-relative — matches every
   * other item path in this component). The canvas does not trash anything
   * itself — same "report the intent, the panel owns the filesystem call"
   * split §5's onCreateItem already established.
   */
  onTrashItems?: (itemPaths: string[]) => void;

  // ── SKY-11188: furniture (§4) ──
  /** Board-only items (columns, checklists, tables, images, sketches, swatches, lines). */
  furniture?: BoardFurnitureItemData[];
  /** Every TOUCHED card/tile's own item key (`v:<id>`/`n:<id>`), by its `path` — a `line`'s endpoint may name one of these. Untouched (never-arranged) items have no id yet and cannot be a line endpoint. */
  itemKeysByPath?: Record<string, string>;
  onFurnitureMove?: (id: string, x: number, y: number) => void;
  onFurnitureResize?: (id: string, w: number, h: number) => void;
  onFurnitureDelete?: (id: string) => void;
  onFurnitureCheckToggle?: (id: string, index: number) => void;
  /** Spec §4: clicking a swatch colour applies it. Scoped here to the swatch's OWN `color` field, not a cross-item "current selection" apply — see BoardsTabPanel. */
  onFurnitureColor?: (id: string, hex: string) => void;
  /** A column item's `ref` — a vault-relative note path kept live by the rename cascade (§4/§2). */
  onOpenNoteRef?: (ref: string) => void;
  /**
   * SKY-11188: "Connect" tool — while active, clicking a furniture item
   * picks it as a `line` endpoint instead of starting a drag (mirrors the
   * prototype's `bdTool === 'line'` behaviour, scoped to furniture-only
   * endpoints for this ticket).
   */
  lineToolActive?: boolean;
  onFurniturePick?: (id: string) => void;

  // ── SKY-11191: wiki-link overlay + minimap (§11) ──
  /**
   * SKY-11191 §11: the wiki-link overlay's connectors, as ANCHOR KEY pairs
   * (an item path, or `furniture:<id>`). The panel owns the link graph; the
   * canvas owns the geometry, because only it knows where a card ended up
   * after auto-layout, a drag or a resize.
   */
  wikiLinks?: readonly BoardWikiLink[];
  /** Draw those connectors. Off by default — the overlay is a toggle (§11). */
  wikiLinkOverlay?: boolean;
  /**
   * FALLBACK rects for anchors the canvas cannot resolve itself, keyed the
   * same way `wikiLinks` are. The panel derives ticket 5's `column` boxes
   * from Store B and passes them here; where the canvas also lays that anchor
   * out, its own live rect wins, so a connector tracks a drag in progress
   * instead of waiting for the commit (SKY-11717).
   */
  linkAnchors?: ReadonlyMap<string, AnchorRect>;
  /** SKY-11191 §11: show the derived minimap. */
  showMinimap?: boolean;
  /**
   * SKY-11191 §11: select an item and scroll it into view — a cross-board
   * search hit landing on this board. `seq` is bumped per request so picking
   * the same hit twice re-reveals it.
   */
  selectRequest?: { itemPath: string; seq: number } | null;
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
  activeTool = 'select',
  onCreateItem,
  renamingPath = null,
  onRequestRename,
  onRenameCommit,
  onRenameCancel,
  onTrashItems,
  furniture = [],
  itemKeysByPath = {},
  onFurnitureMove,
  onFurnitureResize,
  onFurnitureDelete,
  onFurnitureCheckToggle,
  onFurnitureColor,
  onOpenNoteRef,
  lineToolActive = false,
  onFurniturePick,
  wikiLinks,
  wikiLinkOverlay = false,
  linkAnchors,
  showMinimap = false,
  selectRequest = null,
}: BoardCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(900);
  const [zoom, setZoom] = useState(savedView.zoom || 100);
  const [pan, setPan] = useState({ x: savedView.panX || 0, y: savedView.panY || 0 });
  // SKY-11494 BD-3: the neon rim is the mockup's *selection* affordance, so the
  // canvas needs a selection to spend it on. View-local and deliberately not
  // persisted — it is a pointer state, not board content.
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  // SKY-11188: furniture selection is tracked separately from card selection
  // (mutually exclusive — selecting one clears the other) rather than
  // unifying the two into one generic key, so the existing card drag/resize
  // code above is untouched by this ticket.
  const [selectedFurnitureId, setSelectedFurnitureId] = useState<string | null>(null);
  // SKY-11189 §7: a ctrl/cmd/shift+click adds to this set instead of replacing
  // `selectedPath` — "canvas Delete/Backspace trashes the entire current
  // selection" needs a real multi-selection, which nothing on this canvas
  // had before (drag/resize/rename all stay single-item, keyed off
  // `selectedPath`). Empty means "no additive selection is active" — the
  // effective selection then falls back to `selectedPath` alone.
  const [multiSelected, setMultiSelected] = useState<Set<string>>(new Set());
  const effectiveSelection = useMemo(
    () => (multiSelected.size > 0 ? multiSelected : new Set(selectedPath ? [selectedPath] : [])),
    [multiSelected, selectedPath],
  );

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
    for (const f of furniture) {
      if (f.k === 'line') continue;
      const def = defaultFurnitureSize(f.k, furnitureCount(f), { w: f.w, h: f.h });
      max = Math.max(max, f.y + (f.h ?? def.h) + ORIGIN_Y);
    }
    return max;
  }, [resolvedItems, furniture]);

  // A selected item that is no longer on this board (renamed, deleted, or we
  // navigated into a sub-board) must not keep a rim alive against nothing.
  useEffect(() => {
    if (selectedPath && !items.some((item) => item.path === selectedPath)) {
      setSelectedPath(null);
    }
    setMultiSelected((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set([...prev].filter((p) => items.some((item) => item.path === p)));
      return next.size === prev.size ? prev : next;
    });
  }, [items, selectedPath]);

  useEffect(() => {
    if (selectedFurnitureId && !furniture.some((f) => f.id === selectedFurnitureId)) {
      setSelectedFurnitureId(null);
    }
  }, [furniture, selectedFurnitureId]);

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

  /**
   * SKY-11187: screen point → world coordinates. The world element carries
   * the pan translate and the zoom scale, so its own client rect already
   * describes where world (0, 0) is on screen and how big a world pixel is —
   * dividing by `scale` is the whole conversion, and it stays correct while
   * the panel is scrolled.
   */
  const worldPointFrom = useCallback((clientX: number, clientY: number) => {
    const rect = worldRef.current?.getBoundingClientRect();
    if (!rect) return null;
    let x = (clientX - rect.left) / scale;
    let y = (clientY - rect.top) / scale;
    if (gridSnap) { x = snapToGrid(x); y = snapToGrid(y); }
    // The world has no negative quadrant (auto-layout starts at ORIGIN_Y and
    // the sizer clips to the painted footprint), so a click on the very edge
    // must not place a card at a coordinate nothing can scroll to.
    return { x: Math.max(0, x), y: Math.max(0, y) };
  }, [scale, gridSnap]);

  const handleMouseDownCanvas = useCallback((e: MouseEvent<HTMLDivElement>) => {
    if (e.button === 0) {
      // Item mousedown stops propagation, so a left press that reaches the
      // panel is empty canvas — clear the selection. The zoom pill lives
      // inside the panel and is not canvas.
      if ((e.target as HTMLElement).closest('.board-canvas__zoom-controls')) return;
      setSelectedPath(null);
      setSelectedFurnitureId(null);
      setMultiSelected(new Set());
      // SKY-11187 §5: a placement tool turns that same empty-canvas press
      // into a real vault create at the click point.
      if (activeTool !== 'select') {
        const point = worldPointFrom(e.clientX, e.clientY);
        if (point) onCreateItem?.(activeTool === 'board' ? 'folder' : 'note', point.x, point.y);
      }
      return;
    }
    if (e.button !== 1) return; // middle button pans
    e.preventDefault();
    panDragRef.current = { startX: e.clientX, startY: e.clientY, startPanX: pan.x, startPanY: pan.y };
  }, [pan, activeTool, onCreateItem, worldPointFrom]);

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
    /**
     * Latest dragged-to position. Mirrored on the ref rather than read back
     * out of `localPositions` at mouseup: that state is captured in this
     * effect's closure, so a drag whose move and release land in the SAME
     * React batch (a flick, or any synthetic input) would persist the
     * pre-drag position — or nothing at all.
     */
    latest: { x: number; y: number } | null;
  } | null>(null);

  const [draggingPath, setDraggingPath] = useState<string | null>(null);
  const [localPositions, setLocalPositions] = useState<Record<string, { x: number; y: number }>>({});

  const handleItemMouseDown = useCallback((e: MouseEvent<HTMLDivElement>, path: string, rect: ItemRect) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('.board-canvas__resize-handle')) return;
    // SKY-11187: with a placement tool armed, a press on a card is still a
    // press on the canvas — let it bubble so the tool places there instead of
    // starting a drag the user did not ask for.
    if (activeTool !== 'select') return;
    e.stopPropagation();
    // SKY-11189 §7: ctrl/cmd/shift+click toggles membership in the
    // multi-selection instead of starting a drag — a modifier click is a
    // selection gesture, not a move (and the existing single-select drag
    // below is keyed off exactly one path, so a multi-selected drag isn't
    // something this canvas supports).
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      setMultiSelected((prev) => {
        const base = prev.size > 0 ? prev : new Set(selectedPath ? [selectedPath] : []);
        const next = new Set(base);
        if (next.has(path)) next.delete(path); else next.add(path);
        return next;
      });
      setSelectedPath(path);
      return;
    }
    setMultiSelected(new Set());
    setSelectedPath(path);
    setSelectedFurnitureId(null);
    itemDragRef.current = {
      path,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startItemX: rect.x,
      startItemY: rect.y,
      latest: null,
    };
    setDraggingPath(path);
  }, [activeTool, selectedPath]);

  useEffect(() => {
    const onMouseMove = (e: globalThis.MouseEvent) => {
      const drag = itemDragRef.current;
      if (!drag) return;
      const dx = (e.clientX - drag.startMouseX) / scale;
      const dy = (e.clientY - drag.startMouseY) / scale;
      let nx = drag.startItemX + dx;
      let ny = drag.startItemY + dy;
      if (gridSnap) { nx = snapToGrid(nx); ny = snapToGrid(ny); }
      drag.latest = { x: nx, y: ny };
      // `drag.path`, not itemDragRef.current.path: React runs this updater at
      // render time, not at dispatch time, so a mouseup landing in the same
      // batch as the move would have already nulled the ref out from under it.
      setLocalPositions((prev) => ({ ...prev, [drag.path]: { x: nx, y: ny } }));
    };
    const onMouseUp = () => {
      const drag = itemDragRef.current;
      if (!drag) return;
      if (drag.latest) onItemMove?.(drag.path, drag.latest.x, drag.latest.y);
      itemDragRef.current = null;
      setDraggingPath(null);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [scale, gridSnap, onItemMove]);

  // ── Item resize ─────────────────────────────────────────────────────────
  const resizeDragRef = useRef<{
    path: string;
    startMouseX: number;
    startMouseY: number;
    startW: number;
    startH: number;
    /** Latest resized-to size — same closure-staleness reason as the drag's `latest`. */
    latest: { w: number; h: number } | null;
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
      latest: null,
    };
  }, []);

  useEffect(() => {
    const onMouseMove = (e: globalThis.MouseEvent) => {
      const resize = resizeDragRef.current;
      if (!resize) return;
      const dx = (e.clientX - resize.startMouseX) / scale;
      const dy = (e.clientY - resize.startMouseY) / scale;
      const nw = Math.min(RESIZE_MAX_W, Math.max(RESIZE_MIN_W, resize.startW + dx));
      const nh = Math.min(RESIZE_MAX_H, Math.max(RESIZE_MIN_H, resize.startH + dy));
      // Same render-time-updater hazard as the drag above — read the path off
      // the captured snapshot, not off the ref.
      resize.latest = { w: nw, h: nh };
      setLocalSizes((prev) => ({ ...prev, [resize.path]: { w: nw, h: nh } }));
    };
    const onMouseUp = () => {
      const resize = resizeDragRef.current;
      if (!resize) return;
      if (resize.latest) onItemResize?.(resize.path, resize.latest.w, resize.latest.h);
      resizeDragRef.current = null;
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [scale, onItemResize]);

  const handleFocusItem = useCallback((path: string) => setSelectedPath(path), []);

  // ── SKY-11187 §5: inline rename + the context menu that reaches it ───────
  // The renaming card is always the selected one, which also exempts it from
  // culling (boardLod.shouldMount) — a card being named must never be
  // unmounted out from under the caret because the viewport moved.
  useEffect(() => {
    if (renamingPath) setSelectedPath(renamingPath);
  }, [renamingPath]);

  const [contextMenu, setContextMenu] = useState<{ path: string; x: number; y: number } | null>(null);

  const handleItemContextMenu = useCallback((e: MouseEvent<HTMLDivElement>, path: string) => {
    e.preventDefault();
    e.stopPropagation();
    // SKY-11189 §7: right-clicking a card that is already part of the
    // current multi-selection keeps that whole selection (so Delete acts on
    // all of it) — right-clicking anything else resets to just that card,
    // the same "click elsewhere clears it" convention every other selection
    // gesture on this canvas follows.
    if (!effectiveSelection.has(path)) {
      setMultiSelected(new Set());
      setSelectedPath(path);
    }
    setContextMenu({ path, x: e.clientX, y: e.clientY });
  }, [effectiveSelection]);

  const handleTrashSelection = useCallback(() => {
    const targets = [...effectiveSelection];
    if (targets.length === 0) return;
    setSelectedPath(null);
    setMultiSelected(new Set());
    setContextMenu(null);
    onTrashItems?.(targets);
  }, [effectiveSelection, onTrashItems]);

  // SKY-11189 §7: Delete/Backspace trashes the entire current selection.
  // Guarded off text inputs and the inline-rename box exactly like the
  // other keyboard shortcuts in this app (DesktopShell's own keydown
  // handler follows the same inText pattern).
  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (renamingPath) return;
      const target = e.target as HTMLElement;
      const inText = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      if (inText) return;
      if (effectiveSelection.size === 0) return;
      e.preventDefault();
      handleTrashSelection();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [effectiveSelection, renamingPath, handleTrashSelection]);

  // Any press elsewhere, a scroll, or Escape dismisses the menu — it is a
  // transient pointer affordance, never something to click your way out of.
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [contextMenu]);

  // ── SKY-11188: furniture drag/resize — same pattern as items above, keyed
  // by furniture id instead of path (a furniture item has no vault path). ──
  const furnitureDragRef = useRef<{
    id: string;
    startMouseX: number;
    startMouseY: number;
    startX: number;
    startY: number;
  } | null>(null);
  const [draggingFurnitureId, setDraggingFurnitureId] = useState<string | null>(null);
  const [localFurniturePositions, setLocalFurniturePositions] = useState<Record<string, { x: number; y: number }>>({});

  const handleFurnitureMouseDown = useCallback((e: MouseEvent<HTMLDivElement>, id: string, rect: { x: number; y: number; w: number; h: number }) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('.board-canvas__resize-handle')) return;
    e.stopPropagation();
    if (lineToolActive) {
      onFurniturePick?.(id);
      return;
    }
    setSelectedFurnitureId(id);
    setSelectedPath(null);
    furnitureDragRef.current = { id, startMouseX: e.clientX, startMouseY: e.clientY, startX: rect.x, startY: rect.y };
    setDraggingFurnitureId(id);
  }, [lineToolActive, onFurniturePick]);

  useEffect(() => {
    const onMouseMove = (e: globalThis.MouseEvent) => {
      if (!furnitureDragRef.current) return;
      const dx = (e.clientX - furnitureDragRef.current.startMouseX) / scale;
      const dy = (e.clientY - furnitureDragRef.current.startMouseY) / scale;
      let nx = furnitureDragRef.current.startX + dx;
      let ny = furnitureDragRef.current.startY + dy;
      if (gridSnap) { nx = snapToGrid(nx); ny = snapToGrid(ny); }
      setLocalFurniturePositions((prev) => ({ ...prev, [furnitureDragRef.current!.id]: { x: nx, y: ny } }));
    };
    const onMouseUp = () => {
      if (furnitureDragRef.current) {
        const pos = localFurniturePositions[furnitureDragRef.current.id];
        if (pos) onFurnitureMove?.(furnitureDragRef.current.id, pos.x, pos.y);
        furnitureDragRef.current = null;
        setDraggingFurnitureId(null);
      }
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [scale, gridSnap, localFurniturePositions, onFurnitureMove]);

  const furnitureResizeDragRef = useRef<{ id: string; startMouseX: number; startMouseY: number; startW: number; startH: number } | null>(null);
  const [localFurnitureSizes, setLocalFurnitureSizes] = useState<Record<string, { w: number; h: number }>>({});

  const handleFurnitureResizeMouseDown = useCallback((e: MouseEvent<HTMLDivElement>, id: string, rect: { x: number; y: number; w: number; h: number }) => {
    e.stopPropagation();
    e.preventDefault();
    setSelectedFurnitureId(id);
    setSelectedPath(null);
    furnitureResizeDragRef.current = { id, startMouseX: e.clientX, startMouseY: e.clientY, startW: rect.w, startH: rect.h };
  }, []);

  useEffect(() => {
    const onMouseMove = (e: globalThis.MouseEvent) => {
      if (!furnitureResizeDragRef.current) return;
      const dx = (e.clientX - furnitureResizeDragRef.current.startMouseX) / scale;
      const dy = (e.clientY - furnitureResizeDragRef.current.startMouseY) / scale;
      const nw = Math.min(RESIZE_MAX_W, Math.max(RESIZE_MIN_W, furnitureResizeDragRef.current.startW + dx));
      const nh = Math.min(RESIZE_MAX_H, Math.max(RESIZE_MIN_H, furnitureResizeDragRef.current.startH + dy));
      setLocalFurnitureSizes((prev) => ({ ...prev, [furnitureResizeDragRef.current!.id]: { w: nw, h: nh } }));
    };
    const onMouseUp = () => {
      if (furnitureResizeDragRef.current) {
        const size = localFurnitureSizes[furnitureResizeDragRef.current.id];
        if (size) onFurnitureResize?.(furnitureResizeDragRef.current.id, size.w, size.h);
        furnitureResizeDragRef.current = null;
      }
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [scale, localFurnitureSizes, onFurnitureResize]);

  const handleFocusFurniture = useCallback((id: string) => { setSelectedFurnitureId(id); setSelectedPath(null); }, []);

  /** Furniture item count that drives its default height (§6) — items.length for column/check, rows.length for table. */
  function furnitureCount(f: BoardFurnitureItemData): number {
    if (f.k === 'column' || f.k === 'check') return f.items?.length ?? 0;
    if (f.k === 'table') return f.rows?.length ?? 0;
    return 0;
  }

  const RESIZABLE_FURNITURE_KINDS = new Set(['column', 'check', 'table', 'image', 'sketch']);

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

  // ── Where every item actually IS, right now ─────────────────────────────
  // Saved layout, overridden by the live drag/resize. Computed once per
  // render for ALL items rather than only the mounted ones: a connector whose
  // far end is culled still has to leave the card it starts on, and the
  // minimap is a map of the whole board, not of the visible slice.
  const itemRects = useMemo(() => {
    return resolvedItems.map((r) => {
      const path = r.item.path;
      const pos = localPositions[path] ?? { x: r.layout.x, y: r.layout.y };
      const size = localSizes[path] ?? { w: r.layout.w, h: r.layout.h };
      const def = defaultSize(r.item.kind, r.hasThumb);
      return { r, x: pos.x, y: pos.y, w: size.w ?? def.w, h: size.h ?? def.h };
    });
  }, [resolvedItems, localPositions, localSizes]);

  // ── Where every furniture item actually IS, right now ───────────────────
  // The furniture half of `itemRects`: saved x/y/w/h, overridden by the live
  // drag/resize. Keyed by furniture id; both the rendered box and the two
  // connector layers read it, so a `line`, a wiki-link connector and the box
  // itself can never disagree about where a column is mid-drag (SKY-11717).
  const furnitureRects = useMemo(() => {
    const rects = new Map<string, KeyRect>();
    for (const f of furniture) {
      if (f.k === 'line') continue; // drawn from other items' rects — has no box of its own
      const pos = localFurniturePositions[f.id] ?? { x: f.x, y: f.y };
      const size = localFurnitureSizes[f.id] ?? { w: f.w, h: f.h };
      const def = defaultFurnitureSize(f.k, furnitureCount(f), { w: f.w, h: f.h });
      rects.set(f.id, { x: pos.x, y: pos.y, w: size.w ?? def.w, h: size.h ?? def.h });
    }
    return rects;
  }, [furniture, localFurniturePositions, localFurnitureSizes]);

  // ── SKY-11191 §11: wiki-link overlay ────────────────────────────────────
  // Anchors are item paths plus whatever extra boxes the panel supplied
  // (ticket 5's `column` furniture). Both maps are built only while the
  // overlay is on, so a board with the toggle off pays nothing for it.
  //
  // SKY-11717: the panel derives its `linkAnchors` from Store B, so those are
  // the COMMITTED x/y — they only move once a drag ends and the row reloads.
  // Wherever the canvas lays the same anchor out itself it knows better, so
  // its live rect is applied last and wins; `linkAnchors` stays the fallback
  // for anchors the canvas does not render.
  const linkSegments = useMemo(() => {
    if (!wikiLinkOverlay || !wikiLinks || wikiLinks.length === 0) return [];
    const anchors = new Map<string, AnchorRect>();
    for (const { r, x, y, w, h } of itemRects) anchors.set(r.item.path, { x, y, w, h });
    if (linkAnchors) for (const [key, rect] of linkAnchors) anchors.set(key, rect);
    for (const [id, rect] of furnitureRects) anchors.set(furnitureAnchorKey(id), rect);
    return connectorSegments(wikiLinks, anchors);
  }, [wikiLinkOverlay, wikiLinks, linkAnchors, itemRects, furnitureRects]);

  // ── SKY-11191 §11: minimap ──────────────────────────────────────────────
  const minimapBoxes: MinimapBox[] = useMemo(
    () =>
      showMinimap
        ? itemRects.map(({ r, x, y, w, h }) => ({ key: r.item.path, kind: r.item.kind, x, y, w, h }))
        : [],
    [showMinimap, itemRects],
  );

  const minimapWorld = useMemo(
    () => ({ w: containerWidth, h: canvasHeight }),
    [containerWidth, canvasHeight],
  );

  const minimapViewport = useMemo(
    () =>
      minimapViewportRect(
        { scrollLeft: scrollBucket.x, scrollTop: scrollBucket.y, clientWidth: viewportSize.w, clientHeight: viewportSize.h },
        pan,
        zoom,
        minimapWorld,
      ),
    [scrollBucket, viewportSize, pan, zoom, minimapWorld],
  );

  const handleMinimapNavigate = useCallback(
    (point: { x: number; y: number }) => {
      const el = scrollAreaRef.current;
      if (!el) return;
      const next = scrollToCentreWorldPoint(
        point,
        {
          clientWidth: el.clientWidth,
          clientHeight: el.clientHeight,
          scrollWidth: el.scrollWidth,
          scrollHeight: el.scrollHeight,
        },
        pan,
        zoom,
      );
      el.scrollLeft = next.scrollLeft;
      el.scrollTop = next.scrollTop;
      handleScroll();
    },
    [pan, zoom, handleScroll],
  );

  // ── SKY-11191 §11: reveal a searched-for item ───────────────────────────
  // The request routinely arrives BEFORE the board it points at has finished
  // loading, so this watches the resolved items rather than firing once: it
  // stays pending until the named item is actually on the board, then selects
  // and centres it. Selecting a path that is not there yet would be cleared
  // by the stale-selection guard above before the user ever saw it.
  const appliedSelectRef = useRef<number | null>(null);
  const selectSeq = selectRequest?.seq;
  const selectPath = selectRequest?.itemPath;

  useEffect(() => {
    if (selectSeq === undefined || selectPath === undefined) return;
    if (appliedSelectRef.current === selectSeq) return;
    const target = itemRects.find((entry) => entry.r.item.path === selectPath);
    if (!target) return; // not on this board yet — try again when it loads
    appliedSelectRef.current = selectSeq;
    setSelectedPath(selectPath);
    // Centre it: a hit can be far outside the mounted set, and a selection rim
    // the user has to go looking for is not a reveal.
    handleMinimapNavigate({ x: target.x + target.w / 2, y: target.y + target.h / 2 });
  }, [selectSeq, selectPath, itemRects, handleMinimapNavigate]);

  const instanceId = useId();

  // ── SKY-11186: cull, then pick each survivor's LOD tier ─────────────────
  // Items fully outside the cull rect are not mounted at all — at any zoom.
  // The dragged and the selected item are exempt (boardLod.shouldMount).
  const mountedCards: ReactElement[] = [];
  for (const { r, x: posX, y: posY, w, h } of itemRects) {
    const path = r.item.path;
    const pos = { x: posX, y: posY };
    const dragging = draggingPath === path;
    const selected = effectiveSelection.has(path);
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
        renaming={renamingPath === path}
        onItemMouseDown={handleItemMouseDown}
        onResizeMouseDown={handleResizeMouseDown}
        onFocusItem={handleFocusItem}
        onEnterBoard={onEnterBoard}
        onContextMenu={handleItemContextMenu}
        onRequestRename={onRequestRename}
        onRenameCommit={onRenameCommit}
        onRenameCancel={onRenameCancel}
      />,
    );
  }

  // ── SKY-11188: furniture — cull/mount the same way cards do, and build a
  // key → box map (cards + furniture) so `line` items can find their
  // endpoints regardless of which one is a card and which is furniture. ──
  const keyRects = new Map<string, KeyRect>();
  for (const r of resolvedItems) {
    const key = itemKeysByPath[r.item.path];
    if (!key) continue; // never-arranged — has no id yet, can't be a line endpoint (§2)
    const pos = localPositions[r.item.path] ?? { x: r.layout.x, y: r.layout.y };
    const size = localSizes[r.item.path] ?? { w: r.layout.w, h: r.layout.h };
    const def = defaultSize(r.item.kind, r.hasThumb);
    keyRects.set(key, { x: pos.x, y: pos.y, w: size.w ?? def.w, h: size.h ?? def.h });
  }

  const mountedFurniture: ReactElement[] = [];
  for (const f of furniture) {
    const rect = furnitureRects.get(f.id);
    if (!rect) continue; // `line` furniture — drawn separately, below
    const dragging = draggingFurnitureId === f.id;
    const selected = selectedFurnitureId === f.id;
    keyRects.set(`x:${f.id}`, rect);
    if (!shouldMount({ rect, dragging, selected }, cullRect)) continue;
    mountedFurniture.push(
      <BoardFurniture
        key={f.id}
        item={f}
        x={rect.x}
        y={rect.y}
        w={rect.w}
        h={rect.h}
        resizable={RESIZABLE_FURNITURE_KINDS.has(f.k)}
        selected={selected}
        dragging={dragging}
        onItemMouseDown={handleFurnitureMouseDown}
        onResizeMouseDown={handleFurnitureResizeMouseDown}
        onFocusItem={handleFocusFurniture}
        onDelete={(id) => onFurnitureDelete?.(id)}
        onOpenRef={onOpenNoteRef}
        onCheckToggle={onFurnitureCheckToggle}
        onSwatchPick={(hex) => onFurnitureColor?.(f.id, hex)}
      />,
    );
  }

  // `line` furniture connects two item KEYS (v:/n:/x:) — drawn only once
  // BOTH endpoints currently resolve (§4: "deleted when either end is
  // deleted" — the server already cascade-deletes the line itself on that
  // event, but a stale local state frame during a delete round-trip must not
  // draw a connector into empty space either).
  const lineSegments: Array<{ id: string; x1: number; y1: number; x2: number; y2: number; label?: string; color?: string }> = [];
  for (const f of furniture) {
    if (f.k !== 'line') continue;
    const from = keyRects.get(String(f.from ?? ''));
    const to = keyRects.get(String(f.to ?? ''));
    if (!from || !to) continue;
    lineSegments.push({
      id: f.id,
      x1: from.x + from.w / 2,
      y1: from.y + Math.min(from.h, 150) / 2,
      x2: to.x + to.w / 2,
      y2: to.y + Math.min(to.h, 150) / 2,
      label: typeof f.label === 'string' ? f.label : undefined,
      color: f.color,
    });
  }

  return (
    <div
      className="board-canvas__root"
      ref={containerRef}
      onMouseDown={handleMouseDownCanvas}
      onWheel={handleWheel}
      data-min-zoom={minZoom}
      data-mounted-count={mountedCards.length}
      data-active-tool={activeTool}
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
            ref={worldRef}
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

            {/* SKY-11188: `line` connectors — behind the cards/furniture they join. */}
            {lineSegments.length > 0 && (
              <svg
                className="board-canvas__lines"
                width={containerWidth}
                height={canvasHeight}
                aria-hidden="true"
              >
                {lineSegments.map((l) => (
                  <line
                    key={l.id}
                    x1={l.x1}
                    y1={l.y1}
                    x2={l.x2}
                    y2={l.y2}
                    stroke={l.color || 'var(--n1, #00f0ff)'}
                    strokeWidth={1.8}
                    opacity={0.85}
                  />
                ))}
              </svg>
            )}

            {/*
              SKY-11191 §11: the wiki-link overlay sits UNDER the cards and
              inside the same transformed world, so a connector is attached to
              the two boxes it joins through pan, zoom and drag without any
              per-frame recalculation of its own.
            */}
            {wikiLinkOverlay && linkSegments.length > 0 && (
              <BoardLinkOverlay
                segments={linkSegments}
                width={containerWidth}
                height={canvasHeight}
                instanceId={instanceId}
              />
            )}

            {mountedCards}
            {mountedFurniture}
          </div>
        </div>
      </div>

      {/* SKY-11191 §11: derived minimap. A sibling of the scroll panel, not a
          child of the world: it must keep its size at every zoom and stay
          pinned to the panel's corner instead of scrolling away with the
          board — the same reason the zoom pill lives out here. */}
      {showMinimap && (
        <BoardMinimapPanel
          boxes={minimapBoxes}
          world={minimapWorld}
          viewport={minimapViewport}
          onNavigate={handleMinimapNavigate}
        />
      )}

      {/*
        SKY-11187 §5 / SKY-11189 §7: the item menu. Positioned in viewport
        coordinates and rendered outside the zoomed world on purpose — chrome
        must stay legible at 40% zoom. Delete routes through the deferred-
        delete model (onTrashItems), never an ad-hoc fs call here.
      */}
      {contextMenu && (
        <div
          className="board-canvas__menu"
          role="menu"
          aria-label="Board item actions"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            className="board-canvas__menu-item"
            onClick={() => {
              const target = contextMenu.path;
              setContextMenu(null);
              onRequestRename?.(target);
            }}
          >
            Rename
          </button>
          <button
            type="button"
            role="menuitem"
            className="board-canvas__menu-item board-canvas__menu-item--danger"
            onClick={handleTrashSelection}
          >
            {effectiveSelection.size > 1 ? `Delete ${effectiveSelection.size} items` : 'Delete'}
          </button>
        </div>
      )}
    </div>
  );
}
