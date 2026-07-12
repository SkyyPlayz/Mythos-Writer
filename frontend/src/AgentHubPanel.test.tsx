// SKY-6321: Agent hub — Suggestions card live preview + "See All Suggestions" wiring.
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { vi, afterEach, beforeEach, describe, it, expect } from 'vitest';
import AgentHubPanel from './AgentHubPanel';

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

// SKY-6663: M15 follow-up — Brainstorm + Archive in-panel chats wired to the
// shared useAgentSessions/AgentSessionPicker store (same contract as Coach).
describe('AgentHubPanel — Brainstorm + Archive session wiring (SKY-6663)', () => {
  beforeEach(() => {
    // useLiveAnnounce (Archive chat, Brainstorm) calls requestAnimationFrame;
    // make it synchronous so state updates land inside act().
    vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { fn(0); return 0; });
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete (window as any).api;
  });

  function buildFullApi() {
    return {
      suggestionsUnifiedList: vi.fn().mockResolvedValue({ items: [], totalCount: 0 }),
      agentSessions: {
        list: vi.fn().mockResolvedValue({ sessions: [] }),
        create: vi.fn().mockImplementation(async (agent: string) => ({
          session: { id: `${agent}-s1`, agent, title: 'Session 1', startedAt: 't', updatedAt: 't', turns: [] },
          relPath: `Sessions/${agent}.md`,
        })),
        rename: vi.fn(),
        duplicate: vi.fn(),
        delete: vi.fn(),
        appendTurns: vi.fn().mockResolvedValue({ session: null }),
      },
      // BrainstormPage's own API surface, so it mounts cleanly when embedded.
      streamStart: vi.fn().mockResolvedValue({ streamId: 's1' }),
      streamCancel: vi.fn().mockResolvedValue({ cancelled: true }),
      streamAck: vi.fn(),
      entityCreate: vi.fn(),
      entityList: vi.fn().mockResolvedValue({ entities: [] }),
      brainstormWriteNote: vi.fn(),
      brainstormResolveRouting: vi.fn(),
      brainstormListNotesFolders: vi.fn().mockResolvedValue({ folders: [], notesVaultRoot: '/tmp' }),
      brainstormSelectContext: vi.fn().mockResolvedValue({ included: [], excluded: [], usedTokens: 0, budgetTokens: 4000 }),
      onStreamToken: () => () => {},
      onStreamEnd: () => () => {},
      onStreamError: () => () => {},
      onVaultNotesUpdated: () => () => {},
      // Archive chat.
      agentArchive: vi.fn().mockResolvedValue({ text: 'ok', requestId: 'r1' }),
      onArchiveChunk: () => () => {},
    };
  }

  it('opening Brainstorm Agent renders the real BrainstormPage chat, not the placeholder', async () => {
    (window as any).api = buildFullApi();
    render(<AgentHubPanel scene={null} archiveContinuityEnabled={false} />);
    await screen.findByText(/No new suggestions/i);

    fireEvent.click(screen.getByLabelText(/open brainstorm agent chat/i));

    expect(await screen.findByLabelText(/brainstorm prompt/i)).toBeInTheDocument();
    expect(screen.queryByText(/chat coming soon/i)).not.toBeInTheDocument();
  });

  it('opening Archive Agent renders the real Archive chat, not the placeholder', async () => {
    (window as any).api = buildFullApi();
    render(<AgentHubPanel scene={null} archiveContinuityEnabled={false} />);
    await screen.findByText(/No new suggestions/i);

    fireEvent.click(screen.getByLabelText(/open archive agent chat/i));

    expect(await screen.findByLabelText(/archive agent prompt/i)).toBeInTheDocument();
    expect(screen.queryByText(/chat coming soon/i)).not.toBeInTheDocument();
  });

  it('opening Archive Agent initializes its own file-backed session store, keyed separately from Coach/Brainstorm', async () => {
    const api = buildFullApi();
    (window as any).api = api;
    render(<AgentHubPanel scene={null} archiveContinuityEnabled={false} />);
    await screen.findByText(/No new suggestions/i);

    fireEvent.click(screen.getByLabelText(/open archive agent chat/i));
    await screen.findByLabelText(/archive agent prompt/i);

    // All three per-agent stores mount unconditionally (hooks can't be
    // conditional), each keyed by its own agent name — 'coach' is the
    // Writing Coach's session key, distinct from 'archive'.
    await waitFor(() => expect(api.agentSessions.list).toHaveBeenCalledWith('archive'));
    expect(api.agentSessions.list).toHaveBeenCalledWith('coach');
    expect(api.agentSessions.list).toHaveBeenCalledWith('brainstorm');
  });

  it('the Archive session picker pill is present and offers "New chat"', async () => {
    (window as any).api = buildFullApi();
    render(<AgentHubPanel scene={null} archiveContinuityEnabled={false} />);
    await screen.findByText(/No new suggestions/i);

    fireEvent.click(screen.getByLabelText(/open archive agent chat/i));
    await screen.findByLabelText(/archive agent prompt/i);

    fireEvent.click(await screen.findByRole('button', { name: /^session:/i }));
    expect(screen.getByRole('button', { name: /\+ new chat/i })).toBeInTheDocument();
  });
});
