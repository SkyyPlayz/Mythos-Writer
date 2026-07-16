// SKY-6306 M21 AC3 — Embedded span mini-preview.
// Renders inside a timeline span that has `opensTimelineId`: dashed border,
// a sub-label, and a fully-zoomed-out strip of the embedded timeline's events
// scaled to its own axis. Clicking fires onOpen.
import { useMemo } from 'react';
import type { TimelineEvent, TimelineDefinition } from './timelinesTypes';
import './EmbeddedSpanPreview.css';

export interface EmbeddedSpanPreviewProps {
  /** The timeline that this span embeds. */
  embeddedTimeline: TimelineDefinition;
  /** All events belonging to the embedded timeline. */
  embeddedEvents: TimelineEvent[];
  /** The span's own pixel width (used to scale the preview strip). */
  spanWidth: number;
  onOpen: () => void;
}

const STRIP_HEIGHT = 20;
const DOT_R = 2.5;

/** Map a `when` value onto [0, 1] within the embedded timeline's event range.
 *  Falls back to 0 when there are fewer than 2 events. */
function normalizeWhen(when: number, minW: number, maxW: number): number {
  if (maxW === minW) return 0;
  return Math.max(0, Math.min(1, (when - minW) / (maxW - minW)));
}

export default function EmbeddedSpanPreview({
  embeddedTimeline,
  embeddedEvents,
  spanWidth,
  onOpen,
}: EmbeddedSpanPreviewProps) {
  const dots = useMemo(() => {
    if (embeddedEvents.length === 0) return [];
    const whens = embeddedEvents.map((e) => e.when);
    const minW = Math.min(...whens);
    const maxW = Math.max(...whens);
    return embeddedEvents.map((e) => ({
      id: e.id,
      x: normalizeWhen(e.when, minW, maxW) * Math.max(0, spanWidth - DOT_R * 2) + DOT_R,
      name: e.name,
    }));
  }, [embeddedEvents, spanWidth]);

  return (
    <button
      className="esp"
      aria-label={`Open embedded timeline: ${embeddedTimeline.name}`}
      onClick={onOpen}
      data-testid="embedded-span-preview"
    >
      <span className="esp__label">
        {embeddedTimeline.name} · click to open
      </span>
      <svg
        className="esp__strip"
        width={Math.max(spanWidth, 0)}
        height={STRIP_HEIGHT}
        aria-hidden="true"
        data-testid="esp-strip"
      >
        {/* axis baseline */}
        <line
          x1={DOT_R}
          y1={STRIP_HEIGHT / 2}
          x2={Math.max(spanWidth - DOT_R, DOT_R)}
          y2={STRIP_HEIGHT / 2}
          className="esp__axis"
        />
        {dots.map((d) => (
          <circle
            key={d.id}
            cx={d.x}
            cy={STRIP_HEIGHT / 2}
            r={DOT_R}
            className="esp__dot"
          >
            <title>{d.name}</title>
          </circle>
        ))}
      </svg>
    </button>
  );
}
