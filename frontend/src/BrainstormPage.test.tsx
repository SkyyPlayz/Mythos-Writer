import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BrainstormPage from './BrainstormPage';

const mockAgentBrainstorm = vi.fn();
const mockOnBrainstormChunk = vi.fn(() => vi.fn());
const mockEntityCreate = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
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
});
