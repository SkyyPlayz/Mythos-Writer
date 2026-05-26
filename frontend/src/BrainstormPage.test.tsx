import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import BrainstormPage from './BrainstormPage';

const BRAINSTORM_DRAFT_KEY = 'mythos-brainstorm-draft';

const mockAgentBrainstorm = vi.fn();
const mockOnBrainstormChunk = vi.fn(() => vi.fn());
const mockEntityCreate = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  (window as unknown as { api: unknown }).api = {
    agentBrainstorm: mockAgentBrainstorm,
    onBrainstormChunk: mockOnBrainstormChunk,
    entityCreate: mockEntityCreate,
  };
});

describe('BrainstormPage', () => {
  it('renders prompt textarea and disabled Send button initially', () => {
    render(<BrainstormPage onClose={() => {}} />);
    expect(screen.getByLabelText(/brainstorm prompt/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^send$/i })).toBeDisabled();
  });

  it('sends a message and displays the response', async () => {
    mockAgentBrainstorm.mockResolvedValueOnce({ text: 'Your story sounds epic.' });

    render(<BrainstormPage onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/brainstorm prompt/i), {
      target: { value: 'I want to write a fantasy novel' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    await waitFor(() =>
      expect(screen.getByText('Your story sounds epic.')).toBeInTheDocument(),
    );
  });

  it('extracts FACT tags and shows them in the Facts panel', async () => {
    mockAgentBrainstorm.mockResolvedValueOnce({
      text: 'Great character! [FACT:character|Lyra Ashveil|A young mage with silver hair and a troubled past]',
    });

    render(<BrainstormPage onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/brainstorm prompt/i), {
      target: { value: 'Tell me about the hero' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    await waitFor(() =>
      expect(screen.getByText('Lyra Ashveil')).toBeInTheDocument(),
    );
    expect(screen.getByText('A young mage with silver hair and a troubled past')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save lyra ashveil to vault/i })).toBeInTheDocument();
  });

  it('saves a fact to vault via entityCreate and shows Saved status', async () => {
    mockAgentBrainstorm.mockResolvedValueOnce({
      text: '[FACT:location|The Sunken City|An ancient city submerged beneath a magical sea]',
    });
    mockEntityCreate.mockResolvedValueOnce({ id: 'e1', name: 'The Sunken City' });

    render(<BrainstormPage onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/brainstorm prompt/i), {
      target: { value: 'describe the main setting' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /save the sunken city to vault/i })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('button', { name: /save the sunken city to vault/i }));

    await waitFor(() => expect(screen.getByText(/saved ✓/i)).toBeInTheDocument());
    expect(mockEntityCreate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'The Sunken City', type: 'location' }),
    );
  });

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    render(<BrainstormPage onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /close brainstorm/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('saves messages to localStorage after a response', async () => {
    mockAgentBrainstorm.mockResolvedValueOnce({ text: 'Sounds like a great quest arc.' });

    render(<BrainstormPage onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/brainstorm prompt/i), {
      target: { value: 'What about a prophecy?' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    await waitFor(() =>
      expect(screen.getByText('Sounds like a great quest arc.')).toBeInTheDocument(),
    );

    const saved = localStorage.getItem(BRAINSTORM_DRAFT_KEY);
    expect(saved).not.toBeNull();
    const parsed = JSON.parse(saved!);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({ role: 'user', text: 'What about a prophecy?' });
    expect(parsed[1]).toMatchObject({ role: 'assistant', text: 'Sounds like a great quest arc.' });
  });

  it('restores draft from localStorage on mount and shows the banner', () => {
    localStorage.setItem(
      BRAINSTORM_DRAFT_KEY,
      JSON.stringify([
        { role: 'user', text: 'Restored question' },
        { role: 'assistant', text: 'Restored answer' },
      ]),
    );

    render(<BrainstormPage onClose={() => {}} />);

    expect(screen.getByText('Restored question')).toBeInTheDocument();
    expect(screen.getByText('Restored answer')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: /draft restored/i })).toBeInTheDocument();
  });

  it('Start Over clears messages and removes the localStorage draft', async () => {
    mockAgentBrainstorm.mockResolvedValueOnce({ text: 'An interesting idea.' });

    render(<BrainstormPage onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/brainstorm prompt/i), {
      target: { value: 'Give me an idea' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    await waitFor(() =>
      expect(screen.getByText('An interesting idea.')).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('button', { name: /start over/i }));

    expect(screen.queryByText('An interesting idea.')).not.toBeInTheDocument();
    expect(localStorage.getItem(BRAINSTORM_DRAFT_KEY)).toBeNull();
  });

  it('shows an error when the IPC call fails', async () => {
    mockAgentBrainstorm.mockRejectedValueOnce(new Error('ANTHROPIC_API_KEY is not set.'));

    render(<BrainstormPage onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/brainstorm prompt/i), {
      target: { value: 'test' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('ANTHROPIC_API_KEY is not set.'),
    );
  });

  it('shows Cancel button while loading and hides it after response', async () => {
    let resolve!: (v: { text: string }) => void;
    mockAgentBrainstorm.mockReturnValueOnce(new Promise((r) => { resolve = r; }));

    render(<BrainstormPage onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/brainstorm prompt/i), {
      target: { value: 'test' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    expect(screen.getByRole('button', { name: /cancel generation/i })).toBeInTheDocument();

    await act(async () => { resolve({ text: 'Done.' }); });

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /cancel generation/i })).not.toBeInTheDocument(),
    );
  });

  it('Cancel clears the streaming message and restores idle state', async () => {
    let resolve!: (v: { text: string }) => void;
    mockAgentBrainstorm.mockReturnValueOnce(new Promise((r) => { resolve = r; }));

    // Simulate a chunk arriving so there's partial text
    let chunkCb: ((c: string) => void) | null = null;
    mockOnBrainstormChunk.mockImplementationOnce((cb: (c: string) => void) => {
      chunkCb = cb;
      return vi.fn();
    });

    render(<BrainstormPage onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/brainstorm prompt/i), {
      target: { value: 'Partial test' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    // Deliver a partial chunk
    await act(async () => { chunkCb?.('Partial…'); });

    // Cancel while still loading
    fireEvent.click(screen.getByRole('button', { name: /cancel generation/i }));

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /cancel generation/i })).not.toBeInTheDocument(),
    );
    // Input should be re-enabled
    expect(screen.getByLabelText(/brainstorm prompt/i)).not.toBeDisabled();
    // Partial text stays visible (message kept because it had content)
    expect(screen.getByText('Partial…')).toBeInTheDocument();
    // Resolve the pending promise — should be ignored
    await act(async () => { resolve({ text: 'Late response — should be ignored.' }); });
    expect(screen.queryByText('Late response — should be ignored.')).not.toBeInTheDocument();
  });

  it('shows stalled banner after timeout with no chunks', async () => {
    vi.useFakeTimers();
    mockAgentBrainstorm.mockReturnValueOnce(new Promise(() => {})); // never resolves

    render(<BrainstormPage onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/brainstorm prompt/i), {
      target: { value: 'test stall' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    expect(screen.queryByText(/generation appears stalled/i)).not.toBeInTheDocument();

    await act(async () => { vi.advanceTimersByTime(30_000); });

    expect(screen.getByText(/generation appears stalled/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel and retry/i })).toBeInTheDocument();

    vi.useRealTimers();
  });
});
