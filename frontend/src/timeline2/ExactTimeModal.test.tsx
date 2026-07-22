import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { vi, describe, it, expect, afterEach } from 'vitest';
import ExactTimeModal from './ExactTimeModal';
import type { TimelineCalendar } from '../timelinesTypes';
import { safeEncodeWhen } from './axis/calendarCodec';

const STANDARD: TimelineCalendar = { preset: 'standard', monthsPerYear: 12, daysPerMonth: 30, hoursPerDay: 24 };
const AEON13: TimelineCalendar = { preset: 'aeon-13', monthsPerYear: 13, daysPerMonth: 28, hoursPerDay: 18 };

afterEach(() => cleanup());

function renderModal(overrides: Partial<Parameters<typeof ExactTimeModal>[0]> = {}) {
  const props = {
    calendar: STANDARD,
    target: { kind: 'single', when: safeEncodeWhen({ year: 871, month: 3, day: 14, hour: 6 }, STANDARD) } as const,
    fallbackWhen: 0,
    onApply: vi.fn(),
    onClose: vi.fn(),
    onEditCalendar: vi.fn(),
    ...overrides,
  };
  render(<ExactTimeModal {...props} />);
  return props;
}

describe('ExactTimeModal', () => {
  it('seeds the four mono inputs from the target when', () => {
    renderModal();
    expect(screen.getByTestId('etm-start-year')).toHaveValue('871');
    expect(screen.getByTestId('etm-start-month')).toHaveValue('3');
    expect(screen.getByTestId('etm-start-day')).toHaveValue('14');
    expect(screen.getByTestId('etm-start-hour')).toHaveValue('6');
    expect(screen.queryByTestId('etm-end-year')).toBeNull();
  });

  it('dual targets render START and END groups', () => {
    renderModal({
      target: {
        kind: 'dual',
        startWhen: safeEncodeWhen({ year: 1, month: 1, day: 1, hour: 0 }, STANDARD),
        endWhen: safeEncodeWhen({ year: 2, month: 6, day: 15, hour: 12 }, STANDARD),
      },
    });
    expect(screen.getByText('START')).toBeInTheDocument();
    expect(screen.getByText('END')).toBeInTheDocument();
    expect(screen.getByTestId('etm-end-year')).toHaveValue('2');
    expect(screen.getByTestId('etm-end-month')).toHaveValue('6');
  });

  it('applies the encoded when through the active calendar', () => {
    const props = renderModal({ calendar: AEON13, target: { kind: 'single', when: 0 } });
    fireEvent.change(screen.getByTestId('etm-start-year'), { target: { value: '871' } });
    fireEvent.change(screen.getByTestId('etm-start-month'), { target: { value: '13' } });
    fireEvent.change(screen.getByTestId('etm-start-day'), { target: { value: '28' } });
    fireEvent.change(screen.getByTestId('etm-start-hour'), { target: { value: '17' } });
    fireEvent.click(screen.getByTestId('etm-apply'));
    expect(props.onApply).toHaveBeenCalledWith({
      when: safeEncodeWhen({ year: 871, month: 13, day: 28, hour: 17 }, AEON13),
    });
  });

  it('applies both ends for dual targets', () => {
    const props = renderModal({
      target: { kind: 'dual', startWhen: 0, endWhen: 864 },
    });
    fireEvent.change(screen.getByTestId('etm-end-year'), { target: { value: '5' } });
    fireEvent.click(screen.getByTestId('etm-apply'));
    expect(props.onApply).toHaveBeenCalledWith({
      startWhen: 0,
      endWhen: safeEncodeWhen({ year: 5, month: 1, day: 1, hour: 0 }, STANDARD),
    });
  });

  it('garbage input encodes safely (no NaN escapes)', () => {
    const props = renderModal();
    fireEvent.change(screen.getByTestId('etm-start-year'), { target: { value: 'abc' } });
    fireEvent.change(screen.getByTestId('etm-start-month'), { target: { value: '' } });
    fireEvent.click(screen.getByTestId('etm-apply'));
    const applied = (props.onApply as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(Number.isFinite(applied.when)).toBe(true);
  });

  it('shows the calendar note and the change link opens the calendar editor', () => {
    const props = renderModal();
    expect(screen.getByText(/12 months × 30 days × 24h days/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('etm-change-calendar'));
    expect(props.onEditCalendar).toHaveBeenCalledTimes(1);
  });

  it('cancel and backdrop close without applying', () => {
    const props = renderModal();
    fireEvent.click(screen.getByTestId('etm-cancel'));
    fireEvent.click(screen.getByTestId('etm-backdrop'));
    expect(props.onClose).toHaveBeenCalledTimes(2);
    expect(props.onApply).not.toHaveBeenCalled();
  });

  it('Escape closes the modal', () => {
    const props = renderModal();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('autofocuses the first focusable element (close button) on open', () => {
    renderModal();
    expect(screen.getByTestId('etm-close')).toHaveFocus();
  });
});
