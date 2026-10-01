import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useMiniAgentChat, MAX_HISTORY_TURNS } from './timeline2/panel/useMiniAgentChat';
import { __resetAgentSessionStores, getAgentSessionStore, useAgentSessions } from './lib/useAgentSessions';
import {
  PARTNER_SESSION_AGENT,
  buildPartnerGreeting,
  setPartnerGreetingName,
  DEFAULT_PARTNER_DISPLAY_NAME,
} from './agents/partnerIdentity';
import { invokeBrainstorm } from './timeline2/panel/BrainstormTab';
import { useCoachConversation } from './coach/useCoachConversation';
import type { Scene } from './types';

/** Seed enough turns that an uncapped send would exceed MAX_HISTORY_TURNS (Shield: 60 ≠ 20). */
const OVER_CAP_EXCHANGES = MAX_HISTORY_TURNS + 10; // 30 × (user+agent) = 60 turns

function installAccumulatingSessionApi(opts?: {
  agentBrainstorm?: ReturnType<typeof vi.fn>;
  agentWritingAssistant?: ReturnType<typeof vi.fn>;
  settings?: AppSettings;
}) {
  const session: AgentSessionFile = {
    id: 's-partner',
    agent: 'brainstorm',
    title: 'Chat',
    turns: [],
    startedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  const agentBrainstorm = opts?.agentBrainstorm ?? vi.fn().mockResolvedValue({ text: 'ok' });
  const agentWritingAssistant = opts?.agentWritingAssistant ?? vi.fn().mockResolvedValue({ text: 'coach-ok' });
  const settings = opts?.settings ?? {
    provider: { kind: 'ollama', model: 'local-model' },
    agents: {
      writingAssistant: {
        enabled: true,
        model: 'local-model',
        provider: { kind: 'ollama', model: 'local-model' },
      },
      brainstorm: {
        enabled: true,
        model: 'claude-haiku',
        provider: { kind: 'anthropic', model: 'claude-haiku' },
      },
      archive: { enabled: true, model: 'x' },
      betaReader: {
        enabled: true,
        model: 'local-model',
        provider: { kind: 'ollama', model: 'local-model' },
      },
    },
  } as AppSettings;

  (window as unknown as { api: Record<string, unknown> }).api = {
    settingsGet: vi.fn().mockResolvedValue(settings),
    agentSessions: {
      list: vi.fn().mockResolvedValue({ sessions: [] }),
      read: vi.fn().mockResolvedValue({ session: null }),
      create: vi.fn().mockImplementation(async (_agent: string, _title?: string, greeting?: string, id?: string) => {
        session.id = id ?? session.id;
        if (greeting) {
          session.turns = [{ role: 'agent', text: greeting, at: new Date().toISOString() }];
        }
        return { session: { ...session, turns: [...session.turns] }, relPath: 'Sessions/x.md' };
      }),
      // Keep EVERY appended turn — a mock that returns only `turns` makes the
      // history-cap test unable to fail (Shield BLOCK on tip aec7baa1).
      appendTurns: vi.fn().mockImplementation(async (id: string, turns: AgentSessionTurn[]) => {
        session.id = id;
        session.turns = [...session.turns, ...turns];
        session.updatedAt = new Date().toISOString();
        return { session: { ...session, turns: [...session.turns] } };
      }),
      rename: vi.fn().mockResolvedValue({ ok: true }),
      duplicate: vi.fn().mockResolvedValue({ session: { ...session }, relPath: 'Sessions/y.md' }),
      delete: vi.fn().mockResolvedValue({ ok: true }),
    },
    agentBrainstorm,
    agentWritingAssistant,
  };
  return { session, agentBrainstorm, agentWritingAssistant };
}

describe('F3#1 shared partner thread + history cap', () => {
  beforeEach(() => {
    __resetAgentSessionStores();
    setPartnerGreetingName(DEFAULT_PARTNER_DISPLAY_NAME);
    installAccumulatingSessionApi();
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

  it('partner greeting uses display name + partner copy (not Brainstorm Agent)', async () => {
    setPartnerGreetingName('Athena');
    const { result } = renderHook(() => useAgentSessions(PARTNER_SESSION_AGENT));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const greeting = result.current.activeSession?.turns[0]?.text ?? '';
    expect(greeting).toContain("Hi! I'm Athena");
    expect(greeting).toContain('writing partner');
    expect(greeting).not.toMatch(/Brainstorm Agent|vault curator/i);
    expect(buildPartnerGreeting('Athena')).toBe(greeting);
  });

  it('history sent to invoke is exactly MAX_HISTORY_TURNS with newest last (security bar c)', async () => {
    const invoke = vi.fn().mockResolvedValue('reply');
    const { result } = renderHook(() => useMiniAgentChat(PARTNER_SESSION_AGENT, invoke));
    await waitFor(() => expect(result.current.store.loading).toBe(false));

    await act(async () => {
      for (let i = 0; i < OVER_CAP_EXCHANGES; i++) {
        await result.current.postActionResult(`user-${i}`, `agent-${i}`);
      }
    });

    const totalBeforeSend = result.current.store.activeSession?.turns.length ?? 0;
    expect(totalBeforeSend).toBeGreaterThan(MAX_HISTORY_TURNS);

    await act(async () => {
      await result.current.send('final prompt');
    });

    expect(invoke).toHaveBeenCalled();
    const history = invoke.mock.calls[0][1] as { role: string; content: string }[];
    expect(history.length).toBe(MAX_HISTORY_TURNS);
    expect(history[history.length - 1]?.content).toBe(`agent-${OVER_CAP_EXCHANGES - 1}`);
    expect(history[history.length - 1]?.role).toBe('assistant');
  });

  it('Coach send path caps history at exactly MAX_HISTORY_TURNS with newest last', async () => {
    const agentWritingAssistant = vi.fn().mockResolvedValue({ text: 'coach-reply' });
    const agentBrainstorm = vi.fn().mockResolvedValue({ text: 'should-not-run' });
    installAccumulatingSessionApi({ agentWritingAssistant, agentBrainstorm });
    __resetAgentSessionStores();

    const scene = {
      id: 'sc1',
      title: 'Harbor',
      path: 'scenes/sc1.md',
      order: 0,
      blocks: [{ id: 'b1', type: 'prose' as const, content: 'Fog rolled in from the quay.', order: 0, updatedAt: '2026-01-01T00:00:00.000Z' }],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } satisfies Scene;

    const { result } = renderHook(() => useCoachConversation(scene));
    await waitFor(() => expect(result.current.store.loading).toBe(false));

    await act(async () => {
      for (let i = 0; i < OVER_CAP_EXCHANGES; i++) {
        await result.current.store.appendTurns([
          { role: 'user', text: `coach-user-${i}`, at: new Date().toISOString() },
          { role: 'agent', text: `coach-agent-${i}`, at: new Date().toISOString() },
        ]);
      }
    });

    expect((result.current.store.activeSession?.turns.length ?? 0)).toBeGreaterThan(MAX_HISTORY_TURNS);

    await act(async () => {
      await result.current.send('final coach prompt');
    });

    expect(agentWritingAssistant).toHaveBeenCalled();
    expect(agentBrainstorm).not.toHaveBeenCalled();
    const [prompt, context] = agentWritingAssistant.mock.calls[0] as [string, string | undefined];
    expect(context).toContain('Fog rolled in from the quay');

    // Shield S1 — pin exact window + order (split on blank lines).
    const entries = prompt.split(/\n\n/);
    expect(entries).toHaveLength(MAX_HISTORY_TURNS + 1);
    expect(entries[0]).toBe(`User: coach-user-${OVER_CAP_EXCHANGES - MAX_HISTORY_TURNS / 2}`);
    expect(entries[19]).toBe(`Coach: coach-agent-${OVER_CAP_EXCHANGES - 1}`);
    expect(entries[20]).toBe('User: final coach prompt');
    expect(prompt).not.toContain('coach-user-0');
  });

  it('invokeBrainstorm is the hub/timeline chat send path (re-export smoke)', () => {
    expect(typeof invokeBrainstorm).toBe('function');
    expect(MAX_HISTORY_TURNS).toBe(20);
  });

  it('Ivy hard 7: legacy coach + beta-reader sessions appear in partner picker and open', async () => {
    const coachSession: AgentSessionFile = {
      id: 'legacy-coach-1',
      agent: 'coach',
      title: 'Old Coach thread',
      turns: [
        { role: 'user', text: 'How is pacing?', at: '2026-01-01T00:00:00.000Z' },
        { role: 'agent', text: 'Tighten the middle.', at: '2026-01-01T00:01:00.000Z' },
      ],
      startedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:01:00.000Z',
    };
    const betaSession: AgentSessionFile = {
      id: 'legacy-beta-1',
      agent: 'beta-reader',
      title: 'Old Beta thread',
      turns: [{ role: 'agent', text: 'Felt rushed at the end.', at: '2026-01-02T00:00:00.000Z' }],
      startedAt: '2026-01-02T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    };
    const archiveOnly: AgentSessionSummary = {
      id: 'archive-only',
      agent: 'archive',
      title: 'Archive chat',
      startedAt: '2026-01-03T00:00:00.000Z',
      updatedAt: '2026-01-03T00:00:00.000Z',
      turnCount: 1,
      relPath: 'Sessions/archive.md',
    };
    const allSummaries: AgentSessionSummary[] = [
      {
        id: coachSession.id,
        agent: 'coach',
        title: coachSession.title,
        startedAt: coachSession.startedAt,
        updatedAt: coachSession.updatedAt,
        turnCount: coachSession.turns.length,
        relPath: 'Sessions/coach.md',
      },
      {
        id: betaSession.id,
        agent: 'beta-reader',
        title: betaSession.title,
        startedAt: betaSession.startedAt,
        updatedAt: betaSession.updatedAt,
        turnCount: betaSession.turns.length,
        relPath: 'Sessions/beta.md',
      },
      archiveOnly,
    ];
    const files: Record<string, AgentSessionFile> = {
      [coachSession.id]: coachSession,
      [betaSession.id]: betaSession,
    };
    (window as unknown as { api: Record<string, unknown> }).api = {
      agentSessions: {
        list: vi.fn(async (agent?: string) => ({
          sessions: agent
            ? allSummaries.filter((s) => s.agent === agent)
            : allSummaries,
        })),
        read: vi.fn(async (id: string) => ({ session: files[id] ?? null })),
        create: vi.fn(),
        appendTurns: vi.fn(),
        rename: vi.fn().mockResolvedValue({ ok: true }),
        duplicate: vi.fn(),
        delete: vi.fn().mockResolvedValue({ ok: true }),
      },
    };
    __resetAgentSessionStores();

    const { result } = renderHook(() => useAgentSessions(PARTNER_SESSION_AGENT));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const ids = result.current.sessions.map((s) => s.id);
    expect(ids).toContain('legacy-coach-1');
    expect(ids).toContain('legacy-beta-1');
    expect(ids).not.toContain('archive-only');

    await act(async () => {
      await result.current.switchSession('legacy-coach-1');
    });
    expect(result.current.activeSessionId).toBe('legacy-coach-1');
    expect(result.current.activeSession?.turns[1]?.text).toBe('Tighten the middle.');
    // Disk agent key unchanged — no migrate/rename.
    expect(result.current.activeSession?.agent).toBe('coach');
  });
});
