import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import VaultAgentPanel from './VaultAgentPanel';
import type { Scene } from './types';

const mockAgentVaultCheck = vi.fn();
const mockOnVaultCheckChunk = vi.fn(() => vi.fn());

const scene: Scene = {
  id: 's1',
  title: 'The Heist',
  blocks: [
    { id: 'b1', type: 'prose', order: 0, content: 'Elena had blue eyes and golden hair.', updatedAt: '' },
  ],
  draftState: 'in-progress',
  order: 0,
  path: '/scene.md',
  createdAt: '',
  updatedAt: '',
};

beforeEach(() => {
  vi.resetAllMocks();
  (window as unknown as { api: unknown }).api = {
    agentVaultCheck: mockAgentVaultCheck,
    onVaultCheckChunk: mockOnVaultCheckChunk,
  };
});

describe('VaultAgentPanel', () => {
  it('renders Check Continuity button, disabled when no scene', () => {
    render(<VaultAgentPanel scene={null} />);
    expect(screen.getByRole('button', { name: /check continuity/i })).toBeDisabled();
    expect(screen.getByText(/select a scene/i)).toBeInTheDocument();
  });

  it('enables the button when a scene is provided', () => {
    render(<VaultAgentPanel scene={scene} />);
    expect(screen.getByRole('button', { name: /check continuity/i })).not.toBeDisabled();
  });

  it('shows an inconsistency card with provenance and dismiss button', async () => {
    const inconsistency: VaultCheckInconsistency = {
      id: 'inc-1',
      entityName: 'Elena',
      text: 'Elena is described with blue eyes here, but vault says brown eyes.',
      rationale: 'Eye colour mismatch',
      timestamp: new Date().toISOString(),
      source_agent: 'vault-agent',
      status: 'proposed',
    };
    mockAgentVaultCheck.mockResolvedValueOnce({
      text: 'Found 1 inconsistency.',
      inconsistencies: [inconsistency],
    });

    render(<VaultAgentPanel scene={scene} />);
    fireEvent.click(screen.getByRole('button', { name: /check continuity/i }));

    await waitFor(() =>
      expect(screen.getByText('Elena')).toBeInTheDocument(),
    );
    expect(screen.getByText(/blue eyes here.*brown eyes/i)).toBeInTheDocument();
    expect(screen.getByText('vault-agent')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /dismiss issue for elena/i })).toBeInTheDocument();
  });

  it('dismisses an inconsistency when Dismiss is clicked', async () => {
    const inconsistency: VaultCheckInconsistency = {
      id: 'inc-2',
      entityName: 'Lyra',
      text: 'Lyra appears here but is supposedly deceased in vault.',
      rationale: 'Character status conflict',
      timestamp: new Date().toISOString(),
      source_agent: 'vault-agent',
      status: 'proposed',
    };
    mockAgentVaultCheck.mockResolvedValueOnce({
      text: 'Found 1 inconsistency.',
      inconsistencies: [inconsistency],
    });

    render(<VaultAgentPanel scene={scene} />);
    fireEvent.click(screen.getByRole('button', { name: /check continuity/i }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /dismiss issue for lyra/i })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: /dismiss issue for lyra/i }));

    expect(screen.queryByRole('button', { name: /dismiss issue for lyra/i })).not.toBeInTheDocument();
    expect(screen.getByText(/no inconsistencies found/i)).toBeInTheDocument();
  });

  it('shows clean result when no inconsistencies found', async () => {
    mockAgentVaultCheck.mockResolvedValueOnce({ text: 'Scene looks consistent.', inconsistencies: [] });

    render(<VaultAgentPanel scene={scene} />);
    fireEvent.click(screen.getByRole('button', { name: /check continuity/i }));

    await waitFor(() =>
      expect(screen.getByText(/no inconsistencies found/i)).toBeInTheDocument(),
    );
  });

  it('shows an error when the IPC call fails', async () => {
    mockAgentVaultCheck.mockRejectedValueOnce(new Error('ANTHROPIC_API_KEY is not set.'));

    render(<VaultAgentPanel scene={scene} />);
    fireEvent.click(screen.getByRole('button', { name: /check continuity/i }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('ANTHROPIC_API_KEY is not set.'),
    );
  });
});
