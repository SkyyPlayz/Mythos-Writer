// Beta 4 M22 — Axis engine (§8.3): ERAS bar, adaptive ticks, zoom seg +
// Ctrl+scroll, min-width growth + bottom scrollbar, universal direct
// manipulation (drag-to-move, 7px/6px edge resize, click-select → inspector),
// exact-time picker modal, auto-stacking.
//
// Beta 4 M23 — Lane rows + Progress/Structure (§8.4): the full story row
// stack — ERAS · BOOKS · ARCS · CHAPTERS (date-positioned minis, you-are-here
// ring) · PLOTLINES (thin lanes, scene-card chips) · KEY EVENTS (FLASHBACK
// badge) · CHARACTERS (lifespan lines, one lane each) · WORLD (chips) ·
// THEMES · CUSTOM ROWS. Progress mode greys planned items (prototype 6036
// filter); Structure is identical minus the progress styling. The story rows
// gate on the active timeline's kind (prototype tlIsStoryTl, 2093); world /
// universe timelines keep ERAS · SPANS & STORIES · KEY EVENTS · CUSTOM ROWS.
//
// Renders straight from the M21 TimelinesStore (eras / spans / events /
// custom rows / plotline rows) and persists every mutation through the
// timelines:upsertItem / timelines:deleteItem IPC. M25 replaces the built-in
// mini inspector with the full right-panel Inspector.
//
// Exact values ported from the prototype ("Mythos Writer - Liquid Neon
// .dc.html"): eras bar 19px/17px items + 6px handles (2078–2085), span cards
// 46px + 7px handles (2093), arcs 34px gradient bars (6059), chapter minis
// 20px × 80% gap (6079), plotline chip lanes 28px (2114–2124), custom-row
// items 24px + 6px handles (2175), event cards 215px (6691–6697), character
// lanes 20px with 3.5px glow lines (6087–6091), world chips 180px / lane 56
// (6700–6706), progress grey grayscale(.92) brightness(.82) opacity .55
// (6036), book-focus dim opacity .28 grayscale(.6) (6042), toasts verbatim.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  TimelinesStore,
  TimelineDefinition,
  TimelineEra,
  TimelineEvent,
  TimelineRow,
  TimelineSpan,
} from '../timelinesTypes';
import {
  formatWhen,
  roundWhen,
  safeCalendar,
  safeDecodeWhen,
} from './axis/calendarCodec';
import { AXIS_ZOOM_SEGS, axisPct, axisPctL, generateTicks, type AxisZoomSeg } from './axis/ticks';
import { applyWheelZoom, canvasMinWidth } from './axis/zoom';
import { characterLanePolicy, stackPoints, stackSpans } from './axis/lanes';
import {
  EVENT_DRAG_THRESHOLD_PX,
  SPAN_DRAG_THRESHOLD_PX,
  applyEventDrag,
  applySpanDrag,
  dragArmed,
  pixelsToWhen,
  type AxisDragMode,
} from './axis/drag';
import { deriveAxisDomain, type AxisDomain } from './axis/domain';
import { hexA, laneColor, LANE_PALETTE } from './axis/palette';
import { chapterPositions, chapterSlotIndex, plotCardWhen, sortedBooks } from './axis/chapters';
import {
  ARC_LANE,
  CHARACTER_LANE,
  THEME_LANE,
  WORLD_LANE,
  arcSpans,
  characterSpans,
  eventVisible,
  isEventWritten,
  isFlashback,
  isMainSpan,
  keyEvents,
  plotlineCards,
  plotlineRows,
  themeEvents,
  worldEvents,
  type TimelineShowFilter,
} from './axis/storyLanes';
import { useToast } from '../hooks/useToast';
import { Toast } from '../components/Toast/Toast';
import type { TimelineSelection, TimelineSelectableType } from './panel/selection';
import './AxisView.css';

type SelectableType = TimelineSelectableType;
type AxisSelection = TimelineSelection;

export type AxisViewMode = 'progress' | 'structure';

/** One story chapter cell (derived from the manuscript by the caller). */
export interface AxisChapterCell {
  id: string;
  label: string;
  written: boolean;
  isHere: boolean;
}

export interface AxisViewProps {
  store: TimelinesStore;
  /** Receives the authoritative store after every persisted mutation. */
  onStoreChange: (store: TimelinesStore) => void;
  /** §8.4: Progress (default mode) adds the planned-greyscale extras;
   *  Structure is identical minus the progress styling. */
  mode?: AxisViewMode;
  /** Ordered story chapters for the CHAPTERS row (date-positioned minis). */
  chapters?: readonly AxisChapterCell[];
  /** Plotline ids toggled off in the left panel. */
  hiddenPlotlines?: ReadonlySet<string>;
  /** Focused book span id (left-panel book cards); null = Overview. */
  bookFocus?: string | null;
  /** Toolbar Show filter — filters the KEY EVENTS row live. */
  showFilter?: TimelineShowFilter;
  /** Bumped by the toolbar's Today — selects/scrolls to the current position. */
  todaySignal?: number;
  // ── M25 (§8.6): selection is owned by TimelineRoot so the right-panel
  //    Inspector can edit the selected item; omit both to stay uncontrolled.
  selection?: TimelineSelection | null;
  onSelectionChange?: (selection: TimelineSelection | null) => void;
  /** Archive-flag targets (event/scene/chapter ids) — flagged canvas items get
   *  a 2px warning outline (design spec §2, non-blocking). */
  flaggedItemIds?: ReadonlySet<string>;
  /** Flag-card "Jump" — scrolls the canvas to the item with this id; `n`
   *  bumps so repeated jumps to the same id still fire. */
  jumpTarget?: { id: string; n: number } | null;
}

function newItemId(prefix: string): string {
  const uuid =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}:${uuid}`;
}

const EMPTY_CHAPTERS: readonly AxisChapterCell[] = [];
const EMPTY_HIDDEN: ReadonlySet<string> = new Set();

export default function AxisView({
  store,
  onStoreChange,
  mode = 'structure',
  chapters = EMPTY_CHAPTERS,
  hiddenPlotlines = EMPTY_HIDDEN,
  bookFocus = null,
  showFilter = 'All Events',
  todaySignal = 0,
  selection: selectionProp,
  onSelectionChange,
  flaggedItemIds,
  jumpTarget = null,
}: AxisViewProps) {
  // Local working copy: dragging mutates this for 60fps feedback; persistence
  // flows through IPC and comes back via onStoreChange → props.
  const [localStore, setLocalStore] = useState<TimelinesStore>(store);
  useEffect(() => { setLocalStore(store); }, [store]);

  const [zoomSeg, setZoomSeg] = useState<AxisZoomSeg>('Year');
  const [zoomX, setZoomX] = useState(1);
  // M25: controlled when TimelineRoot passes `selection` (the right-panel
  // Inspector edits it); the internal state keeps older callers working.
  const [internalSelection, setInternalSelection] = useState<AxisSelection | null>(null);
  const selection = selectionProp !== undefined ? selectionProp : internalSelection;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const setSelection = useCallback(
    (next: AxisSelection | null) => {
      setInternalSelection(next);
      onSelectionChange?.(next);
    },
    [onSelectionChange],
  );

  const { toast, showToast } = useToast();
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  // Set on drag end so the click that follows mouseup doesn't select;
  // self-clears next tick in case the drag ends off-element (no click).
  const suppressClickRef = useRef(false);
  const suppressNextClick = useCallback(() => {
    suppressClickRef.current = true;
    setTimeout(() => { suppressClickRef.current = false; }, 0);
  }, []);

  const active: TimelineDefinition | undefined = localStore.timelines.find(
    (t) => t.id === localStore.activeTimelineId,
  );
  const activeId = active?.id ?? '';
  const calendar = useMemo(() => safeCalendar(active?.calendar), [active?.calendar]);

  // Fixed per-timeline axis domain (like the prototype's `axis: [t0, t1]`):
  // derived from content on timeline switch, frozen across item edits so the
  // axis never rescales under a drag.
  const [domain, setDomain] = useState<AxisDomain>(() =>
    deriveAxisDomain(store, store.activeTimelineId, safeCalendar(
      store.timelines.find((t) => t.id === store.activeTimelineId)?.calendar,
    )),
  );
  const storeRef = useRef(localStore);
  storeRef.current = localStore;
  useEffect(() => {
    const cal = safeCalendar(
      storeRef.current.timelines.find((t) => t.id === activeId)?.calendar,
    );
    setDomain(deriveAxisDomain(storeRef.current, activeId, cal));
    setSelection(null);
  }, [activeId, setSelection]);
  const [t0, t1] = domain;

  // ── M25: flag-card Jump — scroll the flagged item into view (design §2).
  //    Items carry `data-ax-id`; events also match by sceneId via the
  //    flagged-id mapping below, so the jump id can be a scene/chapter id.
  useEffect(() => {
    if (!jumpTarget) return;
    const scroller = scrollRef.current;
    if (!scroller) return;
    // The jump id may be a scene id — resolve it to the plotted event's id.
    const byScene = storeRef.current.events.find((e) => e.sceneId === jumpTarget.id);
    const canvasId = scroller.querySelector(`[data-ax-id="${CSS.escape(jumpTarget.id)}"]`)
      ? jumpTarget.id
      : byScene?.id;
    if (!canvasId) return;
    const el = scroller.querySelector(`[data-ax-id="${CSS.escape(canvasId)}"]`);
    el?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [jumpTarget]);

  // M25: canvas ids that carry an Archive flag (design §2 per-item cue).
  // Flags anchor to scene/chapter ids — events match by own id OR sceneId.
  const flaggedCanvasIds = useMemo(() => {
    if (!flaggedItemIds || flaggedItemIds.size === 0) return null;
    const out = new Set<string>();
    for (const e of localStore.events) {
      if (flaggedItemIds.has(e.id) || (e.sceneId && flaggedItemIds.has(e.sceneId))) out.add(e.id);
    }
    for (const s of localStore.spans) if (flaggedItemIds.has(s.id)) out.add(s.id);
    return out;
  }, [flaggedItemIds, localStore.events, localStore.spans]);
  const flagCls = useCallback(
    (id: string) => (flaggedCanvasIds?.has(id) ? ' ax-item--flagged' : ''),
    [flaggedCanvasIds],
  );

  // ── Ctrl+scroll zoom (native listener: React wheel handlers are passive) ──
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoomX((x) => applyWheelZoom(x, e.deltaY));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // ── Derived rows ──
  const ticks = useMemo(
    () => generateTicks(t0, t1, zoomSeg, zoomX, calendar),
    [t0, t1, zoomSeg, zoomX, calendar],
  );

  const eras = useMemo(
    () => localStore.eras.filter((e) => e.timelineId === activeId),
    [localStore.eras, activeId],
  );

  const customRows = useMemo(
    () => localStore.rows.filter((r) => r.timelineId === activeId && r.kind === 'custom'),
    [localStore.rows, activeId],
  );

  // ── M23: story rows gate on the timeline kind (prototype tlIsStoryTl) ──
  const isStoryTimeline = active?.kind === 'story';
  const isProgress = mode === 'progress';

  const mainSpans = useMemo(
    () => localStore.spans.filter((s) => s.timelineId === activeId && isMainSpan(s)),
    [localStore.spans, activeId],
  );

  const stackedSpans = useMemo(
    () =>
      stackSpans(
        mainSpans.map((s) => ({
          item: s,
          leftPct: axisPct(s.startWhen, t0, t1),
          rightPct: axisPct(s.endWhen, t0, t1),
        })),
      ),
    [mainSpans, t0, t1],
  );

  // The BOOKS the CHAPTERS row distributes across (prototype chWhen).
  const books = useMemo(() => sortedBooks(mainSpans), [mainSpans]);

  const chapterMinis = useMemo(
    () => chapterPositions(chapters.length, books, domain),
    [chapters.length, books, domain],
  );

  // "You are here" (§8.4 progress extras): the current chapter's end marks the
  // story's position; null when nothing is written yet (everything planned).
  const hereIndex = useMemo(() => chapters.findIndex((c) => c.isHere), [chapters]);
  const hereWhen = hereIndex >= 0 ? chapterMinis[hereIndex]?.nextWhen ?? null : null;

  // Focused book range (left-panel book cards); null = Overview.
  const focusedBook = useMemo(
    () => (bookFocus ? mainSpans.find((s) => s.id === bookFocus) ?? null : null),
    [bookFocus, mainSpans],
  );
  const inFocusedBook = useCallback(
    (startWhen: number, endWhen?: number) => {
      if (!focusedBook) return true;
      const end = endWhen ?? startWhen;
      return end >= focusedBook.startWhen && startWhen <= focusedBook.endWhen;
    },
    [focusedBook],
  );

  // Prototype 6036/6042: progress grey + book-focus dim (dim wins when both).
  const greyStyle = useCallback(
    (planned: boolean, inBook = true): React.CSSProperties => {
      if (!inBook) return { opacity: 0.28, filter: 'grayscale(.6)' };
      if (isProgress && planned) {
        return { filter: 'grayscale(.92) brightness(.82)', opacity: 0.55 };
      }
      return {};
    },
    [isProgress],
  );

  const arcs = useMemo(() => arcSpans(localStore, activeId), [localStore, activeId]);
  const characters = useMemo(() => characterSpans(localStore, activeId), [localStore, activeId]);
  const characterLanes = useMemo(() => characterLanePolicy(characters), [characters]);
  const themes = useMemo(() => themeEvents(localStore, activeId), [localStore, activeId]);
  const plotlines = useMemo(
    () => plotlineRows(localStore, activeId).filter((r) => !hiddenPlotlines.has(r.id)),
    [localStore, activeId, hiddenPlotlines],
  );

  const stackedWorld = useMemo(() => {
    const events = worldEvents(localStore, activeId);
    // Prototype 6699: the world row reserves two lanes (`tlWorldLanes = 2`).
    return stackPoints(events.map((e) => ({ item: e, pct: axisPct(e.when, t0, t1) })), 13, 2);
  }, [localStore, activeId, t0, t1]);

  const visibleKeyEvents = useMemo(() => {
    const all = keyEvents(localStore, activeId);
    return all.filter(
      (e) =>
        eventVisible(e, { show: showFilter, events: all, hereWhen }) &&
        (!focusedBook || inFocusedBook(e.when)),
    );
  }, [localStore, activeId, showFilter, hereWhen, focusedBook, inFocusedBook]);

  const stackedEvents = useMemo(
    () =>
      // Prototype 6690: the events row always reserves two lanes (`tlEvLanes = 2`).
      stackPoints(visibleKeyEvents.map((e) => ({ item: e, pct: axisPct(e.when, t0, t1) })), 17, 2),
    [visibleKeyEvents, t0, t1],
  );

  const rowItems = useCallback(
    (rowId: string) =>
      localStore.spans.filter((s) => s.timelineId === activeId && s.rowId === rowId),
    [localStore.spans, activeId],
  );

  const minWidth = canvasMinWidth(zoomSeg, zoomX);

  // ── Persistence ──
  const persistItem = useCallback(
    (type: SelectableType | 'row', item: TimelineEra | TimelineSpan | TimelineEvent | TimelineRow) => {
      const api = window.api;
      if (typeof api?.timelinesUpsertItem !== 'function') return;
      api
        .timelinesUpsertItem({ type, item })
        .then((res) => { if (res.ok) onStoreChange(res.store); })
        .catch(() => { /* keep the local copy — next load reconciles */ });
    },
    [onStoreChange],
  );

  const deleteItem = useCallback(
    (type: SelectableType | 'row', id: string) => {
      const api = window.api;
      if (typeof api?.timelinesDeleteItem !== 'function') return;
      api
        .timelinesDeleteItem({ type, id })
        .then((res) => { if (res.ok) onStoreChange(res.store); })
        .catch(() => {});
    },
    [onStoreChange],
  );

  const updateLocalItem = useCallback(
    (type: SelectableType | 'row', item: TimelineEra | TimelineSpan | TimelineEvent | TimelineRow) => {
      setLocalStore((prev) => {
        const key = ({ era: 'eras', span: 'spans', event: 'events', row: 'rows' } as const)[type];
        const list = prev[key] as { id: string }[];
        const idx = list.findIndex((existing) => existing.id === item.id);
        const nextList = idx === -1 ? [...list, item] : list.map((x, i) => (i === idx ? item : x));
        return { ...prev, [key]: nextList };
      });
    },
    [],
  );

  const removeLocalItem = useCallback((type: SelectableType | 'row', id: string) => {
    setLocalStore((prev) => {
      const key = ({ era: 'eras', span: 'spans', event: 'events', row: 'rows' } as const)[type];
      const next = { ...prev, [key]: (prev[key] as { id: string }[]).filter((x) => x.id !== id) };
      if (type === 'row') {
        next.spans = next.spans.filter((s) => s.rowId !== id);
      }
      return next as TimelinesStore;
    });
  }, []);

  // ── Universal direct manipulation ──
  const beginSpanLikeDrag = useCallback(
    (
      e: React.MouseEvent,
      mode: AxisDragMode,
      type: 'era' | 'span',
      item: TimelineEra | TimelineSpan,
      rowKey: string,
    ) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      const rect = rowRefs.current.get(rowKey)?.getBoundingClientRect();
      const sx = e.clientX;
      const start0 = item.startWhen;
      const end0 = item.endWhen;
      let moved = false;
      let last = item;
      const onMove = (ev: MouseEvent) => {
        if (!moved && !dragArmed(sx, ev.clientX, SPAN_DRAG_THRESHOLD_PX)) return;
        moved = true;
        const dWhen = pixelsToWhen(ev.clientX - sx, rect?.width ?? 0, t0, t1);
        const next = applySpanDrag(mode, start0, end0, dWhen, t0, t1);
        last = { ...item, startWhen: next.startWhen, endWhen: next.endWhen };
        updateLocalItem(type, last);
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        if (!moved) return;
        suppressNextClick();
        persistItem(type, last);
        if (mode === 'move') showToast('Rough time set — fine-tune with the exact-time picker');
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [t0, t1, updateLocalItem, persistItem, showToast, suppressNextClick],
  );

  const beginEventDrag = useCallback(
    (e: React.MouseEvent, item: TimelineEvent, rowKey: string) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const rect = rowRefs.current.get(rowKey)?.getBoundingClientRect();
      const sx = e.clientX;
      const when0 = item.when;
      let moved = false;
      let last = item;
      const onMove = (ev: MouseEvent) => {
        if (!moved && !dragArmed(sx, ev.clientX, EVENT_DRAG_THRESHOLD_PX)) return;
        moved = true;
        const dWhen = pixelsToWhen(ev.clientX - sx, rect?.width ?? 0, t0, t1);
        last = { ...item, when: applyEventDrag(when0, dWhen, t0, t1) };
        updateLocalItem('event', last);
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        if (!moved) return;
        suppressNextClick();
        persistItem('event', last);
        showToast('Rough time set — fine-tune with the exact-time picker');
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [t0, t1, updateLocalItem, persistItem, showToast, suppressNextClick],
  );

  // ── Click select → Inspector ──
  const handleSelect = useCallback((e: React.MouseEvent, type: SelectableType, id: string) => {
    e.stopPropagation();
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    const prev = selectionRef.current;
    setSelection(prev && prev.type === type && prev.id === id ? null : { type, id });
  }, [setSelection]);

  const openEmbeddedTimeline = useCallback(
    (e: React.MouseEvent, span: TimelineSpan) => {
      e.stopPropagation();
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }
      const api = window.api;
      if (!span.opensTimelineId || typeof api?.timelinesSetActive !== 'function') return;
      api
        .timelinesSetActive(span.opensTimelineId)
        .then((res) => {
          if (!res.ok) return;
          onStoreChange(res.store);
          showToast(`Opened “${span.name}” — close view. Switch back from the timeline picker.`);
        })
        .catch(() => {});
    },
    [onStoreChange, showToast],
  );

  // ── Adds (prototype tlAddEraH / tlAddSpanH / tlAddEventH / tlAddCRowH) ──
  const addEra = useCallback(() => {
    const q = (t1 - t0) / 3;
    const era: TimelineEra = {
      id: newItemId('era'),
      timelineId: activeId,
      name: 'NEW ERA',
      startWhen: roundWhen(t0 + q),
      endWhen: roundWhen(t0 + q * 2),
      color: LANE_PALETTE[eras.length % 6],
    };
    updateLocalItem('era', era);
    persistItem('era', era);
    setSelection({ type: 'era', id: era.id });
    showToast('Era added — name it and set its dates in the inspector');
  }, [t0, t1, activeId, eras.length, updateLocalItem, persistItem, setSelection, showToast]);

  const addSpan = useCallback(() => {
    const q = (t1 - t0) / 4;
    const span: TimelineSpan = {
      id: newItemId('span'),
      timelineId: activeId,
      name: 'New span',
      startWhen: roundWhen(t0 + q),
      endWhen: roundWhen(t0 + q * 2),
      color: LANE_PALETTE[stackedSpans.items.length % 6],
    };
    updateLocalItem('span', span);
    persistItem('span', span);
    setSelection({ type: 'span', id: span.id });
    showToast('Span added — set its start & end in the inspector, or embed an existing timeline');
  }, [t0, t1, activeId, stackedSpans.items.length, updateLocalItem, persistItem, setSelection, showToast]);

  const addEvent = useCallback(() => {
    const event: TimelineEvent = {
      id: newItemId('event'),
      timelineId: activeId,
      name: 'New event',
      when: roundWhen(t0 + (t1 - t0) / 2),
      summary: 'Describe what happens here.',
      icon: '✦',
      source: 'manual',
    };
    updateLocalItem('event', event);
    persistItem('event', event);
    setSelection({ type: 'event', id: event.id });
    showToast('Event added — fill it in on the right');
  }, [t0, t1, activeId, updateLocalItem, persistItem, setSelection, showToast]);

  // ── M23: story-lane adds (prototype laneAdd, 6047) ──
  const addLaneSpan = useCallback(
    (lane: string, name: string, count: number) => {
      const q = (t1 - t0) / 4;
      const span: TimelineSpan = {
        id: newItemId('span'),
        timelineId: activeId,
        name,
        startWhen: roundWhen(t0 + q),
        endWhen: roundWhen(t0 + q * 2),
        rowId: lane,
        color: LANE_PALETTE[count % 6],
      };
      updateLocalItem('span', span);
      persistItem('span', span);
      setSelection({ type: 'span', id: span.id });
      showToast('Added — edit it in the inspector on the right');
    },
    [t0, t1, activeId, updateLocalItem, persistItem, setSelection, showToast],
  );

  const addWorldEvent = useCallback(() => {
    const event: TimelineEvent = {
      id: newItemId('event'),
      timelineId: activeId,
      name: 'New world event',
      when: roundWhen(t0 + (t1 - t0) / 2),
      rowId: WORLD_LANE,
      summary: 'What changes in the world.',
      source: 'manual',
    };
    updateLocalItem('event', event);
    persistItem('event', event);
    setSelection({ type: 'event', id: event.id });
    showToast('Added — edit it in the inspector on the right');
  }, [t0, t1, activeId, updateLocalItem, persistItem, setSelection, showToast]);

  const addTheme = useCallback(() => {
    const event: TimelineEvent = {
      id: newItemId('event'),
      timelineId: activeId,
      name: 'New theme',
      when: roundWhen(t0),
      rowId: THEME_LANE,
      source: 'manual',
    };
    updateLocalItem('event', event);
    persistItem('event', event);
    setSelection({ type: 'event', id: event.id });
    showToast('Added — edit it in the inspector on the right');
  }, [t0, activeId, updateLocalItem, persistItem, setSelection, showToast]);

  // ── M23: Today → select + scroll to the current position (accept:
  //    "Today selects current"; prototype tlToday 6838) ──
  const lastTodaySignal = useRef(todaySignal);
  useEffect(() => {
    if (todaySignal === lastTodaySignal.current) return;
    lastTodaySignal.current = todaySignal;
    if (hereWhen == null) {
      showToast('Nothing written yet — the position marker appears once a chapter is written');
      return;
    }
    // Select the key event nearest the current position.
    let nearest: TimelineEvent | null = null;
    let best = Infinity;
    for (const e of visibleKeyEvents) {
      const d = Math.abs(e.when - hereWhen);
      if (d < best) { best = d; nearest = e; }
    }
    if (nearest) setSelection({ type: 'event', id: nearest.id });
    // Scroll the canvas so the current position sits in view.
    const scroller = scrollRef.current;
    if (scroller && scroller.scrollWidth > scroller.clientWidth) {
      const pct = axisPct(hereWhen, t0, t1) / 100;
      scroller.scrollLeft = Math.max(0, pct * scroller.scrollWidth - scroller.clientWidth / 2);
    }
    const hereLabel = hereIndex >= 0 ? chapters[hereIndex]?.label : '';
    showToast(hereLabel ? `Jumped to today — ${hereLabel}` : 'Jumped to today');
  }, [todaySignal, hereWhen, hereIndex, chapters, visibleKeyEvents, t0, t1, setSelection, showToast]);

  const addCustomRow = useCallback(() => {
    const row: TimelineRow = {
      id: newItemId('row'),
      timelineId: activeId,
      name: 'CUSTOM ROW',
      kind: 'custom',
    };
    updateLocalItem('row', row);
    persistItem('row', row);
    showToast('Row added — name it, then + to plot spans on it');
  }, [activeId, updateLocalItem, persistItem, showToast]);

  const addRowItem = useCallback(
    (row: TimelineRow) => {
      const q = (t1 - t0) / 4;
      const span: TimelineSpan = {
        id: newItemId('span'),
        timelineId: activeId,
        name: 'New',
        startWhen: roundWhen(t0 + q),
        endWhen: roundWhen(t0 + q * 2),
        rowId: row.id,
        color: LANE_PALETTE[rowItems(row.id).length % 6],
      };
      updateLocalItem('span', span);
      persistItem('span', span);
      setSelection({ type: 'span', id: span.id });
    },
    [t0, t1, activeId, rowItems, updateLocalItem, persistItem, setSelection],
  );

  const removeRow = useCallback(
    (row: TimelineRow) => {
      removeLocalItem('row', row.id);
      deleteItem('row', row.id);
      setSelection(null);
      showToast('Row removed');
    },
    [removeLocalItem, deleteItem, setSelection, showToast],
  );

  // M25 (§8.6): selection editing moved to the right-panel Inspector
  // (TimelineRightPanel) — the M22 mini inspector and its modal hosting are gone.

  const setRowRef = useCallback((key: string) => (el: HTMLDivElement | null) => {
    if (el) rowRefs.current.set(key, el);
    else rowRefs.current.delete(key);
  }, []);

  if (!active) {
    return (
      <div className="ax-root" data-testid="timeline-axis-view">
        <div className="ax-empty">No timeline selected — pick one from the timeline picker.</div>
      </div>
    );
  }

  const spanRowLabel = active.kind === 'story' ? 'BOOKS' : 'SPANS & STORIES';
  const gridlines = ticks.map((tick) => (
    <span key={`g${tick.when}`} className="ax-gridline" style={{ left: `${tick.pct}%` }} />
  ));

  const selRing = (type: SelectableType, id: string, col: string): React.CSSProperties =>
    selection && selection.type === type && selection.id === id
      ? { outline: `1.5px solid ${col}`, boxShadow: `0 0 18px -3px ${hexA(col, 0.65)}` }
      : {};

  return (
    <div className="ax-root" data-testid="timeline-axis-view">
      {/* ── Toolbar: zoom seg (prototype tlZoomOpts) ── */}
      <div className="ax-toolbar" role="toolbar" aria-label="Axis controls">
        <span className="ax-toolbar-title">{active.name}</span>
        <span className="ax-toolbar-spacer" />
        <div className="ax-zoom-seg" role="group" aria-label="Axis zoom" data-testid="ax-zoom-seg">
          {AXIS_ZOOM_SEGS.map((seg) => (
            <button
              key={seg}
              type="button"
              className={`ax-zoom-btn${zoomSeg === seg ? ' ax-zoom-btn--active' : ''}`}
              aria-pressed={zoomSeg === seg}
              onClick={() => setZoomSeg(seg)}
              data-testid={`ax-zoom-${seg}`}
            >
              {seg}
            </button>
          ))}
        </div>
      </div>

      <div className="ax-body">
        {/* ── Scrollable canvas: bottom scrollbar lives here ── */}
        <div
          className="ax-scroll"
          ref={scrollRef}
          title="Ctrl + scroll to zoom the time axis"
          data-testid="ax-scroll"
        >
          <div
            className="ax-canvas"
            style={minWidth != null ? { minWidth: `${minWidth}px` } : undefined}
            data-testid="ax-canvas"
            data-min-width={minWidth ?? ''}
          >
            {/* ── ERAS bar + tick labels ── */}
            <div className="ax-row">
              <button
                type="button"
                className="ax-row-label ax-row-label--btn"
                onClick={addEra}
                title="Set & name your eras — click an era to edit it, click here to add one"
                data-testid="ax-add-era"
              >
                ERAS +
              </button>
              <div className="ax-row-content">
                <div className="ax-eras-bar" ref={setRowRef('eras')} data-testid="ax-eras-row">
                  {eras.map((era, i) => {
                    const col = era.color ?? laneColor(i);
                    const l = axisPct(era.startWhen, t0, t1);
                    const r = axisPct(era.endWhen, t0, t1);
                    return (
                      <div
                        key={era.id}
                        className="ax-era"
                        style={{
                          left: `${l}%`,
                          width: `${Math.max(3, r - l)}%`,
                          color: col,
                          background: hexA(col, 0.05),
                          border: `1px solid ${hexA(col, 0.3)}`,
                          ...selRing('era', era.id, col),
                        }}
                        title="Drag to move · drag edges to resize · click to rename"
                        onClick={(e) => handleSelect(e, 'era', era.id)}
                        onMouseDown={(e) => beginSpanLikeDrag(e, 'move', 'era', era, 'eras')}
                        data-ax-id={era.id}
                        data-testid={`ax-era-${era.id}`}
                      >
                        {era.name}
                        <span
                          className="ax-handle ax-handle--6 ax-handle--l"
                          onMouseDown={(e) => beginSpanLikeDrag(e, 'resize-left', 'era', era, 'eras')}
                          data-testid={`ax-rz-l-${era.id}`}
                        />
                        <span
                          className="ax-handle ax-handle--6 ax-handle--r"
                          onMouseDown={(e) => beginSpanLikeDrag(e, 'resize-right', 'era', era, 'eras')}
                          data-testid={`ax-rz-r-${era.id}`}
                        />
                      </div>
                    );
                  })}
                </div>
                <div className="ax-tick-row" data-testid="ax-tick-row">
                  {ticks.map((tick) => (
                    <span
                      key={tick.when}
                      className="ax-tick"
                      style={{ left: `${tick.pct}%` }}
                      data-testid="ax-tick"
                    >
                      {tick.label}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* ── BOOKS / SPANS & STORIES (auto-stacked span-likes) ── */}
            <div className="ax-row">
              <div className="ax-row-label">
                {spanRowLabel}
                <div className="ax-row-sublabel">PLOTTED BY DATE</div>
                <button type="button" className="ax-lane-add" onClick={addSpan} title="Add a span" data-testid="ax-add-span">
                  +
                </button>
              </div>
              <div
                className="ax-row-content ax-spans"
                ref={setRowRef('spans')}
                style={{ height: `${(stackedSpans.laneCount - 1) * 50 + 50}px` }}
                data-testid="ax-spans-row"
                data-lane-count={stackedSpans.laneCount}
              >
                {gridlines}
                {stackedSpans.items.map(({ item: span, leftPct, rightPct, lane }, i) => {
                  const col = span.color ?? laneColor(i);
                  const embedded = Boolean(span.opensTimelineId);
                  const embedTl = embedded
                    ? localStore.timelines.find((t) => t.id === span.opensTimelineId)
                    : undefined;
                  const embedDomain: AxisDomain | null = embedTl
                    ? deriveAxisDomain(localStore, embedTl.id, safeCalendar(embedTl.calendar))
                    : null;
                  return (
                    <div
                      key={span.id}
                      className={`ax-span${flagCls(span.id)}`}
                      style={{
                        left: `${leftPct}%`,
                        width: `${Math.max(4, rightPct - leftPct)}%`,
                        top: `${lane * 50}px`,
                        background: hexA(col, 0.08),
                        border: `1px ${embedded ? 'dashed' : 'solid'} ${hexA(col, 0.5)}`,
                        boxShadow: `inset 0 0 18px ${hexA(col, 0.05)}`,
                        ...greyStyle(false, !focusedBook || span.id === focusedBook.id),
                        ...selRing('span', span.id, col),
                      }}
                      title={
                        embedded
                          ? `${span.name} — embedded timeline · click to open`
                          : 'Drag to move · drag edges to resize · click to edit'
                      }
                      onClick={(e) =>
                        embedded ? openEmbeddedTimeline(e, span) : handleSelect(e, 'span', span.id)
                      }
                      onMouseDown={(e) => beginSpanLikeDrag(e, 'move', 'span', span, 'spans')}
                      data-ax-id={span.id}
                      data-testid={`ax-span-${span.id}`}
                      data-embedded={embedded || undefined}
                    >
                      {embedded &&
                        embedDomain &&
                        localStore.spans
                          .filter((s2) => s2.timelineId === span.opensTimelineId && !s2.rowId)
                          .map((s2, k) => {
                            const col2 = s2.color ?? laneColor(k);
                            const [a0, a1] = embedDomain;
                            const l2 = Math.max(0, Math.min(97, ((s2.startWhen - a0) / (a1 - a0)) * 100));
                            const r2 = Math.max(l2 + 2, Math.min(100, ((s2.endWhen - a0) / (a1 - a0)) * 100));
                            return (
                              <span
                                key={s2.id}
                                className="ax-mini-strip"
                                style={{
                                  left: `${l2}%`,
                                  width: `${r2 - l2}%`,
                                  background: col2,
                                  boxShadow: `0 0 5px ${hexA(col2, 0.5)}`,
                                }}
                                data-testid={`ax-mini-strip-${s2.id}`}
                              />
                            );
                          })}
                      <span
                        className="ax-handle ax-handle--7 ax-handle--l ax-handle--round-l"
                        onMouseDown={(e) => beginSpanLikeDrag(e, 'resize-left', 'span', span, 'spans')}
                        data-testid={`ax-rz-l-${span.id}`}
                      />
                      <span
                        className="ax-handle ax-handle--7 ax-handle--r ax-handle--round-r"
                        onMouseDown={(e) => beginSpanLikeDrag(e, 'resize-right', 'span', span, 'spans')}
                        data-testid={`ax-rz-r-${span.id}`}
                      />
                      <div className="ax-span-title" style={{ color: col, textShadow: `0 0 10px ${hexA(col, 0.5)}` }}>
                        {span.name}
                      </div>
                      <div className="ax-span-sub">
                        {embedded ? 'timeline · click to open' : formatWhen(span.startWhen, calendar, t0)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ── M23: ARCS (gradient bars, date-spanned — prototype 6059) ── */}
            {isStoryTimeline && (
              <div className="ax-row">
                <div className="ax-row-label">
                  ARCS
                  <button
                    type="button"
                    className="ax-lane-add"
                    onClick={() => addLaneSpan(ARC_LANE, 'New Arc', arcs.length)}
                    title="Add an arc — set its start & end dates in the inspector"
                    data-testid="ax-add-arc"
                  >
                    +
                  </button>
                </div>
                <div
                  className="ax-row-content ax-arcs"
                  ref={setRowRef('arcs')}
                  data-testid="ax-arcs-row"
                >
                  {gridlines}
                  {arcs.map((arc, i) => {
                    const col = arc.color ?? laneColor(i);
                    const l = axisPctL(arc.startWhen, t0, t1);
                    const r = axisPctL(arc.endWhen, t0, t1);
                    const planned = hereWhen == null || arc.startWhen > hereWhen;
                    return (
                      <div
                        key={arc.id}
                        className="ax-arc"
                        style={{
                          left: `${l}%`,
                          width: `${Math.max(3, r - l)}%`,
                          background: `linear-gradient(120deg, ${hexA(col, 0.32)}, ${hexA(col, 0.14)})`,
                          border: `1px solid ${hexA(col, 0.5)}`,
                          ...greyStyle(planned, inFocusedBook(arc.startWhen, arc.endWhen)),
                          ...selRing('span', arc.id, col),
                        }}
                        title="Drag to move · drag edges to resize · click to edit"
                        onClick={(e) => handleSelect(e, 'span', arc.id)}
                        onMouseDown={(e) => beginSpanLikeDrag(e, 'move', 'span', arc, 'arcs')}
                        data-ax-id={arc.id}
                        data-testid={`ax-arc-${arc.id}`}
                      >
                        {arc.name}
                        <span
                          className="ax-handle ax-handle--7 ax-handle--l ax-handle--round-l"
                          onMouseDown={(e) => beginSpanLikeDrag(e, 'resize-left', 'span', arc, 'arcs')}
                          data-testid={`ax-rz-l-${arc.id}`}
                        />
                        <span
                          className="ax-handle ax-handle--7 ax-handle--r ax-handle--round-r"
                          onMouseDown={(e) => beginSpanLikeDrag(e, 'resize-right', 'span', arc, 'arcs')}
                          data-testid={`ax-rz-r-${arc.id}`}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── M23: CHAPTERS (date-positioned minis + you-are-here ring) ── */}
            {isStoryTimeline && (
              <div className="ax-row">
                <div className="ax-row-label">CHAPTERS</div>
                <div className="ax-row-content ax-chapters" data-testid="ax-chapters-row">
                  {chapters.length === 0 && (
                    <span className="ax-row-hint">Chapters plot here once your story has chapters.</span>
                  )}
                  {chapters.map((ch, i) => {
                    const pos = chapterMinis[i];
                    if (!pos) return null;
                    const col = LANE_PALETTE[chapterSlotIndex(i, chapters.length)];
                    const l = axisPctL(pos.startWhen, t0, t1);
                    const r = axisPctL(pos.nextWhen, t0, t1);
                    const here = isProgress && ch.isHere;
                    return (
                      <div
                        key={ch.id}
                        className={`ax-chapter${here ? ' ax-chapter--here' : ''}`}
                        style={{
                          left: `${l}%`,
                          width: `${Math.max(0.6, (r - l) * 0.8)}%`,
                          background: hexA(col, 0.4),
                          border: `1px solid ${hexA(col, 0.35)}`,
                          ...greyStyle(!ch.written, inFocusedBook(pos.startWhen, pos.nextWhen)),
                        }}
                        title={`${here ? `You are here — ${ch.label}` : ch.label} · ${formatWhen(pos.startWhen, calendar, t0)}`}
                        data-testid="ax-chapter"
                        data-chapter-id={ch.id}
                        data-here={here || undefined}
                      />
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── M23: PLOTLINES (thin lanes, scene-card chips — 2114–2124) ── */}
            {isStoryTimeline && (
              <div className="ax-row">
                <div className="ax-row-label">
                  PLOTLINES
                  <div className="ax-row-sublabel">TOGGLE IN LEFT PANEL</div>
                </div>
                <div className="ax-row-content ax-plotlanes" data-testid="ax-plotlines-row">
                  {plotlines.length === 0 && (
                    <span className="ax-row-hint">
                      + Plotline in the toolbar starts one — or lay a Templates ▾ structure onto the timeline.
                    </span>
                  )}
                  {plotlines.map((pl, pi) => {
                    const col = pl.color ?? laneColor(pi);
                    return (
                      <div className="ax-plotlane" key={pl.id} data-testid={`ax-plotlane-${pl.id}`}>
                        <span
                          className="ax-plotlane-dot"
                          style={{ background: col, boxShadow: `0 0 7px ${col}` }}
                          title={pl.name}
                        />
                        <div className="ax-plotlane-track">
                          {plotlineCards(localStore, pl.id).map((card) => {
                            const when =
                              card.chapter != null
                                ? plotCardWhen(card.chapter, chapters.length, books, domain)
                                : card.when;
                            return (
                              <button
                                type="button"
                                key={card.id}
                                className={`ax-plotcard${flagCls(card.id)}`}
                                style={{
                                  left: `${axisPct(when, t0, t1)}%`,
                                  color: '#e6ecf9',
                                  background: hexA(col, 0.12),
                                  border: `1px ${card.beat ? 'dashed' : 'solid'} ${hexA(col, 0.5)}`,
                                  ...(selection?.type === 'event' && selection.id === card.id
                                    ? { outline: `1.5px solid ${col}` }
                                    : {}),
                                }}
                                title={card.summary || card.name}
                                onClick={(e) => handleSelect(e, 'event', card.id)}
                                data-ax-id={card.id}
                          data-testid={`ax-plotcard-${card.id}`}
                                data-beat={card.beat || undefined}
                              >
                                {card.name}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── KEY EVENTS (point items: move only, auto-stacked) ── */}
            <div className="ax-row">
              <div className="ax-row-label">
                KEY EVENTS
                <div className="ax-row-sublabel">PLOTTED BY DATE</div>
                <button type="button" className="ax-lane-add" onClick={addEvent} title="Add an event" data-testid="ax-add-event">
                  +
                </button>
              </div>
              <div
                className="ax-row-content ax-events"
                ref={setRowRef('events')}
                style={{ height: `${(stackedEvents.laneCount - 1) * 92 + 96}px` }}
                data-testid="ax-events-row"
                data-lane-count={stackedEvents.laneCount}
              >
                {gridlines}
                {stackedEvents.items.map(({ item: event, leftPct, lane }) => {
                  const selected = selection?.type === 'event' && selection.id === event.id;
                  const flash = isFlashback(event, visibleKeyEvents);
                  return (
                    <div
                      key={event.id}
                      className={`ax-event${selected ? ' ax-event--selected' : ''}${flagCls(event.id)}`}
                      style={{
                        left: `${leftPct}%`,
                        top: `${lane * 92}px`,
                        ...(flash && !selected
                          ? { border: '1px dashed rgba(255,211,25,.5)' }
                          : {}),
                        ...greyStyle(!isEventWritten(event, hereWhen)),
                      }}
                      title="Drag to set roughly when it happens — fine-tune in the exact-time picker"
                      onClick={(e) => handleSelect(e, 'event', event.id)}
                      onMouseDown={(e) => beginEventDrag(e, event, 'events')}
                      data-ax-id={event.id}
                      data-testid={`ax-event-${event.id}`}
                      data-lane={lane}
                      data-flash={flash || undefined}
                    >
                      <div className="ax-event-head">
                        <span className="ax-event-icon">{event.icon ?? '✦'}</span>
                        <div className="ax-event-titles">
                          <div className="ax-event-title">{event.name}</div>
                          <div className="ax-event-when">
                            {event.chapter != null
                              ? `Ch. ${event.chapter}`
                              : formatWhen(event.when, calendar, t0)}
                          </div>
                        </div>
                        {flash && (
                          <span className="ax-event-flash" data-testid={`ax-flash-${event.id}`}>
                            FLASHBACK
                          </span>
                        )}
                      </div>
                      {event.summary && <div className="ax-event-desc">{event.summary}</div>}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ── M23: CHARACTERS (lifespan lines, one lane each — 6087) ── */}
            {isStoryTimeline && (
              <div className="ax-row">
                <div className="ax-row-label">
                  CHARACTERS
                  <div className="ax-row-sublabel">LIFESPANS · APPEARANCES</div>
                  <button
                    type="button"
                    className="ax-lane-add"
                    onClick={() => addLaneSpan(CHARACTER_LANE, 'New Character', characters.length)}
                    title="Add a character — lines mark lifespans or when they appear"
                    data-testid="ax-add-char"
                  >
                    +
                  </button>
                </div>
                <div
                  className="ax-row-content ax-chars"
                  ref={setRowRef('chars')}
                  style={{ height: `${Math.max(1, characterLanes.laneCount) * 20 + 2}px` }}
                  data-testid="ax-chars-row"
                  data-lane-count={characterLanes.laneCount}
                >
                  {gridlines}
                  {characterLanes.items.map(({ item: journey, lane }) => {
                    const col = journey.color ?? laneColor(lane);
                    const l = axisPctL(journey.startWhen, t0, t1);
                    const r = axisPctL(journey.endWhen, t0, t1);
                    const planned = hereWhen == null || journey.startWhen > hereWhen;
                    return (
                      <div
                        key={journey.id}
                        className="ax-char"
                        style={{
                          left: `${l}%`,
                          width: `${Math.max(2.5, r - l)}%`,
                          top: `${lane * 20}px`,
                          ...greyStyle(planned, inFocusedBook(journey.startWhen, journey.endWhen)),
                          ...selRing('span', journey.id, col),
                        }}
                        title={`${journey.name} — drag to move · drag edges to resize`}
                        onClick={(e) => handleSelect(e, 'span', journey.id)}
                        onMouseDown={(e) => beginSpanLikeDrag(e, 'move', 'span', journey, 'chars')}
                        data-ax-id={journey.id}
                      data-testid={`ax-char-${journey.id}`}
                        data-lane={lane}
                      >
                        <span
                          className="ax-char-name"
                          style={{ color: col, textShadow: `0 0 8px ${hexA(col, 0.5)}` }}
                        >
                          {journey.name}
                        </span>
                        <span
                          className="ax-char-line"
                          style={{
                            background: `linear-gradient(90deg, ${hexA(col, 0.25)}, ${col} 12%, ${col} 88%, ${hexA(col, 0.25)})`,
                            boxShadow: `0 0 8px ${hexA(col, 0.5)}`,
                          }}
                        />
                        <span
                          className="ax-handle ax-handle--7 ax-handle--l"
                          onMouseDown={(e) => beginSpanLikeDrag(e, 'resize-left', 'span', journey, 'chars')}
                          data-testid={`ax-rz-l-${journey.id}`}
                        />
                        <span
                          className="ax-handle ax-handle--7 ax-handle--r"
                          onMouseDown={(e) => beginSpanLikeDrag(e, 'resize-right', 'span', journey, 'chars')}
                          data-testid={`ax-rz-r-${journey.id}`}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── M23: WORLD (compact chips, plotted by date — 6700) ── */}
            {isStoryTimeline && (
              <div className="ax-row">
                <div className="ax-row-label">
                  WORLD
                  <div className="ax-row-sublabel">PLOTTED BY DATE</div>
                  <button
                    type="button"
                    className="ax-lane-add"
                    onClick={addWorldEvent}
                    title="Add a world event"
                    data-testid="ax-add-world"
                  >
                    +
                  </button>
                </div>
                <div
                  className="ax-row-content ax-world"
                  ref={setRowRef('world')}
                  style={{ height: `${(stackedWorld.laneCount - 1) * 56 + 56}px` }}
                  data-testid="ax-world-row"
                  data-lane-count={stackedWorld.laneCount}
                >
                  {gridlines}
                  {stackedWorld.items.map(({ item: event, leftPct, lane }, i) => {
                    const col = laneColor(i);
                    const day = safeDecodeWhen(event.when, calendar, t0);
                    return (
                      <div
                        key={event.id}
                        className={`ax-world-chip${flagCls(event.id)}`}
                        style={{
                          left: `${leftPct}%`,
                          top: `${lane * 56}px`,
                          border: `1px solid ${hexA(col, 0.4)}`,
                          ...selRing('event', event.id, col),
                        }}
                        title="Drag to set roughly when · click to edit"
                        onClick={(e) => handleSelect(e, 'event', event.id)}
                        onMouseDown={(e) => beginEventDrag(e, event, 'world')}
                        data-ax-id={event.id}
                      data-testid={`ax-world-${event.id}`}
                        data-lane={lane}
                      >
                        <div className="ax-world-day" style={{ color: col }}>
                          {`Y${day.year} · D${day.day}`}
                        </div>
                        <div className="ax-world-title">{event.name}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── M23: THEMES (gradient chips — 6094) ── */}
            {isStoryTimeline && (
              <div className="ax-row">
                <div className="ax-row-label">THEMES</div>
                <div className="ax-row-content ax-themes" data-testid="ax-themes-row">
                  {themes.map((theme, i) => {
                    const col = laneColor([1, 7, 8, 2][i % 4]);
                    return (
                      <button
                        type="button"
                        key={theme.id}
                        className="ax-theme"
                        style={{
                          background: `linear-gradient(120deg, ${hexA(col, 0.3)}, ${hexA(col, 0.12)})`,
                          border: `1px solid ${hexA(col, 0.45)}`,
                          ...selRing('event', theme.id, col),
                        }}
                        title="Click to edit this theme"
                        onClick={(e) => handleSelect(e, 'event', theme.id)}
                        data-ax-id={theme.id}
                      data-testid={`ax-theme-${theme.id}`}
                      >
                        {theme.name}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    className="ax-lane-add ax-lane-add--inline"
                    onClick={addTheme}
                    title="Add a theme"
                    data-testid="ax-add-theme"
                  >
                    +
                  </button>
                </div>
              </div>
            )}

            {/* ── CUSTOM ROWS ── */}
            {customRows.map((row) => (
              <div className="ax-row" key={row.id} data-testid={`ax-crow-${row.id}`}>
                <div className="ax-row-label ax-row-label--custom">
                  <input
                    className="ax-crow-name"
                    value={row.name}
                    onChange={(e) => updateLocalItem('row', { ...row, name: e.target.value })}
                    onBlur={() => persistItem('row', { ...row })}
                    aria-label="Custom row name"
                    data-testid={`ax-crow-name-${row.id}`}
                  />
                  <button
                    type="button"
                    className="ax-crow-remove"
                    onClick={() => removeRow(row)}
                    data-testid={`ax-crow-remove-${row.id}`}
                  >
                    remove
                  </button>
                </div>
                <div
                  className="ax-row-content ax-crow-items"
                  ref={setRowRef(`crow:${row.id}`)}
                  data-testid={`ax-crow-items-${row.id}`}
                >
                  {gridlines}
                  {rowItems(row.id).map((item, i) => {
                    const col = item.color ?? laneColor(i);
                    const l = axisPct(item.startWhen, t0, t1);
                    const r = axisPct(item.endWhen, t0, t1);
                    return (
                      <div
                        key={item.id}
                        className={`ax-crow-item${flagCls(item.id)}`}
                        style={{
                          left: `${l}%`,
                          width: `${Math.max(3, r - l)}%`,
                          background: hexA(col, 0.12),
                          border: `1px solid ${hexA(col, 0.45)}`,
                          ...selRing('span', item.id, col),
                        }}
                        title="Drag to move · drag edges to resize · click to edit"
                        onClick={(e) => handleSelect(e, 'span', item.id)}
                        onMouseDown={(e) => beginSpanLikeDrag(e, 'move', 'span', item, `crow:${row.id}`)}
                        data-ax-id={item.id}
                          data-testid={`ax-crow-item-${item.id}`}
                      >
                        {item.name}
                        <span
                          className="ax-handle ax-handle--6 ax-handle--l"
                          onMouseDown={(e) => beginSpanLikeDrag(e, 'resize-left', 'span', item, `crow:${row.id}`)}
                          data-testid={`ax-rz-l-${item.id}`}
                        />
                        <span
                          className="ax-handle ax-handle--6 ax-handle--r"
                          onMouseDown={(e) => beginSpanLikeDrag(e, 'resize-right', 'span', item, `crow:${row.id}`)}
                          data-testid={`ax-rz-r-${item.id}`}
                        />
                      </div>
                    );
                  })}
                </div>
                <button
                  type="button"
                  className="ax-lane-add"
                  onClick={() => addRowItem(row)}
                  title="Plot a span on this row"
                  data-testid={`ax-crow-add-${row.id}`}
                >
                  +
                </button>
              </div>
            ))}

            <button type="button" className="ax-add-crow" onClick={addCustomRow} data-testid="ax-add-crow">
              + Custom row
            </button>
          </div>
        </div>

      </div>

      <Toast message={toast?.message ?? null} level={toast?.level} />
    </div>
  );
}
