// SKY-7935 — shared native-table presence markup used by both Relationships
// mode (TimelineRelationships.tsx) and Subway's "View as table" toggle
// (TimelineSubwayTableToggle.tsx), per docs/TIMELINE-VIEW-MODES-A11Y-SPEC.md
// §3.2/§3.3: build as a real <table> (not a div-grid) so screen-reader
// table-navigation commands work, with the WAI-ARIA APG grid keyboard
// pattern (§0) layered on top.
import { forwardRef, useCallback, useState } from 'react';
import type { AeonEvent, AeonCharacterLine } from './timelineAeon';
import './TimelineCharacterPresenceTable.css';

export interface TimelineCharacterPresenceTableProps {
  events: AeonEvent[];
  lines: AeonCharacterLine[];
  /** Called when a filled presence cell is activated (Enter/Space or click) — routes to the Inspector (spec §0). */
  onOpenScene?: (sceneId: string) => void;
  /** Extra class applied to the root <table>, e.g. to scope Subway-toggle-only styling. */
  className?: string;
}

/**
 * Native `<table>` of character presence per event/chapter. Filled cells hold
 * a dot with `aria-label="{character} present in chapter {n}"` and are
 * focusable/activatable (grid pattern); empty cells are inert plain `—` text
 * — no click target, no focus stop (spec §3.2).
 */
const TimelineCharacterPresenceTable = forwardRef<HTMLTableElement, TimelineCharacterPresenceTableProps>(
  function TimelineCharacterPresenceTable({ events, lines, onOpenScene, className }, ref) {
    const filledCells = lines.map(line => new Set(line.presentAt));

    // Roving-tabindex grid pattern (§0): one Tab stop for the whole grid, arrow
    // keys move focus cell-to-cell (no wrap), Home/End jump within a row.
    // Seeded to the first *present* cell — (0,0) may be an empty/inert `—`
    // cell, which would otherwise leave the whole table with no tab stop.
    const [focused, setFocused] = useState<{ row: number; col: number } | null>(() => {
      for (let row = 0; row < lines.length; row++) {
        for (let col = 0; col < events.length; col++) {
          if (filledCells[row]?.has(col)) return { row, col };
        }
      }
      // No present cell anywhere — degenerate table, fall back to the root
      // <table> as the tab stop (see tabIndex below) rather than leaving the
      // whole table unreachable.
      return null;
    });

    const moveFocus = useCallback((row: number, col: number, rowStep: number, colStep: number) => {
      let r = row;
      let c = col;
      while (r >= 0 && r < lines.length && c >= 0 && c < events.length && !filledCells[r]?.has(c)) {
        r += rowStep;
        c += colStep;
      }
      if (r < 0 || r >= lines.length || c < 0 || c >= events.length) {
        // No present cell in that direction — refuse to move rather than
        // desyncing DOM focus (a real cell) from `focused` (an inert one).
        return;
      }
      setFocused({ row: r, col: c });
      const el = document.querySelector<HTMLElement>(
        `[data-testid="tcpt-cell-${r}-${c}"]`,
      );
      el?.focus();
    }, [lines.length, events.length, filledCells]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent, row: number, col: number) => {
      switch (e.key) {
        case 'ArrowRight': e.preventDefault(); moveFocus(row, col + 1, 0, 1); break;
        case 'ArrowLeft': e.preventDefault(); moveFocus(row, col - 1, 0, -1); break;
        case 'ArrowDown': e.preventDefault(); moveFocus(row + 1, col, 1, 0); break;
        case 'ArrowUp': e.preventDefault(); moveFocus(row - 1, col, -1, 0); break;
        case 'Home': e.preventDefault(); moveFocus(row, 0, 0, 1); break;
        case 'End': e.preventDefault(); moveFocus(row, events.length - 1, 0, -1); break;
        case 'Enter':
        case ' ': {
          e.preventDefault();
          const sceneId = events[col]?.sceneId;
          if (sceneId) onOpenScene?.(sceneId);
          break;
        }
        default: break;
      }
    }, [moveFocus, events, onOpenScene]);

    return (
      <table
        ref={ref}
        className={`tcpt-table${className ? ` ${className}` : ''}`}
        data-testid="timeline-character-presence-table"
        tabIndex={focused === null ? 0 : -1}
      >
        <caption className="sr-only">Character presence by chapter</caption>
        <thead>
          <tr>
            <th scope="col" className="tcpt-th-name">Character</th>
            {events.map((event, i) => (
              <th scope="col" key={event.sceneId} className="tcpt-th-event" data-testid="tcpt-event-head">
                {event.icon} {event.title}
                <span className="sr-only"> chapter {i + 1}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lines.map((line, row) => (
            <tr key={line.id} data-testid="tcpt-row">
              <th scope="row" className="tcpt-th-name" style={{ color: line.color }}>
                {line.name}
              </th>
              {events.map((event, col) => {
                const present = filledCells[row]?.has(col);
                const isFocusStop = focused !== null && focused.row === row && focused.col === col;
                if (!present) {
                  // Inert empty cell — plain text content, no focus stop, no click target
                  // (spec §3.2: "don't make 'nothing happened here' a dead-end tab stop").
                  return (
                    <td key={event.sceneId} className="tcpt-cell" data-testid={`tcpt-cell-${row}-${col}`}>
                      <span className="tcpt-empty">—</span>
                    </td>
                  );
                }
                return (
                  <td key={event.sceneId} className="tcpt-cell">
                    <span
                      role="button"
                      tabIndex={isFocusStop ? 0 : -1}
                      className="tcpt-dot"
                      data-testid={`tcpt-cell-${row}-${col}`}
                      aria-label={`${line.name} present in chapter ${col + 1}`}
                      style={{ background: line.color, boxShadow: `0 0 8px ${line.color}` }}
                      onFocus={() => setFocused({ row, col })}
                      onClick={() => onOpenScene?.(event.sceneId)}
                      onKeyDown={e => handleKeyDown(e, row, col)}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    );
  },
);

export default TimelineCharacterPresenceTable;
