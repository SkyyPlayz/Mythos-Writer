import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
});

const stories: Story[] = [];

async function renderAndLoad() {
  render(<ProgressDashboard stories={stories} />);
  // Wait for initial stats load to resolve (loading state clears).
  await screen.findByText('Streak');
}

describe('ProgressDashboard streak reset', () => {
  it('surfaces an accessible error toast when reset streak fails', async () => {
    const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockGoalsResetStreak.mockRejectedValueOnce(new Error('ipc boom'));
    await renderAndLoad();

    // First click arms the confirm state.
    fireEvent.click(screen.getByRole('button', { name: 'Reset writing streak' }));
    // Second click actually invokes the IPC (which rejects).
    fireEvent.click(screen.getByRole('button', { name: 'Confirm: reset writing streak?' }));

    const toast = await screen.findByTestId('app-toast');
    expect(toast.textContent).toContain('Failed to reset streak');
    // Error toasts must be announced assertively via role=alert.
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
    // Stats reloaded: one call at mount + one after reset.
    await waitFor(() => expect(mockGoalsGetStats).toHaveBeenCalledTimes(2));
    // Confirm state cleared → button label reverts.
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
