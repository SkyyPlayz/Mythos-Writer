// SKY-11192/SKY-11674 §3 — the Idea Collections filing hook: already-filed
// detection per mapped folder, the transient `filing` status, and that
// `fileIdea` is a plain function the caller controls (no internal timer/
// effect ever invokes it on its own).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useIdeaCollectionsFiling } from './useIdeaCollectionsFiling';

const mockList = vi.fn();
const mockFile = vi.fn();
const mockUnfile = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, 'api', {
    value: {
      listNotesVault: mockList,
      ideaCollectionsFile: mockFile,
      ideaCollectionsUnfile: mockUnfile,
      onVaultNotesUpdated: () => () => {},
    },
    writable: true,
    configurable: true,
  });
  mockList.mockResolvedValue({ items: [] });
});

const IDEA = { key: 'k1', cat: 'beats' as const, title: 'Midpoint Reversal', desc: '' };

describe('useIdeaCollectionsFiling', () => {
  it('statusFor is "unfiled" when the target folder has no matching note', async () => {
    const { result } = renderHook(() => useIdeaCollectionsFiling(true));
    await waitFor(() => expect(mockList).toHaveBeenCalled());
    expect(result.current.statusFor(IDEA)).toBe('unfiled');
  });

  it('statusFor is "filed" when the mapped folder already lists a matching note', async () => {
    mockList.mockImplementation(async (folder: string) => {
      if (folder === 'Plot & Story') {
        return { items: [{ path: 'Midpoint Reversal.md', name: 'Midpoint Reversal.md', isDirectory: false }] };
      }
      return { items: [] };
    });
    const { result } = renderHook(() => useIdeaCollectionsFiling(true));
    await waitFor(() => expect(result.current.statusFor(IDEA)).toBe('filed'));
  });

  it('fileIdea calls the IPC with the idea and resolves the folder path on success', async () => {
    mockFile.mockResolvedValue({ status: 'filed', folderPath: 'Plot & Story', itemPath: 'Midpoint Reversal.md' });
    const { result } = renderHook(() => useIdeaCollectionsFiling(true));

    let outcome: Awaited<ReturnType<typeof result.current.fileIdea>> = null;
    await act(async () => {
      outcome = await result.current.fileIdea(IDEA);
    });

    expect(mockFile).toHaveBeenCalledWith('beats', 'Midpoint Reversal', '');
    expect(outcome).toEqual({ folderPath: 'Plot & Story', itemPath: 'Midpoint Reversal.md', alreadyFiled: false });
  });

  it('fileIdea returns null on an IPC error and does not throw', async () => {
    mockFile.mockResolvedValue({ error: 'disk full' });
    const { result } = renderHook(() => useIdeaCollectionsFiling(true));

    let outcome: unknown = 'not set';
    await act(async () => {
      outcome = await result.current.fileIdea(IDEA);
    });
    expect(outcome).toBeNull();
  });

  it('unfileIdea calls the IPC with category and itemPath', async () => {
    mockUnfile.mockResolvedValue({ deleted: true });
    const { result } = renderHook(() => useIdeaCollectionsFiling(true));
    await act(async () => {
      await result.current.unfileIdea('beats', 'Midpoint Reversal.md');
    });
    expect(mockUnfile).toHaveBeenCalledWith('beats', 'Midpoint Reversal.md');
  });

  it('folderPathFor resolves the fixed mapping', async () => {
    const { result } = renderHook(() => useIdeaCollectionsFiling(true));
    await waitFor(() => expect(mockList).toHaveBeenCalled());
    expect(result.current.folderPathFor('rel')).toBe('Characters');
    expect(result.current.folderPathFor('world')).toBe('Worldbuilding');
    expect(result.current.folderPathFor('loose')).toBe('Plot & Story');
  });
});
