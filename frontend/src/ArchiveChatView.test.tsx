// SKY-6663: M15 follow-up — Archive Agent in-panel chat
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { vi, afterEach, beforeEach, describe, it, expect } from 'vitest';
import ArchiveChatView from './ArchiveChatView';
import type { UseAgentSessionsResult } from './lib/useAgentSessions';

type ChunkHandler = (chunk: string) => void;

let chunkCb: ChunkHandler | null = null;
const mockAgentArchive = vi.fn();
const mockAppendTurns = vi.fn().mockResolvedValue(undefined);

function buildApi() {
  return {
    agentArchive: mockAgentArchive,
    onArchiveChunk: (cb: ChunkHandler) => {
      chunkCb = cb;
      return () => { chunkCb = null; };
    },
  };
}

function makeStore(overrides: Partial<UseAgentSessionsResult> = {}): UseAgentSessionsResult {
  return {
    sessions: [],
    activeSession: null,
    activeSessionId: 'session-1',
    loading: false,
    switchSession: vi.fn(),
    newSession: vi.fn(),
    renameSession: vi.fn(),
    duplicateSession: vi.fn(),
    deleteSession: vi.fn(),
    appendTurns: mockAppendTurns,
    refresh: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  chunkCb = null;
  mockAgentArchive.mockReset();
  mockAppendTurns.mockClear();
  (window as unknown as { api: unknown }).api = buildApi();
});

afterEach(() => {
  delete (window as unknown as { api?: unknown }).api;
});

describe('ArchiveChatView', () => {
  it('shows the persona greeting before any message is sent', () => {
    render(<ArchiveChatView scene={null} sessionStore={makeStore()} displayName="Archive Agent" />);
    expect(screen.getByText(/continuity guardian/i)).toBeInTheDocument();
  });

  it('sends a prompt and renders the final response', async () => {
    mockAgentArchive.mockResolvedValue({ text: 'No contradictions found.', requestId: 'r1' });

    render(<ArchiveChatView scene={null} sessionStore={makeStore()} displayName="Archive Agent" />);
    fireEvent.change(screen.getByLabelText(/archive agent prompt/i), {
      target: { value: 'Does chapter three contradict chapter one?' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    await waitFor(() =>
      expect(screen.getByText('No contradictions found.')).toBeInTheDocument(),
    );
    expect(screen.getByText('Does chapter three contradict chapter one?')).toBeInTheDocument();
  });

  it('renders progressively-streamed chunks before the response resolves', async () => {
    let resolveResponse: (v: { text: string; requestId: string }) => void = () => {};
    mockAgentArchive.mockImplementation(() => new Promise((resolve) => { resolveResponse = resolve; }));

    render(<ArchiveChatView scene={null} sessionStore={makeStore()} displayName="Archive Agent" />);
    fireEvent.change(screen.getByLabelText(/archive agent prompt/i), { target: { value: 'Check facts' } });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    // onArchiveChunk is registered synchronously before the awaited call, so
    // chunkCb is already set once the click's synchronous work has flushed.
    await waitFor(() => expect(chunkCb).not.toBeNull());
    act(() => { chunkCb?.('No '); });
    act(() => { chunkCb?.('contradictions.'); });
    expect(screen.getByText('No contradictions.')).toBeInTheDocument();

    await act(async () => { resolveResponse({ text: 'No contradictions found.', requestId: 'r1' }); });
    await waitFor(() => expect(screen.getByText('No contradictions found.')).toBeInTheDocument());
  });

  it('persists the completed exchange to the session store via appendTurns', async () => {
    mockAgentArchive.mockResolvedValue({ text: 'Confirmed consistent.', requestId: 'r2' });

    render(<ArchiveChatView scene={null} sessionStore={makeStore()} displayName="Archive Agent" />);
    fireEvent.change(screen.getByLabelText(/archive agent prompt/i), { target: { value: 'Check it' } });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    await waitFor(() => expect(mockAppendTurns).toHaveBeenCalledTimes(1));
    const turns = mockAppendTurns.mock.calls[0][0];
    expect(turns).toEqual([
      expect.objectContaining({ role: 'user', text: 'Check it' }),
      expect.objectContaining({ role: 'agent', text: 'Confirmed consistent.' }),
    ]);
  });

  it('shows an error and drops the empty assistant bubble when the call fails', async () => {
    mockAgentArchive.mockRejectedValue(new Error('Archive Agent paused: hourly token cap reached.'));

    render(<ArchiveChatView scene={null} sessionStore={makeStore()} displayName="Archive Agent" />);
    fireEvent.change(screen.getByLabelText(/archive agent prompt/i), { target: { value: 'test' } });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/hourly token cap reached/i),
    );
    expect(mockAppendTurns).not.toHaveBeenCalled();
  });

  it('clears the transcript when the active session changes', async () => {
    mockAgentArchive.mockResolvedValue({ text: 'reply one', requestId: 'r3' });

    const { rerender } = render(
      <ArchiveChatView scene={null} sessionStore={makeStore({ activeSessionId: 'session-1' })} displayName="Archive Agent" />,
    );
    fireEvent.change(screen.getByLabelText(/archive agent prompt/i), { target: { value: 'first question' } });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));
    await waitFor(() => expect(screen.getByText('reply one')).toBeInTheDocument());

    rerender(
      <ArchiveChatView scene={null} sessionStore={makeStore({ activeSessionId: 'session-2' })} displayName="Archive Agent" />,
    );

    expect(screen.queryByText('first question')).not.toBeInTheDocument();
    expect(screen.queryByText('reply one')).not.toBeInTheDocument();
    expect(screen.getByText(/continuity guardian/i)).toBeInTheDocument();
  });

  it('disables the composer and shows a Settings hint when the agent is disabled', () => {
    render(<ArchiveChatView scene={null} sessionStore={makeStore()} displayName="Archive Agent" enabled={false} />);
    expect(screen.getByText(/disabled.*settings/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/archive agent prompt/i)).not.toBeInTheDocument();
  });

  it('keeps Send disabled for a blank or whitespace-only prompt', () => {
    render(<ArchiveChatView scene={null} sessionStore={makeStore()} displayName="Archive Agent" />);
    const sendBtn = screen.getByRole('button', { name: /^send$/i });
    expect(sendBtn).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/archive agent prompt/i), { target: { value: '   ' } });
    expect(sendBtn).toBeDisabled();
  });
});
