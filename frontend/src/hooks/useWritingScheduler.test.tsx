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

  it('clears stale tips when switching scenes and when the active scene has no prose', async () => {
    const tips = ['Use active voice.'];
    mockWritingScan.mockResolvedValue({ tips, scannedAt: '2026-05-23T12:00:00.000Z' });
    const emptyScene = {
      ...mockScene,
      id: 'empty-scene',
      blocks: [{ ...mockScene.blocks[0], id: 'empty-block', content: '' }],
    };

    const { result, rerender } = renderHook(
      ({ scene }) => useWritingScheduler({ scene, enabled: true, scanIntervalSeconds: 10, isActive: true }),
      { initialProps: { scene: mockScene } },
    );

    await act(async () => { vi.advanceTimersByTime(10_000); });
    expect(result.current.result?.tips).toEqual(tips);

    rerender({ scene: emptyScene });
    expect(result.current.result).toBeNull();

    await act(async () => { vi.advanceTimersByTime(10_000); });
    expect(mockWritingScan).toHaveBeenCalledTimes(1);
    expect(result.current.result).toBeNull();
  });

  // AC-CAD-02: on_save mode — setInterval NOT called, writingScan called on scene:saved event
  it('AC-CAD-02: on_save mode does not use setInterval and fires on scene:saved event', async () => {
    const mockOnWritingScanResult = vi.fn();
    (window as unknown as { api: Partial<Window['api']> }).api = {
      writingScan: mockWritingScan,
      writingAssistantScanNow: vi.fn().mockResolvedValue({ tips: [], scannedAt: new Date().toISOString() }),
      onWritingScanResult: mockOnWritingScanResult,
    };

    mockWritingScan.mockResolvedValue({ tips: ['on-save tip'], scannedAt: new Date().toISOString() });
    mockOnWritingScanResult.mockReturnValue(() => {});

    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');

    renderHook(() =>
      useWritingScheduler({
        scene: mockScene,
        enabled: true,
        scanIntervalSeconds: 10,
        isActive: true,
        cadenceTrigger: 'on_save',
      }),
    );

    // Advance time — no setInterval should have fired writingScan
    await act(() => { vi.advanceTimersByTime(30_000); });
    expect(mockWritingScan).not.toHaveBeenCalled();

    // scene:saved event should trigger a scan
    await act(async () => {
      window.dispatchEvent(new Event('scene:saved'));
      await Promise.resolve();
    });
    expect(mockWritingScan).toHaveBeenCalledTimes(1);

    // setInterval should not have been called for the scan loop
    const intervalCalls = setIntervalSpy.mock.calls.filter(
      (call) => typeof call[1] === 'number' && (call[1] as number) >= 5000,
    );
    expect(intervalCalls).toHaveLength(0);

    setIntervalSpy.mockRestore();
  });

  // AC-CAD-04: idle_heartbeat + debounce — fires writingScan after idleDebounceSeconds of no keypress
  it('AC-CAD-04: idle_heartbeat + debounce fires after idleDebounceSeconds of no keypress', async () => {
    mockWritingScan.mockResolvedValue({ tips: ['debounce tip'], scannedAt: new Date().toISOString() });

    renderHook(() =>
      useWritingScheduler({
        scene: mockScene,
        enabled: true,
        scanIntervalSeconds: 60,
        isActive: true,
        cadenceTrigger: 'idle_heartbeat',
        idleHeartbeatConstantInterval: false,
        idleDebounceSeconds: 10,
      }),
    );

    // Trigger a keydown
    await act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    });

    // Not yet fired
    await act(() => { vi.advanceTimersByTime(5_000); });
    expect(mockWritingScan).not.toHaveBeenCalled();

    // After debounce period, scan fires
    await act(async () => { vi.advanceTimersByTime(5_000); });
    expect(mockWritingScan).toHaveBeenCalledTimes(1);
  });

  // AC-CAD-10: switching to on_save clears setInterval
  it('AC-CAD-10: switching cadenceTrigger to on_save clears the setInterval', async () => {
    mockWritingScan.mockResolvedValue({ tips: ['tip'], scannedAt: new Date().toISOString() });
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');

    const mockOnWritingScanResult = vi.fn().mockReturnValue(() => {});
    (window as unknown as { api: Partial<Window['api']> }).api = {
      writingScan: mockWritingScan,
      writingAssistantScanNow: vi.fn().mockResolvedValue({ tips: [], scannedAt: new Date().toISOString() }),
      onWritingScanResult: mockOnWritingScanResult,
    };

    const { rerender } = renderHook(
      ({ cadenceTrigger }: { cadenceTrigger: 'on_save' | 'idle_heartbeat' }) =>
        useWritingScheduler({
          scene: mockScene,
          enabled: true,
          scanIntervalSeconds: 10,
          isActive: true,
          cadenceTrigger,
        }),
      { initialProps: { cadenceTrigger: 'idle_heartbeat' as 'on_save' | 'idle_heartbeat' } },
    );

    // Scan fires under idle_heartbeat constant interval
    await act(async () => { vi.advanceTimersByTime(10_000); });
    expect(mockWritingScan).toHaveBeenCalledTimes(1);

    clearIntervalSpy.mockClear();

    // Switch to on_save
    rerender({ cadenceTrigger: 'on_save' as const });

    // clearInterval should have been called to clean up the old interval
    expect(clearIntervalSpy).toHaveBeenCalled();

    // Advancing time should NOT call writingScan again (interval cleared)
    await act(() => { vi.advanceTimersByTime(10_000); });
    expect(mockWritingScan).toHaveBeenCalledTimes(1);

    clearIntervalSpy.mockRestore();
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
