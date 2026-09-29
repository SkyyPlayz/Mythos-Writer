import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useMiniAgentChat, MAX_HISTORY_TURNS } from './timeline2/panel/useMiniAgentChat';
import { __resetAgentSessionStores, getAgentSessionStore, useAgentSessions } from './lib/useAgentSessions';
import { PARTNER_SESSION_AGENT } from './agents/partnerIdentity';
import { invokeBrainstorm } from './timeline2/panel/BrainstormTab';

describe('F3#1 shared partner thread + history cap', () => {
  beforeEach(() => {
    __resetAgentSessionStores();
    (window as unknown as { api: Record<string, unknown> }).api = {
    agentSessions: {
      list: vi.fn().mockResolvedValue({ sessions: [] }),
      read: vi.fn().mockResolvedValue({ session: null }),
      create: vi.fn().mockImplementation(async () => ({
        session: {
          id: 's-partner',
          agent: 'brainstorm',
          title: 'Chat',
          turns: [],
          startedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        relPath: 'Sessions/x.md',
      })),
      appendTurns: vi.fn().mockImplementation(async (id: string, turns: AgentSessionTurn[]) => ({
        session: {
          id,
          agent: 'brainstorm',
          title: 'Chat',
          turns,
          startedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      })),
      rename: vi.fn().mockResolvedValue({ ok: true }),
      duplicate: vi.fn().mockResolvedValue({ session: { id: 's2' }, relPath: 'Sessions/y.md' }),
      delete: vi.fn().mockResolvedValue({ ok: true }),
    },
      agentBrainstorm: vi.fn().mockResolvedValue({ text: 'ok' }),
    };
  });
  afterEach(() => {
    delete (window as unknown as { api?: unknown }).api;
  });

  it('hub + coach hooks share the same PARTNER_SESSION_AGENT store / session id', async () => {
    const hub = renderHook(() => useAgentSessions(PARTNER_SESSION_AGENT));
    const coach = renderHook(() => useAgentSessions(PARTNER_SESSION_AGENT));
    await waitFor(() => expect(hub.result.current.loading).toBe(false));
    await act(async () => {
      await hub.result.current.newSession('hi');
    });
    expect(hub.result.current.activeSessionId).toBeTruthy();
    expect(coach.result.current.activeSessionId).toBe(hub.result.current.activeSessionId);
    expect(getAgentSessionStore(PARTNER_SESSION_AGENT)).toBe(
      getAgentSessionStore(PARTNER_SESSION_AGENT),
    );
  });

  it('history sent to invoke is capped at MAX_HISTORY_TURNS (security bar c)', async () => {
    const invoke = vi.fn().mockResolvedValue('reply');
    const { result } = renderHook(() => useMiniAgentChat(PARTNER_SESSION_AGENT, invoke));
    await waitFor(() => expect(result.current.store.loading).toBe(false));

    // Seed more turns than the cap via postActionResult + append.
    await act(async () => {
      for (let i = 0; i < MAX_HISTORY_TURNS + 8; i++) {
        await result.current.postActionResult(`user-${i}`, `agent-${i}`.padEnd(200, 'x'));
      }
    });

    await act(async () => {
      await result.current.send('final prompt');
    });

    expect(invoke).toHaveBeenCalled();
    const history = invoke.mock.calls[0][1] as { role: string; content: string }[];
    expect(history.length).toBeLessThanOrEqual(MAX_HISTORY_TURNS);
  });

  it('invokeBrainstorm is the only chat send path (re-export smoke)', () => {
    expect(typeof invokeBrainstorm).toBe('function');
    expect(MAX_HISTORY_TURNS).toBe(20);
  });
});
