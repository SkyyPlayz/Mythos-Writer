// Beta 4 M12 — Coach page tests (§5.2, §14.6).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import CoachPage from './CoachPage';
import { encodeCoachCard } from './coachMessages';
import { __resetAgentSessionStores } from '../lib/useAgentSessions';
import type { Story, Scene } from '../types';

// ── Fixtures ────────────────────────────────────────────────────────────────

const AT = '2026-07-01T00:00:00.000Z';

function makeScene(id: string, title: string, chPath: string): Scene {
  return {
    id,
    title,
    path: `${chPath}/${id}.md`,
    order: 0,
    blocks: [{ id: `${id}-b1`, type: 'prose', content: 'The stairwell yawned like a throat.', order: 0, updatedAt: AT }],
    createdAt: AT,
    updatedAt: AT,
  };
}

const story: Story = {
  id: 'story-1',
  title: 'The Broken Gate',
  path: 'Manuscript/The Broken Gate',
  chapters: [
    {
      id: 'ch-1', title: 'Chapter 1', path: 'Manuscript/The Broken Gate/ch-1', order: 0,
      scenes: [makeScene('sc-1', 'The Summons', 'Manuscript/The Broken Gate/ch-1')],
      createdAt: AT, updatedAt: AT,
    },
    {
      id: 'ch-2', title: 'Chapter 2', path: 'Manuscript/The Broken Gate/ch-2', order: 1,
      scenes: [makeScene('sc-2', 'Into the Undercity', 'Manuscript/The Broken Gate/ch-2')],
      createdAt: AT, updatedAt: AT,
    },
  ],
  createdAt: AT,
  updatedAt: AT,
};

interface MockApiOptions {
  turns?: AgentSessionTurn[];
  suggestions?: unknown[];
  chatResponse?: string;
  /** When true, agentWritingAssistant stays pending until resolveChat() is called. */
  deferChat?: boolean;
}

function installMockApi(opts: MockApiOptions = {}) {
  const session: AgentSessionFile = {
    id: 'coach-s1',
    agent: 'coach',
    title: 'Lesson thread',
    startedAt: AT,
    updatedAt: AT,
    turns: opts.turns ?? [],
  };
  const calls: string[] = [];
  const agentSessions = {
    list: vi.fn(async () => { calls.push('agentSessions.list'); return { sessions: [{ id: session.id, agent: 'coach', title: session.title, startedAt: AT, updatedAt: AT, turnCount: session.turns.length, relPath: 'Sessions/x.md' }] }; }),
    create: vi.fn(async () => { calls.push('agentSessions.create'); return { session, relPath: 'Sessions/x.md' }; }),
    rename: vi.fn(async () => ({ ok: true })),
    duplicate: vi.fn(async () => ({ session, relPath: 'Sessions/x.md' })),
    delete: vi.fn(async () => ({ ok: true })),
    read: vi.fn(async () => { calls.push('agentSessions.read'); return { session }; }),
    appendTurns: vi.fn(async (_id: string, turns: AgentSessionTurn[]) => {
      calls.push('agentSessions.appendTurns');
      session.turns = [...session.turns, ...turns];
      return { session: { ...session } };
    }),
  };
  let resolveChat: (() => void) | undefined;
  const chatText = opts.chatResponse ?? 'Pacing is rhythm — look at your paragraph lengths.';
  const api = {
    agentSessions,
    agentWritingAssistant: vi.fn(() => {
      calls.push('agentWritingAssistant');
      if (opts.deferChat) {
        return new Promise<{ text: string }>((resolve) => {
          resolveChat = () => resolve({ text: chatText });
        });
      }
      return Promise.resolve({ text: chatText });
    }),
    suggestionsUnifiedList: vi.fn(async () => {
      calls.push('suggestionsUnifiedList');
      return { items: opts.suggestions ?? [] };
    }),
  };
  (window as unknown as Record<string, unknown>).api = api;
  return { api, agentSessions, session, calls, resolveChat: () => resolveChat?.() };
}

async function flush() {
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetAgentSessionStores();
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe('CoachPage (§5.2)', () => {
  it('renders header: Writing Coach title, never-ghost-writes sub, skill chips, footer', async () => {
    installMockApi();
    render(<CoachPage scene={null} story={story} currentChapterId="ch-2" />);
    await flush();

    expect(screen.getByText('Writing Coach')).toBeInTheDocument();
    expect(screen.getByText(/never ghost-writes/)).toBeInTheDocument();
    // 3 skill chips
    expect(screen.getByText('Dialogue')).toBeInTheDocument();
    expect(screen.getByText('Strong')).toBeInTheDocument();
    expect(screen.getByText('Pacing')).toBeInTheDocument();
    expect(screen.getByText('Description')).toBeInTheDocument();
    expect(screen.getByText('Focus area')).toBeInTheDocument();
    // footer line
    expect(screen.getByText(/your coach never writes prose for you/)).toBeInTheDocument();
    // 4 prompt chips
    expect(screen.getByText('Review my open scene like a teacher')).toBeInTheDocument();
    expect(screen.getByText('Give me a 10-minute writing drill')).toBeInTheDocument();
  });

  it('honours the agent rename (settings.agentNames.writingAssistant)', async () => {
    installMockApi();
    render(
      <CoachPage
        scene={null}
        story={null}
        currentChapterId={null}
        agentNames={{ writingAssistant: 'Professor Quill' }}
      />,
    );
    await flush();
    expect(screen.getByText('Professor Quill')).toBeInTheDocument();
  });

  it('renders persisted turns: bubbles + lesson card with drill footer', async () => {
    installMockApi({
      turns: [
        { role: 'agent', text: 'I’m your writing coach.', at: AT },
        { role: 'user', text: 'Teach me pacing', at: AT },
        {
          role: 'agent',
          text: encodeCoachCard({
            kind: 'lesson',
            title: 'This week’s focus — grounding the reader',
            text: 'Anchor place fast.',
            points: ['Anchor place in the first two sentences'],
            drill: 'Drill: underline the first moment of risk. 5 minutes.',
          }),
          at: AT,
        },
      ],
    });
    render(<CoachPage scene={null} story={story} currentChapterId="ch-2" />);
    await flush();

    expect(screen.getByText('I’m your writing coach.')).toBeInTheDocument();
    expect(screen.getByText('Teach me pacing')).toBeInTheDocument();
    const lesson = screen.getByTestId('coach-lesson-card');
    expect(lesson).toHaveTextContent('This week’s focus — grounding the reader');
    expect(lesson).toHaveTextContent('Anchor place in the first two sentences');
    expect(screen.getByTestId('coach-drill')).toHaveTextContent(/5 minutes/);
  });

  it('sends a prompt: typing dots while busy, then persists BOTH turns to the shared store', async () => {
    const mock = installMockApi({ deferChat: true });
    const { container } = render(<CoachPage scene={null} story={story} currentChapterId="ch-2" />);
    await flush();

    const input = screen.getByTestId('coach-input');
    fireEvent.change(input, { target: { value: 'My opening feels slow — what should I learn?' } });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });

    // Optimistic user bubble + typing dots while the coach is thinking
    expect(container.querySelector('.coach-bubble--user')?.textContent).toBe(
      'My opening feels slow — what should I learn?',
    );
    expect(screen.getByTestId('coach-typing')).toBeInTheDocument();

    await act(async () => { mock.resolveChat(); });
    await flush();

    expect(mock.agentSessions.appendTurns).toHaveBeenCalledTimes(1);
    const [, turns] = mock.agentSessions.appendTurns.mock.calls[0];
    expect(turns.map((t: AgentSessionTurn) => t.role)).toEqual(['user', 'agent']);
    expect(turns[0].text).toBe('My opening feels slow — what should I learn?');
    expect(mock.api.agentWritingAssistant).toHaveBeenCalledWith(
      'My opening feels slow — what should I learn?',
      undefined,
    );
    expect(screen.queryByTestId('coach-typing')).not.toBeInTheDocument();
    expect(screen.getByText(/Pacing is rhythm/)).toBeInTheDocument();
  });

  it('passes the open scene as teaching context', async () => {
    const { api } = installMockApi();
    const scene = story.chapters[1].scenes[0];
    render(<CoachPage scene={scene} story={story} currentChapterId="ch-2" />);
    await flush();

    fireEvent.change(screen.getByTestId('coach-input'), { target: { value: 'Review my scene' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('coach-send'));
    });
    await flush();

    expect(api.agentWritingAssistant).toHaveBeenCalledWith(
      'Review my scene',
      expect.stringContaining('The stairwell yawned like a throat.'),
    );
  });

  it('chips send their prompt directly (prototype coachChips)', async () => {
    const { agentSessions } = installMockApi();
    render(<CoachPage scene={null} story={story} currentChapterId="ch-2" />);
    await flush();

    await act(async () => {
      fireEvent.click(screen.getByText('Teach me pacing with my own text'));
    });
    await flush();
    expect(agentSessions.appendTurns).toHaveBeenCalled();
    expect(agentSessions.appendTurns.mock.calls[0][1][0].text).toBe('Teach me pacing with my own text');
  });

  it('runtime lock (§14.6): the send flow touches only allowlisted APIs — never a scene write', async () => {
    const { calls } = installMockApi();
    render(<CoachPage scene={story.chapters[1].scenes[0]} story={story} currentChapterId="ch-2" />);
    await flush();

    fireEvent.change(screen.getByTestId('coach-input'), { target: { value: 'Rewrite my scene for me' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('coach-send'));
    });
    await flush();

    const allowed = new Set([
      'agentSessions.list', 'agentSessions.create', 'agentSessions.read', 'agentSessions.appendTurns',
      'agentWritingAssistant', 'suggestionsUnifiedList',
    ]);
    for (const call of calls) {
      expect(allowed.has(call), `Coach page called ${call} — outside the no-ghost-write allowlist`).toBe(true);
    }
  });
});

describe('CoachPage suggestions rail (§5.2 right rail)', () => {
  const railSuggestions = [
    {
      id: 'sug-general', kind: 'suggestion', sourceAgent: 'writing-assistant', confidence: 0.9,
      rationale: 'Vary your sentence openings', targetPath: null, targetAnchor: null,
      status: 'proposed', createdAt: AT, appliedAt: null, budgetExceeded: false,
      category: 'style-tone', payloadJson: null,
    },
    {
      id: 'sug-ch2', kind: 'suggestion', sourceAgent: 'writing-assistant', confidence: 0.8,
      rationale: 'Add sensory detail in the descent', targetPath: 'Manuscript/The Broken Gate/ch-2/sc-2.md',
      targetAnchor: null, status: 'proposed', createdAt: AT, appliedAt: null, budgetExceeded: false,
      category: 'other', payloadJson: null,
    },
  ];

  it('shows collapsible General + per-chapter groups with the current chapter marked', async () => {
    installMockApi({ suggestions: railSuggestions });
    render(<CoachPage scene={null} story={story} currentChapterId="ch-2" />);
    await flush();

    expect(screen.getByText('SUGGESTIONS')).toBeInTheDocument();
    expect(screen.getByText('General')).toBeInTheDocument();
    expect(screen.getByText('Chapter 1')).toBeInTheDocument();
    expect(screen.getByText('Chapter 2 · current')).toBeInTheDocument();

    // General + current chapter open by default → their items visible
    expect(screen.getByText('Vary your sentence openings')).toBeInTheDocument();
    expect(screen.getByText('Add sensory detail in the descent')).toBeInTheDocument();
  });

  it('toggles a group closed and open', async () => {
    installMockApi({ suggestions: railSuggestions });
    render(<CoachPage scene={null} story={story} currentChapterId="ch-2" />);
    await flush();

    const generalHeader = screen.getByTestId('coach-sug-group-general');
    expect(generalHeader).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(generalHeader);
    expect(generalHeader).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Vary your sentence openings')).not.toBeInTheDocument();
    fireEvent.click(generalHeader);
    expect(screen.getByText('Vary your sentence openings')).toBeInTheDocument();
  });

  it('clicking a suggestion prefills the input with `Teach me: …`', async () => {
    installMockApi({ suggestions: railSuggestions });
    render(<CoachPage scene={null} story={story} currentChapterId="ch-2" />);
    await flush();

    fireEvent.click(screen.getByText('Add sensory detail in the descent'));
    expect(screen.getByTestId('coach-input')).toHaveValue('Teach me: Add sensory detail in the descent');
  });
});
