// SKY-2452 — TimestampEditor unit tests (vitest + @testing-library/react).

import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import TimestampEditor from './TimestampEditor';
import type { TimestampEditorProps } from './TimestampEditor';

function makeProps(overrides: Partial<TimestampEditorProps> = {}): TimestampEditorProps {
  return {
    currentDay: 3,
    currentTime: 'morning',
    maxDay: 10,
    onConfirm: vi.fn().mockResolvedValue(undefined),
    onCancel: vi.fn(),
    ...overrides,
  };
}

describe('TimestampEditor', () => {
  // ── Render & structure ────────────────────────────────────────────────────

  it('renders with role="group" and descriptive aria-label', () => {
    render(<TimestampEditor {...makeProps()} />);
    expect(screen.getByRole('group', { name: /edit scene timestamp/i })).toBeInTheDocument();
  });

  it('renders the Day label and slider + number input', () => {
    render(<TimestampEditor {...makeProps()} />);
    expect(screen.getByText('Day')).toBeInTheDocument();
    expect(screen.getByTestId('te-day-input')).toBeInTheDocument();
    expect(screen.getByRole('slider')).toBeInTheDocument();
  });

  it('renders the Time of day label and select', () => {
    render(<TimestampEditor {...makeProps()} />);
    expect(screen.getByText('Time of day')).toBeInTheDocument();
    expect(screen.getByTestId('te-time-select')).toBeInTheDocument();
  });

  it('renders Confirm and Cancel buttons', () => {
    render(<TimestampEditor {...makeProps()} />);
    expect(screen.getByTestId('te-confirm')).toBeInTheDocument();
    expect(screen.getByTestId('te-cancel')).toBeInTheDocument();
  });

  // ── Initial values ────────────────────────────────────────────────────────

  it('slider value initialises to currentDay', () => {
    render(<TimestampEditor {...makeProps({ currentDay: 5 })} />);
    const slider = screen.getByRole('slider') as HTMLInputElement;
    expect(slider.value).toBe('5');
  });

  it('number input value initialises to currentDay', () => {
    render(<TimestampEditor {...makeProps({ currentDay: 5 })} />);
    const input = screen.getByTestId('te-day-input') as HTMLInputElement;
    expect(input.value).toBe('5');
  });

  it('select initialises to currentTime', () => {
    render(<TimestampEditor {...makeProps({ currentTime: 'dusk' })} />);
    const sel = screen.getByTestId('te-time-select') as HTMLSelectElement;
    expect(sel.value).toBe('dusk');
  });

  it('falls back to "unspecified" when currentTime is not in the enum', () => {
    render(<TimestampEditor {...makeProps({ currentTime: 'evening' })} />);
    const sel = screen.getByTestId('te-time-select') as HTMLSelectElement;
    expect(sel.value).toBe('unspecified');
  });

  // ── Time of day dropdown ──────────────────────────────────────────────────

  it('dropdown contains all 8 valid time options', () => {
    render(<TimestampEditor {...makeProps()} />);
    const sel = screen.getByTestId('te-time-select');
    const options = sel.querySelectorAll('option');
    const values = Array.from(options).map(o => (o as HTMLOptionElement).value);
    expect(values).toEqual([
      'unspecified', 'midnight', 'dawn', 'morning', 'noon', 'afternoon', 'dusk', 'night',
    ]);
  });

  it('changing the time dropdown updates the selected value', () => {
    render(<TimestampEditor {...makeProps({ currentTime: 'morning' })} />);
    const sel = screen.getByTestId('te-time-select') as HTMLSelectElement;
    fireEvent.change(sel, { target: { value: 'night' } });
    expect(sel.value).toBe('night');
  });

  // ── Slider + number input sync ────────────────────────────────────────────

  it('moving the slider updates the number input', () => {
    render(<TimestampEditor {...makeProps({ currentDay: 3, maxDay: 10 })} />);
    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '7' } });
    const input = screen.getByTestId('te-day-input') as HTMLInputElement;
    expect(input.value).toBe('7');
  });

  it('typing in the number input updates the slider', () => {
    render(<TimestampEditor {...makeProps({ currentDay: 3, maxDay: 10 })} />);
    const input = screen.getByTestId('te-day-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '8' } });
    const slider = screen.getByRole('slider') as HTMLInputElement;
    expect(slider.value).toBe('8');
  });

  // ── Day validation ────────────────────────────────────────────────────────

  it('clamps day to 1 when input is below 1 on blur', () => {
    render(<TimestampEditor {...makeProps({ currentDay: 3, maxDay: 10 })} />);
    const input = screen.getByTestId('te-day-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '-5' } });
    fireEvent.blur(input);
    expect(input.value).toBe('1');
  });

  it('clamps day to maxDay when input exceeds maxDay on blur', () => {
    render(<TimestampEditor {...makeProps({ currentDay: 3, maxDay: 10 })} />);
    const input = screen.getByTestId('te-day-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '99' } });
    fireEvent.blur(input);
    expect(input.value).toBe('10');
  });

  it('non-numeric input is clamped to 1 on blur', () => {
    render(<TimestampEditor {...makeProps({ currentDay: 3, maxDay: 10 })} />);
    const input = screen.getByTestId('te-day-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'abc' } });
    fireEvent.blur(input);
    expect(input.value).toBe('1');
  });

  // ── Confirm: calls onConfirm with correct payload ─────────────────────────

  it('Confirm calls onConfirm with the current day and time', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<TimestampEditor {...makeProps({ currentDay: 3, currentTime: 'morning', onConfirm })} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId('te-confirm'));
    });

    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onConfirm).toHaveBeenCalledWith(3, 'morning');
  });

  it('Confirm passes updated day and time after user edits', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<TimestampEditor {...makeProps({ currentDay: 3, currentTime: 'morning', maxDay: 10, onConfirm })} />);

    fireEvent.change(screen.getByRole('slider'), { target: { value: '7' } });
    fireEvent.change(screen.getByTestId('te-time-select'), { target: { value: 'dusk' } });

    await act(async () => {
      fireEvent.click(screen.getByTestId('te-confirm'));
    });

    expect(onConfirm).toHaveBeenCalledWith(7, 'dusk');
  });

  // ── Confirm: disabled while pending ──────────────────────────────────────

  it('Confirm button is disabled and shows "Saving…" while pending', async () => {
    let resolveIpc!: () => void;
    const ipcPending = new Promise<void>(r => { resolveIpc = r; });
    const onConfirm = vi.fn().mockReturnValue(ipcPending);

    render(<TimestampEditor {...makeProps({ onConfirm })} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId('te-confirm'));
    });

    const btn = screen.getByTestId('te-confirm');
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent('Saving…');
    expect(screen.getByTestId('te-cancel')).toBeDisabled();

    await act(async () => { resolveIpc(); });
  });

  it('slider and number input are disabled while pending', async () => {
    let resolveIpc!: () => void;
    const ipcPending = new Promise<void>(r => { resolveIpc = r; });
    const onConfirm = vi.fn().mockReturnValue(ipcPending);

    render(<TimestampEditor {...makeProps({ onConfirm })} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId('te-confirm'));
    });

    expect(screen.getByRole('slider')).toBeDisabled();
    expect(screen.getByTestId('te-day-input')).toBeDisabled();
    expect(screen.getByTestId('te-time-select')).toBeDisabled();

    await act(async () => { resolveIpc(); });
  });

  it('shows an error message when onConfirm rejects', async () => {
    const onConfirm = vi.fn().mockRejectedValue(new Error('Network error'));
    render(<TimestampEditor {...makeProps({ onConfirm })} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId('te-confirm'));
    });

    expect(screen.getByTestId('te-error')).toHaveTextContent('Network error');
    // Button re-enables after error so user can retry
    expect(screen.getByTestId('te-confirm')).not.toBeDisabled();
  });

  // ── Cancel: discards without IPC ─────────────────────────────────────────

  it('Cancel calls onCancel and does not call onConfirm', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<TimestampEditor {...makeProps({ onConfirm, onCancel })} />);

    fireEvent.click(screen.getByTestId('te-cancel'));

    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  // ── Keyboard shortcuts ────────────────────────────────────────────────────

  it('pressing Enter in the day number input triggers Confirm', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<TimestampEditor {...makeProps({ onConfirm })} />);

    await act(async () => {
      fireEvent.keyDown(screen.getByTestId('te-day-input'), { key: 'Enter' });
    });

    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('pressing Escape in the day number input triggers Cancel', () => {
    const onCancel = vi.fn();
    render(<TimestampEditor {...makeProps({ onCancel })} />);

    fireEvent.keyDown(screen.getByTestId('te-day-input'), { key: 'Escape' });

    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('pressing Escape anywhere in the editor triggers Cancel', () => {
    const onCancel = vi.fn();
    render(<TimestampEditor {...makeProps({ onCancel })} />);

    fireEvent.keyDown(screen.getByTestId('timestamp-editor'), { key: 'Escape' });

    expect(onCancel).toHaveBeenCalledOnce();
  });

  // ── Accessibility ─────────────────────────────────────────────────────────

  it('slider has aria-valuemin, aria-valuemax, and aria-valuenow', () => {
    render(<TimestampEditor {...makeProps({ currentDay: 3, maxDay: 10 })} />);
    const slider = screen.getByRole('slider');
    expect(slider).toHaveAttribute('aria-valuemin', '1');
    expect(slider).toHaveAttribute('aria-valuemax', '10');
    expect(slider).toHaveAttribute('aria-valuenow', '3');
  });

  it('Confirm button has aria-busy=true while pending', async () => {
    let resolveIpc!: () => void;
    const ipcPending = new Promise<void>(r => { resolveIpc = r; });
    const onConfirm = vi.fn().mockReturnValue(ipcPending);

    render(<TimestampEditor {...makeProps({ onConfirm })} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId('te-confirm'));
    });

    expect(screen.getByTestId('te-confirm')).toHaveAttribute('aria-busy', 'true');

    await act(async () => { resolveIpc(); });
  });

  it('error message has role="alert" for screen reader announcement', async () => {
    const onConfirm = vi.fn().mockRejectedValue(new Error('IPC failed'));
    render(<TimestampEditor {...makeProps({ onConfirm })} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId('te-confirm'));
    });

    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('number input is associated with its label via htmlFor', () => {
    render(<TimestampEditor {...makeProps()} />);
    const input = screen.getByLabelText(/day \(number\)/i);
    expect(input).toHaveAttribute('type', 'number');
  });

  it('time select is associated with its label', () => {
    render(<TimestampEditor {...makeProps()} />);
    const sel = screen.getByLabelText(/time of day/i);
    expect(sel.tagName.toLowerCase()).toBe('select');
  });

  // ── SKY-5149: multi-digit day input ──────────────────────────────────────

  it('typing a multi-digit day digit-by-digit then confirming saves the fully typed value', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<TimestampEditor {...makeProps({ currentDay: 1, maxDay: 30, onConfirm })} />);

    const input = screen.getByTestId('te-day-input') as HTMLInputElement;

    // Simulate typing "30" one digit at a time: "3" then "30"
    fireEvent.change(input, { target: { value: '3' } });
    fireEvent.change(input, { target: { value: '30' } });

    await act(async () => {
      fireEvent.click(screen.getByTestId('te-confirm'));
    });

    expect(onConfirm).toHaveBeenCalledWith(30, 'morning');
  });

  it('intermediate partial digit in field is the committed value when user confirms mid-type', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<TimestampEditor {...makeProps({ currentDay: 1, maxDay: 30, onConfirm })} />);

    const input = screen.getByTestId('te-day-input') as HTMLInputElement;

    // User typed only "3" — field shows "3"; confirm fires at this partial state
    fireEvent.change(input, { target: { value: '3' } });

    await act(async () => {
      fireEvent.click(screen.getByTestId('te-confirm'));
    });

    // "3" is what the field currently holds — that is the committed value, not an earlier or later digit
    expect(onConfirm).toHaveBeenCalledWith(3, 'morning');
  });

  it('empty / NaN input on confirm falls back to day 1 without error', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<TimestampEditor {...makeProps({ currentDay: 5, maxDay: 10, onConfirm })} />);

    const input = screen.getByTestId('te-day-input') as HTMLInputElement;

    // User clears the field completely
    fireEvent.change(input, { target: { value: '' } });

    await act(async () => {
      fireEvent.click(screen.getByTestId('te-confirm'));
    });

    expect(onConfirm).toHaveBeenCalledWith(1, 'morning');
    expect(screen.queryByTestId('te-error')).not.toBeInTheDocument();
  });

  it('out-of-range typed day is clamped to maxDay on confirm', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<TimestampEditor {...makeProps({ currentDay: 1, maxDay: 10, onConfirm })} />);

    const input = screen.getByTestId('te-day-input') as HTMLInputElement;

    // Type a value that exceeds maxDay
    fireEvent.change(input, { target: { value: '99' } });

    await act(async () => {
      fireEvent.click(screen.getByTestId('te-confirm'));
    });

    expect(onConfirm).toHaveBeenCalledWith(10, 'morning');
  });

  it('blur normalises out-of-range input; subsequent confirm uses the normalised value', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<TimestampEditor {...makeProps({ currentDay: 1, maxDay: 10, onConfirm })} />);

    const input = screen.getByTestId('te-day-input') as HTMLInputElement;

    fireEvent.change(input, { target: { value: '30' } });
    fireEvent.blur(input);

    // After blur, the input should show the clamped value
    expect(input.value).toBe('10');

    await act(async () => {
      fireEvent.click(screen.getByTestId('te-confirm'));
    });

    expect(onConfirm).toHaveBeenCalledWith(10, 'morning');
  });

  // ── Edge cases ────────────────────────────────────────────────────────────

  it('clamps currentDay to 1 when maxDay is 1', () => {
    render(<TimestampEditor {...makeProps({ currentDay: 5, maxDay: 1 })} />);
    const input = screen.getByTestId('te-day-input') as HTMLInputElement;
    expect(input.value).toBe('1');
  });

  it('does not call onConfirm a second time while a pending call is in flight', async () => {
    let resolveIpc!: () => void;
    const ipcPending = new Promise<void>(r => { resolveIpc = r; });
    const onConfirm = vi.fn().mockReturnValue(ipcPending);

    render(<TimestampEditor {...makeProps({ onConfirm })} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId('te-confirm'));
    });

    // Double-click while pending — the second click should be ignored
    fireEvent.click(screen.getByTestId('te-confirm'));
    expect(onConfirm).toHaveBeenCalledOnce();

    await act(async () => { resolveIpc(); });
  });
});
