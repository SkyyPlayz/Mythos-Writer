import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVaultFiles } from './useVaultFiles';

// SKY-11182: `useVaultFiles('notes')` must refresh on the Notes-Vault channel
// (`vault:notes-updated` via `onVaultNotesUpdated`) — NOT the Story-Vault
// channel (`vault:file-changed` via `onVaultFileChanged`). The `story` source
// keeps the inverse wiring. These tests capture each listener's callback and
// assert reloads fire on the matching channel only.

const mockListVault = vi.fn();
const mockListNotesVault = vi.fn();
const mockStartVaultWatch = vi.fn();

// Captured callbacks so tests can fire each channel independently.
let fileChangedCb: (() => void) | undefined;
let notesUpdatedCb: (() => void) | undefined;
const mockOnVaultFileChanged = vi.fn((cb: () => void) => {
  fileChangedCb = cb;
  return vi.fn();
});
const mockOnVaultNotesUpdated = vi.fn((cb: () => void) => {
  notesUpdatedCb = cb;
  return vi.fn();
});

beforeEach(() => {
  vi.useFakeTimers();
  fileChangedCb = undefined;
  notesUpdatedCb = undefined;
  mockListVault.mockReset().mockResolvedValue({ items: [] });
  mockListNotesVault.mockReset().mockResolvedValue({ items: [] });
  mockStartVaultWatch.mockReset().mockResolvedValue({ watching: true });
  mockOnVaultFileChanged.mockClear();
  mockOnVaultNotesUpdated.mockClear();

  (window as unknown as { api: unknown }).api = {
    listVault: mockListVault,
    listNotesVault: mockListNotesVault,
    startVaultWatch: mockStartVaultWatch,
    onVaultFileChanged: mockOnVaultFileChanged,
    onVaultNotesUpdated: mockOnVaultNotesUpdated,
  };
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

// Flush the microtask queue for the async `load()` while fake timers are active.
async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useVaultFiles('notes')", () => {
  it('lists from the Notes Vault and subscribes to the notes channel only', async () => {
    renderHook(() => useVaultFiles('notes'));
    await flushMicrotasks();

    expect(mockListNotesVault).toHaveBeenCalled();
    expect(mockListVault).not.toHaveBeenCalled();
    expect(mockOnVaultNotesUpdated).toHaveBeenCalledTimes(1);
    expect(mockOnVaultFileChanged).not.toHaveBeenCalled();
    // Notes watcher is started by main on project switch, not the renderer.
    expect(mockStartVaultWatch).not.toHaveBeenCalled();
  });

  it('reloads on vault:notes-updated (debounced)', async () => {
    renderHook(() => useVaultFiles('notes'));
    await flushMicrotasks();
    expect(mockListNotesVault).toHaveBeenCalledTimes(1); // initial load

    act(() => {
      notesUpdatedCb?.();
    });
    // Debounced 150ms — no reload yet.
    expect(mockListNotesVault).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(150);
    });
    await flushMicrotasks();
    expect(mockListNotesVault).toHaveBeenCalledTimes(2);
  });

  it('does NOT reload when the Story-Vault channel fires', async () => {
    renderHook(() => useVaultFiles('notes'));
    await flushMicrotasks();
    expect(mockListNotesVault).toHaveBeenCalledTimes(1);

    // The story channel was never subscribed, so its callback is undefined.
    expect(fileChangedCb).toBeUndefined();
    act(() => {
      vi.advanceTimersByTime(150);
    });
    await flushMicrotasks();
    expect(mockListNotesVault).toHaveBeenCalledTimes(1);
  });
});

describe("useVaultFiles('story')", () => {
  it('lists from the Story Vault and subscribes to the story channel only', async () => {
    renderHook(() => useVaultFiles('story'));
    await flushMicrotasks();

    expect(mockListVault).toHaveBeenCalled();
    expect(mockListNotesVault).not.toHaveBeenCalled();
    expect(mockOnVaultFileChanged).toHaveBeenCalledTimes(1);
    expect(mockOnVaultNotesUpdated).not.toHaveBeenCalled();
    expect(mockStartVaultWatch).toHaveBeenCalledTimes(1);
  });

  it('reloads on vault:file-changed and ignores the notes channel', async () => {
    renderHook(() => useVaultFiles('story'));
    await flushMicrotasks();
    expect(mockListVault).toHaveBeenCalledTimes(1);

    // Notes channel never subscribed for a story hook.
    expect(notesUpdatedCb).toBeUndefined();

    act(() => {
      fileChangedCb?.();
      vi.advanceTimersByTime(150);
    });
    await flushMicrotasks();
    expect(mockListVault).toHaveBeenCalledTimes(2);
  });
});
