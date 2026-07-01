import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProgressDashboard from './ProgressDashboard';
import type { Story } from './types';

const mockGoalsGetStats = vi.fn();
const mockGoalsResetStreak = vi.fn();
const mockGoalsSetGoal = vi.fn();

const baseStats = {
  todayWords: 120,
  weekWords: 800,
  dailyGoal: 500,
  streakDays: 4,
  heatmap: Array.from({ length: 30 }, (_, i) => ({ date: `d${i}`, words: 0 })),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGoalsGetStats.mockResolvedValue({ ...baseStats });
  mockGoalsResetStreak.mockResolvedValue(undefined);
  mockGoalsSetGoal.mockResolvedValue(undefined);
  Object.defineProperty(window, 'api', {
    value: {
      goalsGetStats: mockGoalsGetStats,
      goalsResetStreak: mockGoalsResetStreak,
      goalsSetGoal: mockGoalsSetGoal,
    },
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

const stories: Story[] = [];

async function renderAndLoad() {
  render(<ProgressDashboard stories={stories} />);
  await screen.findByText('Streak');
}

async function renderAndWait() {
  render(<ProgressDashboard stories={[]} />);
  return screen.findByLabelText('Daily word count goal');
}

async function setGoalAndSave(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'Save daily goal' }));
}

// ---------------------------------------------------------------------------
// Streak reset + save-goal IPC error toasts (from SKY-5145 / GH#732)
// ---------------------------------------------------------------------------

describe('ProgressDashboard streak reset', () => {
  it('surfaces an accessible error toast when reset streak fails', async () => {
    const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockGoalsResetStreak.mockRejectedValueOnce(new Error('ipc boom'));
    await renderAndLoad();

    fireEvent.click(screen.getByRole('button', { name: 'Reset writing streak' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm: reset writing streak?' }));

    const toast = await screen.findByTestId('app-toast');
    expect(toast.textContent).toContain('Failed to reset streak');
    expect(toast.getAttribute('role')).toBe('alert');
    expect(toast.getAttribute('aria-live')).toBe('assertive');
    expect(mockGoalsResetStreak).toHaveBeenCalledTimes(1);
    expect(consoleErr).toHaveBeenCalled();
  });

  it('clears confirm and reloads stats on successful reset (no error toast)', async () => {
    await renderAndLoad();

    fireEvent.click(screen.getByRole('button', { name: 'Reset writing streak' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm: reset writing streak?' }));

    await waitFor(() => expect(mockGoalsResetStreak).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockGoalsGetStats).toHaveBeenCalledTimes(2));
    await screen.findByRole('button', { name: 'Reset writing streak' });
    expect(screen.queryByTestId('app-toast')).toBeNull();
  });

  it('surfaces an error toast when saving the daily goal fails', async () => {
    const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockGoalsSetGoal.mockRejectedValueOnce(new Error('save boom'));
    await renderAndLoad();

    fireEvent.click(screen.getByRole('button', { name: 'Save daily goal' }));

    const toast = await screen.findByTestId('app-toast');
    expect(toast.textContent).toContain('Failed to save goal');
    expect(toast.getAttribute('role')).toBe('alert');
    expect(consoleErr).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Goal input validation — invalid inputs rejected (from SKY-5153 / GH#625)
// ---------------------------------------------------------------------------

describe('ProgressDashboard — goal input validation: invalid inputs rejected', () => {
  it('rejects a decimal like "50." and shows an error', async () => {
    const input = await renderAndWait();
    await setGoalAndSave(input, '50.');
    expect(mockGoalsSetGoal).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('rejects a suffixed value like "500x" and shows an error', async () => {
    const input = await renderAndWait();
    await setGoalAndSave(input, '500x');
    expect(mockGoalsSetGoal).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('rejects scientific notation like "1e3" and shows an error', async () => {
    const input = await renderAndWait();
    await setGoalAndSave(input, '1e3');
    expect(mockGoalsSetGoal).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('rejects alphabetic text like "abc" and shows an error', async () => {
    const input = await renderAndWait();
    await setGoalAndSave(input, 'abc');
    expect(mockGoalsSetGoal).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('rejects empty input and shows an error', async () => {
    const input = await renderAndWait();
    await setGoalAndSave(input, '');
    expect(mockGoalsSetGoal).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('rejects zero and shows an error', async () => {
    const input = await renderAndWait();
    await setGoalAndSave(input, '0');
    expect(mockGoalsSetGoal).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('rejects a negative number and shows an error', async () => {
    const input = await renderAndWait();
    await setGoalAndSave(input, '-5');
    expect(mockGoalsSetGoal).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Goal input validation — valid inputs accepted
// ---------------------------------------------------------------------------

describe('ProgressDashboard — goal input validation: valid inputs accepted', () => {
  it('saves a clean positive integer like "500"', async () => {
    const input = await renderAndWait();
    await setGoalAndSave(input, '500');
    await waitFor(() => expect(mockGoalsSetGoal).toHaveBeenCalledWith(500));
  });

  it('trims surrounding whitespace and saves " 50 " as 50', async () => {
    const input = await renderAndWait();
    await setGoalAndSave(input, ' 50 ');
    await waitFor(() => expect(mockGoalsSetGoal).toHaveBeenCalledWith(50));
  });

  it('saves the value "1" (minimum valid)', async () => {
    const input = await renderAndWait();
    await setGoalAndSave(input, '1');
    await waitFor(() => expect(mockGoalsSetGoal).toHaveBeenCalledWith(1));
  });
});

// ---------------------------------------------------------------------------
// Goal error UX
// ---------------------------------------------------------------------------

describe('ProgressDashboard — goal error UX', () => {
  it('shows no error initially', async () => {
    await renderAndWait();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('clears the error when the user changes the input after an invalid attempt', async () => {
    const input = await renderAndWait();
    await setGoalAndSave(input, 'bad');
    expect(await screen.findByRole('alert')).toBeInTheDocument();

    fireEvent.change(input, { target: { value: '500' } });
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('saves without error after a prior invalid attempt once input is corrected', async () => {
    const input = await renderAndWait();
    await setGoalAndSave(input, 'bad');
    expect(await screen.findByRole('alert')).toBeInTheDocument();

    fireEvent.change(input, { target: { value: '300' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save daily goal' }));
    await waitFor(() => expect(mockGoalsSetGoal).toHaveBeenCalledWith(300));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('saving via Enter key also validates and rejects invalid input', async () => {
    const input = await renderAndWait();
    fireEvent.change(input, { target: { value: '50.' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockGoalsSetGoal).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
