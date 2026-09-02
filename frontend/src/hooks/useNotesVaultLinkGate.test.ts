// SKY-11154 — the shared "gate a notes-vault switch behind the broken
// wikilink report" hook, extracted from NotesVaultPicker.tsx so both it and
// the Settings-page Notes/Story columns share one implementation.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useNotesVaultLinkGate } from './useNotesVaultLinkGate';

const mockPreview = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, 'api', {
    value: { notesVaultRegistrySetActivePreview: mockPreview },
    writable: true,
    configurable: true,
  });
});

describe('useNotesVaultLinkGate', () => {
  it('commits immediately with no dialog when totalStems === 0', async () => {
    mockPreview.mockResolvedValue({ resolvedCount: 0, unresolvedStems: [], totalStems: 0 });
    const onCommit = vi.fn();
    const { result } = renderHook(() => useNotesVaultLinkGate());

    await act(async () => {
      await result.current.requestGatedSwitch('vault-2', 'Second Notes', onCommit);
    });

    expect(onCommit).toHaveBeenCalledWith('vault-2');
    expect(result.current.pending).toBeNull();
  });

  it('gates behind a confirm when totalStems > 0, and only commits on confirm()', async () => {
    mockPreview.mockResolvedValue({ resolvedCount: 3, unresolvedStems: ['gone'], totalStems: 4 });
    const onCommit = vi.fn();
    const { result } = renderHook(() => useNotesVaultLinkGate());

    await act(async () => {
      await result.current.requestGatedSwitch('vault-2', 'Second Notes', onCommit);
    });

    expect(onCommit).not.toHaveBeenCalled();
    expect(result.current.pending).toEqual({
      targetId: 'vault-2',
      targetDisplayName: 'Second Notes',
      report: { resolvedCount: 3, unresolvedStems: ['gone'], totalStems: 4 },
    });

    await act(async () => {
      await result.current.confirm();
    });

    expect(onCommit).toHaveBeenCalledWith('vault-2');
    expect(result.current.pending).toBeNull();
  });

  it('cancel() discards the pending switch without ever running onCommit', async () => {
    mockPreview.mockResolvedValue({ resolvedCount: 0, unresolvedStems: ['x'], totalStems: 1 });
    const onCommit = vi.fn();
    const { result } = renderHook(() => useNotesVaultLinkGate());

    await act(async () => {
      await result.current.requestGatedSwitch('vault-2', 'Second Notes', onCommit);
    });
    expect(result.current.pending).not.toBeNull();

    act(() => {
      result.current.cancel();
    });

    expect(result.current.pending).toBeNull();
    await act(async () => {
      await result.current.confirm(); // no-op — nothing pending
    });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('does nothing when the preview call is unavailable', async () => {
    Object.defineProperty(window, 'api', { value: {}, writable: true, configurable: true });
    const onCommit = vi.fn();
    const { result } = renderHook(() => useNotesVaultLinkGate());
    await act(async () => {
      await result.current.requestGatedSwitch('vault-2', 'Second Notes', onCommit);
    });
    expect(onCommit).not.toHaveBeenCalled();
    expect(result.current.pending).toBeNull();
  });

  it('sets busy true while the commit callback is in flight', async () => {
    mockPreview.mockResolvedValue({ resolvedCount: 0, unresolvedStems: ['x'], totalStems: 1 });
    let resolveCommit: () => void = () => {};
    const onCommit = vi.fn(() => new Promise<void>((resolve) => { resolveCommit = resolve; }));
    const { result } = renderHook(() => useNotesVaultLinkGate());

    await act(async () => {
      await result.current.requestGatedSwitch('vault-2', 'Second Notes', onCommit);
    });

    let confirmPromise!: Promise<void>;
    act(() => {
      confirmPromise = result.current.confirm();
    });
    await waitFor(() => expect(result.current.busy).toBe(true));

    resolveCommit();
    await act(async () => { await confirmPromise; });
    expect(result.current.busy).toBe(false);
  });
});
