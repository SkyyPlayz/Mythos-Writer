// SKY-11223 — aiActivity store: renderer-side mirror of the shared
// AiActivityRegistry pushed from main. Verifies the push channel drives the
// snapshot, per-agent filtering works, and cancel calls through.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import {
  useAiActivities,
  useIsAgentActive,
  useAnyAiActivityRunning,
  useRecentAiActivityTerminals,
  useAgentRunningEntry,
  useAgentRecentTerminal,
  cancelAiActivity,
  resetAiActivityForTests,
} from './aiActivity';

function makeEntry(overrides: Partial<AiActivityEntry> = {}): AiActivityEntry {
  return {
    requestId: 'req-1',
    agent: 'brainstorm',
    agentLabel: 'Brainstorm Agent',
    surface: 'brainstorm-chat',
    surfaceLabel: 'Brainstorm chat',
    provider: { kind: 'lmstudio', model: 'qwen3.6-35b-a3b' },
    startedAt: Date.now(),
    ...overrides,
  };
}

describe('aiActivity store', () => {
  let updateListener: (entries: AiActivityEntry[]) => void;
  let terminalListener: (event: AiActivityTerminalEvent) => void;
  let cancelSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetAiActivityForTests();
    cancelSpy = vi.fn();
    (window as any).api = {
      getAiActivitySnapshot: vi.fn().mockResolvedValue([]),
      onAiActivityUpdate: (cb: (entries: AiActivityEntry[]) => void) => {
        updateListener = cb;
        return () => {};
      },
      onAiActivityTerminal: (cb: (event: AiActivityTerminalEvent) => void) => {
        terminalListener = cb;
        return () => {};
      },
      cancelAiActivity: cancelSpy,
    };
  });

  // Every test's first render kicks off the (mocked) getAiActivitySnapshot()
  // fetch-on-subscribe; flushing it under act() before asserting keeps React
  // from reporting a state update outside act() once that promise resolves.
  async function flush(): Promise<void> {
    await act(async () => {
      await Promise.resolve();
    });
  }

  it('starts empty and is idle', async () => {
    const { result } = renderHook(() => useAnyAiActivityRunning());
    await flush();
    expect(result.current).toBe(false);
  });

  it('picks up the initial snapshot on first subscribe', async () => {
    (window as any).api.getAiActivitySnapshot = vi.fn().mockResolvedValue([makeEntry()]);
    const { result } = renderHook(() => useAiActivities());
    await waitFor(() => expect(result.current).toHaveLength(1));
  });

  it('reflects a pushed update naming agent, surface, and provider', async () => {
    const { result } = renderHook(() => useAiActivities());
    await flush();
    act(() => {
      updateListener([makeEntry({ requestId: 'req-2', agent: 'writingAssistant', surfaceLabel: 'Writing Coach' })]);
    });
    expect(result.current).toEqual([
      expect.objectContaining({ requestId: 'req-2', agent: 'writingAssistant', surfaceLabel: 'Writing Coach' }),
    ]);
  });

  it('filters by agent for status-dot consumers', async () => {
    const { result } = renderHook(() => useIsAgentActive('betaReader'));
    await flush();
    expect(result.current).toBe(false);

    act(() => {
      updateListener([makeEntry({ agent: 'brainstorm' })]);
    });
    expect(result.current).toBe(false);

    act(() => {
      updateListener([makeEntry({ agent: 'betaReader' })]);
    });
    expect(result.current).toBe(true);
  });

  it('clears back to idle when the snapshot empties out (success/error/cancel all converge here)', async () => {
    const { result } = renderHook(() => useAnyAiActivityRunning());
    await flush();
    act(() => { updateListener([makeEntry()]); });
    expect(result.current).toBe(true);

    act(() => { updateListener([]); });
    expect(result.current).toBe(false);
  });

  it('surfaces a terminal outcome instead of going silent', async () => {
    const { result } = renderHook(() => useRecentAiActivityTerminals());
    await flush();
    act(() => {
      terminalListener({
        requestId: 'req-1',
        agent: 'writingAssistant',
        agentLabel: 'Writing Coach',
        surface: 'writing-coach',
        surfaceLabel: 'Writing Coach',
        status: 'empty',
        reason: null,
        endedAt: Date.now(),
      });
    });
    expect(result.current).toEqual([
      expect.objectContaining({ requestId: 'req-1', status: 'empty' }),
    ]);
  });

  it('useAgentRunningEntry returns only this agent\'s running request', async () => {
    const { result } = renderHook(() => useAgentRunningEntry('archive'));
    await flush();
    act(() => { updateListener([makeEntry({ agent: 'brainstorm' })]); });
    expect(result.current).toBeNull();

    act(() => { updateListener([makeEntry({ agent: 'archive', requestId: 'req-archive' })]); });
    expect(result.current?.requestId).toBe('req-archive');
  });

  it('useAgentRecentTerminal returns the latest finished request for that agent', async () => {
    const { result } = renderHook(() => useAgentRecentTerminal('betaReader'));
    await flush();
    act(() => {
      terminalListener({
        requestId: 'req-a',
        agent: 'betaReader',
        agentLabel: 'Beta Reader',
        surface: 'beta-reader-scan',
        surfaceLabel: 'Beta Reader — scene scan',
        status: 'error',
        reason: 'Connection refused',
        endedAt: Date.now(),
      });
    });
    expect(result.current).toEqual(
      expect.objectContaining({ requestId: 'req-a', status: 'error', reason: 'Connection refused' }),
    );
  });

  it('cancelAiActivity calls through to window.api with the requestId', () => {
    cancelAiActivity('req-9');
    expect(cancelSpy).toHaveBeenCalledWith('req-9');
  });
});
