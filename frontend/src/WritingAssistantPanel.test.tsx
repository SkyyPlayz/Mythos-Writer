import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import WritingAssistantPanel from './WritingAssistantPanel';

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
  afterEach(() => {
    vi.useRealTimers();
  });

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

  it('shows Cancel generation while loading and allows cancelling an in-flight request', async () => {
    let resolveRequest: ((value: { text: string }) => void) | null = null;
    mockAgentWritingAssistant.mockImplementationOnce(
      () => new Promise<{ text: string }>((resolve) => { resolveRequest = resolve; }),
    );

    render(<WritingAssistantPanel scene={null} />);
    fireEvent.change(screen.getByLabelText(/writing assistant prompt/i), {
      target: { value: 'keep going' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^ask$/i }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /cancel generation/i })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('button', { name: /cancel generation/i }));

    expect(screen.getByRole('button', { name: /^ask$/i })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Generation cancelled. You can retry now.');
    expect(screen.queryByLabelText(/writing assistant response/i)).not.toBeInTheDocument();

    resolveRequest?.({ text: 'late response should be ignored' });
    await waitFor(() =>
      expect(screen.queryByText(/late response should be ignored/i)).not.toBeInTheDocument(),
    );
  });

  it('times out when no streaming progress arrives and shows retry guidance', async () => {
    vi.useFakeTimers();
    mockAgentWritingAssistant.mockImplementationOnce(() => new Promise<{ text: string }>(() => {}));

    render(<WritingAssistantPanel scene={null} />);
    fireEvent.change(screen.getByLabelText(/writing assistant prompt/i), {
      target: { value: 'test timeout path' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^ask$/i }));

    expect(screen.getByRole('button', { name: /cancel generation/i })).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20000);
    });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Generation timed out due to no progress. Please retry.',
    );
    expect(screen.queryByRole('button', { name: /cancel generation/i })).not.toBeInTheDocument();
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
