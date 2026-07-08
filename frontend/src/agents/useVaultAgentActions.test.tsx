// Beta 3 M22 — vault-tree "Beta read" / "Continuity check" wiring.
// Mocks window.api the way existing agent tests do (vi.fn per method).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useVaultAgentActions, noteAgentScanKey } from './useVaultAgentActions';
import { listNotifications, clearNotifications } from '../notificationStore';
import { agentsActiveSnapshot, resetAgentActivityForTests } from './agentActivity';

const mockReadNotesVault = vi.fn();
const mockBetaReadScan = vi.fn();
const mockArchiveScanContinuity = vi.fn();
const mockArchiveListContinuity = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  clearNotifications();
  resetAgentActivityForTests();
  (window as unknown as { api: Record<string, unknown> }).api = {
    readNotesVault: mockReadNotesVault,
    betaReadScan: mockBetaReadScan,
    archiveScanContinuity: mockArchiveScanContinuity,
    archiveListContinuity: mockArchiveListContinuity,
  };
  mockReadNotesVault.mockResolvedValue({ content: 'The drownlight burns beneath the tide.', path: 'lore/drownlight.md' });
  mockBetaReadScan.mockResolvedValue({
    comments: [
      { id: 'c1', scene_id: 'note:lore/drownlight.md', anchor_text: 'drownlight', comment_text: 'Vivid!', created_at: 'now', dismissed_at: null },
      { id: 'c2', scene_id: 'note:lore/drownlight.md', anchor_text: 'the tide', comment_text: 'Which tide?', created_at: 'now', dismissed_at: null },
    ],
    scannedAt: 'now',
  });
  mockArchiveScanContinuity.mockResolvedValue(undefined);
  mockArchiveListContinuity.mockResolvedValue({ items: [{ id: 'i1', status: 'open' }] });
});

describe('noteAgentScanKey (M23 contract)', () => {
  it('prefixes the note path with note:', () => {
    expect(noteAgentScanKey('lore/drownlight.md')).toBe('note:lore/drownlight.md');
  });
});

describe('betaReadNote', () => {
  it('reads the note and runs the Beta Reader scan keyed note:<path>', async () => {
    const { result } = renderHook(() => useVaultAgentActions());
    act(() => { result.current.betaReadNote('lore/drownlight.md'); });

    await waitFor(() => expect(mockBetaReadScan).toHaveBeenCalledTimes(1));
    expect(mockReadNotesVault).toHaveBeenCalledWith('lore/drownlight.md');
    expect(mockBetaReadScan).toHaveBeenCalledWith(
      'note:lore/drownlight.md',
      'The drownlight burns beneath the tide.',
      'lore/drownlight.md',
    );
  });

  it('pushes a beta notification with the reaction count and custom agent name', async () => {
    const { result } = renderHook(() =>
      useVaultAgentActions({ agentNames: { betaReader: 'Ruthless Rita' } }),
    );
    act(() => { result.current.betaReadNote('lore/drownlight.md'); });

    await waitFor(() => expect(listNotifications()).toHaveLength(1));
    const [n] = listNotifications();
    expect(n.kind).toBe('beta');
    expect(n.title).toContain('Ruthless Rita');
    expect(n.title).toContain('drownlight');
    expect(n.detail).toContain('2 reactions');
  });

  it('marks agent activity while the scan runs and clears it after', async () => {
    let resolveScan!: (v: unknown) => void;
    mockBetaReadScan.mockReturnValueOnce(new Promise((res) => { resolveScan = res; }));

    const { result } = renderHook(() => useVaultAgentActions());
    act(() => { result.current.betaReadNote('lore/drownlight.md'); });

    await waitFor(() => expect(agentsActiveSnapshot()).toBe(true));
    await act(async () => { resolveScan({ comments: [], scannedAt: 'now' }); });
    await waitFor(() => expect(agentsActiveSnapshot()).toBe(false));
  });

  it('skips the scan and notifies when the note is empty', async () => {
    mockReadNotesVault.mockResolvedValueOnce({ content: '   ', path: 'empty.md' });
    const { result } = renderHook(() => useVaultAgentActions());
    act(() => { result.current.betaReadNote('empty.md'); });

    await waitFor(() => expect(listNotifications()).toHaveLength(1));
    expect(mockBetaReadScan).not.toHaveBeenCalled();
    expect(listNotifications()[0].title).toContain('skipped');
  });

  it('surfaces scan errors as a notification and still releases activity', async () => {
    mockBetaReadScan.mockResolvedValueOnce({ error: 'No API key configured.' });
    const { result } = renderHook(() => useVaultAgentActions());
    act(() => { result.current.betaReadNote('lore/drownlight.md'); });

    await waitFor(() => expect(listNotifications()).toHaveLength(1));
    expect(listNotifications()[0].detail).toContain('No API key configured.');
    expect(agentsActiveSnapshot()).toBe(false);
  });
});

describe('continuityCheckNote', () => {
  it('runs the archive continuity scan keyed note:<path> and reports open flags', async () => {
    const { result } = renderHook(() => useVaultAgentActions());
    act(() => { result.current.continuityCheckNote('lore/drownlight.md'); });

    await waitFor(() => expect(listNotifications()).toHaveLength(1));
    expect(mockArchiveScanContinuity).toHaveBeenCalledWith(
      'note:lore/drownlight.md',
      'The drownlight burns beneath the tide.',
    );
    expect(mockArchiveListContinuity).toHaveBeenCalledWith({
      sceneId: 'note:lore/drownlight.md',
      filter: { status: 'open' },
    });
    const [n] = listNotifications();
    expect(n.kind).toBe('archive');
    expect(n.detail).toContain('1 open flag');
  });

  it('uses the custom archive agent name', async () => {
    mockArchiveListContinuity.mockResolvedValueOnce({ items: [] });
    const { result } = renderHook(() =>
      useVaultAgentActions({ agentNames: { archive: 'The Archivist' } }),
    );
    act(() => { result.current.continuityCheckNote('lore/drownlight.md'); });

    await waitFor(() => expect(listNotifications()).toHaveLength(1));
    expect(listNotifications()[0].title).toContain('The Archivist');
    expect(listNotifications()[0].detail).toContain('No continuity flags');
  });

  it('surfaces read errors and releases activity', async () => {
    mockReadNotesVault.mockResolvedValueOnce({ error: 'not found' });
    const { result } = renderHook(() => useVaultAgentActions());
    act(() => { result.current.continuityCheckNote('missing.md'); });

    await waitFor(() => expect(listNotifications()).toHaveLength(1));
    expect(listNotifications()[0].title).toContain('couldn’t check');
    expect(agentsActiveSnapshot()).toBe(false);
  });
});
