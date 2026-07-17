// SKY-6228: M15 — unit tests for useAgentSessions hook
// Tests session rename/duplicate/delete-last behaviours (§11 contract)
// M12: the store is shared per agent key — reset between tests.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAgentSessions, __resetAgentSessionStores } from './useAgentSessions';

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
    __resetAgentSessionStores();
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

  // M12: Coach page ↔ Coach panel chat render one conversation — two hook
  // instances on the same agent key must share sessions, active id, AND turns.
  it('M12: two hook instances share one store (turns visible on both surfaces)', async () => {
    const s1 = makeMockSession({ id: 's1', title: 'Shared thread' });
    setupMockApi([s1]);
    const page = renderHook(() => useAgentSessions('coach'));
    const panel = renderHook(() => useAgentSessions('coach'));
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

    const turn: AgentSessionTurn = { role: 'user', text: 'Teach me pacing', at: '2026-01-01T01:00:00.000Z' };
    await act(async () => {
      await page.result.current.appendTurns([turn]);
    });

    expect(panel.result.current.activeSession?.turns.map((t) => t.text)).toEqual(['Teach me pacing']);
    expect(panel.result.current.activeSessionId).toBe(page.result.current.activeSessionId);

    // Renaming from the panel is visible on the page.
    await act(async () => {
      await panel.result.current.renameSession('s1', 'Lesson thread');
    });
    expect(page.result.current.sessions.find((s) => s.id === 's1')?.title).toBe('Lesson thread');
  });

  // M12: mounting onto an EXISTING session hydrates its stored turns via
  // agentSession:read so the feed shows history (not just the summary).
  it('M12: hydrates existing session turns via read()', async () => {
    const s1 = makeMockSession({
      id: 's1',
      turns: [{ role: 'agent', text: 'Welcome back', at: '2026-01-01T00:00:00.000Z' }],
    });
    const mockApi = setupMockApi([s1]);
    (mockApi as unknown as Record<string, unknown>).read = vi.fn().mockResolvedValue({ session: s1 });

    const { result } = renderHook(() => useAgentSessions('coach'));
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

    expect(result.current.activeSessionId).toBe('s1');
    expect(result.current.activeSession?.turns.map((t) => t.text)).toEqual(['Welcome back']);
  });

  it('M12: degrades to summaries-only when preload lacks read()', async () => {
    const s1 = makeMockSession({ id: 's1' });
    setupMockApi([s1]); // no read()
    const { result } = renderHook(() => useAgentSessions('coach'));
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

    expect(result.current.activeSessionId).toBe('s1');
    expect(result.current.activeSession).toBeNull();
  });

  // SKY-7076 (gh-960 gap): switchSession/appendTurns must never misattribute
  // an in-flight exchange to the wrong session, and the feed must reflect
  // whichever session is CURRENTLY selected, never a stale one.
  describe('SKY-7076: session switching', () => {
    it('hydrates the newly selected session via read() on switch', async () => {
      const s1 = makeMockSession({ id: 's1', turns: [{ role: 'user', text: 'in s1', at: 't1' }] });
      const s2 = makeMockSession({ id: 's2', turns: [{ role: 'user', text: 'in s2', at: 't2' }] });
      const mockApi = setupMockApi([s1, s2]);
      const readMock = vi.fn().mockImplementation(
        async (id: string) => ({ session: [s1, s2].find((s) => s.id === id) }),
      );
      (mockApi as unknown as Record<string, unknown>).read = readMock;

      const { result } = renderHook(() => useAgentSessions('coach'));
      await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
      expect(result.current.activeSessionId).toBe('s1');

      await act(async () => {
        await result.current.switchSession('s2');
      });

      expect(readMock).toHaveBeenCalledWith('s2');
      expect(result.current.activeSessionId).toBe('s2');
      expect(result.current.activeSession?.turns.map((t) => t.text)).toEqual(['in s2']);
    });

    it('pins an in-flight appendTurns to the origin session, not wherever the user has switched to by the time it resolves', async () => {
      const s1 = makeMockSession({ id: 's1' });
      const s2 = makeMockSession({ id: 's2' });
      const mockApi = setupMockApi([s1, s2]);
      (mockApi as unknown as Record<string, unknown>).read = vi.fn().mockImplementation(
        async (id: string) => ({ session: [s1, s2].find((s) => s.id === id) }),
      );

      let resolveAppend!: (v: { session: AgentSessionFile }) => void;
      mockApi.appendTurns.mockImplementationOnce(
        () => new Promise((resolve) => { resolveAppend = resolve; }),
      );

      const { result } = renderHook(() => useAgentSessions('coach'));
      await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
      expect(result.current.activeSessionId).toBe('s1');

      const turn: AgentSessionTurn = { role: 'user', text: 'Asked from s1', at: '2026-01-01T02:00:00.000Z' };
      let appendPromise!: Promise<void>;
      act(() => {
        appendPromise = result.current.appendTurns([turn], 's1');
      });

      // The user switches away before the reply resolves.
      await act(async () => {
        await result.current.switchSession('s2');
      });
      expect(result.current.activeSessionId).toBe('s2');

      await act(async () => {
        resolveAppend({ session: { ...s1, turns: [...s1.turns, turn] } });
        await appendPromise;
      });

      // The write must land on the session it was asked from...
      expect(mockApi.appendTurns).toHaveBeenCalledWith('s1', [turn]);
      const s1Summary = result.current.sessions.find((s) => s.id === 's1');
      expect(s1Summary?.turnCount).toBe(1);
      // ...and must not clobber whatever the user is now looking at.
      expect(result.current.activeSessionId).toBe('s2');
      expect(result.current.activeSession?.id).not.toBe('s1');
    });

    it('rapid successive switches: a late-resolving stale read never clobbers the latest switch', async () => {
      const s1 = makeMockSession({ id: 's1', turns: [{ role: 'user', text: 's1 content', at: 't1' }] });
      const s2 = makeMockSession({ id: 's2', turns: [{ role: 'user', text: 's2 content', at: 't2' }] });
      const s3 = makeMockSession({ id: 's3', turns: [{ role: 'user', text: 's3 content', at: 't3' }] });
      const mockApi = setupMockApi([s1, s2, s3]);

      const pendingReads: Record<string, (v: { session: AgentSessionFile }) => void> = {};
      (mockApi as unknown as Record<string, unknown>).read = vi.fn().mockImplementation(
        (id: string) => new Promise((resolve) => { pendingReads[id] = resolve; }),
      );

      const { result } = renderHook(() => useAgentSessions('coach'));
      await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
      expect(result.current.activeSessionId).toBe('s1');

      // Switch s1 -> s2 -> s3 before either read has resolved.
      let switchToS3!: Promise<void>;
      act(() => { void result.current.switchSession('s2'); });
      act(() => { switchToS3 = result.current.switchSession('s3'); });

      // s2's read resolves late, after s3 was already requested — must be dropped.
      await act(async () => {
        pendingReads.s2({ session: s2 });
        await Promise.resolve();
      });
      expect(result.current.activeSession?.id).not.toBe('s2');
      expect(result.current.activeSessionId).toBe('s3');

      await act(async () => {
        pendingReads.s3({ session: s3 });
        await switchToS3;
      });

      expect(result.current.activeSessionId).toBe('s3');
      expect(result.current.activeSession?.turns.map((t) => t.text)).toEqual(['s3 content']);
    });
  });
});

// CF-10 ("dismissed suggestions never resurface") is a Suggestion Inbox
// behaviour, not a session-store one — its real regression coverage lives
// against the actual production code path: SuggestionReview.test.tsx
// ("reject button calls IPC and removes row from inbox") for the frontend,
// and electron-main/src/suggestions.test.ts ("proposed → rejected" / listing
// by status) for the DB-level terminal-status guarantee. See also
// AgentHubPanel.test.tsx for the hub preview card's poll-level regression.
