import { renderHook, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useWritingScheduler } from './useWritingScheduler';

const mockScene = {
  id: 's1',
  title: 'Test Scene',
  blocks: [{ id: 'b1', type: 'prose' as const, order: 0, content: 'The hero walked into the tavern.', updatedAt: '' }],
  draftState: 'in-progress' as const,
  order: 0,
  path: '/stories/ch1/scene1.md',
  createdAt: '',
  updatedAt: '',
};

const mockWritingScan = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  (window as unknown as { api: Partial<Window['api']> }).api = {
    writingScan: mockWritingScan,
  };
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useWritingScheduler', () => {
  it('does not call writingScan when disabled', async () => {
    renderHook(() =>
      useWritingScheduler({ scene: mockScene, enabled: false, scanIntervalSeconds: 10, isActive: true }),
    );
    await act(() => { vi.advanceTimersByTime(30_000); });
    expect(mockWritingScan).not.toHaveBeenCalled();
  });

  it('does not call writingScan when isActive is false (page not focused)', async () => {
    renderHook(() =>
      useWritingScheduler({ scene: mockScene, enabled: true, scanIntervalSeconds: 10, isActive: false }),
    );
    await act(() => { vi.advanceTimersByTime(30_000); });
    expect(mockWritingScan).not.toHaveBeenCalled();
  });

  it('does not call writingScan when scene is null', async () => {
    mockWritingScan.mockResolvedValue({ tips: [], scannedAt: new Date().toISOString() });
    renderHook(() =>
      useWritingScheduler({ scene: null, enabled: true, scanIntervalSeconds: 10, isActive: true }),
    );
    await act(async () => { vi.advanceTimersByTime(10_000); });
    expect(mockWritingScan).not.toHaveBeenCalled();
  });

  it('calls writingScan at the configured interval', async () => {
    mockWritingScan.mockResolvedValue({ tips: ['Be concise.'], scannedAt: new Date().toISOString() });

    renderHook(() =>
      useWritingScheduler({ scene: mockScene, enabled: true, scanIntervalSeconds: 10, isActive: true }),
    );

    await act(async () => { vi.advanceTimersByTime(10_000); });
    expect(mockWritingScan).toHaveBeenCalledTimes(1);

    await act(async () => { vi.advanceTimersByTime(10_000); });
    expect(mockWritingScan).toHaveBeenCalledTimes(2);
  });

  it('calls writingScan with correct scene arguments', async () => {
    mockWritingScan.mockResolvedValue({ tips: ['Tip.'], scannedAt: new Date().toISOString() });

    renderHook(() =>
      useWritingScheduler({ scene: mockScene, enabled: true, scanIntervalSeconds: 10, isActive: true }),
    );

    await act(async () => { vi.advanceTimersByTime(10_000); });
    expect(mockWritingScan).toHaveBeenCalledWith(
      mockScene.id,
      mockScene.blocks[0].content,
      mockScene.path,
    );
  });

  it('restarts interval immediately when scanIntervalSeconds changes', async () => {
    mockWritingScan.mockResolvedValue({ tips: ['Tip.'], scannedAt: new Date().toISOString() });

    const { rerender } = renderHook(
      ({ interval }: { interval: number }) =>
        useWritingScheduler({ scene: mockScene, enabled: true, scanIntervalSeconds: interval, isActive: true }),
      { initialProps: { interval: 30 } },
    );

    // No scan fires before 30s
    await act(() => { vi.advanceTimersByTime(20_000); });
    expect(mockWritingScan).toHaveBeenCalledTimes(0);

    // Change to 10s interval — old 30s timer is cleared
    rerender({ interval: 10 });

    // Scan fires after 10s under the new interval
    await act(async () => { vi.advanceTimersByTime(10_000); });
    expect(mockWritingScan).toHaveBeenCalledTimes(1);
  });

  it('pauses when isActive becomes false and resumes when true again', async () => {
    mockWritingScan.mockResolvedValue({ tips: ['Tip.'], scannedAt: new Date().toISOString() });

    const { rerender } = renderHook(
      ({ isActive }: { isActive: boolean }) =>
        useWritingScheduler({ scene: mockScene, enabled: true, scanIntervalSeconds: 10, isActive }),
      { initialProps: { isActive: true } },
    );

    // First tick fires
    await act(async () => { vi.advanceTimersByTime(10_000); });
    expect(mockWritingScan).toHaveBeenCalledTimes(1);

    // Pause — switching away from editor view
    rerender({ isActive: false });
    await act(() => { vi.advanceTimersByTime(20_000); });
    expect(mockWritingScan).toHaveBeenCalledTimes(1);

    // Resume — back to editor view
    rerender({ isActive: true });
    await act(async () => { vi.advanceTimersByTime(10_000); });
    expect(mockWritingScan).toHaveBeenCalledTimes(2);
  });

  it('returns scan result after successful tick', async () => {
    const tips = ['Use active voice.', 'Shorten this paragraph.'];
    const scannedAt = '2026-05-23T12:00:00.000Z';
    mockWritingScan.mockResolvedValue({ tips, scannedAt });

    const { result } = renderHook(() =>
      useWritingScheduler({ scene: mockScene, enabled: true, scanIntervalSeconds: 10, isActive: true }),
    );

    expect(result.current.result).toBeNull();

    await act(async () => { vi.advanceTimersByTime(10_000); });

    expect(result.current.result).toEqual({ tips, scannedAt });
  });

  it('continues scheduling after a failed scan (non-fatal)', async () => {
    mockWritingScan
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce({ tips: ['Recovered tip.'], scannedAt: new Date().toISOString() });

    const { result } = renderHook(() =>
      useWritingScheduler({ scene: mockScene, enabled: true, scanIntervalSeconds: 10, isActive: true }),
    );

    // First tick fails — no crash, result stays null
    await act(async () => { vi.advanceTimersByTime(10_000); });
    expect(result.current.result).toBeNull();

    // Second tick succeeds
    await act(async () => { vi.advanceTimersByTime(10_000); });
    expect(result.current.result?.tips).toEqual(['Recovered tip.']);
  });
});
