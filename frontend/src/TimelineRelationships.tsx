// Beta 3 M20 — Relationships view: per-character presence table per key event
// (prototype template 1507–1526, data `relChars` 4578–4581).
//
// SKY-7935 (Beta4/M24 a11y rebuild, spec §3.2): rebuilt from the earlier
// div-based track/dot markup onto the shared native `<table>` used by both
// this mode and Subway's "View as table" toggle
// (TimelineCharacterPresenceTable.tsx) — real table semantics so
// screen-reader table-navigation commands work, the WAI-ARIA APG grid
// keyboard pattern, and inert `—` text for absent cells instead of a blank
// dot slot.
import {
  type AeonTimelineData,
} from './timelineAeon';
import TimelineCharacterPresenceTable from './TimelineCharacterPresenceTable';
import './TimelineRelationships.css';

export interface TimelineRelationshipsProps {
  data: AeonTimelineData;
  /** Selecting a presence cell opens the Inspector on that event's scene (spec §0). */
  onOpenScene?: (sceneId: string) => void;
}

export default function TimelineRelationships({ data, onOpenScene }: TimelineRelationshipsProps) {
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
      {lines.length === 0 ? (
        <p className="trl-no-lines" data-testid="trl-no-lines">
          Link characters to scenes to see their presence at each beat.
        </p>
      ) : (
        <TimelineCharacterPresenceTable events={events} lines={lines} onOpenScene={onOpenScene} />
      )}

      <div className="trl-caption">Relationship view — who is present at every beat of the story.</div>
    </div>
  );
}
