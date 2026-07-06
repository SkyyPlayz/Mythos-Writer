// Beta 3 M20 — Relationships view: per-character presence dots per key event
// (prototype template 1507–1526, data `relChars` 4578–4581).
//
// One row per character line: a faint horizontal track plus a glowing radial
// dot in every event column the character is present at. Colors are
// slot-tinted (`var(--nN, hex)` / `var(--gN, …)`) with prototype fallbacks.
import {
  type AeonTimelineData,
  hexA,
} from './timelineAeon';
import './TimelineRelationships.css';

export interface TimelineRelationshipsProps {
  data: AeonTimelineData;
}

export default function TimelineRelationships({ data }: TimelineRelationshipsProps) {
  const { events, lines } = data;

  if (events.length === 0) {
    return (
      <div className="trl-empty" data-testid="timeline-relationships-empty">
        <h2>No timeline events yet.</h2>
        <p>Create scenes in your story to map who is present at each beat.</p>
      </div>
    );
  }

  return (
    <div
      className="trl-root"
      data-testid="timeline-relationships"
      role="region"
      aria-label="Relationships timeline"
    >
      {/* ── Event column headers (1508–1513) ── */}
      <div className="trl-row">
        <div className="trl-name-col" aria-hidden="true" />
        <div className="trl-track trl-track--head">
          {events.map(event => (
            <span key={event.sceneId} className="trl-event-head" data-testid="trl-event-head">
              {event.icon} {event.title}
            </span>
          ))}
        </div>
      </div>

      {/* ── Character presence rows (1514–1524) ── */}
      {lines.length === 0 ? (
        <p className="trl-no-lines" data-testid="trl-no-lines">
          Link characters to scenes to see their presence at each beat.
        </p>
      ) : (
        lines.map(line => {
          const color = `var(--n${line.slot}, ${line.color})`;
          return (
            <div className="trl-row" key={line.id} data-testid="trl-char-row">
              <div className="trl-name-col trl-name" style={{ color }}>
                {line.name}
              </div>
              <div className="trl-track">
                <div
                  className="trl-line"
                  style={{ background: `var(--b${line.slot}, ${hexA(line.color, 0.3)})` }}
                  aria-hidden="true"
                />
                {events.map((event, i) => {
                  const on = line.presentAt.indexOf(i) > -1;
                  return (
                    <div key={event.sceneId} className="trl-cell">
                      {on && (
                        <span
                          className="trl-dot"
                          data-testid="trl-dot"
                          title={`${line.name} — ${event.title}`}
                          style={{
                            background: `radial-gradient(circle, #fff 0%, var(--n${line.slot}, ${line.color}) 45%, transparent 75%)`,
                            boxShadow: `0 0 10px var(--g${line.slot}, ${hexA(line.color, 0.7)})`,
                          }}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })
      )}

      <div className="trl-caption">Relationship view — who is present at every beat of the story.</div>
    </div>
  );
}
