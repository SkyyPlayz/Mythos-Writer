// SKY-7935 — TimelineSubwayTableToggle tests: the toggle button's
// aria-pressed state, and the table view swaps in the same
// TimelineCharacterPresenceTable markup Relationships uses, moving focus
// into the table on activation.

import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import { TimelineSubwayTableToggleButton } from './TimelineSubwayTableToggle';
import TimelineSubwayTableView from './TimelineSubwayTableToggle';
import { EMPTY_AEON_DATA, type AeonTimelineData } from './timelineAeon';

afterEach(() => cleanup());

function makeData(): AeonTimelineData {
  return {
    ...EMPTY_AEON_DATA,
    events: [
      { sceneId: 's1', title: 'Departure', ch: 'Ch. 1', chapterIndex: 0, icon: '✦', description: '', written: true },
    ],
    lines: [
      { id: 'c-mira', name: 'Mira Veynn', slot: 1, color: 'hsl(0, 85%, 60%)', presentAt: [0] },
    ],
  };
}

describe('TimelineSubwayTableToggleButton', () => {
  it('reflects pressed state via aria-pressed', () => {
    const { rerender } = render(<TimelineSubwayTableToggleButton pressed={false} onToggle={() => {}} />);
    expect(screen.getByTestId('subway-table-toggle')).toHaveAttribute('aria-pressed', 'false');
    rerender(<TimelineSubwayTableToggleButton pressed onToggle={() => {}} />);
    expect(screen.getByTestId('subway-table-toggle')).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('TimelineSubwayTableView', () => {
  it('renders the shared presence table markup', () => {
    render(<TimelineSubwayTableView data={makeData()} />);
    expect(screen.getByTestId('timeline-character-presence-table')).toBeInTheDocument();
    expect(screen.getByLabelText('Mira Veynn present in chapter 1')).toBeInTheDocument();
  });

  it('moves focus into the table on activation', () => {
    render(<TimelineSubwayTableView data={makeData()} />);
    const table = screen.getByTestId('timeline-character-presence-table');
    expect(document.activeElement).toBe(table);
  });

  it('degrades to a hint when no characters are linked', () => {
    render(<TimelineSubwayTableView data={EMPTY_AEON_DATA} />);
    expect(screen.getByTestId('subway-table-no-lines')).toBeInTheDocument();
  });
});
