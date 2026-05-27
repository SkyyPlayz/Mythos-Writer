import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import BrainstormPage, { STALL_TIMEOUT_MS, HARD_TIMEOUT_MS } from './BrainstormPage';

type TokenHandler = (data: { streamId: string; token: string }) => void;
type EndHandler = (data: { streamId: string }) => void;
type ErrorHandler = (data: { streamId: string; error: string }) => void;

let tokenCb: TokenHandler | null = null;
let endCb: EndHandler | null = null;
let errorCb: ErrorHandler | null = null;

const mockStreamStart = vi.fn();
const mockStreamCancel = vi.fn().mockResolvedValue({ cancelled: true });
const mockStreamAck = vi.fn();
const mockEntityCreate = vi.fn();
const mockEntityList = vi.fn();

function buildApi(overrides: Record<string, unknown> = {}) {
  return {
    streamStart: mockStreamStart,
    streamCancel: mockStreamCancel,
    streamAck: mockStreamAck,
    entityCreate: mockEntityCreate,
    entityList: mockEntityList,
    onStreamToken: (cb: TokenHandler) => {
      tokenCb = cb;
      return () => {
        tokenCb = null;
      };
    },
    onStreamEnd: (cb: EndHandler) => {
      endCb = cb;
      return () => {
        endCb = null;
      };
    },
    onStreamError: (cb: ErrorHandler) => {
      errorCb = cb;
      return () => {
        errorCb = null;
      };
    },
    sttStart: vi.fn(),
    sttStop: vi.fn(),
    onSttResult: () => () => {},
    onVaultNotesUpdated: () => () => {},
    ...overrides,
  };
}

async function simulateStream(tokens: string[], error?: string) {
  await waitFor(() => expect(tokenCb).not.toBeNull());
  act(() => {
    for (const t of tokens) {
      tokenCb?.({ streamId: 'test-stream-1', token: t });
    }
    if (error) {
      errorCb?.({ streamId: 'test-stream-1', error });
    } else {
      endCb?.({ streamId: 'test-stream-1' });
    }
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  tokenCb = null;
  endCb = null;
  errorCb = null;
  mockStreamStart.mockResolvedValue({ streamId: 'test-stream-1' });
  mockStreamCancel.mockResolvedValue({ cancelled: true });
  // Default: no existing entities — new facts are saved directly.
  mockEntityList.mockResolvedValue({ entities: [] });
  (window as unknown as { api: unknown }).api = buildApi();
  localStorage.clear();
});

describe('BrainstormPage', () => {
  it('renders prompt textarea and disabled Send button initially', () => {
    render(<BrainstormPage onClose={() => {}} />);
    expect(screen.getByLabelText(/brainstorm prompt/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^send$/i })).toBeDisabled();
  });

  it('sends a message and displays the response', async () => {
    render(<BrainstormPage onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/brainstorm prompt/i), {
      target: { value: 'I want to write a fantasy novel' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    await simulateStream(['Your story sounds epic.']);

    await waitFor(() =>
      expect(screen.getByText('Your story sounds epic.')).toBeInTheDocument(),
    );
  });

  it('extracts FACT tags, shows them in the Facts panel, and auto-saves', async () => {
    mockEntityCreate.mockResolvedValue({ id: 'e1', name: 'Lyra Ashveil' });

    render(<BrainstormPage onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/brainstorm prompt/i), {
      target: { value: 'Tell me about the hero' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    await simulateStream([
      'Great character! [FACT:character|Lyra Ashveil|A young mage with silver hair and a troubled past]',
    ]);

    await waitFor(() =>
      expect(screen.getByText('Lyra Ashveil')).toBeInTheDocument(),
    );
    expect(screen.getByText('A young mage with silver hair and a troubled past')).toBeInTheDocument();
    // No manual save button — auto-save fires immediately
    expect(screen.queryByRole('button', { name: /save lyra ashveil to vault/i })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/saved ✓/i)).toBeInTheDocument());
    expect(mockEntityCreate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Lyra Ashveil', type: 'character' }),
    );
  });

  it('auto-saves a fact to vault via entityCreate and shows Saved status', async () => {
    mockEntityCreate.mockResolvedValue({ id: 'e1', name: 'The Sunken City' });

    render(<BrainstormPage onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/brainstorm prompt/i), {
      target: { value: 'describe the main setting' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    await simulateStream([
      '[FACT:location|The Sunken City|An ancient city submerged beneath a magical sea]',
    ]);

    await waitFor(() => expect(screen.getByText(/saved ✓/i)).toBeInTheDocument());
    expect(mockEntityCreate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'The Sunken City', type: 'location' }),
    );
  });

  it('auto-routes edit to pending_review when entity with same name already exists', async () => {
    const mockSuggestionsUpsert = vi.fn().mockResolvedValue({ id: 'sug-1' });
    (window as unknown as { api: unknown }).api = buildApi({
      suggestionsUpsert: mockSuggestionsUpsert,
    });
    // Simulate entity already in vault
    mockEntityList.mockResolvedValue({
      entities: [{ id: 'existing-1', name: 'The Sunken City', path: 'entities/locations/existing-1.md' }],
    });

    render(<BrainstormPage onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/brainstorm prompt/i), {
      target: { value: 'describe the main setting' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    await simulateStream([
      '[FACT:location|The Sunken City|An updated description of the ancient city]',
    ]);

    await waitFor(() => expect(screen.getByText(/pending review/i)).toBeInTheDocument());
    expect(mockEntityCreate).not.toHaveBeenCalled();
    expect(mockSuggestionsUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        source_agent: 'brainstorm',
        target_kind: 'vault',
        target_path: 'entities/locations/existing-1.md',
        status: 'proposed',
      }),
    );
  });

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    render(<BrainstormPage onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /close brainstorm/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows an error when streamStart fails', async () => {
    mockStreamStart.mockRejectedValueOnce(new Error('ANTHROPIC_API_KEY is not set.'));

    render(<BrainstormPage onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/brainstorm prompt/i), {
      target: { value: 'test' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('ANTHROPIC_API_KEY is not set.'),
    );
  });

  it('shows an error when STREAM_ERROR fires mid-stream', async () => {
    render(<BrainstormPage onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/brainstorm prompt/i), {
      target: { value: 'test' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    await simulateStream([], 'mid-stream failure');

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('mid-stream failure'),
    );
  });

  it('shows Cancel button while streaming and hides after completion', async () => {
    render(<BrainstormPage onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/brainstorm prompt/i), {
      target: { value: 'test' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /cancel streaming/i })).toBeInTheDocument(),
    );

    await simulateStream(['Done.']);

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /cancel streaming/i })).not.toBeInTheDocument(),
    );
  });

  it('Cancel button aborts the stream and removes the pending bubble', async () => {
    render(<BrainstormPage onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/brainstorm prompt/i), {
      target: { value: 'test' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    await waitFor(() => expect(tokenCb).not.toBeNull());
    act(() => {
      tokenCb?.({ streamId: 'test-stream-1', token: 'partial' });
    });

    fireEvent.click(screen.getByRole('button', { name: /cancel streaming/i }));

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /cancel streaming/i })).not.toBeInTheDocument(),
    );
    expect(mockStreamCancel).toHaveBeenCalledWith('test-stream-1');
  });
});

describe('BrainstormPage disabled state', () => {
  it('shows disabled banner when enabled=false', () => {
    render(<BrainstormPage onClose={() => {}} enabled={false} />);
    expect(screen.getByText(/brainstorm agent is disabled/i)).toBeInTheDocument();
  });

  it('hides the prompt textarea when disabled', () => {
    render(<BrainstormPage onClose={() => {}} enabled={false} />);
    expect(screen.queryByLabelText(/brainstorm prompt/i)).not.toBeInTheDocument();
  });

  it('does not call streamStart when disabled', async () => {
    render(<BrainstormPage onClose={() => {}} enabled={false} />);
    expect(mockStreamStart).not.toHaveBeenCalled();
  });

  it('shows a Close button on the disabled view that calls onClose', () => {
    const onClose = vi.fn();
    render(<BrainstormPage onClose={onClose} enabled={false} />);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('BrainstormPage — STREAM_ERROR handling', () => {
  it('shows error when STREAM_ERROR fires before any content arrives', async () => {
    render(<BrainstormPage onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/brainstorm prompt/i), {
      target: { value: 'test' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    // Fire error immediately — no tokens precede it.
    await waitFor(() => expect(errorCb).not.toBeNull());
    act(() => {
      errorCb?.({ streamId: 'test-stream-1', error: 'Invalid API key — check your API key in Settings.' });
    });

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Invalid API key — check your API key in Settings.',
      ),
    );
    // Pending assistant bubble should be gone.
    expect(screen.queryByText(/▍/)).not.toBeInTheDocument();
  });

  it('displays user-friendly auth error when STREAM_ERROR carries 401 message', async () => {
    render(<BrainstormPage onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/brainstorm prompt/i), {
      target: { value: 'test' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    await waitFor(() => expect(errorCb).not.toBeNull());
    act(() => {
      errorCb?.({
        streamId: 'test-stream-1',
        error: 'Invalid API key — check your API key in Settings.',
      });
    });

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Invalid API key'),
    );
  });

  it('displays user-friendly rate-limit message when STREAM_ERROR carries 429 message', async () => {
    render(<BrainstormPage onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/brainstorm prompt/i), {
      target: { value: 'test' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    await waitFor(() => expect(errorCb).not.toBeNull());
    act(() => {
      errorCb?.({
        streamId: 'test-stream-1',
        error: 'Rate limit reached — too many requests. Try again shortly.',
      });
    });

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Rate limit reached'),
    );
  });

  it('displays model-unavailable message when STREAM_ERROR carries 404 message', async () => {
    render(<BrainstormPage onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/brainstorm prompt/i), {
      target: { value: 'test' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    await waitFor(() => expect(errorCb).not.toBeNull());
    act(() => {
      errorCb?.({
        streamId: 'test-stream-1',
        error: 'Model unavailable — the selected model may not be accessible on your account.',
      });
    });

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Model unavailable'),
    );
  });

  it('falls back to generic message when STREAM_ERROR has empty error string', async () => {
    render(<BrainstormPage onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/brainstorm prompt/i), {
      target: { value: 'test' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    await waitFor(() => expect(errorCb).not.toBeNull());
    act(() => {
      errorCb?.({ streamId: 'test-stream-1', error: '' });
    });

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('AI unavailable'),
    );
  });

  it('re-enables Send button after STREAM_ERROR fires', async () => {
    render(<BrainstormPage onClose={() => {}} />);
    const input = screen.getByLabelText(/brainstorm prompt/i);
    fireEvent.change(input, { target: { value: 'test' } });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    await waitFor(() => expect(errorCb).not.toBeNull());
    act(() => {
      errorCb?.({ streamId: 'test-stream-1', error: 'Rate limit reached — too many requests. Try again shortly.' });
    });

    await waitFor(() =>
      expect(screen.getByRole('alert')).toBeInTheDocument(),
    );
    // Input is re-enabled; Send button shows (not Cancel).
    expect(screen.queryByRole('button', { name: /cancel streaming/i })).not.toBeInTheDocument();
  });
});

describe('Draft persistence', () => {
  it('restores messages and facts from localStorage draft on mount', () => {
    const draft = {
      v: 1,
      savedAt: new Date().toISOString(),
      messages: [
        { role: 'user', text: 'Restored user message' },
        { role: 'assistant', text: 'Restored assistant reply', streaming: false },
      ],
      facts: [],
    };
    localStorage.setItem('brainstorm:draft', JSON.stringify(draft));

    render(<BrainstormPage onClose={() => {}} />);

    expect(screen.getByText('Restored user message')).toBeInTheDocument();
    expect(screen.getByText('Restored assistant reply')).toBeInTheDocument();
  });

  it('saves a completed message to localStorage after stream ends', async () => {
    render(<BrainstormPage onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/brainstorm prompt/i), {
      target: { value: 'Save this conversation' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    await simulateStream(['Saved response text.']);

    await waitFor(() =>
      expect(screen.getByText('Saved response text.')).toBeInTheDocument(),
    );

    const stored = localStorage.getItem('brainstorm:draft');
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!);
    expect(parsed.v).toBe(1);
    expect(parsed.messages.some((m: { text: string }) => m.text === 'Save this conversation')).toBe(true);
    expect(parsed.messages.some((m: { text: string }) => m.text === 'Saved response text.')).toBe(true);
  });

  it('New Session clears localStorage draft and removes messages from view', () => {
    const draft = {
      v: 1,
      savedAt: new Date().toISOString(),
      messages: [
        { role: 'user', text: 'Prior session message' },
        { role: 'assistant', text: 'Prior session reply' },
      ],
      facts: [],
    };
    localStorage.setItem('brainstorm:draft', JSON.stringify(draft));

    render(<BrainstormPage onClose={() => {}} />);
    expect(screen.getByText('Prior session message')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /new session/i }));

    expect(screen.queryByText('Prior session message')).not.toBeInTheDocument();
    expect(localStorage.getItem('brainstorm:draft')).toBeNull();
  });

  it('shows Download button when messages are present', () => {
    const draft = {
      v: 1,
      savedAt: new Date().toISOString(),
      messages: [
        { role: 'user', text: 'A question' },
        { role: 'assistant', text: 'An answer' },
      ],
      facts: [],
    };
    localStorage.setItem('brainstorm:draft', JSON.stringify(draft));

    render(<BrainstormPage onClose={() => {}} />);

    expect(screen.getByRole('button', { name: /download session/i })).toBeInTheDocument();
  });

  it('hides Download button when no messages are present', () => {
    render(<BrainstormPage onClose={() => {}} />);
    expect(screen.queryByRole('button', { name: /download session/i })).not.toBeInTheDocument();
  });

  it('Download button triggers file download via URL.createObjectURL', () => {
    const mockCreateObjectURL = vi.fn().mockReturnValue('blob:mock-url');
    const mockRevokeObjectURL = vi.fn();
    global.URL.createObjectURL = mockCreateObjectURL;
    global.URL.revokeObjectURL = mockRevokeObjectURL;
    const mockClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const draft = {
      v: 1,
      savedAt: new Date().toISOString(),
      messages: [
        { role: 'user', text: 'My question' },
        { role: 'assistant', text: 'My answer' },
      ],
      facts: [],
    };
    localStorage.setItem('brainstorm:draft', JSON.stringify(draft));

    render(<BrainstormPage onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /download session/i }));

    expect(mockCreateObjectURL).toHaveBeenCalled();
    expect(mockClick).toHaveBeenCalled();
    expect(mockRevokeObjectURL).toHaveBeenCalled();

    mockClick.mockRestore();
  });

  it('ignores a malformed localStorage draft without throwing', () => {
    localStorage.setItem('brainstorm:draft', 'not-valid-json{{{');
    expect(() => render(<BrainstormPage onClose={() => {}} />)).not.toThrow();
    expect(screen.queryByText(/undefined/i)).not.toBeInTheDocument();
  });
});

describe('Stalled-stream UX', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('exported constants have correct values', () => {
    expect(STALL_TIMEOUT_MS).toBe(20_000);
    expect(HARD_TIMEOUT_MS).toBe(90_000);
  });

  it('shows the stalled panel after STALL_TIMEOUT_MS with no tokens', async () => {
    render(<BrainstormPage onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/brainstorm prompt/i), {
      target: { value: 'test' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    // tokenCb is set synchronously before _runStream's first await
    expect(tokenCb).not.toBeNull();

    // Use async act to flush React 18 batched updates triggered by timer callbacks
    await act(async () => { vi.advanceTimersByTime(STALL_TIMEOUT_MS + 1000); });

    expect(screen.getByRole('status', { name: /generation stalled/i })).toBeInTheDocument();
    expect(screen.getByText(/taking longer than expected/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry generation/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel generation/i })).toBeInTheDocument();
  });

  it('hides the stalled panel when tokens resume after stall', async () => {
    render(<BrainstormPage onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/brainstorm prompt/i), {
      target: { value: 'test' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    expect(tokenCb).not.toBeNull();
    await act(async () => { vi.advanceTimersByTime(STALL_TIMEOUT_MS + 1000); });
    expect(screen.getByRole('status', { name: /generation stalled/i })).toBeInTheDocument();

    // Token arrives — streamPhase resets to 'streaming', stall panel disappears
    act(() => { tokenCb?.({ streamId: 'test-stream-1', token: 'hello' }); });
    await act(async () => {});  // flush React batched updates
    expect(screen.queryByRole('status', { name: /generation stalled/i })).not.toBeInTheDocument();
  });

  it('Cancel button in stalled panel aborts the stream and shows toast', async () => {
    render(<BrainstormPage onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/brainstorm prompt/i), {
      target: { value: 'test' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    expect(tokenCb).not.toBeNull();
    await act(async () => { vi.advanceTimersByTime(STALL_TIMEOUT_MS + 1000); });
    expect(screen.getByRole('button', { name: /cancel generation/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /cancel generation/i }));
    await act(async () => {});  // flush

    expect(mockStreamCancel).toHaveBeenCalledWith('test-stream-1');
    expect(screen.queryByRole('status', { name: /generation stalled/i })).not.toBeInTheDocument();
    expect(screen.getByText(/generation cancelled/i)).toBeInTheDocument();
  });

  it('Retry button re-starts the stream with the same messages', async () => {
    render(<BrainstormPage onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/brainstorm prompt/i), {
      target: { value: 'retry-me' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    expect(tokenCb).not.toBeNull();
    await act(async () => { vi.advanceTimersByTime(STALL_TIMEOUT_MS + 1000); });
    expect(screen.getByRole('button', { name: /retry generation/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /retry generation/i }));
    // retryFromStalled is async — flush its promise chain
    await act(async () => {});

    expect(mockStreamCancel).toHaveBeenCalledWith('test-stream-1');
    expect(mockStreamStart).toHaveBeenCalledTimes(2);

    // End the new stream — stalled panel should not reappear
    act(() => { endCb?.({ streamId: 'test-stream-1' }); });
    await act(async () => {});
    expect(screen.queryByRole('status', { name: /generation stalled/i })).not.toBeInTheDocument();
  });

  it('auto-aborts after HARD_TIMEOUT_MS and shows an error', async () => {
    render(<BrainstormPage onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/brainstorm prompt/i), {
      target: { value: 'slow request' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    expect(tokenCb).not.toBeNull();
    // Flush the streamStart() resolved-Promise microtask so streamIdRef.current is set
    await act(async () => {});

    await act(async () => { vi.advanceTimersByTime(HARD_TIMEOUT_MS + 1000); });

    expect(screen.getByRole('alert')).toHaveTextContent(/timed out/i);
    expect(mockStreamCancel).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /cancel streaming/i })).not.toBeInTheDocument();
  });

  it('Cancel button in input area shows cancelled toast', async () => {
    render(<BrainstormPage onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/brainstorm prompt/i), {
      target: { value: 'test' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    expect(tokenCb).not.toBeNull();
    // Flush the streamStart() resolved-Promise microtask so streamIdRef.current is set
    await act(async () => {});
    expect(screen.getByRole('button', { name: /cancel streaming/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /cancel streaming/i }));
    await act(async () => {});

    expect(mockStreamCancel).toHaveBeenCalledWith('test-stream-1');
    expect(screen.getByText(/generation cancelled/i)).toBeInTheDocument();
  });
});

describe('Mic button', () => {
  it('renders a mic button for voice input', () => {
    render(<BrainstormPage onClose={() => {}} />);
    expect(screen.getByRole('button', { name: /start recording/i })).toBeInTheDocument();
  });

  it('calls sttStart when the mic button is clicked', () => {
    const mockSttStart = vi.fn();
    (window as unknown as { api: unknown }).api = buildApi({ sttStart: mockSttStart });
    render(<BrainstormPage onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /start recording/i }));
    expect(mockSttStart).toHaveBeenCalled();
  });

  it('shows Stop Recording state when recording is active', () => {
    render(<BrainstormPage onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /start recording/i }));
    expect(screen.getByRole('button', { name: /stop recording/i })).toBeInTheDocument();
  });

  it('calls sttStop when the mic is active and clicked again', () => {
    const mockSttStop = vi.fn();
    (window as unknown as { api: unknown }).api = buildApi({ sttStop: mockSttStop });
    render(<BrainstormPage onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /start recording/i }));
    fireEvent.click(screen.getByRole('button', { name: /stop recording/i }));
    expect(mockSttStop).toHaveBeenCalled();
  });

  it('fills the composer with STT result text', async () => {
    let sttResultCb: ((text: string) => void) | null = null;
    (window as unknown as { api: unknown }).api = buildApi({
      onSttResult: (cb: (text: string) => void) => {
        sttResultCb = cb;
        return () => { sttResultCb = null; };
      },
    });
    render(<BrainstormPage onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /start recording/i }));
    await waitFor(() => expect(sttResultCb).not.toBeNull());
    act(() => { sttResultCb?.('hello world'); });
    await waitFor(() =>
      expect(screen.getByLabelText(/brainstorm prompt/i)).toHaveValue('hello world'),
    );
  });
});
