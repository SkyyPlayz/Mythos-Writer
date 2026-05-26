import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import WritingAssistantPanel from './WritingAssistantPanel';

const WA_DRAFT_KEY_GLOBAL = 'mythos-wa-draft-global';

const mockAgentWritingAssistant = vi.fn();
const mockOnWritingAssistantChunk = vi.fn(() => vi.fn()); // returns unsub fn

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
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

  it('saves messages to localStorage after a response', async () => {
    mockAgentWritingAssistant.mockResolvedValueOnce({ text: 'Try slowing the pacing here.' });

    render(<WritingAssistantPanel scene={null} />);
    fireEvent.change(screen.getByLabelText(/writing assistant prompt/i), {
      target: { value: 'Any pacing advice?' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^ask$/i }));

    await waitFor(() => screen.getByLabelText(/writing assistant response/i));

    const saved = localStorage.getItem(WA_DRAFT_KEY_GLOBAL);
    expect(saved).not.toBeNull();
    const parsed = JSON.parse(saved!);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({ role: 'user', text: 'Any pacing advice?' });
    expect(parsed[1]).toMatchObject({ role: 'assistant', text: 'Try slowing the pacing here.' });
  });

  it('restores draft from localStorage on mount and shows the banner', () => {
    localStorage.setItem(
      WA_DRAFT_KEY_GLOBAL,
      JSON.stringify([
        { role: 'user', text: 'Saved question' },
        { role: 'assistant', text: 'Saved advice', suggestion: undefined },
      ]),
    );

    render(<WritingAssistantPanel scene={null} />);

    expect(screen.getByText('Saved question')).toBeInTheDocument();
    expect(screen.getByText('Saved advice')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: /draft restored/i })).toBeInTheDocument();
  });

  it('Clear button removes messages and localStorage draft', async () => {
    mockAgentWritingAssistant.mockResolvedValueOnce({ text: 'Cut adverbs.' });

    render(<WritingAssistantPanel scene={null} />);
    fireEvent.change(screen.getByLabelText(/writing assistant prompt/i), {
      target: { value: 'Style tip?' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^ask$/i }));

    await waitFor(() => screen.getByLabelText(/writing assistant response/i));

    fireEvent.click(screen.getByRole('button', { name: /clear conversation/i }));

    expect(screen.queryByLabelText(/writing assistant response/i)).not.toBeInTheDocument();
    expect(localStorage.getItem(WA_DRAFT_KEY_GLOBAL)).toBeNull();
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

  it('shows Cancel button while loading and hides it after response', async () => {
    let resolve!: (v: { text: string }) => void;
    mockAgentWritingAssistant.mockReturnValueOnce(new Promise((r) => { resolve = r; }));

    render(<WritingAssistantPanel scene={null} />);
    fireEvent.change(screen.getByLabelText(/writing assistant prompt/i), {
      target: { value: 'test' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^ask$/i }));

    expect(screen.getByRole('button', { name: /cancel generation/i })).toBeInTheDocument();

    await act(async () => { resolve({ text: 'Done.' }); });

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /cancel generation/i })).not.toBeInTheDocument(),
    );
  });

  it('Cancel clears streaming and restores idle state', async () => {
    let resolve!: (v: { text: string }) => void;
    mockAgentWritingAssistant.mockReturnValueOnce(new Promise((r) => { resolve = r; }));

    let chunkCb: ((c: string) => void) | null = null;
    mockOnWritingAssistantChunk.mockImplementationOnce((cb: (c: string) => void) => {
      chunkCb = cb;
      return vi.fn();
    });

    render(<WritingAssistantPanel scene={null} />);
    fireEvent.change(screen.getByLabelText(/writing assistant prompt/i), {
      target: { value: 'partial test' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^ask$/i }));

    await act(async () => { chunkCb?.('Partial…'); });

    fireEvent.click(screen.getByRole('button', { name: /cancel generation/i }));

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /cancel generation/i })).not.toBeInTheDocument(),
    );
    expect(screen.getByLabelText(/writing assistant prompt/i)).not.toBeDisabled();
    expect(screen.getByText('Partial…')).toBeInTheDocument();

    await act(async () => { resolve({ text: 'Late response.' }); });
    expect(screen.queryByText('Late response.')).not.toBeInTheDocument();
  });

  it('shows stalled banner after timeout with no chunks', async () => {
    vi.useFakeTimers();
    mockAgentWritingAssistant.mockReturnValueOnce(new Promise(() => {}));

    render(<WritingAssistantPanel scene={null} />);
    fireEvent.change(screen.getByLabelText(/writing assistant prompt/i), {
      target: { value: 'test stall' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^ask$/i }));

    expect(screen.queryByText(/generation appears stalled/i)).not.toBeInTheDocument();

    await act(async () => { vi.advanceTimersByTime(30_000); });

    expect(screen.getByText(/generation appears stalled/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel and retry/i })).toBeInTheDocument();

    vi.useRealTimers();
  });
});
