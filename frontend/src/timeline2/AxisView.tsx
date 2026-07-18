// Beta 4 M22 — Axis engine (§8.3): ERAS bar, adaptive ticks, zoom seg +
// Ctrl+scroll, min-width growth + bottom scrollbar, universal direct
// manipulation (drag-to-move, 7px/6px edge resize, click-select → inspector),
// exact-time picker modal, auto-stacking.
//
// Renders straight from the M21 TimelinesStore (eras / spans / events /
// custom rows) and persists every mutation through the timelines:upsertItem /
// timelines:deleteItem IPC. M23 layers the full lane rows (books, arcs,
// chapters, plotlines, characters, world, themes) on this machinery; M25
// replaces the built-in mini inspector with the full right-panel Inspector.
//
// Exact values ported from the prototype ("Mythos Writer - Liquid Neon
// .dc.html"): eras bar 19px/17px items + 6px handles (2078–2085), span cards
// 46px + 7px handles (2093), custom-row items 24px + 6px handles (2175),
// event cards 215px (6691–6697), lane heights 50/92/56 (7173–7175), toasts
// verbatim.
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
} from './axis/calendarCodec';
import { AXIS_ZOOM_SEGS, axisPct, generateTicks, type AxisZoomSeg } from './axis/ticks';
import { applyWheelZoom, canvasMinWidth } from './axis/zoom';
import { stackPoints, stackSpans } from './axis/lanes';
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
import { useToast } from '../hooks/useToast';
import { Toast } from '../components/Toast/Toast';
import ExactTimeModal from './ExactTimeModal';
import CalendarEditorModal from './CalendarEditorModal';
import './AxisView.css';

type SelectableType = 'era' | 'span' | 'event';

interface AxisSelection {
  type: SelectableType;
  id: string;
}

export interface AxisViewProps {
  store: TimelinesStore;
  /** Receives the authoritative store after every persisted mutation. */
  onStoreChange: (store: TimelinesStore) => void;
}

function newItemId(prefix: string): string {
  const uuid =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}:${uuid}`;
}

export default function AxisView({ store, onStoreChange }: AxisViewProps) {
  // Local working copy: dragging mutates this for 60fps feedback; persistence
  // flows through IPC and comes back via onStoreChange → props.
  const [localStore, setLocalStore] = useState<TimelinesStore>(store);
  useEffect(() => { setLocalStore(store); }, [store]);

  const [zoomSeg, setZoomSeg] = useState<AxisZoomSeg>('Year');
  const [zoomX, setZoomX] = useState(1);
  const [selection, setSelection] = useState<AxisSelection | null>(null);
  const [exactTimeOpen, setExactTimeOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);

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
  }, [activeId]);
  const [t0, t1] = domain;

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

  const stackedSpans = useMemo(() => {
    const mainSpans = localStore.spans.filter((s) => s.timelineId === activeId && !s.rowId);
    return stackSpans(
      mainSpans.map((s) => ({
        item: s,
        leftPct: axisPct(s.startWhen, t0, t1),
        rightPct: axisPct(s.endWhen, t0, t1),
      })),
    );
  }, [localStore.spans, activeId, t0, t1]);

  const stackedEvents = useMemo(() => {
    const events = localStore.events.filter((e) => e.timelineId === activeId);
    // Prototype 6690: the events row always reserves two lanes (`tlEvLanes = 2`).
    return stackPoints(events.map((e) => ({ item: e, pct: axisPct(e.when, t0, t1) })), 17, 2);
  }, [localStore.events, activeId, t0, t1]);

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
    setSelection((prev) => (prev && prev.type === type && prev.id === id ? null : { type, id }));
  }, []);

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
  }, [t0, t1, activeId, eras.length, updateLocalItem, persistItem, showToast]);

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
  }, [t0, t1, activeId, stackedSpans.items.length, updateLocalItem, persistItem, showToast]);

  const addEvent = useCallback(() => {
    const event: TimelineEvent = {
      id: newItemId('event'),
      timelineId: activeId,
      name: 'New event',
      when: roundWhen(t0 + (t1 - t0) / 2),
      source: 'manual',
    };
    updateLocalItem('event', event);
    persistItem('event', event);
    setSelection({ type: 'event', id: event.id });
    showToast('Event added — fill it in on the right');
  }, [t0, t1, activeId, updateLocalItem, persistItem, showToast]);

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
    [t0, t1, activeId, rowItems, updateLocalItem, persistItem],
  );

  const removeRow = useCallback(
    (row: TimelineRow) => {
      removeLocalItem('row', row.id);
      deleteItem('row', row.id);
      setSelection(null);
      showToast('Row removed');
    },
    [removeLocalItem, deleteItem, showToast],
  );

  // ── Selection helpers ──
  const selectedItem: TimelineEra | TimelineSpan | TimelineEvent | null = useMemo(() => {
    if (!selection) return null;
    if (selection.type === 'era') return eras.find((e) => e.id === selection.id) ?? null;
    if (selection.type === 'span')
      return localStore.spans.find((s) => s.id === selection.id) ?? null;
    return localStore.events.find((e) => e.id === selection.id) ?? null;
  }, [selection, eras, localStore.spans, localStore.events]);

  const selectedKindLabel = useMemo(() => {
    if (!selection || !selectedItem) return '';
    if (selection.type === 'era') return 'Era';
    if (selection.type === 'event') return 'Event';
    return (selectedItem as TimelineSpan).rowId ? 'Custom row item' : 'Timeline span';
  }, [selection, selectedItem]);

  const renameSelected = useCallback(
    (name: string) => {
      if (!selection || !selectedItem) return;
      updateLocalItem(selection.type, { ...selectedItem, name });
    },
    [selection, selectedItem, updateLocalItem],
  );

  const commitSelected = useCallback(() => {
    if (!selection || !selectedItem) return;
    persistItem(selection.type, selectedItem);
  }, [selection, selectedItem, persistItem]);

  const deleteSelected = useCallback(() => {
    if (!selection) return;
    removeLocalItem(selection.type, selection.id);
    deleteItem(selection.type, selection.id);
    setSelection(null);
    showToast('Deleted');
  }, [selection, removeLocalItem, deleteItem, showToast]);

  const setEmbed = useCallback(
    (timelineId: string) => {
      if (!selection || selection.type !== 'span' || !selectedItem) return;
      const span = { ...(selectedItem as TimelineSpan) };
      if (timelineId) span.opensTimelineId = timelineId;
      else delete span.opensTimelineId;
      updateLocalItem('span', span);
      persistItem('span', span);
      if (timelineId) showToast('Timeline embedded — clicking this span now opens it');
    },
    [selection, selectedItem, updateLocalItem, persistItem, showToast],
  );

  const applyExactTime = useCallback(
    (result: { when?: number; startWhen?: number; endWhen?: number }) => {
      if (!selection || !selectedItem) return;
      if (selection.type === 'event' && result.when != null) {
        const next = { ...(selectedItem as TimelineEvent), when: result.when };
        updateLocalItem('event', next);
        persistItem('event', next);
      } else if (selection.type !== 'event' && result.startWhen != null && result.endWhen != null) {
        // The store rejects end ≤ start — keep at least one tick apart.
        const endWhen = result.endWhen > result.startWhen ? result.endWhen : roundWhen(result.startWhen + 0.1);
        const next = {
          ...(selectedItem as TimelineEra | TimelineSpan),
          startWhen: result.startWhen,
          endWhen,
        };
        updateLocalItem(selection.type, next);
        persistItem(selection.type, next);
      }
      setExactTimeOpen(false);
      showToast('Exact time set — replotted on the axis');
    },
    [selection, selectedItem, updateLocalItem, persistItem, showToast],
  );

  const persistCalendar = useCallback(
    (nextCalendar: { preset: string; monthsPerYear: number; daysPerMonth: number; hoursPerDay: number }, presetLabel?: string) => {
      if (!active) return;
      const api = window.api;
      if (typeof api?.timelinesUpsert !== 'function') return;
      api
        .timelinesUpsert({ id: active.id, name: active.name, kind: active.kind, calendar: nextCalendar })
        .then((res) => {
          if (res.ok) onStoreChange(res.store);
          if (presetLabel) showToast(`Calendar set — ${presetLabel}`);
        })
        .catch(() => {});
    },
    [active, onStoreChange, showToast],
  );

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
                      className="ax-span"
                      style={{
                        left: `${leftPct}%`,
                        width: `${Math.max(4, rightPct - leftPct)}%`,
                        top: `${lane * 50}px`,
                        background: hexA(col, 0.08),
                        border: `1px ${embedded ? 'dashed' : 'solid'} ${hexA(col, 0.5)}`,
                        boxShadow: `inset 0 0 18px ${hexA(col, 0.05)}`,
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
                {stackedEvents.items.map(({ item: event, leftPct, lane }) => (
                  <div
                    key={event.id}
                    className={`ax-event${selection?.type === 'event' && selection.id === event.id ? ' ax-event--selected' : ''}`}
                    style={{ left: `${leftPct}%`, top: `${lane * 92}px` }}
                    title="Drag to set roughly when it happens — fine-tune in the exact-time picker"
                    onClick={(e) => handleSelect(e, 'event', event.id)}
                    onMouseDown={(e) => beginEventDrag(e, event, 'events')}
                    data-testid={`ax-event-${event.id}`}
                    data-lane={lane}
                  >
                    <div className="ax-event-head">
                      <span className="ax-event-icon">✦</span>
                      <div className="ax-event-titles">
                        <div className="ax-event-title">{event.name}</div>
                        <div className="ax-event-when">{formatWhen(event.when, calendar, t0)}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

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
                        className="ax-crow-item"
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

        {/* ── Mini inspector (M25 replaces this with the right-panel Inspector) ── */}
        {selection && selectedItem && (
          <aside className="ax-inspector" data-testid="ax-inspector" aria-label="Timeline item inspector">
            <div className="ax-insp-kind">{selectedKindLabel}</div>
            <label className="ax-insp-label" htmlFor="ax-insp-title">TITLE</label>
            <input
              id="ax-insp-title"
              className="ax-insp-title"
              value={selectedItem.name}
              onChange={(e) => renameSelected(e.target.value)}
              onBlur={commitSelected}
              data-testid="ax-insp-title"
            />
            {selection.type === 'event' ? (
              <div className="ax-insp-when" data-testid="ax-insp-when">
                {formatWhen((selectedItem as TimelineEvent).when, calendar, t0)}
              </div>
            ) : (
              <div className="ax-insp-when" data-testid="ax-insp-when">
                <span>STARTS {formatWhen((selectedItem as TimelineEra | TimelineSpan).startWhen, calendar, t0)}</span>
                <span>ENDS {formatWhen((selectedItem as TimelineEra | TimelineSpan).endWhen, calendar, t0)}</span>
              </div>
            )}
            <button
              type="button"
              className="ax-insp-exact"
              onClick={() => setExactTimeOpen(true)}
              title="Set year, month, day and hour — uses this timeline's calendar"
              data-testid="ax-insp-exact"
            >
              Set exact time…
            </button>
            {selection.type === 'span' && !(selectedItem as TimelineSpan).rowId && (
              <>
                <label className="ax-insp-label" htmlFor="ax-insp-embed">EMBEDS TIMELINE</label>
                <select
                  id="ax-insp-embed"
                  className="ax-insp-embed"
                  value={(selectedItem as TimelineSpan).opensTimelineId ?? ''}
                  onChange={(e) => setEmbed(e.target.value)}
                  data-testid="ax-insp-embed"
                >
                  <option value="">Nothing — plain span</option>
                  {localStore.timelines
                    .filter((t) => t.id !== activeId)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                </select>
              </>
            )}
            <button type="button" className="ax-insp-delete" onClick={deleteSelected} data-testid="ax-insp-delete">
              Delete
            </button>
          </aside>
        )}
      </div>

      {exactTimeOpen && selectedItem && selection && (
        <ExactTimeModal
          calendar={calendar}
          target={
            selection.type === 'event'
              ? { kind: 'single', when: (selectedItem as TimelineEvent).when }
              : {
                  kind: 'dual',
                  startWhen: (selectedItem as TimelineEra | TimelineSpan).startWhen,
                  endWhen: (selectedItem as TimelineEra | TimelineSpan).endWhen,
                }
          }
          fallbackWhen={t0}
          onApply={applyExactTime}
          onClose={() => setExactTimeOpen(false)}
          onEditCalendar={() => setCalendarOpen(true)}
        />
      )}

      {calendarOpen && (
        <CalendarEditorModal
          timelineName={active.name}
          calendar={calendar}
          onChange={persistCalendar}
          onClose={() => setCalendarOpen(false)}
        />
      )}

      <Toast message={toast?.message ?? null} level={toast?.level} />
    </div>
  );
}
