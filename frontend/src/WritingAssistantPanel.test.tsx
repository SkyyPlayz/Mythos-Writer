import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import WritingAssistantPanel from './WritingAssistantPanel';

const mockAgentWritingAssistant = vi.fn();
const mockOnWritingAssistantChunk = vi.fn(() => vi.fn()); // returns unsub fn
const mockWritingScan = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  mockWritingScan.mockResolvedValue({ tips: [], scannedAt: new Date().toISOString() });
  (window as unknown as { api: unknown }).api = {
    agentWritingAssistant: mockAgentWritingAssistant,
    onWritingAssistantChunk: mockOnWritingAssistantChunk,
    writingScan: mockWritingScan,
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

  it.each([
    {
      label: 'auth failure (bad API key)',
      message: 'Authentication error — check your API key in Settings.',
    },
    {
      label: 'rate limit exceeded',
      message: 'Rate limit reached — try again shortly.',
    },
    {
      label: 'model not found / invalid request',
      message: 'Invalid request — check the model and input parameters.',
    },
    {
      label: 'network failure',
      message: 'Network error — check your connection and try again.',
    },
  ])('shows user-friendly error for provider rejection: $label', async ({ message }) => {
    mockAgentWritingAssistant.mockRejectedValueOnce(new Error(message));

    render(<WritingAssistantPanel scene={null} />);
    fireEvent.change(screen.getByLabelText(/writing assistant prompt/i), {
      target: { value: 'test prompt' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^ask$/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(message);
    });
    expect(screen.queryByLabelText(/writing assistant response/i)).not.toBeInTheDocument();
  });
});

const mockScene = {
  id: 's1',
  title: 'The Heist',
  blocks: [{ id: 'b1', type: 'prose' as const, order: 0, content: 'The airship docked silently.', updatedAt: '' }],
  draftState: 'in-progress' as const,
  order: 0,
  path: '/stories/ch1/scene1.md',
  createdAt: '',
  updatedAt: '',
};

describe('WritingAssistantPanel — heartbeat scheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls writingScan at the configured interval and shows tips', async () => {
    mockWritingScan.mockResolvedValue({
      tips: ['Use shorter sentences.', 'Add sensory detail.'],
      scannedAt: new Date().toISOString(),
    });

    render(<WritingAssistantPanel scene={mockScene} scanIntervalSeconds={10} isActive={true} />);

    expect(screen.queryByLabelText(/writing tips/i)).not.toBeInTheDocument();

    await act(async () => { vi.advanceTimersByTime(10_000); });

    expect(screen.getByLabelText(/writing tips/i)).toBeInTheDocument();
    expect(screen.getByText('Use shorter sentences.')).toBeInTheDocument();
    expect(screen.getByText('Add sensory detail.')).toBeInTheDocument();
  });

  it('calls writingScan with scene prose and path', async () => {
    mockWritingScan.mockResolvedValue({ tips: ['Tip.'], scannedAt: new Date().toISOString() });

    render(<WritingAssistantPanel scene={mockScene} scanIntervalSeconds={10} isActive={true} />);

    await act(async () => { vi.advanceTimersByTime(10_000); });

    expect(mockWritingScan).toHaveBeenCalledWith(
      mockScene.id,
      mockScene.blocks[0].content,
      mockScene.path,
    );
  });

  it('does not call writingScan when isActive is false', async () => {
    render(<WritingAssistantPanel scene={mockScene} scanIntervalSeconds={10} isActive={false} />);

    await act(() => { vi.advanceTimersByTime(30_000); });

    expect(mockWritingScan).not.toHaveBeenCalled();
    expect(screen.queryByLabelText(/writing tips/i)).not.toBeInTheDocument();
  });

  it('does not call writingScan when enabled is false', async () => {
    render(<WritingAssistantPanel scene={mockScene} enabled={false} scanIntervalSeconds={10} isActive={true} />);

    await act(() => { vi.advanceTimersByTime(30_000); });

    expect(mockWritingScan).not.toHaveBeenCalled();
  });

  it('does not show tips section when scan returns empty tips', async () => {
    mockWritingScan.mockResolvedValue({ tips: [], scannedAt: new Date().toISOString() });

    render(<WritingAssistantPanel scene={mockScene} scanIntervalSeconds={10} isActive={true} />);

    await act(async () => { vi.advanceTimersByTime(10_000); });

    expect(screen.queryByLabelText(/writing tips/i)).not.toBeInTheDocument();
  });

  it('updates tips after a second scan tick', async () => {
    mockWritingScan
      .mockResolvedValueOnce({ tips: ['First tip.'], scannedAt: new Date().toISOString() })
      .mockResolvedValueOnce({ tips: ['Second tip.'], scannedAt: new Date().toISOString() });

    render(<WritingAssistantPanel scene={mockScene} scanIntervalSeconds={10} isActive={true} />);

    await act(async () => { vi.advanceTimersByTime(10_000); });
    expect(screen.getByText('First tip.')).toBeInTheDocument();

    await act(async () => { vi.advanceTimersByTime(10_000); });
    expect(screen.getByText('Second tip.')).toBeInTheDocument();
    expect(screen.queryByText('First tip.')).not.toBeInTheDocument();
  });
});
