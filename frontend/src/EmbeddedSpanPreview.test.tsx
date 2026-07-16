import { render, screen, fireEvent } from '@testing-library/react';
import EmbeddedSpanPreview from './EmbeddedSpanPreview';
import type { TimelineDefinition, TimelineEvent } from './timelinesTypes';

const TL: TimelineDefinition = {
  id: 'tl-world',
  name: 'World of Veynn',
  kind: 'world',
  axis: 'calendar',
  calendar: { preset: 'standard', monthsPerYear: 12, daysPerMonth: 30, hoursPerDay: 24 },
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const EVENTS: TimelineEvent[] = [
  { id: 'ev1', timelineId: 'tl-world', name: 'The Founding', when: 8380 },
  { id: 'ev2', timelineId: 'tl-world', name: 'The Fall', when: 8740 },
  { id: 'ev3', timelineId: 'tl-world', name: 'New Dawn', when: 8800 },
];

describe('EmbeddedSpanPreview', () => {
  it('renders the embedded timeline name', () => {
    render(
      <EmbeddedSpanPreview
        embeddedTimeline={TL}
        embeddedEvents={EVENTS}
        spanWidth={200}
        onOpen={() => {}}
      />,
    );
    expect(screen.getByText(/World of Veynn/)).toBeInTheDocument();
  });

  it('calls onOpen when clicked', () => {
    const onOpen = vi.fn();
    render(
      <EmbeddedSpanPreview
        embeddedTimeline={TL}
        embeddedEvents={EVENTS}
        spanWidth={200}
        onOpen={onOpen}
      />,
    );
    fireEvent.click(screen.getByTestId('embedded-span-preview'));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('renders an SVG strip with one dot per event', () => {
    render(
      <EmbeddedSpanPreview
        embeddedTimeline={TL}
        embeddedEvents={EVENTS}
        spanWidth={200}
        onOpen={() => {}}
      />,
    );
    const strip = screen.getByTestId('esp-strip');
    const dots = strip.querySelectorAll('circle.esp__dot');
    expect(dots).toHaveLength(3);
  });

  it('renders an empty strip when there are no events', () => {
    render(
      <EmbeddedSpanPreview
        embeddedTimeline={TL}
        embeddedEvents={[]}
        spanWidth={200}
        onOpen={() => {}}
      />,
    );
    const strip = screen.getByTestId('esp-strip');
    const dots = strip.querySelectorAll('circle.esp__dot');
    expect(dots).toHaveLength(0);
  });

  it('first and last dots are at the correct relative positions', () => {
    render(
      <EmbeddedSpanPreview
        embeddedTimeline={TL}
        embeddedEvents={EVENTS}
        spanWidth={200}
        onOpen={() => {}}
      />,
    );
    const dots = screen.getByTestId('esp-strip').querySelectorAll('circle.esp__dot');
    // First dot should be near the left edge, last near the right.
    const cx0 = parseFloat(dots[0].getAttribute('cx') ?? '0');
    const cx2 = parseFloat(dots[2].getAttribute('cx') ?? '0');
    expect(cx0).toBeLessThan(cx2);
  });
});
