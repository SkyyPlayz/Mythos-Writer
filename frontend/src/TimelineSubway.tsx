// Beta 3 M20 — Subway view: per-character colored SVG polylines through the
// key-event stations, with absence dips + station circles.
//
// Exact port of the prototype's Timeline Subway (template 1480–1506, math
// `subLines` 4703–4709 → buildSubwayLines in timelineAeon.ts). Line/station
// colors are slot-tinted (`var(--nN, hex)`) so theme slot changes recolor the
// lines live.
import { useMemo } from 'react';
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
        {/* ── Event stations header (1482–1490) ── */}
        <div className="tsw-events">
          {events.map(event => (
            <button
              key={event.sceneId}
              type="button"
              className="tsw-event"
              data-testid="tsw-event"
              onClick={() => onOpenScene?.(event.sceneId)}
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
            {/* ── Polylines + stations (1491–1499) ── */}
            <svg
              className="tsw-svg"
              viewBox={`0 0 ${SUBWAY_VIEWBOX_WIDTH} ${SUBWAY_VIEWBOX_HEIGHT}`}
              preserveAspectRatio="none"
              role="img"
              aria-label={`Subway lines for ${lines.length} character${lines.length === 1 ? '' : 's'} across ${events.length} events`}
              data-testid="tsw-svg"
            >
              {subwayLines.map(line => {
                const stroke = `var(--n${line.slot}, ${line.color})`;
                return (
                  <g key={line.name} data-testid="tsw-line" aria-label={`Line: ${line.name}`}>
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

            {/* ── Legend (1500–1504) ── */}
            <div className="tsw-legend" data-testid="tsw-legend">
              {subwayLines.map(line => {
                const color = `var(--n${line.slot}, ${line.color})`;
                return (
                  <span key={line.name} className="tsw-legend-item">
                    <span
                      className="tsw-legend-swatch"
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
