// SKY-6321: Agent hub — Suggestions card live preview + "See All Suggestions" wiring.
// Beta 4 M13: Scene Analysis card — computed local values + View Full Analysis.
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { vi, afterEach, beforeEach, describe, it, expect } from 'vitest';
import AgentHubPanel from './AgentHubPanel';
import { __resetAgentSessionStores } from './lib/useAgentSessions';
import { buildAnalysisCard, parseCoachRead } from './coach/sceneAnalysis';
import { decodeCoachCard, encodeCoachCard } from './coach/coachMessages';
import type { Scene } from './types';

function makeSuggestion(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 's1',
    kind: 'suggestion',
    sourceAgent: 'writing-assistant',
    confidence: 0.9,
    rationale: 'Tighten this paragraph.',
    targetPath: 'Scenes/Ch1.md',
    targetAnchor: null,
    status: 'proposed',
    createdAt: new Date().toISOString(),
    appliedAt: null,
    budgetExceeded: false,
    category: null,
    payloadJson: null,
    ...overrides,
  };
}

describe('AgentHubPanel — Suggestions card', () => {
  beforeEach(() => {
    __resetAgentSessionStores();
  });
  afterEach(() => {
    delete (window as any).api;
  });

  it('shows the empty state when there are no proposed suggestions', async () => {
    (window as any).api = {
      suggestionsUnifiedList: vi.fn().mockResolvedValue({ items: [], totalCount: 0 }),
    };

    render(<AgentHubPanel scene={null} />);

    expect(await screen.findByText(/No new suggestions/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/pending/i)).not.toBeInTheDocument();
  });

  it('renders live preview rows and a count badge when suggestions are proposed', async () => {
    (window as any).api = {
      suggestionsUnifiedList: vi.fn().mockResolvedValue({
        totalCount: 5,
        items: [
          {
            id: 's1',
            kind: 'suggestion',
            sourceAgent: 'writing-assistant',
            confidence: 0.82,
            rationale: 'Tighten this paragraph — it repeats the prior beat.',
            targetPath: 'Scenes/Ch1.md',
            targetAnchor: null,
            status: 'proposed',
            createdAt: new Date().toISOString(),
            appliedAt: null,
            budgetExceeded: false,
            category: null,
            payloadJson: null,
          },
        ],
      }),
    };

    render(<AgentHubPanel scene={null} />);

    expect(await screen.findByText(/Tighten this paragraph/)).toBeInTheDocument();
    expect(screen.getByText('82%')).toBeInTheDocument();
    expect(screen.getByLabelText('5 pending')).toHaveTextContent('5');
  });

  it('calls onOpenSuggestionInbox when "See All Suggestions" is clicked', async () => {
    (window as any).api = {
      suggestionsUnifiedList: vi.fn().mockResolvedValue({ items: [], totalCount: 0 }),
    };
    const onOpenSuggestionInbox = vi.fn();

    render(<AgentHubPanel scene={null} onOpenSuggestionInbox={onOpenSuggestionInbox} />);
    await screen.findByText(/No new suggestions/i);

    fireEvent.click(screen.getByRole('button', { name: /See All Suggestions/i }));

    expect(onOpenSuggestionInbox).toHaveBeenCalledTimes(1);
  });

  it('CF-10: a suggestion rejected/dismissed elsewhere is dropped and never resurfaces on the next poll', async () => {
    vi.useFakeTimers();
    try {
      const suggestionsUnifiedList = vi
        .fn()
        .mockResolvedValueOnce({ totalCount: 1, items: [makeSuggestion()] })
        // Simulates the suggestion's status flipping to the terminal 'rejected'
        // state between polls — status filtering (status: 'proposed') must
        // exclude it permanently, so the next poll returns nothing.
        .mockResolvedValue({ totalCount: 0, items: [] });
      (window as any).api = { suggestionsUnifiedList };

      await act(async () => {
        render(<AgentHubPanel scene={null} />);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(screen.getByText(/Tighten this paragraph\./)).toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });

      expect(screen.queryByText(/Tighten this paragraph\./)).not.toBeInTheDocument();
      expect(screen.getByText(/No new suggestions/i)).toBeInTheDocument();
      expect(suggestionsUnifiedList).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ── M13: Scene Analysis card (§5.4) ─────────────────────────────────────────

const AT = '2026-07-01T00:00:00.000Z';

function makeScene(): Scene {
  return {
    id: 'sc-1',
    title: 'Harbor Scene',
    path: 'stories/s1/chapters/c1/scenes/sc-1.md',
    order: 0,
    blocks: [
      {
        id: 'b1',
        type: 'prose',
        content: 'She took the stairs two at a time. Her lantern guttered in the wet dark below.',
        order: 0,
        updatedAt: AT,
      },
    ],
    createdAt: AT,
    updatedAt: AT,
  };
}

const GOOD_READ = parseCoachRead(JSON.stringify({
  purpose: 'Story progression — commits her to the descent',
  tension: 'Rising — climbs from the first step',
  pacing: 'Medium — evenly weighted',
  pov: 'Third limited — holds steady',
  takeaway: 'Strong opening movement.',
  drill: 'Drill: mark each paragraph D, A or T. 5 minutes.',
}))!;

/** Coach session store mock (same surface CoachPage.test.tsx uses). */
function installCoachApi(turns: AgentSessionTurn[] = [], chatResponse?: string) {
  const session: AgentSessionFile = {
    id: 'coach-s1', agent: 'coach', title: 'Thread',
    startedAt: AT, updatedAt: AT, turns,
  };
  const agentSessions = {
    list: vi.fn(async () => ({ sessions: [{ id: session.id, agent: 'coach', title: session.title, startedAt: AT, updatedAt: AT, turnCount: session.turns.length, relPath: 'Sessions/x.md' }] })),
    create: vi.fn(async () => ({ session, relPath: 'Sessions/x.md' })),
    rename: vi.fn(async () => ({ ok: true })),
    duplicate: vi.fn(async () => ({ session, relPath: 'Sessions/x.md' })),
    delete: vi.fn(async () => ({ ok: true })),
    read: vi.fn(async () => ({ session })),
    appendTurns: vi.fn(async (_id: string, newTurns: AgentSessionTurn[]) => {
      session.turns = [...session.turns, ...newTurns];
      return { session: { ...session } };
    }),
  };
  (window as any).api = {
    suggestionsUnifiedList: vi.fn().mockResolvedValue({ items: [], totalCount: 0 }),
    agentSessions,
    agentWritingAssistant: vi.fn(async () => ({ text: chatResponse ?? 'not json' })),
  };
  return { agentSessions, session };
}

describe('AgentHubPanel — Scene Analysis card (M13 §5.4)', () => {
  beforeEach(() => {
    __resetAgentSessionStores();
  });
  afterEach(() => {
    delete (window as any).api;
    document.querySelectorAll('[data-testid="ln-toast"]').forEach((el) => el.remove());
  });

  it('keeps the empty state when no scene is open', async () => {
    installCoachApi();
    render(<AgentHubPanel scene={null} />);
    expect(await screen.findByText(/Open a scene to see analysis/)).toBeInTheDocument();
    expect(screen.queryByTestId('view-full-analysis')).not.toBeInTheDocument();
  });

  it('renders computed values for the open scene with NO AI involved', async () => {
    installCoachApi();
    render(<AgentHubPanel scene={makeScene()} />);

    const rows = await screen.findByTestId('scene-analysis-rows');
    // Prototype 5848 row order.
    const keys = Array.from(rows.querySelectorAll('.ahp-analysis-row-k')).map((el) => el.textContent);
    expect(keys).toEqual(['Purpose', 'Tension', 'Pacing', 'POV', 'Word Count', 'Read Time']);

    // Computed: 16 words → count + floor read time; heuristics fill Pacing/POV.
    expect(screen.getByText('16')).toBeInTheDocument();
    expect(screen.getByText('~1 min')).toBeInTheDocument();
    expect(screen.getByText('Third person')).toBeInTheDocument();
    // Judgment rows are honestly blank until a Full Analysis has run.
    expect(rows.querySelectorAll('.ahp-analysis-row-v')[0].textContent).toBe('—');
    expect(rows.querySelectorAll('.ahp-analysis-row-v')[1].textContent).toBe('—');
    // One-line computed note + the button.
    expect(document.querySelector('.ahp-analysis-note')?.textContent).toBeTruthy();
    expect(screen.getByTestId('view-full-analysis')).toHaveTextContent('View Full Analysis');
    // The card never called the model on its own.
    expect((window as any).api.agentWritingAssistant).not.toHaveBeenCalled();
  });

  it('surfaces the newest persisted Coach’s Read for this scene (Purpose/Tension)', async () => {
    const scene = makeScene();
    const card = buildAnalysisCard(scene, GOOD_READ);
    installCoachApi([{ role: 'agent', text: encodeCoachCard(card), at: AT }]);
    render(<AgentHubPanel scene={scene} />);

    expect(await screen.findByText('Story progression')).toBeInTheDocument();
    expect(screen.getByText('Rising')).toBeInTheDocument();
    // Tension carries the prototype's hot styling once a value exists.
    expect(screen.getByText('Rising').className).toContain('ahp-analysis-row-v--hot');
  });

  it('View Full Analysis: runs the analysis into the coach session and navigates to the Coach page', async () => {
    const scene = makeScene();
    const { agentSessions } = installCoachApi([], JSON.stringify({
      purpose: 'Setup — plants the lantern',
      tension: 'Rising — narrow climb',
      pacing: 'Fast — short beats',
      pov: 'Third limited — tight',
      takeaway: 'Good bones.',
      drill: 'Drill: cut every sentence past 12 words in ¶1. 5 minutes.',
    }));
    const onOpenCoachPage = vi.fn();
    render(<AgentHubPanel scene={scene} onOpenCoachPage={onOpenCoachPage} />);

    fireEvent.click(await screen.findByTestId('view-full-analysis'));
    expect(onOpenCoachPage).toHaveBeenCalledTimes(1);

    await waitFor(() => expect(agentSessions.appendTurns).toHaveBeenCalledTimes(1));
    const [, turns] = agentSessions.appendTurns.mock.calls[0];
    const appended = decodeCoachCard(turns[0].text);
    expect(appended?.kind).toBe('analysis');
    if (appended?.kind !== 'analysis') return;
    expect(appended.title).toBe('Full Scene Analysis — Sc. 1 · Harbor Scene');
    expect(appended.computed).toHaveLength(6);
    expect(appended.read).toHaveLength(4);

    // Prototype toast (HTML 7266).
    await waitFor(() => expect(document.querySelector('[data-testid="ln-toast"]')).not.toBeNull());
  });

  it('acceptance: with AI erroring, View Full Analysis still lands a computed-only card', async () => {
    const scene = makeScene();
    const { agentSessions } = installCoachApi();
    ((window as any).api.agentWritingAssistant as ReturnType<typeof vi.fn>)
      .mockRejectedValue(new Error('Writing Coach is disabled in settings.'));
    render(<AgentHubPanel scene={scene} onOpenCoachPage={vi.fn()} />);

    fireEvent.click(await screen.findByTestId('view-full-analysis'));

    await waitFor(() => expect(agentSessions.appendTurns).toHaveBeenCalledTimes(1));
    const [, turns] = agentSessions.appendTurns.mock.calls[0];
    const appended = decodeCoachCard(turns[0].text);
    if (appended?.kind !== 'analysis') throw new Error('expected analysis card');
    expect(appended.computed).toHaveLength(6);
    expect(appended.read).toEqual([]);
    expect(appended.readNote).toContain('disabled in settings');
  });
});

// SKY-7113: Writing Coach session picker — hydrate on select, isolate
// new-chat, persist transcripts. Drives the real `useAgentSessions` store and
// `AgentSessionPicker` UI through `AgentHubPanel`, against a mock vault IPC
// (window.api.agentSessions) that actually keeps state, so a session switch
// or "reopen" reads back exactly what was persisted — same contract as the
// real electron-main `agentSessionsIpc.ts` handlers.
describe('AgentHubPanel — Writing Coach session picker (SKY-7113)', () => {
  function toSummary(session: AgentSessionFile, relPath: string): AgentSessionSummary {
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

  /** A mock vault: persists across `list`/`read`/`appendTurns` calls, like the real IPC. */
  function setupVaultApi(initialSessions: AgentSessionFile[]) {
    const vault = initialSessions.map((s) => ({ ...s, turns: [...s.turns] }));

    const agentSessions = {
      list: vi.fn(async (agent?: string) => ({
        sessions: vault.filter((s) => !agent || s.agent === agent).map((s) => toSummary(s, `Sessions/${s.id}.md`)),
      })),
      create: vi.fn(async (agent: string, title?: string, greeting?: string) => {
        const now = new Date().toISOString();
        const session: AgentSessionFile = {
          id: `session-${vault.length + 1}`,
          agent,
          title: title ?? 'New chat',
          startedAt: now,
          updatedAt: now,
          turns: greeting ? [{ role: 'agent', text: greeting, at: now }] : [],
        };
        vault.unshift(session);
        return { session, relPath: `Sessions/${session.id}.md` };
      }),
      rename: vi.fn(async (id: string, title: string) => {
        const s = vault.find((x) => x.id === id);
        if (s) s.title = title;
        return { ok: true };
      }),
      duplicate: vi.fn(async (id: string) => {
        const src = vault.find((x) => x.id === id)!;
        const copy = { ...src, id: `${src.id}-copy`, turns: [...src.turns] };
        vault.unshift(copy);
        return { session: copy, relPath: `Sessions/${copy.id}.md` };
      }),
      delete: vi.fn(async (id: string) => {
        const idx = vault.findIndex((x) => x.id === id);
        if (idx >= 0) vault.splice(idx, 1);
        return { ok: true };
      }),
      appendTurns: vi.fn(async (id: string, turns: AgentSessionTurn[]) => {
        const s = vault.find((x) => x.id === id);
        if (!s) return { session: null };
        s.turns = [...s.turns, ...turns];
        s.updatedAt = new Date().toISOString();
        return { session: s };
      }),
      read: vi.fn(async (id: string) => ({ session: vault.find((x) => x.id === id) ?? null })),
    };

    (window as any).api = {
      agentSessions,
      suggestionsUnifiedList: vi.fn().mockResolvedValue({ items: [], totalCount: 0 }),
      agentWritingAssistant: vi.fn().mockResolvedValue({ text: 'Coach reply for reopen test' }),
      onWritingAssistantChunk: vi.fn(() => vi.fn()),
      writingScan: vi.fn().mockResolvedValue({ tips: [], scannedAt: new Date().toISOString() }),
      writingAssistantCadenceChange: vi.fn().mockResolvedValue({ saved: true, waScanInterval: 60 }),
      writingAssistantTipDecision: vi.fn().mockResolvedValue({ saved: true }),
      writingAssistantScanNow: vi.fn().mockResolvedValue({ tips: [], scannedAt: new Date().toISOString() }),
      writingAssistantSetActiveScene: vi.fn().mockResolvedValue({ ok: true }),
    };

    return { vault, agentSessions };
  }

  function makeSession(id: string, title: string, turns: AgentSessionTurn[]): AgentSessionFile {
    return {
      id,
      agent: 'coach',
      title,
      startedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      turns,
    };
  }

  async function openWritingCoachChat() {
    // AgentRow sets an explicit role="listitem" on the button (it lives inside
    // a role="list" rows container), so it isn't queryable as role="button".
    fireEvent.click(await screen.findByRole('listitem', { name: /open writing coach chat/i }));
  }

  beforeEach(() => {
    __resetAgentSessionStores();
  });

  afterEach(() => {
    __resetAgentSessionStores();
    delete (window as any).api;
  });

  it('hydrates the transcript when the user selects a different session', async () => {
    const sessionA = makeSession('session-a', 'Session A', [
      { role: 'user', text: 'Hi from A', at: '2026-01-01T00:00:00.000Z' },
      { role: 'agent', text: 'Hello A', at: '2026-01-01T00:00:01.000Z' },
    ]);
    const sessionB = makeSession('session-b', 'Session B', [
      { role: 'user', text: 'Hi from B', at: '2026-01-02T00:00:00.000Z' },
      { role: 'agent', text: 'Hello B', at: '2026-01-02T00:00:01.000Z' },
    ]);
    setupVaultApi([sessionA, sessionB]);

    render(<AgentHubPanel scene={null} />);
    await openWritingCoachChat();

    expect(await screen.findByText('Hello A')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/^Session:/));
    fireEvent.click(screen.getByText('Session B'));

    await waitFor(() => expect(screen.getByText('Hello B')).toBeInTheDocument());
    expect(screen.queryByText('Hello A')).not.toBeInTheDocument();
  });

  it('isolates a new chat from the previously active session', async () => {
    const sessionA = makeSession('session-a', 'Session A', [
      { role: 'user', text: 'Hi from A', at: '2026-01-01T00:00:00.000Z' },
      { role: 'agent', text: 'Hello A', at: '2026-01-01T00:00:01.000Z' },
    ]);
    setupVaultApi([sessionA]);

    render(<AgentHubPanel scene={null} />);
    await openWritingCoachChat();
    expect(await screen.findByText('Hello A')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/^Session:/));
    fireEvent.click(screen.getByRole('button', { name: /\+ New chat/i }));

    await waitFor(() => expect(screen.queryByText('Hello A')).not.toBeInTheDocument());
    expect(screen.queryByText('Hi from A')).not.toBeInTheDocument();
  });

  it('persists a sent message across a session switch and a simulated app reopen', async () => {
    const sessionA = makeSession('session-a', 'Session A', []);
    const { vault } = setupVaultApi([sessionA]);

    const { unmount } = render(<AgentHubPanel scene={null} />);
    await openWritingCoachChat();

    fireEvent.change(screen.getByLabelText(/writing coach prompt/i), {
      target: { value: 'Remember this across reopen' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^ask$/i }));

    await waitFor(() => expect(screen.getByLabelText(/writing coach response/i)).toHaveTextContent('Coach reply for reopen test'));
    // The exchange lands in the vault-backed store, not just local component state.
    await waitFor(() => expect(vault.find((s) => s.id === 'session-a')?.turns).toHaveLength(2));

    unmount();
    __resetAgentSessionStores();

    render(<AgentHubPanel scene={null} />);
    await openWritingCoachChat();

    expect(await screen.findByText('Remember this across reopen')).toBeInTheDocument();
    expect(screen.getByLabelText(/writing coach response/i)).toHaveTextContent('Coach reply for reopen test');
  });
});
