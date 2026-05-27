import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import WritingAssistantPanel, { STALL_TIMEOUT_MS, HARD_TIMEOUT_MS } from './WritingAssistantPanel';

const mockAgentWritingAssistant = vi.fn();
const mockOnWritingAssistantChunk = vi.fn(() => vi.fn()); // returns unsub fn

beforeEach(() => {
  vi.resetAllMocks();
  (window as unknown as { api: unknown }).api = {
    agentWritingAssistant: mockAgentWritingAssistant,
    onWritingAssistantChunk: mockOnWritingAssistantChunk,
  };
});

describe('WritingAssistantPanel', () => {
  it('renders prompt textarea and disabled Ask button initially', () => {
    render(<WritingAssistantPanel scene={null} />);
    expect(screen.getByLabelText(/writing assistant prompt/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^ask$/i })).toBeDisabled();
  });

  it('enables the button once prompt is non-empty', () => {
    render(<WritingAssistantPanel scene={null} />);
    const input = screen.getByLabelText(/writing assistant prompt/i);
    fireEvent.change(input, { target: { value: 'How can I make this scene more tense?' } });
    expect(screen.getByRole('button', { name: /^ask$/i })).not.toBeDisabled();
  });

  it('displays Claude response after ask and shows Accept/Dismiss buttons', async () => {
    mockAgentWritingAssistant.mockResolvedValueOnce({ text: 'Try adding a ticking clock.' });

    render(<WritingAssistantPanel scene={null} />);
    fireEvent.change(screen.getByLabelText(/writing assistant prompt/i), {
      target: { value: 'How to add tension?' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^ask$/i }));

    await waitFor(() => {
      expect(screen.getByLabelText(/writing assistant response/i)).toBeInTheDocument();
    });
    expect(screen.getByLabelText(/writing assistant response/i)).toHaveTextContent('Try adding a ticking clock.');
    expect(screen.getByRole('button', { name: /accept suggestion/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reject suggestion/i })).toBeInTheDocument();
  });

  it('marks suggestion as accepted when Accept is clicked', async () => {
    mockAgentWritingAssistant.mockResolvedValueOnce({ text: 'Use shorter sentences.' });

    render(<WritingAssistantPanel scene={null} />);
    fireEvent.change(screen.getByLabelText(/writing assistant prompt/i), {
      target: { value: 'Pacing advice?' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^ask$/i }));

    await waitFor(() => screen.getByRole('button', { name: /accept suggestion/i }));
    fireEvent.click(screen.getByRole('button', { name: /accept suggestion/i }));

    expect(screen.getByText(/accepted/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /accept suggestion/i })).not.toBeInTheDocument();
  });

  it('marks suggestion as dismissed when Dismiss is clicked', async () => {
    mockAgentWritingAssistant.mockResolvedValueOnce({ text: 'Cut the adverbs.' });

    render(<WritingAssistantPanel scene={null} />);
    fireEvent.change(screen.getByLabelText(/writing assistant prompt/i), {
      target: { value: 'Style advice?' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^ask$/i }));

    await waitFor(() => screen.getByRole('button', { name: /reject suggestion/i }));
    fireEvent.click(screen.getByRole('button', { name: /reject suggestion/i }));

    expect(screen.getByText(/dismissed/i)).toBeInTheDocument();
  });

  it('passes scene context to IPC when a scene is selected', async () => {
    mockAgentWritingAssistant.mockResolvedValueOnce({ text: 'Some advice.' });

    const scene = {
      id: 's1',
      title: 'The Heist',
      blocks: [{ id: 'b1', type: 'prose' as const, order: 0, content: 'The airship docked.', updatedAt: '' }],
      draftState: 'in-progress' as const,
      order: 0,
      path: '/scene.md',
      createdAt: '',
      updatedAt: '',
    };

    render(<WritingAssistantPanel scene={scene} />);
    fireEvent.change(screen.getByLabelText(/writing assistant prompt/i), {
      target: { value: 'what happens next?' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^ask$/i }));

    await waitFor(() => expect(mockAgentWritingAssistant).toHaveBeenCalled());
    const [prompt, context] = mockAgentWritingAssistant.mock.calls[0];
    expect(prompt).toBe('what happens next?');
    expect(context).toContain('The Heist');
    expect(context).toContain('The airship docked.');
  });

  it('shows an error message when the IPC call rejects', async () => {
    mockAgentWritingAssistant.mockRejectedValueOnce(new Error('ANTHROPIC_API_KEY is not set.'));

    render(<WritingAssistantPanel scene={null} />);
    fireEvent.change(screen.getByLabelText(/writing assistant prompt/i), {
      target: { value: 'test' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^ask$/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('ANTHROPIC_API_KEY is not set.');
    });
    expect(screen.queryByLabelText(/writing assistant response/i)).not.toBeInTheDocument();
  });

  it('shows Cancel button while streaming and hides after completion', async () => {
    // agentWritingAssistant never resolves during this test — stays loading
    let resolve: ((v: { text: string }) => void) | null = null;
    mockAgentWritingAssistant.mockReturnValueOnce(
      new Promise<{ text: string }>((r) => { resolve = r; }),
    );

    render(<WritingAssistantPanel scene={null} />);
    fireEvent.change(screen.getByLabelText(/writing assistant prompt/i), {
      target: { value: 'test' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^ask$/i }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /cancel generation/i })).toBeInTheDocument(),
    );
    expect(screen.queryByRole('button', { name: /^ask$/i })).not.toBeInTheDocument();

    // Resolve the promise — Cancel button should go away
    act(() => { resolve?.({ text: 'done' }); });
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /cancel generation/i })).not.toBeInTheDocument(),
    );
  });

  it('Cancel button aborts the in-flight request and removes the bubble', async () => {
    let resolve: ((v: { text: string }) => void) | null = null;
    mockAgentWritingAssistant.mockReturnValueOnce(
      new Promise<{ text: string }>((r) => { resolve = r; }),
    );

    render(<WritingAssistantPanel scene={null} />);
    fireEvent.change(screen.getByLabelText(/writing assistant prompt/i), {
      target: { value: 'test' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^ask$/i }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /cancel generation/i })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('button', { name: /cancel generation/i }));

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /cancel generation/i })).not.toBeInTheDocument(),
    );
    // Bubble removed
    expect(screen.queryByLabelText(/writing assistant response/i)).not.toBeInTheDocument();
    // Toast shown
    expect(screen.getByText(/generation cancelled/i)).toBeInTheDocument();

    // If the IPC eventually resolves, response should be ignored
    act(() => { resolve?.({ text: 'late response' }); });
    await waitFor(() =>
      expect(screen.queryByText('late response')).not.toBeInTheDocument(),
    );
  });

  it('does not modify scene content — no vault write', async () => {
    mockAgentWritingAssistant.mockResolvedValueOnce({ text: 'New ideas here.' });

    const mockWriteVault = vi.fn();
    (window as unknown as { api: unknown }).api = {
      agentWritingAssistant: mockAgentWritingAssistant,
      onWritingAssistantChunk: mockOnWritingAssistantChunk,
      writeVault: mockWriteVault,
    };

    render(<WritingAssistantPanel scene={null} />);
    fireEvent.change(screen.getByLabelText(/writing assistant prompt/i), {
      target: { value: 'ideas' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^ask$/i }));

    await waitFor(() => screen.getByLabelText(/writing assistant response/i));
    expect(mockWriteVault).not.toHaveBeenCalled();
  });
});

describe('WritingAssistantPanel — stalled-stream UX', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    (window as unknown as { api: unknown }).api = {
      agentWritingAssistant: mockAgentWritingAssistant,
      onWritingAssistantChunk: mockOnWritingAssistantChunk,
    };
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('exported constants have correct values', () => {
    expect(STALL_TIMEOUT_MS).toBe(20_000);
    expect(HARD_TIMEOUT_MS).toBe(90_000);
  });

  it('shows stalled panel after STALL_TIMEOUT_MS when no chunks arrive', async () => {
    mockAgentWritingAssistant.mockReturnValueOnce(new Promise(() => {}));

    render(<WritingAssistantPanel scene={null} />);
    fireEvent.change(screen.getByLabelText(/writing assistant prompt/i), {
      target: { value: 'slow question' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^ask$/i }));

    // Cancel button is shown synchronously (loading=true after click)
    expect(screen.getByRole('button', { name: /cancel generation/i })).toBeInTheDocument();

    await act(async () => { vi.advanceTimersByTime(STALL_TIMEOUT_MS + 1000); });

    expect(screen.getByRole('status', { name: /generation stalled/i })).toBeInTheDocument();
    expect(screen.getByText(/taking longer than expected/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry generation/i })).toBeInTheDocument();
  });

  it('auto-aborts after HARD_TIMEOUT_MS and shows an error', async () => {
    mockAgentWritingAssistant.mockReturnValueOnce(new Promise(() => {}));

    render(<WritingAssistantPanel scene={null} />);
    fireEvent.change(screen.getByLabelText(/writing assistant prompt/i), {
      target: { value: 'very slow' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^ask$/i }));

    expect(screen.getByRole('button', { name: /cancel generation/i })).toBeInTheDocument();

    await act(async () => { vi.advanceTimersByTime(HARD_TIMEOUT_MS + 1000); });

    expect(screen.getByRole('alert')).toHaveTextContent(/timed out/i);
    expect(screen.queryByRole('button', { name: /cancel generation/i })).not.toBeInTheDocument();
  });

  it('Retry button in stalled panel re-issues the IPC call', async () => {
    let resolveFirst: ((v: { text: string }) => void) | null = null;
    mockAgentWritingAssistant
      .mockReturnValueOnce(new Promise<{ text: string }>((r) => { resolveFirst = r; }))
      .mockResolvedValueOnce({ text: 'Retry response.' });

    render(<WritingAssistantPanel scene={null} />);
    fireEvent.change(screen.getByLabelText(/writing assistant prompt/i), {
      target: { value: 'retry this' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^ask$/i }));

    expect(screen.getByRole('button', { name: /cancel generation/i })).toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(STALL_TIMEOUT_MS + 1000); });
    expect(screen.getByRole('button', { name: /retry generation/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /retry generation/i }));
    // retryFromStalled is async — flush its promise chain
    await act(async () => {});

    expect(mockAgentWritingAssistant).toHaveBeenCalledTimes(2);

    // When the first call eventually resolves, it should be ignored (cancelledRef=true at that point)
    act(() => { resolveFirst?.({ text: 'Ignored late response.' }); });
    await act(async () => {});
    expect(screen.queryByText('Ignored late response.')).not.toBeInTheDocument();

    // Retry response shows up (second call resolves immediately)
    expect(screen.getByLabelText(/writing assistant response/i)).toHaveTextContent('Retry response.');
  });
});
