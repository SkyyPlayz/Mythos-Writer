// Beta 4 M25 — timeline side-tab mini chats (§8.6, §14.5, AC4/AC8).
// Mirrors CoachPage.test's session mocking: shared useAgentSessions store,
// optimistic bubble, typing dots, origin-session pinning.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { __resetAgentSessionStores } from '../../lib/useAgentSessions';
import type { TimelinesStore } from '../../timelinesTypes';
import BrainstormTab from './BrainstormTab';
import ArchiveTab from './ArchiveTab';

const AT = '2026-07-01T00:00:00.000Z';
const STANDARD = { preset: 'standard' as const, monthsPerYear: 12, daysPerMonth: 30, hoursPerDay: 24 };

function makeStore(): TimelinesStore {
  return {
    schemaVersion: 1,
    activeTimelineId: 'tl-1',
    timelines: [
      { id: 'tl-1', name: 'Story', kind: 'story', axis: 'calendar', calendar: { ...STANDARD }, createdAt: '', updatedAt: '' },
    ],
    eras: [{ id: 'era-1', timelineId: 'tl-1', name: 'DAWN', startWhen: 0, endWhen: 400 }],
    spans: [],
    rows: [],
    events: [
      // blank summary → NEEDS FILLING OUT
      { id: 'ev-thin', timelineId: 'tl-1', name: 'The Fall', when: 100 },
      { id: 'ev-full', timelineId: 'tl-1', name: 'The Rise', when: 200, summary: 'A long and complete description of the turn.' },
    ],
  };
}

interface MockOptions {
  agent: 'brainstorm' | 'archive';
  deferReply?: boolean;
  replyText?: string;
}

function installMockApi(opts: MockOptions) {
  const session: AgentSessionFile = {
    id: `${opts.agent}-s1`,
    agent: opts.agent,
    title: 'Thread',
    startedAt: AT,
    updatedAt: AT,
    turns: [],
  };
  const agentSessions = {
    list: vi.fn(async () => ({
      sessions: [{ id: session.id, agent: opts.agent, title: session.title, startedAt: AT, updatedAt: AT, turnCount: session.turns.length, relPath: 'Sessions/x.md' }],
    })),
    create: vi.fn(async () => ({ session, relPath: 'Sessions/x.md' })),
    rename: vi.fn(async () => ({ ok: true })),
    duplicate: vi.fn(async () => ({ session, relPath: 'Sessions/x.md' })),
    delete: vi.fn(async () => ({ ok: true })),
    read: vi.fn(async () => ({ session })),
    appendTurns: vi.fn(async (_id: string, turns: AgentSessionTurn[]) => {
      session.turns = [...session.turns, ...turns];
      return { session: { ...session } };
    }),
  };
  let resolveReply: (() => void) | undefined;
  const text = opts.replyText ?? 'The agent answers.';
  const invoke = vi.fn(() => {
    if (opts.deferReply) {
      return new Promise<{ text: string }>((resolve) => {
        resolveReply = () => resolve({ text });
      });
    }
    return Promise.resolve({ text });
  });
  const api: Record<string, unknown> = { agentSessions };
  if (opts.agent === 'brainstorm') api.agentBrainstorm = invoke;
  else api.agentArchive = invoke;
  Object.defineProperty(window, 'api', { value: api, writable: true, configurable: true });
  return { agentSessions, invoke, session, resolveReply: () => resolveReply?.() };
}

async function flush() {
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetAgentSessionStores();
});
afterEach(() => cleanup());

const brainstormProps = () => ({
  store: makeStore(),
  activeTimelineId: 'tl-1',
  onJumpTo: vi.fn(),
  showToast: vi.fn(),
});

describe('Brainstorm tab (AC4, AC8)', () => {
  it('sends through the shared brainstorm session: optimistic bubble → typing dots → both turns persisted', async () => {
    const mock = installMockApi({ agent: 'brainstorm', deferReply: true, replyText: 'Filed under Notes.' });
    render(<BrainstormTab {...brainstormProps()} />);
    await flush();

    fireEvent.change(screen.getByTestId('trp-brainstorm-chat-input'), { target: { value: 'What do we know about Veynn?' } });
    fireEvent.click(screen.getByTestId('trp-brainstorm-chat-send'));
    await flush();

    // §14.5: pending user bubble + typing dots while the agent works
    expect(screen.getByText('What do we know about Veynn?')).toBeInTheDocument();
    expect(screen.getByTestId('trp-brainstorm-typing')).toBeInTheDocument();

    mock.resolveReply();
    await flush();
    expect(screen.queryByTestId('trp-brainstorm-typing')).toBeNull();
    expect(screen.getByText('Filed under Notes.')).toBeInTheDocument();
    expect(mock.agentSessions.appendTurns).toHaveBeenCalledWith('brainstorm-s1', [
      expect.objectContaining({ role: 'user', text: 'What do we know about Veynn?' }),
      expect.objectContaining({ role: 'agent', text: 'Filed under Notes.' }),
    ]);
  });

  it('Structure timeline into notes fires the agent with a timeline digest (AC4)', async () => {
    const mock = installMockApi({ agent: 'brainstorm' });
    const props = brainstormProps();
    render(<BrainstormTab {...props} />);
    await flush();

    fireEvent.click(screen.getByTestId('trp-structure-notes'));
    await flush();

    expect(props.showToast).toHaveBeenCalledWith('Asked the Brainstorm agent to structure the timeline into notes');
    const [prompt] = mock.invoke.mock.calls[0] as [string];
    expect(prompt).toContain('structure it into vault notes');
    expect(prompt).toContain('Timeline: Story');
    expect(prompt).toContain('Era: DAWN');
    expect(prompt).toContain('Event: The Fall');
  });

  it('NEEDS FILLING OUT lists thin events and clicking jumps to them (AC4)', async () => {
    installMockApi({ agent: 'brainstorm' });
    const props = brainstormProps();
    render(<BrainstormTab {...props} />);
    await flush();

    const list = screen.getByTestId('trp-needs-list');
    expect(list).toHaveTextContent('The Fall');
    expect(list).not.toHaveTextContent('The Rise');
    fireEvent.click(screen.getByTestId('trp-need-ev-thin'));
    expect(props.onJumpTo).toHaveBeenCalledWith('ev-thin');
  });

  it('surfaces the agent error inline instead of dropping the message', async () => {
    installMockApi({ agent: 'brainstorm' });
    (window.api as unknown as Record<string, unknown>).agentBrainstorm = vi.fn(() =>
      Promise.reject(new Error('Provider not configured')),
    );
    render(<BrainstormTab {...brainstormProps()} />);
    await flush();
    fireEvent.change(screen.getByTestId('trp-brainstorm-chat-input'), { target: { value: 'hi' } });
    fireEvent.click(screen.getByTestId('trp-brainstorm-chat-send'));
    await flush();
    expect(screen.getByTestId('trp-brainstorm-chat-error')).toHaveTextContent('Provider not configured');
  });
});

const archiveProps = () => ({
  flags: [],
  recentAutoAdds: [],
  onQuickAdd: vi.fn(async () => {}),
  onUndoAutoAdd: vi.fn(),
  onJumpTo: vi.fn(),
  onFlagResolved: vi.fn(),
  busy: false,
  showToast: vi.fn(),
});

describe('Archive tab (AC5/AC6 surface, AC8)', () => {
  it('quick-add submits the text and clears the input', async () => {
    installMockApi({ agent: 'archive' });
    const props = archiveProps();
    render(<ArchiveTab {...props} />);
    await flush();

    const input = screen.getByTestId('trp-quickadd-input');
    fireEvent.change(input, { target: { value: 'Add the festival from Ch. 4' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(props.onQuickAdd).toHaveBeenCalledWith('Add the festival from Ch. 4');
    expect(input).toHaveValue('');
  });

  it('RECENTLY AUTO-ADDED lists entries with per-row undo (AC6)', async () => {
    installMockApi({ agent: 'archive' });
    const props = {
      ...archiveProps(),
      recentAutoAdds: [
        { eventId: 'ev-a', label: 'The festival — Y871 · M3 · D14 · 00:00' },
        { eventId: 'ev-b', label: 'The siege — Y872 · M1 · D2 · 00:00' },
      ],
    };
    render(<ArchiveTab {...props} />);
    await flush();

    expect(screen.getByTestId('trp-recent-list')).toHaveTextContent('The festival');
    fireEvent.click(screen.getByTestId('trp-recent-undo-ev-a'));
    expect(props.onUndoAutoAdd).toHaveBeenCalledWith('ev-a');
    fireEvent.click(screen.getByTestId('trp-recent-ev-b'));
    expect(props.onJumpTo).toHaveBeenCalledWith('ev-b');
  });

  it('flags render with Jump for all kinds and Resolve only for contradictions (design §2)', async () => {
    installMockApi({ agent: 'archive' });
    const props = {
      ...archiveProps(),
      flags: [
        { id: 'f-gap', kind: 'gap' as const, description: '"Chapter 9" has no scenes yet.', anchor: 'Chapter 9', affectedItemId: 'ch-9' },
        { id: 'f-con', kind: 'contradiction' as const, description: 'Eye color drifts.', anchor: 'her grey eyes', affectedItemId: 'sc-2' },
      ],
    };
    render(<ArchiveTab {...props} />);
    await flush();

    expect(screen.getByTestId('trp-flags-section')).toHaveTextContent('2');
    expect(screen.queryByTestId('trp-flag-resolve-f-gap')).toBeNull();
    fireEvent.click(screen.getByTestId('trp-flag-jump-f-gap'));
    expect(props.onJumpTo).toHaveBeenCalledWith('ch-9');
    expect(screen.getByTestId('trp-flag-resolve-f-con')).toBeInTheDocument();
  });

  it('Resolve routes contradictions through the continuity backend and reports up', async () => {
    installMockApi({ agent: 'archive' });
    const resolveContinuity = vi.fn(async () => ({ ok: true }));
    (window.api as unknown as Record<string, unknown>).archiveResolveContinuity = resolveContinuity;
    const flag = { id: 'inc-1', kind: 'contradiction' as const, description: 'Eye color drifts.', anchor: 'her grey eyes', affectedItemId: 'sc-2' };
    const props = { ...archiveProps(), flags: [flag] };
    render(<ArchiveTab {...props} />);
    await flush();

    fireEvent.click(screen.getByTestId('trp-flag-resolve-inc-1'));
    fireEvent.click(screen.getByRole('button', { name: 'Update vault to match manuscript' }));
    await flush();
    expect(resolveContinuity).toHaveBeenCalledWith('inc-1', 'match_archive_to_story');
    expect(props.onFlagResolved).toHaveBeenCalledWith(flag);
    expect(props.showToast).toHaveBeenCalledWith('Flag resolved');
  });

  it('archive mini chat sends through the shared archive session with typing dots (AC8)', async () => {
    const mock = installMockApi({ agent: 'archive', deferReply: true, replyText: 'Dated to Y871.' });
    render(<ArchiveTab {...archiveProps()} />);
    await flush();

    fireEvent.change(screen.getByTestId('trp-archive-chat-input'), { target: { value: 'When was the siege?' } });
    fireEvent.click(screen.getByTestId('trp-archive-chat-send'));
    await flush();
    expect(screen.getByTestId('trp-archive-typing')).toBeInTheDocument();

    mock.resolveReply();
    await flush();
    expect(screen.getByText('Dated to Y871.')).toBeInTheDocument();
    expect(mock.agentSessions.appendTurns).toHaveBeenCalledWith('archive-s1', [
      expect.objectContaining({ role: 'user' }),
      expect.objectContaining({ role: 'agent', text: 'Dated to Y871.' }),
    ]);
  });
});
