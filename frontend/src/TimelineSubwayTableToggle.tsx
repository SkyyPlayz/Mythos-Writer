// SKY-7935 — "View as table" toggle for Subway mode (spec §3.3, addendum to
// SKY-7253 §7's component inventory). Renders beside the mode-seg control,
// visible only in Subway mode. When pressed, swaps the SVG subway rendering
// for the identical table markup Relationships uses
// (TimelineCharacterPresenceTable), moving focus into the table on
// activation — the primary accessible path for this mode, not a fallback.
import { useEffect, useRef } from 'react';
import { Table2 } from 'lucide-react';
import type { AeonTimelineData } from './timelineAeon';
import TimelineCharacterPresenceTable from './TimelineCharacterPresenceTable';
import './TimelineSubwayTableToggle.css';

export interface TimelineSubwayTableToggleButtonProps {
  pressed: boolean;
  onToggle: () => void;
}

/** The toolbar toggle button itself — rendered beside the mode-seg control. */
export function TimelineSubwayTableToggleButton({ pressed, onToggle }: TimelineSubwayTableToggleButtonProps) {
  return (
    <button
      type="button"
      className={`tstt-toggle-btn${pressed ? ' tstt-toggle-btn--active' : ''}`}
      aria-pressed={pressed}
      onClick={onToggle}
      data-testid="subway-table-toggle"
    >
      <Table2 size={14} aria-hidden="true" />
      View as table
    </button>
  );
}

export interface TimelineSubwayTableViewProps {
  data: AeonTimelineData;
  onOpenScene?: (sceneId: string) => void;
}

/** The table content shown in place of the SVG when the toggle is active.
 *  Focuses the table on mount (activation) per spec §3.3. */
export default function TimelineSubwayTableView({ data, onOpenScene }: TimelineSubwayTableViewProps) {
  const tableRef = useRef<HTMLTableElement>(null);

  useEffect(() => {
    // Focus moves into the table on activation — verified via ref + focus().
    tableRef.current?.focus();
  }, []);

  if (data.lines.length === 0) {
    return (
      <p className="tstt-no-lines" data-testid="subway-table-no-lines">
        Link characters to scenes to draw their subway lines.
      </p>
    );
  }

  return (
    <div className="tstt-table-wrap" data-testid="subway-table-view">
      <TimelineCharacterPresenceTable
        ref={tableRef}
        events={data.events}
        lines={data.lines}
        onOpenScene={onOpenScene}
        className="tstt-table"
      />
    </div>
  );
}
