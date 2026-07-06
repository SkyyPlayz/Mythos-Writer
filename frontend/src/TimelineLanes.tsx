// Beta 3 M20 — Aeon lane stack: eras ruler, book bands, arcs, chapter cells,
// key events, characters, world, themes + minimap scrubber.
//
// Renders both lanes modes (prototype template 1527–1592):
//   - mode='progress' (Plan vs Progress) greys unwritten content with the exact
//     prototype filter `grayscale(.92) brightness(.82)` + opacity .55 (4259)
//     and outlines the "you are here" chapter in cyan (4263).
//   - mode='structure' is the same lane stack ungreyed (tlIsLanes, 4576).
// The minimap (1583–1591) mirrors the chapter strip; dragging its viewport
// window scrolls the lane canvas horizontally (math in timelineAeon.ts).
import { useState, useEffect, useRef, useCallback } from 'react';
import {
  type AeonTimelineData,
  type TimelineZoom,
  TIMELINE_ZOOM_FACTORS,
  PROGRESS_GREY_FILTER,
  PROGRESS_GREY_OPACITY,
  hexA,
  minimapWindow,
  minimapScrollLeft,
} from './timelineAeon';
import './TimelineLanes.css';

export interface TimelineLanesProps {
  data: AeonTimelineData;
  mode: 'progress' | 'structure';
  zoom: TimelineZoom;
  onOpenScene?: (sceneId: string) => void;
  /** Incremented by the header's "Today" jump — scrolls the here-chapter into view. */
  todaySignal?: number;
}

/** Inline grey style for unwritten content in Plan-vs-Progress mode. Inline
 *  (like the prototype) so tests can assert the exact filter values. */
function greyStyle(mode: 'progress' | 'structure', unwritten: boolean): React.CSSProperties {
  if (mode !== 'progress' || !unwritten) return {};
  return { filter: PROGRESS_GREY_FILTER, opacity: PROGRESS_GREY_OPACITY };
}

export default function TimelineLanes({ data, mode, zoom, onOpenScene, todaySignal }: TimelineLanesProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const draggingRef = useRef(false);

  // Scroll metrics drive the minimap window. Content width scales with zoom.
  const [metrics, setMetrics] = useState({ scrollLeft: 0, viewportWidth: 0, contentWidth: 0 });

  const measure = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setMetrics({
      scrollLeft: el.scrollLeft,
      viewportWidth: el.clientWidth,
      contentWidth: el.scrollWidth,
    });
  }, []);

  const handleScroll = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      measure();
    });
  }, [measure]);

  useEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('resize', measure);
      if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    };
  }, [measure, zoom, data]);

  // "Today" jump: scroll the here-chapter cell into view.
  useEffect(() => {
    if (!todaySignal) return;
    const here = scrollRef.current?.querySelector<HTMLElement>('[data-here="true"]');
    here?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [todaySignal]);

  // ── Minimap scrubbing ──

  const scrubTo = useCallback((clientX: number) => {
    const track = trackRef.current;
    const scroller = scrollRef.current;
    if (!track || !scroller) return;
    const rect = track.getBoundingClientRect();
    if (rect.width <= 0) return;
    const frac = (clientX - rect.left) / rect.width;
    scroller.scrollLeft = minimapScrollLeft(frac, scroller.clientWidth, scroller.scrollWidth);
    measure();
  }, [measure]);

  const handleTrackPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = true;
    // jsdom has no pointer capture — guard for tests.
    e.currentTarget.setPointerCapture?.(e.pointerId);
    scrubTo(e.clientX);
  }, [scrubTo]);

  const handleTrackPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    scrubTo(e.clientX);
  }, [scrubTo]);

  const handleTrackPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  }, []);

  const win = minimapWindow(metrics.scrollLeft, metrics.viewportWidth, metrics.contentWidth);
  const zoomFactor = TIMELINE_ZOOM_FACTORS[zoom];

  const { events, chapters, eras, bands, arcs, journeys, world, themes, hereIndex } = data;

  if (chapters.length === 0 && events.length === 0) {
    return (
      <div className="tla-empty" data-testid="timeline-lanes-empty">
        <h2>No timeline data yet.</h2>
        <p>Create chapters and scenes in your story to build the lane view.</p>
      </div>
    );
  }

  return (
    <div
      className="tla-root"
      data-testid="timeline-lanes"
      data-mode={mode}
      role="region"
      aria-label={mode === 'progress' ? 'Plan vs Progress timeline lanes' : 'Structure timeline lanes'}
    >
      <div className="tla-scroll" ref={scrollRef} onScroll={handleScroll} data-testid="tla-scroll">
        <div className="tla-canvas" style={{ minWidth: `${zoomFactor * 100}%` }}>
          {/* ── ERAS ruler (prototype 1528–1533) ── */}
          {eras.length > 0 && (
            <div className="tla-row">
              <div className="tla-row-label">ERAS</div>
              <div className="tla-eras" data-testid="tla-eras">
                {eras.map(era => (
                  <div key={era.label} className="tla-era" style={{ flex: era.flex }}>
                    {era.label}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Book bands (prototype 1534–1539 / 4260) ── */}
          {bands.length > 0 && (
            <div className="tla-row">
              <div className="tla-row-label" aria-hidden="true" />
              <div className="tla-flex-8" data-testid="tla-bands">
                {bands.map(band => (
                  <div
                    key={band.title}
                    className="tla-band"
                    style={{
                      background: hexA(band.color, 0.07),
                      borderColor: hexA(band.color, 0.35),
                      boxShadow: `inset 0 0 18px ${hexA(band.color, 0.05)}`,
                      ...greyStyle(mode, band.unwritten),
                    }}
                  >
                    <div
                      className="tla-band-title"
                      style={{ color: band.color, textShadow: `0 0 10px ${hexA(band.color, 0.5)}` }}
                    >
                      {band.title}
                    </div>
                    <div className="tla-band-sub">{band.sub}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── ARCS (prototype 1540–1545 / 4261–4262) ── */}
          {arcs.length > 0 && (
            <div className="tla-row">
              <div className="tla-row-label">ARCS</div>
              <div className="tla-flex-6" data-testid="tla-arcs">
                {arcs.map(arc => (
                  <div
                    key={arc.id}
                    className="tla-arc"
                    title={arc.title}
                    style={{
                      flex: arc.flex,
                      background: `linear-gradient(120deg, ${hexA(arc.color, 0.32)}, ${hexA(arc.color, 0.14)})`,
                      borderColor: hexA(arc.color, 0.5),
                      ...greyStyle(mode, !arc.written),
                    }}
                  >
                    {arc.title}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── CHAPTERS strip (prototype 1546–1551 / 4263) ── */}
          {chapters.length > 0 && (
            <div className="tla-row">
              <div className="tla-row-label">CHAPTERS</div>
              <div className="tla-chapters" data-testid="tla-chapters">
                {chapters.map(cell => (
                  <div
                    key={cell.id}
                    className={`tla-chapter${cell.isHere ? ' tla-chapter--here' : ''}`}
                    data-testid="tla-chapter-cell"
                    data-here={cell.isHere ? 'true' : undefined}
                    title={cell.isHere ? `You are here — ${cell.label}` : cell.label}
                    style={{
                      background: hexA(cell.color, 0.4),
                      borderColor: hexA(cell.color, 0.35),
                      ...greyStyle(mode, cell.index > hereIndex),
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* ── KEY EVENTS (prototype 1552–1563 / 4264–4268) ── */}
          {events.length > 0 && (
            <div className="tla-row tla-row--top">
              <div className="tla-row-label tla-row-label--events">KEY EVENTS</div>
              <div className="tla-flex-8" data-testid="tla-events">
                {events.map(event => (
                  <button
                    key={event.sceneId}
                    type="button"
                    className="tla-event"
                    data-testid="tla-event-card"
                    style={greyStyle(mode, !event.written)}
                    onClick={() => onOpenScene?.(event.sceneId)}
                  >
                    <div className="tla-event-head">
                      <span className="tla-event-icon" aria-hidden="true">{event.icon}</span>
                      <div className="tla-event-meta">
                        <div className="tla-event-title">{event.title}</div>
                        <div className="tla-event-ch">{event.ch}</div>
                      </div>
                    </div>
                    {event.description && <div className="tla-event-desc">{event.description}</div>}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── CHARACTERS journeys (prototype 1564–1569 / 4269) ── */}
          {journeys.length > 0 && (
            <div className="tla-row">
              <div className="tla-row-label">CHARACTERS</div>
              <div className="tla-flex-8" data-testid="tla-journeys">
                {journeys.map(j => (
                  <div
                    key={j.id}
                    className="tla-journey"
                    style={{
                      background: hexA(j.color, 0.1),
                      borderColor: hexA(j.color, 0.4),
                      ...greyStyle(mode, !j.written),
                    }}
                  >
                    <div className="tla-journey-name">{j.name}</div>
                    <div
                      className="tla-journey-sub"
                      style={{ color: `var(--n${j.slot}, ${j.color})` }}
                    >
                      {j.sub}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── WORLD (prototype 1570–1577 / 4270) ── */}
          {world.length > 0 && (
            <div className="tla-row tla-row--top">
              <div className="tla-row-label tla-row-label--world">WORLD</div>
              <div className="tla-flex-8" data-testid="tla-world">
                {world.map(w => (
                  <div
                    key={w.id}
                    className="tla-world"
                    style={{ borderColor: hexA(w.color, 0.35) }}
                  >
                    <div className="tla-world-day" style={{ color: w.color }}>{w.day}</div>
                    <div className="tla-world-title">{w.name}</div>
                    {w.description && <div className="tla-world-desc">{w.description}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── THEMES (prototype 1578–1582 / 4271) ── */}
          {themes.length > 0 && (
            <div className="tla-row">
              <div className="tla-row-label">THEMES</div>
              <div className="tla-flex-8" data-testid="tla-themes">
                {themes.map(t => (
                  <div
                    key={t.id}
                    className="tla-theme"
                    style={{
                      background: `linear-gradient(120deg, ${hexA(t.color, 0.3)}, ${hexA(t.color, 0.12)})`,
                      borderColor: hexA(t.color, 0.45),
                    }}
                  >
                    {t.name}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Minimap scrubber (prototype 1583–1591) ── */}
      {chapters.length > 0 && (
        <div className="tla-row tla-minimap-row">
          <div className="tla-row-label" aria-hidden="true" />
          <div
            className="tla-minimap"
            ref={trackRef}
            data-testid="timeline-minimap"
            role="scrollbar"
            aria-label="Timeline minimap scrubber"
            aria-orientation="horizontal"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(win.left * 100)}
            onPointerDown={handleTrackPointerDown}
            onPointerMove={handleTrackPointerMove}
            onPointerUp={handleTrackPointerUp}
          >
            <div className="tla-minimap-cells" aria-hidden="true">
              {chapters.map(cell => (
                <div key={cell.id} className="tla-minimap-cell" />
              ))}
            </div>
            <div
              className="tla-minimap-window"
              data-testid="minimap-window"
              style={{ left: `${win.left * 100}%`, width: `${win.width * 100}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
