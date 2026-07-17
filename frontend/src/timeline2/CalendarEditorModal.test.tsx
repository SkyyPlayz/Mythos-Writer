import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { vi, describe, it, expect, afterEach } from 'vitest';
import CalendarEditorModal from './CalendarEditorModal';
import type { TimelineCalendar } from '../timelinesTypes';

const STANDARD: TimelineCalendar = { preset: 'standard', monthsPerYear: 12, daysPerMonth: 30, hoursPerDay: 24 };

afterEach(() => cleanup());

function renderModal(overrides: Partial<Parameters<typeof CalendarEditorModal>[0]> = {}) {
  const props = {
    timelineName: 'The Last City of Veynn',
    calendar: STANDARD,
    onChange: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<CalendarEditorModal {...props} />);
  return props;
}

describe('CalendarEditorModal', () => {
  it('renders the three unit fields seeded from the calendar', () => {
    renderModal();
    expect(screen.getByTestId('cem-monthsPerYear')).toHaveValue('12');
    expect(screen.getByTestId('cem-daysPerMonth')).toHaveValue('30');
    expect(screen.getByTestId('cem-hoursPerDay')).toHaveValue('24');
    expect(screen.getByText(/Calendar — The Last City of Veynn/)).toBeInTheDocument();
  });

  it('commits positive integer edits as a custom calendar', () => {
    const props = renderModal();
    fireEvent.change(screen.getByTestId('cem-monthsPerYear'), { target: { value: '13' } });
    expect(props.onChange).toHaveBeenCalledWith({ ...STANDARD, preset: 'custom', monthsPerYear: 13 });
  });

  it('ignores zero, negative and non-numeric input (prototype guard)', () => {
    const props = renderModal();
    fireEvent.change(screen.getByTestId('cem-daysPerMonth'), { target: { value: '0' } });
    fireEvent.change(screen.getByTestId('cem-daysPerMonth'), { target: { value: '-4' } });
    fireEvent.change(screen.getByTestId('cem-daysPerMonth'), { target: { value: 'x' } });
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it('the Strange world preset applies 13 × 28 · 18h with its toast label', () => {
    const props = renderModal();
    fireEvent.click(screen.getByTestId('cem-preset-aeon-13'));
    expect(props.onChange).toHaveBeenCalledWith(
      { preset: 'aeon-13', monthsPerYear: 13, daysPerMonth: 28, hoursPerDay: 18 },
      'Strange world — 13 × 28 · 18h',
    );
  });

  it('Done and backdrop close the modal', () => {
    const props = renderModal();
    fireEvent.click(screen.getByTestId('cem-done'));
    fireEvent.click(screen.getByTestId('cem-backdrop'));
    expect(props.onClose).toHaveBeenCalledTimes(2);
  });
});
