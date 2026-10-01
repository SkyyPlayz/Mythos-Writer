import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import MiniAgentChat from './MiniAgentChat';
import type { MiniAgentChat as MiniAgentChatState } from './useMiniAgentChat';

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

function makeChat(): MiniAgentChatState {
  return {
    messages: [],
    pendingPrompt: null,
    busy: false,
    stalled: false,
    error: null,
    store: {
      activeSession: {
        id: 's1',
        agent: 'brainstorm',
        title: 'Chat',
        startedAt: '',
        updatedAt: '',
        turns: [],
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
