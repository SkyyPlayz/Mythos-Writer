import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import TimelinePicker from './TimelinePicker';
import { buildTimelineTreeRows } from './TimelineTreeSidebar';
import type { TimelinesStore } from './timelinesTypes';

const BASE_STORE: TimelinesStore = {
  schemaVersion: 1,
  activeTimelineId: 'tl-story',
  timelines: [
    {
      id: 'tl-universe',
      name: 'Universal',
      kind: 'universe',
      axis: 'calendar',
      calendar: { preset: 'standard', monthsPerYear: 12, daysPerMonth: 30, hoursPerDay: 24 },
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      std: true,
    },
    {
      id: 'tl-story',
      name: 'The Last City of Veynn',
      kind: 'story',
      axis: 'calendar',
      calendar: { preset: 'standard', monthsPerYear: 12, daysPerMonth: 30, hoursPerDay: 24 },
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'tl-world',
      name: 'World of Veynn',
      kind: 'world',
      axis: 'calendar',
      calendar: { preset: 'standard', monthsPerYear: 12, daysPerMonth: 30, hoursPerDay: 24 },
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ],
  eras: [],
  spans: [
    {
      id: 'sp1',
      timelineId: 'tl-universe',
      name: 'Story span',
      startWhen: 0,
      endWhen: 100,
      opensTimelineId: 'tl-story',
    },
    {
      id: 'sp2',
      timelineId: 'tl-universe',
      name: 'World span',
      startWhen: 0,
      endWhen: 100,
      opensTimelineId: 'tl-world',
    },
  ],
  rows: [],
  events: [],
};

describe('TimelinePicker (F3 hierarchical tree)', () => {
  it('renders the hierarchical tree with Universal root', () => {
    render(
      <TimelinePicker
        store={BASE_STORE}
        onSelect={() => {}}
        onNewTimeline={() => {}}
        onEditCalendar={() => {}}
      />,
    );
    expect(screen.getByTestId('tl-tree')).toBeInTheDocument();
    expect(screen.getByText('Universal')).toBeInTheDocument();
    expect(screen.getByText('The Last City of Veynn')).toBeInTheDocument();
    expect(screen.getByText('World of Veynn')).toBeInTheDocument();
  });

  it('lists all timelines without a dropdown', () => {
    render(
      <TimelinePicker
        store={BASE_STORE}
        onSelect={() => {}}
        onNewTimeline={() => {}}
        onEditCalendar={() => {}}
      />,
    );
    expect(screen.queryByTestId('timeline-picker-dropdown')).not.toBeInTheDocument();
    expect(screen.getByTestId('timeline-option-tl-story')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-option-tl-world')).toBeInTheDocument();
  });

  it('calls onSelect when a timeline is picked', () => {
    const onSelect = vi.fn();
    render(
      <TimelinePicker
        store={BASE_STORE}
        onSelect={onSelect}
        onNewTimeline={() => {}}
        onEditCalendar={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId('timeline-option-tl-world').querySelector('button.tlpicker__tree-pick')!);
    expect(onSelect).toHaveBeenCalledWith('tl-world');
  });

  it('calls onNewTimeline when "+ New timeline" is clicked', () => {
    const onNewTimeline = vi.fn();
    render(
      <TimelinePicker
        store={BASE_STORE}
        onSelect={() => {}}
        onNewTimeline={onNewTimeline}
        onEditCalendar={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId('timeline-new'));
    expect(onNewTimeline).toHaveBeenCalledTimes(1);
  });

  it('calls onEditCalendar when Edit calendar is clicked', () => {
    const onEditCalendar = vi.fn();
    render(
      <TimelinePicker
        store={BASE_STORE}
        onSelect={() => {}}
        onNewTimeline={() => {}}
        onEditCalendar={onEditCalendar}
      />,
    );
    fireEvent.click(screen.getByTestId('timeline-edit-calendar'));
    expect(onEditCalendar).toHaveBeenCalledWith('tl-story');
  });

  it('does not show a Demo badge on seed timelines (A2)', () => {
    const demoStore: TimelinesStore = {
      ...BASE_STORE,
      timelines: BASE_STORE.timelines.map((t, i) => (i === 1 ? { ...t, source: 'seed' as const } : t)),
    };
    render(
      <TimelinePicker
        store={demoStore}
        onSelect={() => {}}
        onNewTimeline={() => {}}
        onEditCalendar={() => {}}
      />,
    );
    expect(screen.queryByText('Demo')).not.toBeInTheDocument();
  });

  it('buildTimelineTreeRows nests children under Universal', () => {
    const rows = buildTimelineTreeRows(BASE_STORE, { 'tl-universe': true });
    expect(rows[0]?.timeline.id).toBe('tl-universe');
    expect(rows[0]?.childIds).toEqual(expect.arrayContaining(['tl-story', 'tl-world']));
    expect(rows.some((r) => r.timeline.id === 'tl-story' && r.depth === 1)).toBe(true);
  });

  it('F3#6 — seed-shaped Universal-rooted store keeps Universe at depth 0', () => {
    const seedLike: TimelinesStore = {
      ...BASE_STORE,
      timelines: [
        { ...BASE_STORE.timelines[1], id: 'tl-story', name: 'Story Timeline', kind: 'story', std: undefined },
        { ...BASE_STORE.timelines[2], id: 'tl-world', name: 'World History', kind: 'world', std: undefined },
        { ...BASE_STORE.timelines[0], id: 'tl-universe', name: 'Universe Timeline', kind: 'universe', std: undefined },
      ],
      spans: [
        {
          id: 'span:universe-world',
          timelineId: 'tl-universe',
          name: 'World history',
          startWhen: 0,
          endWhen: 720,
          opensTimelineId: 'tl-world',
        },
        {
          id: 'span:universe-story',
          timelineId: 'tl-universe',
          name: 'Story arc',
          startWhen: 2.4,
          endWhen: 96,
          opensTimelineId: 'tl-story',
        },
      ],
    };
    const rows = buildTimelineTreeRows(seedLike, { 'tl-universe': true });
    expect(rows[0]?.timeline.kind).toBe('universe');
    expect(rows[0]?.depth).toBe(0);
    expect(rows.filter((r) => r.depth === 0)).toHaveLength(1);
    expect(rows.some((r) => r.timeline.kind === 'story' && r.depth === 1)).toBe(true);
    expect(rows.some((r) => r.timeline.kind === 'world' && r.depth === 1)).toBe(true);
  });
});
