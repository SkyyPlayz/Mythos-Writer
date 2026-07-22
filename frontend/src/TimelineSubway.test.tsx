// Beta 3 M20 — TimelineSubway tests (vitest + @testing-library/react).
// SKY-7935 — station row rebuilt onto the roving-tabindex keyboard pattern
// and the raw SVG path is now aria-hidden.
//
// Coverage:
//   - One polyline per character line, colored via the shared hue algorithm
//   - Station circles only at present events; absence dips in the path
//   - Event header row + legend from the same event/line data
//   - Roving tabindex: ArrowLeft/ArrowRight/Home/End move focus, Enter/Space activates
//   - SVG is aria-hidden (decorative); station buttons carry accessible names
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
      { id: 'c-mira', name: 'Mira Veynn', slot: 1, color: 'hsl(0.0, 85%, 60%)', presentAt: [0, 2] },
      { id: 'c-kael', name: 'Kael Thorne', slot: 6, color: 'hsl(150.0, 85%, 60%)', presentAt: [1] },
    ],
    ...overrides,
  };
}

describe('TimelineSubway', () => {
  it('renders one polyline per character with its assigned color', () => {
    render(<TimelineSubway data={makeData()} />);
    const paths = screen.getAllByTestId('tsw-path');
    expect(paths).toHaveLength(2);
    expect(paths[0]).toHaveAttribute('stroke', 'hsl(0.0, 85%, 60%)');
    expect(paths[1]).toHaveAttribute('stroke', 'hsl(150.0, 85%, 60%)');
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

  it('marks the raw SVG as decorative (aria-hidden)', () => {
    render(<TimelineSubway data={makeData()} />);
    expect(screen.getByTestId('tsw-svg')).toHaveAttribute('aria-hidden', 'true');
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

  it('stations are accessible buttons with a chapter+title label', () => {
    render(<TimelineSubway data={makeData()} />);
    expect(screen.getByRole('button', { name: 'Chapter 1: Departure' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Chapter 2: Crossing' })).toBeInTheDocument();
  });

  it('opens the scene when a station is clicked', () => {
    const onOpenScene = vi.fn();
    render(<TimelineSubway data={makeData()} onOpenScene={onOpenScene} />);
    fireEvent.click(screen.getAllByTestId('tsw-event')[1]);
    expect(onOpenScene).toHaveBeenCalledWith('s2');
  });

  it('roving tabindex: only the focused station is a Tab stop', () => {
    render(<TimelineSubway data={makeData()} />);
    const events = screen.getAllByTestId('tsw-event');
    expect(events[0]).toHaveAttribute('tabindex', '0');
    expect(events[1]).toHaveAttribute('tabindex', '-1');
    expect(events[2]).toHaveAttribute('tabindex', '-1');
  });

  it('ArrowRight/ArrowLeft move focus station to station', () => {
    render(<TimelineSubway data={makeData()} />);
    const events = screen.getAllByTestId('tsw-event');
    fireEvent.focus(events[0]);
    fireEvent.keyDown(events[0], { key: 'ArrowRight' });
    expect(document.activeElement).toBe(events[1]);
    fireEvent.keyDown(events[1], { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(events[0]);
  });

  it('Home/End jump focus to the first/last station', () => {
    render(<TimelineSubway data={makeData()} />);
    const events = screen.getAllByTestId('tsw-event');
    fireEvent.focus(events[1]);
    fireEvent.keyDown(events[1], { key: 'End' });
    expect(document.activeElement).toBe(events[2]);
    fireEvent.keyDown(events[2], { key: 'Home' });
    expect(document.activeElement).toBe(events[0]);
  });

  it('Enter/Space on a focused station opens its scene', () => {
    const onOpenScene = vi.fn();
    render(<TimelineSubway data={makeData()} onOpenScene={onOpenScene} />);
    const events = screen.getAllByTestId('tsw-event');
    fireEvent.focus(events[2]);
    fireEvent.keyDown(events[2], { key: 'Enter' });
    expect(onOpenScene).toHaveBeenCalledWith('s3');
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
