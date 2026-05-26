import { renderHook, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useArchiveScheduler } from './useArchiveScheduler';

const mockScene = {
  id: 's1',
  title: 'Test Scene',
  blocks: [{ id: 'b1', type: 'prose' as const, order: 0, content: 'The hero arrived at the keep.', updatedAt: '' }],
  draftState: 'in-progress' as const,
  order: 0,
  path: '/stories/ch1/scene1.md',
  createdAt: '',
  updatedAt: '',
};

const mockArchiveScan = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  (window as unknown as { api: Partial<Window['api']> }).api = {
    archiveScan: mockArchiveScan,
  };
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useArchiveScheduler', () => {
  it('does not call archiveScan when disabled', async () => {
    renderHook(() =>
      useArchiveScheduler({ scene: mockScene, enabled: false, continuityCheckIntervalSeconds: 10, isActive: true }),
    );
    await act(() => { vi.advanceTimersByTime(30_000); });
    expect(mockArchiveScan).not.toHaveBeenCalled();
  });

  it('does not call archiveScan when isActive is false', async () => {
    renderHook(() =>
      useArchiveScheduler({ scene: mockScene, enabled: true, continuityCheckIntervalSeconds: 10, isActive: false }),
    );
    await act(() => { vi.advanceTimersByTime(30_000); });
    expect(mockArchiveScan).not.toHaveBeenCalled();
  });

  it('does not call archiveScan when scene is null', async () => {
    mockArchiveScan.mockResolvedValue({ inconsistenciesFound: 0, wikiLinksFound: 0 });
    renderHook(() =>
      useArchiveScheduler({ scene: null, enabled: true, continuityCheckIntervalSeconds: 10, isActive: true }),
    );
    await act(async () => { vi.advanceTimersByTime(10_000); });
    expect(mockArchiveScan).not.toHaveBeenCalled();
  });

  it('calls archiveScan at the configured interval', async () => {
    mockArchiveScan.mockResolvedValue({ inconsistenciesFound: 1, wikiLinksFound: 2 });

    renderHook(() =>
      useArchiveScheduler({ scene: mockScene, enabled: true, continuityCheckIntervalSeconds: 10, isActive: true }),
    );

    await act(async () => { vi.advanceTimersByTime(10_000); });
    expect(mockArchiveScan).toHaveBeenCalledTimes(1);

    await act(async () => { vi.advanceTimersByTime(10_000); });
    expect(mockArchiveScan).toHaveBeenCalledTimes(2);
  });

  it('calls archiveScan with correct arguments', async () => {
    mockArchiveScan.mockResolvedValue({ inconsistenciesFound: 0, wikiLinksFound: 0 });

    renderHook(() =>
      useArchiveScheduler({ scene: mockScene, enabled: true, continuityCheckIntervalSeconds: 10, isActive: true }),
    );

    await act(async () => { vi.advanceTimersByTime(10_000); });
    expect(mockArchiveScan).toHaveBeenCalledWith(
      mockScene.blocks[0].content,
      mockScene.path,
    );
  });

  it('restarts interval immediately when continuityCheckIntervalSeconds changes', async () => {
    mockArchiveScan.mockResolvedValue({ inconsistenciesFound: 0, wikiLinksFound: 0 });

    const { rerender } = renderHook(
      ({ interval }: { interval: number }) =>
        useArchiveScheduler({ scene: mockScene, enabled: true, continuityCheckIntervalSeconds: interval, isActive: true }),
      { initialProps: { interval: 30 } },
    );

    // No scan before 30s
    await act(() => { vi.advanceTimersByTime(20_000); });
    expect(mockArchiveScan).toHaveBeenCalledTimes(0);

    // Change to 10s — old 30s timer cleared
    rerender({ interval: 10 });

    await act(async () => { vi.advanceTimersByTime(10_000); });
    expect(mockArchiveScan).toHaveBeenCalledTimes(1);
  });

  it('returns scan result after successful tick', async () => {
    mockArchiveScan.mockResolvedValue({ inconsistenciesFound: 3, wikiLinksFound: 1 });

    const { result } = renderHook(() =>
      useArchiveScheduler({ scene: mockScene, enabled: true, continuityCheckIntervalSeconds: 10, isActive: true }),
    );

    expect(result.current.result).toBeNull();

    await act(async () => { vi.advanceTimersByTime(10_000); });

    expect(result.current.result?.inconsistenciesFound).toBe(3);
    expect(result.current.result?.wikiLinksFound).toBe(1);
    expect(result.current.result?.scannedAt).toBeDefined();
  });

  it('continues scheduling after a failed scan (non-fatal)', async () => {
    mockArchiveScan
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce({ inconsistenciesFound: 0, wikiLinksFound: 0 });

    const { result } = renderHook(() =>
      useArchiveScheduler({ scene: mockScene, enabled: true, continuityCheckIntervalSeconds: 10, isActive: true }),
    );

    await act(async () => { vi.advanceTimersByTime(10_000); });
    expect(result.current.result).toBeNull();

    await act(async () => { vi.advanceTimersByTime(10_000); });
    expect(result.current.result?.inconsistenciesFound).toBe(0);
  });

  it('triggerScan fires archiveScan immediately on save', async () => {
    mockArchiveScan.mockResolvedValue({ inconsistenciesFound: 1, wikiLinksFound: 0 });

    const { result } = renderHook(() =>
      useArchiveScheduler({ scene: mockScene, enabled: true, continuityCheckIntervalSeconds: 60, isActive: true }),
    );

    // No periodic tick yet
    expect(mockArchiveScan).not.toHaveBeenCalled();

    // Simulate save
    await act(async () => { result.current.triggerScan(); });
    expect(mockArchiveScan).toHaveBeenCalledTimes(1);
  });

  it('triggerScan debounces duplicate save events within 5s of last scan', async () => {
    mockArchiveScan.mockResolvedValue({ inconsistenciesFound: 0, wikiLinksFound: 0 });

    const { result } = renderHook(() =>
      useArchiveScheduler({ scene: mockScene, enabled: true, continuityCheckIntervalSeconds: 60, isActive: true }),
    );

    // First save triggers scan
    await act(async () => { result.current.triggerScan(); });
    expect(mockArchiveScan).toHaveBeenCalledTimes(1);

    // Second save 1s later — within debounce window, suppressed
    await act(() => { vi.advanceTimersByTime(1_000); });
    await act(async () => { result.current.triggerScan(); });
    expect(mockArchiveScan).toHaveBeenCalledTimes(1);

    // Third save 5s after first scan — debounce window expired, fires
    await act(() => { vi.advanceTimersByTime(4_001); });
    await act(async () => { result.current.triggerScan(); });
    expect(mockArchiveScan).toHaveBeenCalledTimes(2);
  });

  it('triggerScan does nothing when disabled', async () => {
    mockArchiveScan.mockResolvedValue({ inconsistenciesFound: 0, wikiLinksFound: 0 });

    const { result } = renderHook(() =>
      useArchiveScheduler({ scene: mockScene, enabled: false, continuityCheckIntervalSeconds: 60, isActive: true }),
    );

    await act(async () => { result.current.triggerScan(); });
    expect(mockArchiveScan).not.toHaveBeenCalled();
  });

  it('triggerScan does nothing when isActive is false', async () => {
    mockArchiveScan.mockResolvedValue({ inconsistenciesFound: 0, wikiLinksFound: 0 });

    const { result } = renderHook(() =>
      useArchiveScheduler({ scene: mockScene, enabled: true, continuityCheckIntervalSeconds: 60, isActive: false }),
    );

    await act(async () => { result.current.triggerScan(); });
    expect(mockArchiveScan).not.toHaveBeenCalled();
  });
});
