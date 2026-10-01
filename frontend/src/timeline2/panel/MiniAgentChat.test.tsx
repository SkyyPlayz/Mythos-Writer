import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import MiniAgentChat from './MiniAgentChat';
import type { MiniAgentChat as MiniAgentChatState } from './useMiniAgentChat';
import { encodeCoachCard } from '../../coach/coachMessages';

const start = vi.fn();
const stop = vi.fn();

vi.mock('../../lib/useVoiceDictation', () => ({
  useVoiceDictation: (opts: { onTranscript: (t: string) => void }) => {
    (globalThis as unknown as { __macOnTranscript?: (t: string) => void }).__macOnTranscript = opts.onTranscript;
    return {
      state: 'idle' as const,
      errorMessage: '',
      start,
      stop,
      cancel: vi.fn(),
    };
  },
}));

function makeChat(opts?: {
  agent?: string;
  messages?: AgentSessionTurn[];
}): MiniAgentChatState {
  const agent = opts?.agent ?? 'brainstorm';
  const messages = opts?.messages ?? [];
  return {
    messages,
    pendingPrompt: null,
    busy: false,
    stalled: false,
    error: null,
    store: {
      activeSession: {
        id: 's1',
        agent,
        title: 'Chat',
        startedAt: '',
        updatedAt: '',
        turns: messages,
      },
      sessions: [],
      loading: false,
      error: null,
      refresh: vi.fn(),
      create: vi.fn(),
      rename: vi.fn(),
      duplicate: vi.fn(),
      remove: vi.fn(),
      select: vi.fn(),
    } as unknown as MiniAgentChatState['store'],
    send: vi.fn(),
    cancel: vi.fn(),
    postActionResult: vi.fn(),
  };
}

describe('MiniAgentChat voice (unified composer)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('hides mic when voiceEnabled is false', () => {
    render(
      <MiniAgentChat
        chat={makeChat()}
        accent="brainstorm"
        placeholder="Message…"
        testidPrefix="ahp-partner"
      />,
    );
    expect(screen.queryByTestId('ahp-partner-mic-btn')).not.toBeInTheDocument();
  });

  it('shows mic when voiceEnabled and appends transcript into draft', async () => {
    render(
      <MiniAgentChat
        chat={makeChat()}
        accent="brainstorm"
        placeholder="Message…"
        testidPrefix="ahp-partner"
        voiceEnabled
      />,
    );
    const mic = screen.getByTestId('ahp-partner-mic-btn');
    expect(mic).toBeInTheDocument();
    fireEvent.click(mic);
    expect(start).toHaveBeenCalled();
    await act(async () => {
      (globalThis as unknown as { __macOnTranscript: (t: string) => void }).__macOnTranscript('hello from voice');
    });
    await waitFor(() => {
      expect(screen.getByTestId('ahp-partner-chat-input')).toHaveValue('hello from voice');
    });
  });
});

describe('MiniAgentChat A6 legacy LESSON (Partner)', () => {
  it('pins all 6 lesson fields as text — points list + drill; no buttons/badge', () => {
    // 6 fields: title, text, point1, point2, point3, drill.
    // RED if MiniAgentChat prefixes points/drill with `false &&`.
    const lesson = {
      kind: 'lesson' as const,
      title: 'This week’s focus — grounding the reader',
      text: 'Every scene needs the reader to know three things fast.',
      points: [
        'Anchor place in the first two sentences',
        'Put the danger in the room early',
        'Name who is present before the first turn',
      ],
      drill: 'Drill: underline the first moment a reader feels risk. 5 minutes.',
    };
    const turn: AgentSessionTurn = {
      role: 'agent',
      text: encodeCoachCard(lesson),
      at: '2026-07-01T00:00:00.000Z',
      // no cardKind — main-saved legacy format
    };
    render(
      <MiniAgentChat
        chat={makeChat({ agent: 'coach', messages: [turn] })}
        accent="brainstorm"
        placeholder="Message…"
        testidPrefix="ahp-partner"
        hideSessionPicker
      />,
    );
    const card = screen.getByTestId('ahp-partner-display-card-0');
    expect(card).toHaveAttribute('data-readonly-card', 'true');
    expect(card).toHaveTextContent(lesson.title);
    expect(card).toHaveTextContent(lesson.text);
    expect(card).toHaveTextContent(lesson.points[0]);
    expect(card).toHaveTextContent(lesson.points[1]);
    expect(card).toHaveTextContent(lesson.points[2]);
    expect(card).toHaveTextContent(lesson.drill);
    expect(card.querySelector('.trp-msg-card-points')).toBeTruthy();
    expect(card.querySelectorAll('.trp-msg-card-points li')).toHaveLength(3);
    expect(card.querySelector('.trp-msg-card-foot')).toHaveTextContent(lesson.drill);
    expect(card.querySelectorAll('button')).toHaveLength(0);
    expect(card.textContent ?? '').not.toMatch(/COMPUTED/);
    expect(card.textContent ?? '').not.toMatch(/mythos:coach-card/);
    expect(card.textContent ?? '').not.toMatch(/\{"kind"/);
  });
});
