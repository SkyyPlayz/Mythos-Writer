// SKY-6228: M15 — unit tests for useAgentSessions hook
// Tests session rename/duplicate/delete-last behaviours (§11 contract)

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAgentSessions } from './useAgentSessions';

// Mock window.api.agentSessions
function makeMockSession(overrides: Partial<AgentSessionFile> = {}): AgentSessionFile {
  return {
    id: 'test-session-1',
    agent: 'coach',
    title: 'Session 1',
    startedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    turns: [],
    ...overrides,
  };
}

function makeSummary(session: AgentSessionFile, relPath = 'Sessions/test.md'): AgentSessionSummary {
  return {
    id: session.id,
    agent: session.agent,
    title: session.title,
    startedAt: session.startedAt,
    updatedAt: session.updatedAt,
    turnCount: session.turns.length,
    relPath,
  };
}

function setupMockApi(sessions: AgentSessionFile[]) {
  const summaries = sessions.map((s) => makeSummary(s));

  const mockApi = {
    list: vi.fn().mockResolvedValue({ sessions: summaries }),
    create: vi.fn().mockImplementation(async (agent: string, title?: string, greeting?: string) => {
      const s = makeMockSession({
        id: 'new-session-' + Date.now(),
        agent,
        title: title ?? 'New session',
        turns: greeting ? [{ role: 'agent' as const, text: greeting, at: new Date().toISOString() }] : [],
      });
      return { session: s, relPath: `Sessions/${s.id}.md` };
    }),
    rename: vi.fn().mockResolvedValue({ ok: true }),
    duplicate: vi.fn().mockImplementation(async (sessionId: string) => {
      const src = sessions.find((s) => s.id === sessionId);
      if (!src) throw new Error('not found');
      const copy = makeMockSession({ ...src, id: `${src.id}-copy`, title: `${src.title ?? 'Session'} (copy)` });
      return { session: copy, relPath: `Sessions/${copy.id}.md` };
    }),
    delete: vi.fn().mockImplementation(async (sessionId: string) => {
      const remaining = sessions.filter((s) => s.id !== sessionId);
      if (remaining.length === 0) {
        const rep = makeMockSession({ id: 'auto-replacement', agent: 'coach', title: undefined });
        return { ok: true, replacement: rep, replacementRelPath: `Sessions/${rep.id}.md` };
      }
      return { ok: true };
    }),
    appendTurns: vi.fn().mockImplementation(async (sessionId: string, turns: AgentSessionTurn[]) => {
      const s = sessions.find((x) => x.id === sessionId) ?? makeMockSession();
      return { session: { ...s, turns: [...s.turns, ...turns] } };
    }),
  };

  (window as unknown as Record<string, unknown>).api = { agentSessions: mockApi };
  return mockApi;
}

describe('useAgentSessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('auto-creates a session when none exist', async () => {
    const emptyApi = {
      list: vi.fn().mockResolvedValue({ sessions: [] }),
      create: vi.fn().mockResolvedValue({
        session: makeMockSession({ id: 'auto-1' }),
        relPath: 'Sessions/auto-1.md',
      }),
      rename: vi.fn(),
      duplicate: vi.fn(),
      delete: vi.fn(),
      appendTurns: vi.fn(),
    };
    (window as unknown as Record<string, unknown>).api = { agentSessions: emptyApi };

    const { result } = renderHook(() => useAgentSessions('coach'));
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

    expect(emptyApi.create).toHaveBeenCalledWith('coach', undefined, expect.any(String));
    expect(result.current.sessions).toHaveLength(1);
    expect(result.current.activeSessionId).toBe('auto-1');
  });

  it('renames a session and updates local state', async () => {
    const s1 = makeMockSession({ id: 's1', title: 'Old name' });
    const mockApi = setupMockApi([s1]);
    const { result } = renderHook(() => useAgentSessions('coach'));
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

    await act(async () => {
      await result.current.renameSession('s1', 'New name');
    });

    expect(mockApi.rename).toHaveBeenCalledWith('s1', 'New name');
    const renamed = result.current.sessions.find((s) => s.id === 's1');
    expect(renamed?.title).toBe('New name');
  });

  it('duplicates a session and switches to the copy', async () => {
    const s1 = makeMockSession({ id: 's1', title: 'Original' });
    setupMockApi([s1]);
    const { result } = renderHook(() => useAgentSessions('coach'));
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

    await act(async () => {
      await result.current.duplicateSession('s1');
    });

    expect(result.current.sessions).toHaveLength(2);
    const copy = result.current.sessions.find((s) => s.title?.includes('(copy)'));
    expect(copy).toBeDefined();
    expect(result.current.activeSessionId).toBe(copy?.id);
  });

  it('§11 delete-last: auto-creates a replacement when last session is deleted', async () => {
    const s1 = makeMockSession({ id: 'only-session' });
    setupMockApi([s1]);
    const { result } = renderHook(() => useAgentSessions('coach'));
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

    await act(async () => {
      await result.current.deleteSession('only-session');
    });

    // After deleting the last session a replacement must be present
    expect(result.current.sessions.length).toBeGreaterThanOrEqual(1);
    const rep = result.current.sessions.find((s) => s.id === 'auto-replacement');
    expect(rep).toBeDefined();
    expect(result.current.activeSessionId).toBe('auto-replacement');
  });

  it('appends turns and updates session state', async () => {
    const s1 = makeMockSession({ id: 's1' });
    setupMockApi([s1]);
    const { result } = renderHook(() => useAgentSessions('coach'));
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

    const turn: AgentSessionTurn = { role: 'user', text: 'Hello', at: '2026-01-01T01:00:00.000Z' };
    await act(async () => {
      await result.current.appendTurns([turn]);
    });

    expect(result.current.activeSession?.turns).toHaveLength(1);
    expect(result.current.activeSession?.turns[0].text).toBe('Hello');
  });
});

// CF-10 ("dismissed suggestions never resurface") is a Suggestion Inbox
// behaviour, not a session-store one — its real regression coverage lives
// against the actual production code path: SuggestionReview.test.tsx
// ("reject button calls IPC and removes row from inbox") for the frontend,
// and electron-main/src/suggestions.test.ts ("proposed → rejected" / listing
// by status) for the DB-level terminal-status guarantee. See also
// AgentHubPanel.test.tsx for the hub preview card's poll-level regression.
