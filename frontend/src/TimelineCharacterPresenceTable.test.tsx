// SKY-8158 — regression coverage for the roving-tabindex "no tab stop when
// row 0 / col 0 is empty" bug (SKY-8149 audit). Both existing consumer tests
// (TimelineRelationships, TimelineSubwayTableToggle) happen to seed the first
// character present at column 0, so the (0,0)-hardcoded default focus target
// was never exercised against an absent top-left cell.

import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, afterEach } from 'vitest';
import TimelineCharacterPresenceTable from './TimelineCharacterPresenceTable';
import type { AeonEvent, AeonCharacterLine } from './timelineAeon';

afterEach(() => cleanup());

const events: AeonEvent[] = [
  { sceneId: 's1', title: 'Departure', ch: 'Ch. 1', chapterIndex: 0, icon: '✦', description: '', written: true },
  { sceneId: 's2', title: 'Crossing', ch: 'Ch. 2', chapterIndex: 1, icon: '◈', description: '', written: false },
  { sceneId: 's3', title: 'Arrival', ch: 'Ch. 3', chapterIndex: 2, icon: '✹', description: '', written: false },
];

// Top-left (row 0, col 0) is absent: Mira isn't present until chapter 2.
const linesGapAtOrigin: AeonCharacterLine[] = [
  { id: 'c-mira', name: 'Mira Veynn', slot: 1, color: '#f00', presentAt: [1, 2] },
  { id: 'c-kael', name: 'Kael Thorne', slot: 6, color: '#0f0', presentAt: [0] },
];

function focusStops(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>('[tabindex]')).filter(
    el => el.getAttribute('tabindex') === '0',
  );
}

describe('TimelineCharacterPresenceTable — roving tabindex', () => {
  it('seeds the initial focus stop on the first present cell, not the hardcoded (0,0)', () => {
    const { container } = render(
      <TimelineCharacterPresenceTable events={events} lines={linesGapAtOrigin} />,
    );
    const stops = focusStops(container);
    expect(stops).toHaveLength(1);
    expect(stops[0]).toBe(screen.getByTestId('tcpt-cell-0-1'));
    expect(container.querySelector('table')).toHaveAttribute('tabindex', '-1');
  });

  it('reaches the table via Tab and lands on the real focus stop', async () => {
    const user = userEvent.setup();
    render(<TimelineCharacterPresenceTable events={events} lines={linesGapAtOrigin} />);
    await user.tab();
    expect(screen.getByTestId('tcpt-cell-0-1')).toHaveFocus();
  });

  it('ArrowLeft from the seeded cell skips the empty (0,0) cell instead of getting stuck', async () => {
    const user = userEvent.setup();
    render(<TimelineCharacterPresenceTable events={events} lines={linesGapAtOrigin} />);
    await user.tab();
    expect(screen.getByTestId('tcpt-cell-0-1')).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    // No present cell to the left of (0,1) — focus must stay put, not
    // silently no-op onto the inert <td> at (0,0).
    expect(screen.getByTestId('tcpt-cell-0-1')).toHaveFocus();
  });

  it('ArrowDown/ArrowUp skip a row that is absent in the target column instead of landing on it', async () => {
    const user = userEvent.setup();
    const linesWithGapRow: AeonCharacterLine[] = [
      { id: 'c-mira', name: 'Mira Veynn', slot: 1, color: '#f00', presentAt: [1, 2] },
      // Absent at col 1 — ArrowDown from Mira must not land here.
      { id: 'c-kael', name: 'Kael Thorne', slot: 6, color: '#0f0', presentAt: [0] },
      { id: 'c-toran', name: 'Toran', slot: 3, color: '#00f', presentAt: [1] },
    ];
    const { container } = render(
      <TimelineCharacterPresenceTable events={events} lines={linesWithGapRow} />,
    );
    await user.tab();
    expect(screen.getByTestId('tcpt-cell-0-1')).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByTestId('tcpt-cell-2-1')).toHaveFocus();
    expect(focusStops(container)).toEqual([screen.getByTestId('tcpt-cell-2-1')]);
    await user.keyboard('{ArrowUp}');
    expect(screen.getByTestId('tcpt-cell-0-1')).toHaveFocus();
  });

  it('refuses to move when no present cell exists in the arrow direction', async () => {
    const user = userEvent.setup();
    render(<TimelineCharacterPresenceTable events={events} lines={linesGapAtOrigin} />);
    await user.tab();
    expect(screen.getByTestId('tcpt-cell-0-1')).toHaveFocus();
    // Kael (row 1) is only present at col 0 — straight down from col 1 has
    // no present cell, so focus must stay put rather than desync.
    await user.keyboard('{ArrowDown}');
    expect(screen.getByTestId('tcpt-cell-0-1')).toHaveFocus();
  });

  it('falls back to a table-level tab stop when no cell is present anywhere', () => {
    const linesAllAbsent: AeonCharacterLine[] = [
      { id: 'c-mira', name: 'Mira Veynn', slot: 1, color: '#f00', presentAt: [] },
    ];
    const { container } = render(
      <TimelineCharacterPresenceTable events={events} lines={linesAllAbsent} />,
    );
    expect(focusStops(container)).toEqual([container.querySelector('table')]);
  });
});
