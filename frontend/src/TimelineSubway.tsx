// Beta 3 M20 — Subway view: per-character colored SVG polylines through the
// key-event stations, with absence dips + station circles.
//
// Exact port of the prototype's Timeline Subway (template 1480–1506, math
// `subLines` 4703–4709 → buildSubwayLines in timelineAeon.ts). Line/station
// colors come from the shared hue-separation algorithm (SKY-7935,
// lib/characterHue.ts via timelineAeon's `lines`).
//
// SKY-7935 (Beta4/M24 a11y rebuild, spec §3.3): station row rebuilt onto the
// roving-tabindex keyboard pattern (role="button", ArrowLeft/ArrowRight move
// focus, Home/End jump first/last, Enter/Space activates → Inspector); the
// raw SVG path is `aria-hidden` (decorative — semantics carried by the
// station buttons + the "View as table" toggle in TimelineRoot).
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  type AeonTimelineData,
  buildSubwayLines,
  SUBWAY_VIEWBOX_WIDTH,
  SUBWAY_VIEWBOX_HEIGHT,
} from './timelineAeon';
import './TimelineSubway.css';

export interface TimelineSubwayProps {
  data: AeonTimelineData;
  onOpenScene?: (sceneId: string) => void;
}

export default function TimelineSubway({ data, onOpenScene }: TimelineSubwayProps) {
  const { events, lines } = data;

  const subwayLines = useMemo(
    () => buildSubwayLines(lines, events.length),
    [lines, events.length],
  );

  // Roving tabindex (spec §3.3 / §0): one Tab stop into the station row,
  // ArrowLeft/ArrowRight move focus station to station, Home/End jump to
  // first/last, Enter/Space activates (opens the Inspector for that chapter).
  const [focusedIndex, setFocusedIndex] = useState(0);
  const stationRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const moveFocus = useCallback((index: number) => {
    const clamped = Math.max(0, Math.min(events.length - 1, index));
    setFocusedIndex(clamped);
    stationRefs.current[clamped]?.focus();
  }, [events.length]);

  const handleStationKeyDown = useCallback((e: React.KeyboardEvent, index: number) => {
    switch (e.key) {
      case 'ArrowRight': e.preventDefault(); moveFocus(index + 1); break;
      case 'ArrowLeft': e.preventDefault(); moveFocus(index - 1); break;
      case 'Home': e.preventDefault(); moveFocus(0); break;
      case 'End': e.preventDefault(); moveFocus(events.length - 1); break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        onOpenScene?.(events[index].sceneId);
        break;
      default: break;
    }
  }, [moveFocus, events, onOpenScene]);

  if (events.length === 0) {
    return (
      <div className="tsw-empty" data-testid="timeline-subway-empty">
        <h2>No timeline events yet.</h2>
        <p>Create scenes in your story to see character lines here.</p>
      </div>
    );
  }

  return (
    <div className="tsw-root" data-testid="timeline-subway" role="region" aria-label="Subway timeline">
      <div className="tsw-board" data-screen-label="Timeline Subway">
        {/* ── Event stations (1482–1490) — roving-tabindex row, role="button" ── */}
        <div className="tsw-events" role="group" aria-label="Chapters">
          {events.map((event, i) => (
            <button
              key={event.sceneId}
              type="button"
              role="button"
              className="tsw-event"
              data-testid="tsw-event"
              aria-label={`Chapter ${i + 1}: ${event.title}`}
              tabIndex={focusedIndex === i ? 0 : -1}
              ref={el => { stationRefs.current[i] = el; }}
              onFocus={() => setFocusedIndex(i)}
              onKeyDown={e => handleStationKeyDown(e, i)}
              onClick={() => { setFocusedIndex(i); onOpenScene?.(event.sceneId); }}
            >
              <div className="tsw-event-icon" aria-hidden="true">{event.icon}</div>
              <div className="tsw-event-title">{event.title}</div>
              <div className="tsw-event-ch">{event.ch}</div>
            </button>
          ))}
        </div>

        {lines.length === 0 ? (
          <p className="tsw-no-lines" data-testid="tsw-no-lines">
            Link characters to scenes to draw their subway lines.
          </p>
        ) : (
          <>
            {/* ── Polylines + stations (1491–1499) — decorative, aria-hidden;
                semantics carried by the station buttons above and the table
                toggle (spec §3.3). ── */}
            <svg
              className="tsw-svg"
              viewBox={`0 0 ${SUBWAY_VIEWBOX_WIDTH} ${SUBWAY_VIEWBOX_HEIGHT}`}
              preserveAspectRatio="none"
              aria-hidden="true"
              data-testid="tsw-svg"
            >
              {subwayLines.map(line => {
                const stroke = line.color;
                return (
                  <g key={line.name} data-testid="tsw-line">
                    <path
                      d={line.path}
                      fill="none"
                      stroke={stroke}
                      strokeWidth={4}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      opacity={0.85}
                      style={{ filter: `drop-shadow(0 0 6px ${stroke})` }}
                      data-testid="tsw-path"
                    />
                    {line.stations.map(s => (
                      <circle
                        key={`${s.cx}-${s.cy}`}
                        cx={s.cx}
                        cy={s.cy}
                        r={7}
                        fill="#0b0d17"
                        stroke={stroke}
                        strokeWidth={3}
                        style={{ filter: `drop-shadow(0 0 7px ${stroke})` }}
                        data-testid="tsw-station"
                      />
                    ))}
                  </g>
                );
              })}
            </svg>

            {/* ── Legend (1500–1504) — color paired with a line-dash pattern
                per character (spec §0/§3.3 color independence), cycling for
                >4 characters. ── */}
            <div className="tsw-legend" data-testid="tsw-legend">
              {subwayLines.map((line, i) => {
                const color = line.color;
                const dashClass = `tsw-legend-swatch--dash-${i % 4}`;
                return (
                  <span key={line.name} className="tsw-legend-item">
                    <span
                      className={`tsw-legend-swatch ${dashClass}`}
                      style={{ background: color, boxShadow: `0 0 8px ${color}` }}
                      aria-hidden="true"
                    />
                    {line.name}
                  </span>
                );
              })}
            </div>
          </>
        )}
      </div>
      <div className="tsw-caption">
        Aeon-style subway — each character is a line; stations are the events they&rsquo;re part of.
        Dips mean they sit that beat out.
      </div>
    </div>
  );
}
