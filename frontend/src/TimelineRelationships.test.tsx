// Beta 3 M20 — TimelineRelationships tests (vitest + @testing-library/react).
//
// Coverage:
//   - Event column headers from the shared event data
//   - One row per character line with a slot-tinted name
//   - Presence dots rendered only at present events (prototype 1514–1524)
//   - Degraded states: no events / events without character links

import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import TimelineRelationships from './TimelineRelationships';
import { EMPTY_AEON_DATA, type AeonTimelineData } from './timelineAeon';

afterEach(() => cleanup());

function makeData(overrides: Partial<AeonTimelineData> = {}): AeonTimelineData {
  return {
    ...EMPTY_AEON_DATA,
    events: [
      { sceneId: 's1', title: 'Departure', ch: 'Ch. 1', chapterIndex: 0, icon: '✦', description: '', written: true },
      { sceneId: 's2', title: 'Crossing', ch: 'Ch. 2', chapterIndex: 1, icon: '◈', description: '', written: false },
      { sceneId: 's3', title: 'Arrival', ch: 'Ch. 3', chapterIndex: 2, icon: '✹', description: '', written: false },
    ],
    lines: [
      { id: 'c-mira', name: 'Mira Veynn', slot: 1, color: '#00f0ff', presentAt: [0, 2] },
      { id: 'c-kael', name: 'Kael Thorne', slot: 6, color: '#3d9bff', presentAt: [1] },
    ],
    ...overrides,
  };
}

describe('TimelineRelationships', () => {
  it('renders an event column header per key event', () => {
    render(<TimelineRelationships data={makeData()} />);
    const heads = screen.getAllByTestId('trl-event-head');
    expect(heads).toHaveLength(3);
    expect(heads[0]).toHaveTextContent('Departure');
    expect(heads[2]).toHaveTextContent('Arrival');
  });

  it('renders one row per character line with a slot-tinted name', () => {
    render(<TimelineRelationships data={makeData()} />);
    const rows = screen.getAllByTestId('trl-char-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Mira Veynn');
    // jsdom's cssstyle can drop var() colors from .style.color, so assert on
    // the raw style attribute instead.
    const name = rows[0].querySelector<HTMLElement>('.trl-name')!;
    expect(name.getAttribute('style')).toContain('--n1');
  });

  it('renders presence dots only where the character is present', () => {
    render(<TimelineRelationships data={makeData()} />);
    const rows = screen.getAllByTestId('trl-char-row');
    expect(rows[0].querySelectorAll('[data-testid="trl-dot"]')).toHaveLength(2);
    expect(rows[1].querySelectorAll('[data-testid="trl-dot"]')).toHaveLength(1);
    // Dots carry a character-and-event title for hover inspection.
    expect(screen.getByTitle('Kael Thorne — Crossing')).toBeInTheDocument();
  });

  it('shows the no-events empty state', () => {
    render(<TimelineRelationships data={EMPTY_AEON_DATA} />);
    expect(screen.getByTestId('timeline-relationships-empty')).toBeInTheDocument();
  });

  it('degrades to a hint when events exist but no characters are linked', () => {
    render(<TimelineRelationships data={makeData({ lines: [] })} />);
    expect(screen.getByTestId('trl-no-lines')).toBeInTheDocument();
    expect(screen.queryAllByTestId('trl-char-row')).toHaveLength(0);
  });
});
