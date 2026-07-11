import { render, screen, fireEvent } from '@testing-library/react';
import TimelinePicker from './TimelinePicker';
import type { TimelinesStore } from './timelinesTypes';

const BASE_STORE: TimelinesStore = {
  schemaVersion: 1,
  activeTimelineId: 'tl-story',
  timelines: [
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
  spans: [],
  rows: [],
  events: [],
};

function openPicker() {
  fireEvent.click(screen.getByRole('button', { name: /Active timeline:/i }));
}

describe('TimelinePicker', () => {
  it('renders the active timeline name', () => {
    render(
      <TimelinePicker
        store={BASE_STORE}
        onSelect={() => {}}
        onNewTimeline={() => {}}
        onEditCalendar={() => {}}
      />,
    );
    expect(screen.getByText('The Last City of Veynn')).toBeInTheDocument();
  });

  it('opens dropdown on card click', () => {
    render(
      <TimelinePicker
        store={BASE_STORE}
        onSelect={() => {}}
        onNewTimeline={() => {}}
        onEditCalendar={() => {}}
      />,
    );
    expect(screen.queryByTestId('timeline-picker-dropdown')).not.toBeInTheDocument();
    openPicker();
    expect(screen.getByTestId('timeline-picker-dropdown')).toBeInTheDocument();
  });

  it('lists all timelines in dropdown', () => {
    render(
      <TimelinePicker
        store={BASE_STORE}
        onSelect={() => {}}
        onNewTimeline={() => {}}
        onEditCalendar={() => {}}
      />,
    );
    openPicker();
    expect(screen.getByTestId('timeline-option-tl-story')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-option-tl-world')).toBeInTheDocument();
  });

  it('calls onSelect and closes dropdown when a timeline is picked', () => {
    const onSelect = vi.fn();
    render(
      <TimelinePicker
        store={BASE_STORE}
        onSelect={onSelect}
        onNewTimeline={() => {}}
        onEditCalendar={() => {}}
      />,
    );
    openPicker();
    fireEvent.click(screen.getByTestId('timeline-option-tl-world'));
    expect(onSelect).toHaveBeenCalledWith('tl-world');
    expect(screen.queryByTestId('timeline-picker-dropdown')).not.toBeInTheDocument();
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
    openPicker();
    fireEvent.click(screen.getByTestId('timeline-new'));
    expect(onNewTimeline).toHaveBeenCalledTimes(1);
  });

  it('calls onEditCalendar when "Edit calendar..." is clicked', () => {
    const onEditCalendar = vi.fn();
    render(
      <TimelinePicker
        store={BASE_STORE}
        onSelect={() => {}}
        onNewTimeline={() => {}}
        onEditCalendar={onEditCalendar}
      />,
    );
    openPicker();
    fireEvent.click(screen.getByTestId('timeline-edit-calendar'));
    expect(onEditCalendar).toHaveBeenCalledTimes(1);
  });
});
