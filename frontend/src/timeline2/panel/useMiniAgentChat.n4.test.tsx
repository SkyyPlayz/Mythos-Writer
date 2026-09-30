/**
 * N4 Secure bar — Cancel + stall must abort the provider stream in MAIN
 * (cancelAiActivity), not just clear renderer UI.
 * Critic hard 2/3 — bind cancel to THIS job id; reset stall on chunks.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { __resetAgentSessionStores } from '../../lib/useAgentSessions';
import {
  useMiniAgentChat,
  HARD_TIMEOUT_MS,
  STALL_WARNING_MS,
} from './useMiniAgentChat';
import { encodeCoachCard } from '../../coach/coachMessages';

function installApi() {
  const cancelAiActivity = vi.fn();
  const cancelBrainstorm = vi.fn();
  let streamStartCb: ((id: string) => void) | null = null;
  let chunkCb: ((chunk: string) => void) | null = null;
  let activityCb: ((entries: { requestId: string }[]) => void) | null = null;
  const session: AgentSessionFile = {
    id: 's1',
    agent: 'brainstorm',
    startedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    turns: [],
  };
  (window as unknown as { api: Record<string, unknown> }).api = {
    cancelAiActivity,
    cancelBrainstorm,
    onBrainstormStreamStart: (cb: (id: string) => void) => {
      streamStartCb = cb;
      return () => { streamStartCb = null; };
    },
    onBrainstormChunk: (cb: (chunk: string) => void) => {
      chunkCb = cb;
      return () => { chunkCb = null; };
    },
    onAiActivityUpdate: (cb: (entries: { requestId: string }[]) => void) => {
      activityCb = cb;
      return () => { activityCb = null; };
    },
    agentSessions: {
      list: vi.fn().mockResolvedValue({ sessions: [] }),
      create: vi.fn().mockResolvedValue({ session, relPath: 'Sessions/x.md' }),
      read: vi.fn().mockResolvedValue({ session }),
      appendTurns: vi.fn().mockImplementation(async (_id: string, turns: AgentSessionTurn[]) => {
        session.turns = [...session.turns, ...turns];
        return { session: { ...session } };
      }),
      rename: vi.fn().mockResolvedValue({ ok: true }),
      duplicate: vi.fn().mockResolvedValue({ session, relPath: 'Sessions/x.md' }),
      delete: vi.fn().mockResolvedValue({ ok: true }),
    },
  };
  return {
    cancelAiActivity,
    cancelBrainstorm,
    fireStreamStart: (id: string) => streamStartCb?.(id),
    fireChunk: (chunk: string) => chunkCb?.(chunk),
    fireActivity: (entries: { requestId: string }[]) => activityCb?.(entries),
    session,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  __resetAgentSessionStores();
});

afterEach(() => {
  vi.useRealTimers();
  __resetAgentSessionStores();
  delete (window as unknown as { api?: unknown }).api;
});

describe('useMiniAgentChat N4 cancel/stall main abort', () => {
  it('Cancel aborts the in-flight request in MAIN via cancelAiActivity', async () => {
    const api = installApi();
    let resolveInvoke: (v: string) => void = () => {};
    const invoke = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveInvoke = resolve;
        }),
    );

    const { result } = renderHook(() => useMiniAgentChat('brainstorm', invoke));
    await act(async () => { await Promise.resolve(); });

    act(() => {
      void result.current.send('Hello partner');
    });
    await act(async () => { await Promise.resolve(); });
    expect(result.current.busy).toBe(true);

    act(() => {
      api.fireStreamStart('req-main-uuid-1');
    });

    act(() => {
      result.current.cancel();
    });

    expect(api.cancelAiActivity).toHaveBeenCalledWith('req-main-uuid-1');
    expect(result.current.busy).toBe(false);
    expect(result.current.error).toMatch(/cancelled/i);

    await act(async () => {
      resolveInvoke('late reply');
      await Promise.resolve();
    });
    expect(result.current.messages.every((m) => m.text !== 'late reply')).toBe(true);
  });

  it('hard stall timeout aborts in MAIN via cancelAiActivity', async () => {
    const api = installApi();
    const invoke = vi.fn(() => new Promise<string>(() => { /* never resolves */ }));

    const { result } = renderHook(() => useMiniAgentChat('brainstorm', invoke));
    await act(async () => { await Promise.resolve(); });

    act(() => {
      void result.current.send('Hung prompt');
    });
    await act(async () => { await Promise.resolve(); });

    act(() => {
      api.fireStreamStart('req-stall-uuid');
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(STALL_WARNING_MS);
    });
    expect(result.current.stalled).toBe(true);
    expect(api.cancelAiActivity).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(HARD_TIMEOUT_MS - STALL_WARNING_MS + 1);
    });

    expect(api.cancelAiActivity).toHaveBeenCalledWith('req-stall-uuid');
    expect(result.current.busy).toBe(false);
    expect(result.current.error).toMatch(/timed out/i);
  });

  it('Critic hard 2: Cancel ignores a newer app-wide activity entry (binds stream-start id)', async () => {
    const api = installApi();
    const invoke = vi.fn(() => new Promise<string>(() => { /* hang */ }));
    const { result } = renderHook(() => useMiniAgentChat('brainstorm', invoke));
    await act(async () => { await Promise.resolve(); });

    act(() => { void result.current.send('mine'); });
    await act(async () => { await Promise.resolve(); });
    act(() => { api.fireStreamStart('req-mine'); });
    act(() => {
      api.fireActivity([
        { requestId: 'req-mine' },
        { requestId: 'req-other-window' },
      ]);
    });

    act(() => { result.current.cancel(); });
    expect(api.cancelAiActivity).toHaveBeenCalledWith('req-mine');
    expect(api.cancelAiActivity).not.toHaveBeenCalledWith('req-other-window');
  });

  it('Critic hard 3: streamed chunks re-arm the hard timeout (slow healthy reply survives)', async () => {
    const api = installApi();
    const invoke = vi.fn(() => new Promise<string>(() => { /* hang */ }));
    const { result } = renderHook(() => useMiniAgentChat('brainstorm', invoke));
    await act(async () => { await Promise.resolve(); });

    act(() => { void result.current.send('slow'); });
    await act(async () => { await Promise.resolve(); });
    act(() => { api.fireStreamStart('req-slow'); });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(HARD_TIMEOUT_MS - 5_000);
    });
    expect(api.cancelAiActivity).not.toHaveBeenCalled();
    act(() => { api.fireChunk('…still going'); });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(HARD_TIMEOUT_MS - 5_000);
    });
    expect(api.cancelAiActivity).not.toHaveBeenCalled();
    expect(result.current.busy).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(api.cancelAiActivity).toHaveBeenCalledWith('req-slow');
  });

  it('Critic N2: history sent to invoke strips raw Full Analysis card JSON', async () => {
    const api = installApi();
    const card = encodeCoachCard({
      kind: 'analysis',
      title: 'Full Scene Analysis — Sc. 1 · Harbor',
      computed: [['Words', '12']],
      read: [['Purpose', 'Setup']],
      takeaway: 'Lean into the quay fog.',
    });
    const invoke = vi.fn().mockResolvedValue('ok');
    const { result } = renderHook(() => useMiniAgentChat('brainstorm', invoke));
    await act(async () => { await Promise.resolve(); });

    // Seed a trusted analysis card into the live session (not the pending greeting alone).
    await act(async () => {
      await result.current.store.appendTurns([
        {
          role: 'agent',
          text: card,
          at: '2026-01-01T00:00:00.000Z',
          cardKind: 'analysis',
          cardTitle: 'Full Scene Analysis — Sc. 1 · Harbor',
        },
      ]);
    });

    await act(async () => {
      await result.current.send('follow up');
    });

    expect(invoke).toHaveBeenCalled();
    const history = invoke.mock.calls[0][1] as { content: string }[];
    const analysisEntry = history.find((h) => h.content.includes('Full Scene Analysis') || h.content.includes('quay fog'));
    expect(analysisEntry).toBeTruthy();
    expect(analysisEntry!.content).not.toContain('mythos:coach-card');
    expect(analysisEntry!.content).not.toMatch(/\{"kind":"analysis"/);
    expect(analysisEntry!.content).toContain('Lean into the quay fog');
    void api;
  });
});
