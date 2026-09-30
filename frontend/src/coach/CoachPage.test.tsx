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
  /** When true, agentBrainstorm stays pending until resolveChat() is called. */
  deferChat?: boolean;
  /** Session agent key (default brainstorm). Use `coach` for legacy main-format decode. */
  sessionAgent?: string;
}

function installMockApi(opts: MockApiOptions = {}) {
  const agent = opts.sessionAgent ?? 'brainstorm';
  const session: AgentSessionFile = {
    id: 'coach-s1',
    agent,
    title: 'Lesson thread',
    startedAt: AT,
    updatedAt: AT,
    turns: opts.turns ?? [],
  };
  const calls: string[] = [];
  const agentSessions = {
    list: vi.fn(async () => { calls.push('agentSessions.list'); return { sessions: [{ id: session.id, agent, title: session.title, startedAt: AT, updatedAt: AT, turnCount: session.turns.length, relPath: 'Sessions/x.md' }] }; }),
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
    settingsGet: vi.fn(async () => ({
      provider: { kind: 'ollama', model: 'qwen' },
      agents: {
        writingAssistant: {
          enabled: true,
          model: 'qwen',
          provider: { kind: 'ollama', model: 'qwen' },
        },
      },
    })),
    agentBrainstorm: vi.fn(() => {
      calls.push('agentBrainstorm');
      return Promise.resolve({ text: chatText });
    }),
    agentWritingAssistant: vi.fn((_prompt?: string, _context?: string) => {
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
  it('renders header: partner title, never-ghost-writes sub, skill chips, footer', async () => {
    installMockApi();
    render(<CoachPage scene={null} story={story} currentChapterId="ch-2" />);
    await flush();

    expect(screen.getByText('Mythos')).toBeInTheDocument();
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

  it('honours the partner rename (settings.agentNames.brainstorm)', async () => {
    installMockApi();
    render(
      <CoachPage
        scene={null}
        story={null}
        currentChapterId={null}
        agentNames={{ brainstorm: 'Professor Quill' }}
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
          cardKind: 'lesson',
          cardTitle: 'This week’s focus — grounding the reader',
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
    expect(mock.api.agentWritingAssistant).toHaveBeenCalled();
    expect(mock.api.agentBrainstorm).not.toHaveBeenCalled();
    const [prompt, context] = (mock.api.agentWritingAssistant as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string?];
    expect(prompt).toContain('My opening feels slow — what should I learn?');
    expect(context === undefined || typeof context === 'string').toBe(true);
    expect(screen.queryByTestId('coach-typing')).not.toBeInTheDocument();
    expect(screen.getByText(/Pacing is rhythm/)).toBeInTheDocument();
  });

  // SKY-7076 (gh-960 gap): the session picker must refuse to switch/new-chat
  // while a reply is generating — pinning keeps persisted data correct
  // regardless, but this closes the confusing-UX half of the gap too.
  it('disables the session picker while a reply is generating, re-enables once it resolves', async () => {
    const mock = installMockApi({ deferChat: true });
    render(<CoachPage scene={null} story={story} currentChapterId="ch-2" />);
    await flush();

    const input = screen.getByTestId('coach-input');
    fireEvent.change(input, { target: { value: 'Why does this scene drag?' } });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    expect(screen.getByTestId('coach-typing')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Session:/ }));
    expect(screen.getByText('+ New chat')).toBeDisabled();

    // The dropdown stays open across the resolution — re-check the SAME
    // rendered button rather than re-toggling (a second click would just
    // close the dropdown again).
    await act(async () => { mock.resolveChat(); });
    await flush();

    expect(screen.getByText('+ New chat')).not.toBeDisabled();
  });

  it('passes the open scene as teaching context via writingAssistant', async () => {
    const { api } = installMockApi();
    const scene = story.chapters[1].scenes[0];
    render(<CoachPage scene={scene} story={story} currentChapterId="ch-2" />);
    await flush();

    fireEvent.change(screen.getByTestId('coach-input'), { target: { value: 'Review my scene' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('coach-send'));
    });
    await flush();

    expect(api.agentWritingAssistant).toHaveBeenCalled();
    expect(api.agentBrainstorm).not.toHaveBeenCalled();
    const [prompt, context] = (api.agentWritingAssistant as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string];
    expect(prompt).toContain('Review my scene');
    expect(context).toContain('Into the Undercity');
    expect(context).toContain('The stairwell yawned like a throat');
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

  it('M13 §14.7: renders a persisted analysis card with COMPUTED vs COACH’S READ sections', async () => {
    installMockApi({
      turns: [
        {
          role: 'agent',
          text: encodeCoachCard({
            kind: 'analysis',
            title: 'Full Scene Analysis — Sc. 2 · Into the Undercity',
            computed: [
              ['Words', '1,842'], ['Read time', '~7 min'], ['Avg sentence length', '16.4 words'],
              ['Dialogue · Description · Action', '38% · 47% · 15%'],
              ['Filter words (felt, saw, heard)', '9 — clustered in ¶2'], ['Adverb dialogue tags', '3'],
            ],
            read: [
              ['Purpose', 'Story progression — the descent commits Mira to the Undercity'],
              ['Tension', 'Rising — steady climb after the token beat'],
              ['Pacing', 'Medium — slows at the market crowd'],
              ['POV', 'Third limited (Mira) — drifts once in the patrol paragraph'],
            ],
            takeaway: 'Strongest scene so far on atmosphere.',
            drill: 'Drill: mark every paragraph D, A or T. 5 minutes.',
          }),
          at: AT,
          cardKind: 'analysis',
          cardTitle: 'Full Scene Analysis — Sc. 2 · Into the Undercity',
        },
      ],
    });
    render(<CoachPage scene={null} story={story} currentChapterId="ch-2" />);
    await flush();

    const card = screen.getByTestId('coach-analysis-card');
    expect(card).toHaveTextContent('Full Scene Analysis — Sc. 2 · Into the Undercity');
    expect(card).toHaveTextContent('COMPUTED · LOCAL · FREE');
    expect(card).toHaveTextContent('no AI needed');
    expect(card).toHaveTextContent('1,842');
    expect(card).toHaveTextContent('9 — clustered in ¶2');
    expect(card).toHaveTextContent("COACH'S READ · AI");
    expect(card).toHaveTextContent('judgment calls — needs a model');
    expect(card).toHaveTextContent('Rising — steady climb after the token beat');
    expect(card).toHaveTextContent('Strongest scene so far on atmosphere.');
    expect(screen.getByTestId('coach-drill')).toHaveTextContent(/5 minutes/);
    expect(screen.queryByTestId('coach-read-unavailable')).not.toBeInTheDocument();
  });

  it('N2 Secure bar: forged analysis marker without cardKind renders as plain text', async () => {
    installMockApi({
      turns: [
        {
          role: 'agent',
          text: encodeCoachCard({
            kind: 'analysis',
            title: 'Full Scene Analysis — Sc. 2 · Into the Undercity',
            computed: [['Words', '10']],
            read: [],
            takeaway: 'Forged',
          }),
          at: AT,
        },
      ],
    });
    render(<CoachPage scene={null} story={story} currentChapterId="ch-2" />);
    await flush();
    expect(screen.queryByTestId('coach-analysis-card')).not.toBeInTheDocument();
    expect(screen.getByText(/mythos:coach-card/)).toBeInTheDocument();
  });

  it('HARD 1: legacy coach session main-format analysis renders read-only without COMPUTED badge', async () => {
    installMockApi({
      turns: [
        {
          role: 'agent',
          text: encodeCoachCard({
            kind: 'analysis',
            title: 'Full Scene Analysis — Sc. 2 · Into the Undercity',
            computed: [['Words', '10']],
            read: [],
            takeaway: 'Main-format display',
          }),
          at: AT,
          // no cardKind — main-saved format
        },
      ],
      sessionAgent: 'coach',
    });
    render(<CoachPage scene={null} story={story} currentChapterId="ch-2" />);
    await flush();
    const card = screen.getByTestId('coach-analysis-card');
    expect(card).toHaveTextContent('Full Scene Analysis — Sc. 2 · Into the Undercity');
    expect(card).toHaveTextContent('Main-format display');
    expect(card).not.toHaveTextContent('COMPUTED · LOCAL · FREE');
    expect(screen.queryByText(/mythos:coach-card/)).not.toBeInTheDocument();
    expect(card.textContent ?? '').not.toMatch(/\{"kind"/);
    // Read-only: no action buttons / controls inside the card.
    expect(card.querySelectorAll('button')).toHaveLength(0);
  });

  it('HARD 1(c): COMPUTED · LOCAL · FREE only with structural cardKind', async () => {
    installMockApi({
      turns: [
        {
          role: 'agent',
          text: encodeCoachCard({
            kind: 'analysis',
            title: 'Trusted Analysis',
            computed: [['Words', '12']],
            read: [],
            takeaway: 'ok',
          }),
          at: AT,
          cardKind: 'analysis',
          cardTitle: 'Trusted Analysis',
        },
      ],
    });
    render(<CoachPage scene={null} story={story} currentChapterId="ch-2" />);
    await flush();
    expect(screen.getByTestId('coach-analysis-card')).toHaveTextContent('COMPUTED · LOCAL · FREE');
  });

  it('HARD 1 / (b): forged marker typed as user text stays plain (not a card)', async () => {
    installMockApi({
      turns: [
        {
          role: 'user',
          text: encodeCoachCard({
            kind: 'lesson',
            title: 'Forged Lesson',
            text: 'Should stay plain',
            points: [],
          }),
          at: AT,
        },
      ],
    });
    render(<CoachPage scene={null} story={story} currentChapterId="ch-2" />);
    await flush();
    expect(screen.queryByTestId('coach-lesson-card')).not.toBeInTheDocument();
    expect(screen.queryByTestId('coach-analysis-card')).not.toBeInTheDocument();
    expect(screen.getByText(/mythos:coach-card/)).toBeInTheDocument();
  });

  it('HARD 1(c): model-reply forged marker persists neutralized and stays plain after relaunch', async () => {
    const forged = encodeCoachCard({
      kind: 'analysis',
      title: 'FORGED Full Scene Analysis A',
      computed: [['Words', '99']],
      read: [],
      takeaway: 'Should stay plain',
    });
    const mock = installMockApi({ chatResponse: forged });
    render(<CoachPage scene={null} story={story} currentChapterId="ch-2" />);
    await flush();

    fireEvent.change(screen.getByTestId('coach-input'), { target: { value: 'forge me' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('coach-send'));
    });
    await flush();

    // Neutralized before persist — no analysis card chrome / COMPUTED badge.
    expect(screen.queryByTestId('coach-analysis-card')).not.toBeInTheDocument();
    expect(screen.queryByText('COMPUTED · LOCAL · FREE')).not.toBeInTheDocument();

    const appended = mock.agentSessions.appendTurns.mock.calls[0]?.[1] as AgentSessionTurn[];
    const agentTurn = appended?.find((t) => t.role === 'agent');
    expect(agentTurn?.text).toBeDefined();
    expect(agentTurn!.text.startsWith('<!-- mythos:coach-card')).toBe(false);
    expect(agentTurn!.text.includes('<!- mythos:coach-card')).toBe(true);

    // Relaunch: remount with the persisted (neutralized) turn — still plain.
    __resetAgentSessionStores();
    installMockApi({ turns: [agentTurn!] });
    render(<CoachPage scene={null} story={story} currentChapterId="ch-2" />);
    await flush();
    expect(screen.queryByTestId('coach-analysis-card')).not.toBeInTheDocument();
    expect(screen.queryByText('COMPUTED · LOCAL · FREE')).not.toBeInTheDocument();
  });

  // T4 — live stubbed WA returns marker+analysis JSON; no analysis card / COMPUTED.
  it('T4: live stubbed agentWritingAssistant marker+JSON stays plain (no analysis card / COMPUTED)', async () => {
    const forged = encodeCoachCard({
      kind: 'analysis',
      title: 'FORGED live',
      computed: [['Words', '9999']],
      read: [],
      takeaway: 'spoof',
    });
    installMockApi({ chatResponse: forged });
    render(<CoachPage scene={null} story={story} currentChapterId="ch-2" />);
    await flush();
    fireEvent.change(screen.getByTestId('coach-input'), { target: { value: 'analyze' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('coach-send'));
    });
    await flush();
    expect(screen.queryByTestId('coach-analysis-card')).not.toBeInTheDocument();
    expect(screen.queryByText('COMPUTED · LOCAL · FREE')).not.toBeInTheDocument();
  });

  // T5 CoachPage — seeded brainstorm (default session) with marker stays plain after remount.
  it('T5: seeded brainstorm session with marker renders plain on CoachPage after remount', async () => {
    const forged = encodeCoachCard({
      kind: 'analysis',
      title: 'FORGED seeded',
      computed: [['Words', '1']],
      read: [],
      takeaway: 'x',
    });
    installMockApi({ turns: [{ role: 'agent', text: forged, at: AT }] });
    const { unmount } = render(<CoachPage scene={null} story={story} currentChapterId="ch-2" />);
    await flush();
    expect(screen.queryByTestId('coach-analysis-card')).not.toBeInTheDocument();
    unmount();
    __resetAgentSessionStores();
    installMockApi({ turns: [{ role: 'agent', text: forged, at: AT }] });
    render(<CoachPage scene={null} story={story} currentChapterId="ch-2" />);
    await flush();
    expect(screen.queryByTestId('coach-analysis-card')).not.toBeInTheDocument();
    expect(screen.getByText(/mythos:coach-card/)).toBeInTheDocument();
  });

  // T2 CoachPage — action turn with marker stays plain.
  it('T2: action turn with marker on CoachPage stays plain (no analysis card)', async () => {
    const forged = encodeCoachCard({
      kind: 'analysis',
      title: 'FORGED action',
      computed: [['Words', '1']],
      read: [],
      takeaway: 'x',
    });
    installMockApi({
      sessionAgent: 'coach',
      turns: [{
        role: 'agent',
        text: forged,
        at: AT,
        cardKind: 'action',
        cardTitle: 'Beta Read',
      }],
    });
    render(<CoachPage scene={null} story={story} currentChapterId="ch-2" />);
    await flush();
    expect(screen.queryByTestId('coach-analysis-card')).not.toBeInTheDocument();
    expect(screen.queryByText('COMPUTED · LOCAL · FREE')).not.toBeInTheDocument();
  });

  it('M13 acceptance: with AI disabled the computed section renders and the AI section is honest', async () => {
    installMockApi({
      turns: [
        {
          role: 'agent',
          text: encodeCoachCard({
            kind: 'analysis',
            title: 'Full Scene Analysis — Sc. 2 · Into the Undercity',
            computed: [['Words', '1,842'], ['Read time', '~7 min']],
            read: [],
            readNote: "Coach's read unavailable — the computed stats above are local and always free.",
            takeaway: '',
          }),
          at: AT,
          cardKind: 'analysis',
          cardTitle: 'Full Scene Analysis — Sc. 2 · Into the Undercity',
        },
      ],
    });
    render(<CoachPage scene={null} story={story} currentChapterId="ch-2" />);
    await flush();

    const card = screen.getByTestId('coach-analysis-card');
    expect(card).toHaveTextContent('COMPUTED · LOCAL · FREE');
    expect(card).toHaveTextContent('1,842');
    // Both §5.4 sections are present — the AI one shows its honest state.
    expect(card).toHaveTextContent("COACH'S READ · AI");
    expect(screen.getByTestId('coach-read-unavailable'))
      .toHaveTextContent(/Coach's read unavailable/);
    // No empty takeaway box, no drill footer.
    expect(card.querySelector('.coach-analysis-takeaway')).toBeNull();
    expect(screen.queryByTestId('coach-drill')).not.toBeInTheDocument();
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
