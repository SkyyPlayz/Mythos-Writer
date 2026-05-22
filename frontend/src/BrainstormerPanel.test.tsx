import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BrainstormerPanel from './BrainstormerPanel';

const mockAgentBrainstorm = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  (window as unknown as { api: unknown }).api = {
    agentBrainstorm: mockAgentBrainstorm,
  };
});

describe('BrainstormerPanel', () => {
  it('renders prompt textarea and disabled Brainstorm button initially', () => {
    render(<BrainstormerPanel scene={null} />);
    expect(screen.getByLabelText(/brainstorm prompt/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /brainstorm/i })).toBeDisabled();
  });

  it('enables the button once prompt is non-empty', () => {
    render(<BrainstormerPanel scene={null} />);
    const input = screen.getByLabelText(/brainstorm prompt/i);
    fireEvent.change(input, { target: { value: 'a fantasy heist set on a sky-ship' } });
    expect(screen.getByRole('button', { name: /brainstorm/i })).not.toBeDisabled();
  });

  it('displays Claude response in read-only output after brainstorm', async () => {
    mockAgentBrainstorm.mockResolvedValueOnce({ text: 'Pirates and mages conspire.' });

    render(<BrainstormerPanel scene={null} />);
    fireEvent.change(screen.getByLabelText(/brainstorm prompt/i), {
      target: { value: 'a fantasy heist set on a sky-ship' },
    });
    fireEvent.click(screen.getByRole('button', { name: /brainstorm/i }));

    await waitFor(() => {
      expect(screen.getByLabelText(/brainstorm result/i)).toBeInTheDocument();
    });
    expect(screen.getByLabelText(/brainstorm result/i)).toHaveValue('Pirates and mages conspire.');
    expect(screen.getByLabelText(/brainstorm result/i)).toHaveAttribute('readonly');
  });

  it('passes scene context to IPC when a scene is selected', async () => {
    mockAgentBrainstorm.mockResolvedValueOnce({ text: 'Some ideas.' });

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

    render(<BrainstormerPanel scene={scene} />);
    fireEvent.change(screen.getByLabelText(/brainstorm prompt/i), {
      target: { value: 'what happens next?' },
    });
    fireEvent.click(screen.getByRole('button', { name: /brainstorm/i }));

    await waitFor(() => expect(mockAgentBrainstorm).toHaveBeenCalled());
    const [prompt, context] = mockAgentBrainstorm.mock.calls[0];
    expect(prompt).toBe('what happens next?');
    expect(context).toContain('The Heist');
    expect(context).toContain('The airship docked.');
  });

  it('shows an error message when the IPC call rejects', async () => {
    mockAgentBrainstorm.mockRejectedValueOnce(new Error('ANTHROPIC_API_KEY is not set.'));

    render(<BrainstormerPanel scene={null} />);
    fireEvent.change(screen.getByLabelText(/brainstorm prompt/i), {
      target: { value: 'test' },
    });
    fireEvent.click(screen.getByRole('button', { name: /brainstorm/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('ANTHROPIC_API_KEY is not set.');
    });
    expect(screen.queryByLabelText(/brainstorm result/i)).not.toBeInTheDocument();
  });

  it('does not modify scene content — editor is unaffected', async () => {
    mockAgentBrainstorm.mockResolvedValueOnce({ text: 'New ideas here.' });

    const mockWriteVault = vi.fn();
    (window as unknown as { api: unknown }).api = {
      agentBrainstorm: mockAgentBrainstorm,
      writeVault: mockWriteVault,
    };

    render(<BrainstormerPanel scene={null} />);
    fireEvent.change(screen.getByLabelText(/brainstorm prompt/i), {
      target: { value: 'ideas' },
    });
    fireEvent.click(screen.getByRole('button', { name: /brainstorm/i }));

    await waitFor(() => screen.getByLabelText(/brainstorm result/i));
    expect(mockWriteVault).not.toHaveBeenCalled();
  });
});
