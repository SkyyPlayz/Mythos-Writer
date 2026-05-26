import { render, screen, waitFor } from '@testing-library/react';
import { vi, beforeEach, describe, it, expect } from 'vitest';
import VaultGraphView, { type VaultGraphData } from './VaultGraphView';

// React Flow uses DOM APIs not available in jsdom; stub the whole module
vi.mock('@xyflow/react', () => ({
  ReactFlow: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="react-flow-stub">{children}</div>
  ),
  Background: () => null,
  Controls: () => null,
  useNodesState: (init: unknown[]) => [init, vi.fn(), vi.fn()],
  useEdgesState: (init: unknown[]) => [init, vi.fn(), vi.fn()],
  MarkerType: { ArrowClosed: 'arrowclosed' },
  BackgroundVariant: { Dots: 'dots' },
}));

global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const MOCK_DATA: VaultGraphData = {
  nodes: [
    { id: 'n1', label: 'Scene One', path: 'stories/s1/ch1/scenes/n1.md', folder: 'stories', tags: ['action'] },
    { id: 'n2', label: 'Scene Two', path: 'stories/s1/ch1/scenes/n2.md', folder: 'stories', tags: ['drama'] },
    { id: 'n3', label: 'Character A', path: 'characters/a.md', folder: 'characters', tags: ['action'] },
  ],
  edges: [
    { source: 'n1', target: 'n2' },
    { source: 'n2', target: 'n3' },
  ],
};

type ApiMock = {
  vaultGraphData: ReturnType<typeof vi.fn>;
  onVaultFileChanged: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  (window as unknown as { api: ApiMock }).api = {
    vaultGraphData: vi.fn().mockResolvedValue(MOCK_DATA),
    onVaultFileChanged: vi.fn().mockReturnValue(vi.fn()),
  };
});

describe('VaultGraphView', () => {
  it('renders the graph container after data loads', async () => {
    render(<VaultGraphView />);
    await waitFor(() => {
      expect(screen.getByTestId('vault-graph-view')).toBeInTheDocument();
    });
  });

  it('shows node count and link count in toolbar', async () => {
    render(<VaultGraphView />);
    await waitFor(() => {
      expect(screen.getByText(/3 notes · 2 links/)).toBeInTheDocument();
    });
  });

  it('renders folder filter when folders are present', async () => {
    render(<VaultGraphView />);
    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: /filter by folder/i })).toBeInTheDocument();
    });
  });

  it('renders tag filter when tags are present', async () => {
    render(<VaultGraphView />);
    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: /filter by tag/i })).toBeInTheDocument();
    });
  });

  it('shows error state when IPC is unavailable', async () => {
    (window as unknown as { api: ApiMock }).api = {
      vaultGraphData: vi.fn().mockResolvedValue(undefined),
      onVaultFileChanged: vi.fn().mockReturnValue(vi.fn()),
    };
    render(<VaultGraphView />);
    await waitFor(() => {
      expect(screen.getByText(/VAULT_GRAPH_DATA IPC not available/i)).toBeInTheDocument();
    });
  });

  it('shows empty state when no nodes', async () => {
    (window as unknown as { api: ApiMock }).api = {
      vaultGraphData: vi.fn().mockResolvedValue({ nodes: [], edges: [] }),
      onVaultFileChanged: vi.fn().mockReturnValue(vi.fn()),
    };
    render(<VaultGraphView />);
    await waitFor(() => {
      expect(screen.getByText(/No notes found/i)).toBeInTheDocument();
    });
  });

  it('renders a graph canvas region', async () => {
    render(<VaultGraphView />);
    await waitFor(() => {
      expect(screen.getByRole('region', { name: /vault note graph/i })).toBeInTheDocument();
    });
  });

  it('calls onOpenNote callback when registered', async () => {
    const onOpenNote = vi.fn();
    render(<VaultGraphView onOpenNote={onOpenNote} />);
    await waitFor(() => {
      expect(screen.getByTestId('vault-graph-view')).toBeInTheDocument();
    });
    expect(typeof onOpenNote).toBe('function');
  });
});
