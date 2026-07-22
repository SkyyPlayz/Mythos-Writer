// Beta 4 M24 — Plotlines (Plottr grid, §8.5): sticky plotline column ×
// 12 chapter columns (`PLOT_GRID_CHAPTERS`); scene cards drag between any
// cell; `+` per cell adds a blank card; grid min-width scales with the zoom
// seg. Reads/writes the M21 `timelines.json` store through the same
// `timelinesUpsertItem` IPC path as the Progress/Structure axis (AxisView),
// so switching modes never loses or duplicates events (M24 AC7).
import { useMemo, useState, useCallback } from 'react';
import type { TimelinesStore, TimelineEvent, TimelineRow } from './timelinesTypes';
import { plotlineRows, plotlineCards, isMainSpan } from './timeline2/axis/storyLanes';
import { PLOT_GRID_CHAPTERS, plotCardWhen } from './timeline2/axis/chapters';
import { deriveAxisDomain } from './timeline2/axis/domain';
import { safeCalendar, roundWhen } from './timeline2/axis/calendarCodec';
import { laneColor, hexA } from './timeline2/axis/palette';
import './TimelinePlotlines.css';

/** Mirrors AxisView's chapter-cell shape — only `isHere` is used here, to
 *  place the YOU ARE HERE marker on the 12-column grid. */
export interface PlotlinesChapterCell {
  isHere?: boolean;
}

export interface TimelinePlotlinesProps {
  store: TimelinesStore;
  onStoreChange: (store: TimelinesStore) => void;
  /** Ordered story chapters (any count) — scaled onto the fixed 12-column
   *  grid the same way `plotCardWhen` scales card placements. */
  chapters?: readonly PlotlinesChapterCell[];
}

const ZOOM_STEPS: readonly { label: string; factor: number }[] = [
  { label: '100%', factor: 1 },
  { label: '150%', factor: 1.5 },
  { label: '200%', factor: 2 },
];

const BASE_COL_WIDTH = 132;
const GRID_COLS = Array.from({ length: PLOT_GRID_CHAPTERS }, (_, i) => i + 1);

const EMPTY_CHAPTERS: readonly PlotlinesChapterCell[] = [];

function newItemId(prefix: string): string {
  const uuid =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}:${uuid}`;
}

export default function TimelinePlotlines({
  store,
  onStoreChange,
  chapters = EMPTY_CHAPTERS,
}: TimelinePlotlinesProps) {
  const active = store.timelines.find((t) => t.id === store.activeTimelineId);
  const activeId = active?.id ?? '';
  const [zoomIdx, setZoomIdx] = useState(0);
  const [dragCardId, setDragCardId] = useState<string | null>(null);

  const plotlines = useMemo(() => plotlineRows(store, activeId), [store, activeId]);

  const books = useMemo(
    () =>
      store.spans
        .filter((s) => s.timelineId === activeId && isMainSpan(s))
        .map((s) => ({ startWhen: s.startWhen, endWhen: s.endWhen })),
    [store.spans, activeId],
  );

  const domain = useMemo(
    () => deriveAxisDomain(store, activeId, safeCalendar(active?.calendar)),
    [store, activeId, active?.calendar],
  );

  const hereCol = useMemo(() => {
    const hereIndex = chapters.findIndex((c) => c.isHere);
    if (hereIndex === -1 || chapters.length === 0) return null;
    const col = Math.round((hereIndex * PLOT_GRID_CHAPTERS) / chapters.length) + 1;
    return Math.max(1, Math.min(PLOT_GRID_CHAPTERS, col));
  }, [chapters]);

  const cardWhen = useCallback(
    (col: number) => roundWhen(plotCardWhen(col, chapters.length, books, domain)),
    [chapters.length, books, domain],
  );

  const persistEvent = useCallback(
    (event: TimelineEvent) => {
      const api = window.api;
      if (typeof api?.timelinesUpsertItem !== 'function') return;
      api
        .timelinesUpsertItem({ type: 'event', item: event })
        .then((res) => { if (res.ok) onStoreChange(res.store); })
        .catch(() => { /* keep the local copy — next load reconciles */ });
    },
    [onStoreChange],
  );

  const handleAddCard = useCallback(
    (plotline: TimelineRow, col: number) => {
      const event: TimelineEvent = {
        id: newItemId('event'),
        timelineId: activeId,
        name: 'New beat',
        when: cardWhen(col),
        rowId: plotline.id,
        chapter: col,
        beat: true,
        summary: 'Describe what happens here.',
        source: 'manual',
      };
      persistEvent(event);
    },
    [activeId, cardWhen, persistEvent],
  );

  const handleDrop = useCallback(
    (plotline: TimelineRow, col: number) => {
      const cardId = dragCardId;
      setDragCardId(null);
      if (!cardId) return;
      const card = store.events.find((e) => e.id === cardId);
      if (!card) return;
      persistEvent({ ...card, rowId: plotline.id, chapter: col, when: cardWhen(col) });
    },
    [dragCardId, store.events, cardWhen, persistEvent],
  );

  if (plotlines.length === 0) {
    return (
      <div className="tlp-empty" data-testid="timeline-plotlines-empty">
        <h2>No plotlines yet.</h2>
        <p>
          Add a plotline from the Progress/Structure toolbar, or lay a Templates ▾ structure onto
          the timeline.
        </p>
      </div>
    );
  }

  const colWidth = BASE_COL_WIDTH * ZOOM_STEPS[zoomIdx].factor;

  return (
    <div className="tlp-root" data-testid="timeline-plotlines" role="region" aria-label="Plotlines grid">
      <div className="tlp-toolbar">
        <span className="tlp-toolbar-label">Zoom</span>
        <div className="tlp-zoom-seg" role="group" aria-label="Grid zoom">
          {ZOOM_STEPS.map((z, i) => (
            <button
              key={z.label}
              type="button"
              className={`tlp-zoom-btn${i === zoomIdx ? ' tlp-zoom-btn--active' : ''}`}
              onClick={() => setZoomIdx(i)}
              data-testid={`tlp-zoom-${z.label}`}
            >
              {z.label}
            </button>
          ))}
        </div>
      </div>

      <div className="tlp-scroll">
        <div className="tlp-grid" style={{ minWidth: `${160 + colWidth * PLOT_GRID_CHAPTERS}px` }}>
          <div className="tlp-header-row">
            <div className="tlp-sticky-col tlp-corner" />
            {GRID_COLS.map((col) => (
              <div
                key={col}
                className="tlp-col-head"
                style={{ width: `${colWidth}px` }}
                data-testid={`tlp-col-head-${col}`}
              >
                Ch. {col}
                {hereCol === col && (
                  <div className="tlp-here" data-testid="tlp-here-marker">YOU ARE HERE</div>
                )}
              </div>
            ))}
          </div>

          {plotlines.map((pl, pi) => {
            const col = pl.color ?? laneColor(pi);
            const cards = plotlineCards(store, pl.id);
            return (
              <div className="tlp-row" key={pl.id} data-testid={`tlp-row-${pl.id}`}>
                <div className="tlp-sticky-col tlp-name-cell">
                  <span className="tlp-dot" style={{ background: col, boxShadow: `0 0 7px ${col}` }} />
                  <span className="tlp-name">{pl.name}</span>
                  <span className="tlp-count">{cards.length}</span>
                </div>
                {GRID_COLS.map((gridCol) => {
                  const cellCards = cards.filter((c) => (c.chapter ?? 1) === gridCol);
                  return (
                    <div
                      key={gridCol}
                      className="tlp-cell"
                      style={{ width: `${colWidth}px` }}
                      data-testid={`tlp-cell-${pl.id}-${gridCol}`}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => { e.preventDefault(); handleDrop(pl, gridCol); }}
                    >
                      {cellCards.map((card) => (
                        <div
                          key={card.id}
                          className="tlp-card"
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.effectAllowed = 'move';
                            setDragCardId(card.id);
                          }}
                          onDragEnd={() => setDragCardId(null)}
                          style={{
                            borderLeft: `3px solid ${hexA(col, card.written ? 1 : 0.35)}`,
                            borderTop: card.beat ? `1px dashed ${hexA(col, 0.5)}` : `1px solid ${hexA(col, 0.3)}`,
                            borderRight: card.beat ? `1px dashed ${hexA(col, 0.5)}` : `1px solid ${hexA(col, 0.3)}`,
                            borderBottom: card.beat ? `1px dashed ${hexA(col, 0.5)}` : `1px solid ${hexA(col, 0.3)}`,
                          }}
                          title={card.summary || card.name}
                          data-testid={`tlp-card-${card.id}`}
                          data-beat={card.beat || undefined}
                        >
                          {card.name}
                        </div>
                      ))}
                      <button
                        type="button"
                        className="tlp-add-btn"
                        onClick={() => handleAddCard(pl, gridCol)}
                        title="Add a scene card"
                        data-testid={`tlp-add-${pl.id}-${gridCol}`}
                      >
                        +
                      </button>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
