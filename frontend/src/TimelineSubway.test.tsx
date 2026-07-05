// Beta 3 M20 — TimelineSubway tests (vitest + @testing-library/react).
//
// Coverage:
//   - One polyline per character line, slot-tinted stroke with hex fallback
//   - Station circles only at present events; absence dips in the path
//   - Event header row + legend from the same event/line data
//   - Click event → onOpenScene
//   - Degraded states: no events / events without character links

import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import TimelineSubway from './TimelineSubway';
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

describe('TimelineSubway', () => {
  it('renders one polyline per character with a slot-tinted stroke', () => {
    render(<TimelineSubway data={makeData()} />);
    const paths = screen.getAllByTestId('tsw-path');
    expect(paths).toHaveLength(2);
    expect(paths[0]).toHaveAttribute('stroke', 'var(--n1, #00f0ff)');
    expect(paths[1]).toHaveAttribute('stroke', 'var(--n6, #3d9bff)');
  });

  it('draws the absence dip into the path (prototype +14 below the line)', () => {
    render(<TimelineSubway data={makeData()} />);
    const paths = screen.getAllByTestId('tsw-path');
    // Line 1 (y=60): present at events 0 and 2, dips at event 1 (y=74).
    expect(paths[0]).toHaveAttribute('d', 'M70,60 L470,74 L870,60');
    // Line 2 (y=104): present only at event 1, dips at 0 and 2 (y=118).
    expect(paths[1]).toHaveAttribute('d', 'M70,118 L470,104 L870,118');
  });

  it('renders station circles only where the character is present', () => {
    render(<TimelineSubway data={makeData()} />);
    expect(screen.getAllByTestId('tsw-station')).toHaveLength(3); // 2 + 1
  });

  it('renders the event header row and legend from the same data', () => {
    render(<TimelineSubway data={makeData()} />);
    const events = screen.getAllByTestId('tsw-event');
    expect(events).toHaveLength(3);
    expect(events[0]).toHaveTextContent('Departure');
    expect(events[0]).toHaveTextContent('Ch. 1');
    const legend = screen.getByTestId('tsw-legend');
    expect(legend).toHaveTextContent('Mira Veynn');
    expect(legend).toHaveTextContent('Kael Thorne');
  });

  it('opens the scene when an event station header is clicked', () => {
    const onOpenScene = vi.fn();
    render(<TimelineSubway data={makeData()} onOpenScene={onOpenScene} />);
    fireEvent.click(screen.getAllByTestId('tsw-event')[1]);
    expect(onOpenScene).toHaveBeenCalledWith('s2');
  });

  it('shows the no-events empty state', () => {
    render(<TimelineSubway data={EMPTY_AEON_DATA} />);
    expect(screen.getByTestId('timeline-subway-empty')).toBeInTheDocument();
  });

  it('degrades to a hint when events exist but no characters are linked', () => {
    render(<TimelineSubway data={makeData({ lines: [] })} />);
    expect(screen.getByTestId('tsw-no-lines')).toBeInTheDocument();
    expect(screen.queryByTestId('tsw-svg')).toBeNull();
  });
});
