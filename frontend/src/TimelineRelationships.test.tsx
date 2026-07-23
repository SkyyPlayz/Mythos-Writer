// Beta 3 M20 — TimelineRelationships tests (vitest + @testing-library/react).
// SKY-7935 — rebuilt onto TimelineCharacterPresenceTable's native <table>.
//
// Coverage:
//   - Native table with sr-only caption and per-event column headers
//   - One row per character line, presence dots aria-labeled and empty cells inert
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
      { id: 'c-mira', name: 'Mira Veynn', slot: 1, color: 'hsl(0.0, 85%, 60%)', presentAt: [0, 2] },
      { id: 'c-kael', name: 'Kael Thorne', slot: 6, color: 'hsl(150.0, 85%, 60%)', presentAt: [1] },
    ],
    ...overrides,
  };
}

describe('TimelineRelationships', () => {
  it('renders a native table with an sr-only caption', () => {
    render(<TimelineRelationships data={makeData()} />);
    const table = screen.getByTestId('timeline-character-presence-table');
    expect(table.tagName).toBe('TABLE');
    const caption = table.querySelector('caption');
    expect(caption).toHaveTextContent('Character presence by chapter');
    expect(caption).toHaveClass('sr-only');
  });

  it('renders an event column header per key event', () => {
    render(<TimelineRelationships data={makeData()} />);
    const heads = screen.getAllByTestId('tcpt-event-head');
    expect(heads).toHaveLength(3);
    expect(heads[0]).toHaveTextContent('Departure');
    expect(heads[2]).toHaveTextContent('Arrival');
  });

  it('renders one row per character line with a colored name', () => {
    render(<TimelineRelationships data={makeData()} />);
    const rows = screen.getAllByTestId('tcpt-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Mira Veynn');
    const name = rows[0].querySelector('th')!;
    // jsdom's cssstyle normalizes hsl() to rgb() on the style attribute — just
    // assert an inline color was set (character name is colored, not the default).
    expect(name.getAttribute('style')).toMatch(/color:\s*rgb/);
  });

  it('renders presence dots only where the character is present, with aria-labels', () => {
    render(<TimelineRelationships data={makeData()} />);
    expect(screen.getByLabelText('Mira Veynn present in chapter 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Mira Veynn present in chapter 3')).toBeInTheDocument();
    expect(screen.getByLabelText('Kael Thorne present in chapter 2')).toBeInTheDocument();
    expect(screen.queryByLabelText('Kael Thorne present in chapter 1')).not.toBeInTheDocument();
  });

  it('renders empty cells as inert plain dash text, not a focus stop', () => {
    render(<TimelineRelationships data={makeData()} />);
    const rows = screen.getAllByTestId('tcpt-row');
    // Kael's row: absent at chapters 1 and 3.
    const kaelCells = rows[1].querySelectorAll('td');
    const dashCells = Array.from(kaelCells).filter(td => td.textContent === '—');
    expect(dashCells).toHaveLength(2);
    for (const td of dashCells) {
      expect(td.querySelector('[role="button"]')).toBeNull();
    }
  });

  it('shows the no-events empty state', () => {
    render(<TimelineRelationships data={EMPTY_AEON_DATA} />);
    expect(screen.getByTestId('timeline-relationships-empty')).toBeInTheDocument();
  });

  it('degrades to a hint when events exist but no characters are linked', () => {
    render(<TimelineRelationships data={makeData({ lines: [] })} />);
    expect(screen.getByTestId('trl-no-lines')).toBeInTheDocument();
    expect(screen.queryAllByTestId('tcpt-row')).toHaveLength(0);
  });
});
