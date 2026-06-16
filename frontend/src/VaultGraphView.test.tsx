import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { vi, beforeEach, describe, it, expect } from 'vitest';
import VaultGraphView, {
  buildNeighbourMap,
  computeNodeRadius,
  type VaultGraphData,
} from './VaultGraphView';
import { readContrastFloors } from './themeAxis';

const MOCK_DATA: VaultGraphData = {
  nodes: [
    { id: 'characters/ava.md', label: 'Ava.md', path: 'Characters/Ava.md', category: 'characters', degree: 2 },
    { id: 'locations/citadel.md', label: 'Citadel.md', path: 'Locations/Citadel.md', category: 'locations', degree: 1 },
    { id: 'items/orb.md', label: 'Orb.md', path: 'Items/Orb.md', category: 'items', degree: 1 },
  ],
  edges: [
    { source: 'characters/ava.md', target: 'locations/citadel.md', weight: 1 },
    { source: 'characters/ava.md', target: 'items/orb.md', weight: 1 },
  ],
};

beforeEach(() => {
  (window as any).api = {
    vaultGraphNodes: vi.fn().mockResolvedValue({ nodes: MOCK_DATA.nodes }),
    vaultGraphEdges: vi.fn().mockResolvedValue({ edges: MOCK_DATA.edges }),
  };
});

describe('VaultGraphView', () => {
  it('loads Notes Vault graph nodes and edges from SKY-1756 IPC handlers', async () => {
    render(<VaultGraphView />);

    await waitFor(() => {
      expect(screen.getByTestId('vault-graph-view')).toBeInTheDocument();
    });

    expect((window as any).api.vaultGraphNodes).toHaveBeenCalledTimes(1);
    expect((window as any).api.vaultGraphEdges).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/3 notes · 2 links/)).toBeInTheDocument();
  });

  it('renders circular category-token nodes with radius based on degree', async () => {
    render(<VaultGraphView />);

    const avaNode = await screen.findByRole('button', { name: /open note Ava/i });
    const circle = within(avaNode).getByTestId('vault-graph-node-circle');

    expect(circle).toHaveAttribute('r', String(computeNodeRadius(2)));
    expect(circle).toHaveClass('vgv-node-circle--characters');
    expect(circle.getAttribute('style')).toContain('--ln-graph-node-characters');
  });

  it('dims non-neighbour nodes and unrelated edges on hover', async () => {
    render(<VaultGraphView />);

    const citadelNode = await screen.findByRole('button', { name: /open note Citadel/i });
    fireEvent.mouseEnter(citadelNode);

    expect(screen.getByTestId('vault-node-characters/ava.md')).not.toHaveClass('vgv-graph-node--dimmed');
    expect(screen.getByTestId('vault-node-items/orb.md')).toHaveClass('vgv-graph-node--dimmed');
    expect(screen.getByTestId('vault-edge-characters/ava.md__items/orb.md')).toHaveClass('vgv-graph-edge--dimmed');

    fireEvent.mouseLeave(citadelNode);
    expect(screen.getByTestId('vault-node-items/orb.md')).not.toHaveClass('vgv-graph-node--dimmed');
  });

  it('selects and opens a node on click, then deselects on empty canvas click', async () => {
    const onOpenNote = vi.fn();
    render(<VaultGraphView onOpenNote={onOpenNote} />);

    const avaNode = await screen.findByRole('button', { name: /open note Ava/i });
    fireEvent.click(avaNode);

    expect(onOpenNote).toHaveBeenCalledWith('Characters/Ava.md');
    expect(screen.getByTestId('vault-node-characters/ava.md')).toHaveClass('vgv-graph-node--selected');

    fireEvent.click(screen.getByTestId('vault-graph-canvas'));
    expect(screen.getByTestId('vault-node-characters/ava.md')).not.toHaveClass('vgv-graph-node--selected');
  });

  it('renders reset, zoom in, and zoom out controls', async () => {
    render(<VaultGraphView />);

    await screen.findByTestId('vault-graph-view');
    expect(screen.getByRole('button', { name: /zoom out/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /zoom in/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reset graph view/i })).toBeInTheDocument();
  });

  it('shows error state when v2 IPC handlers are unavailable', async () => {
    (window as any).api = { vaultGraphNodes: vi.fn().mockResolvedValue(undefined) };

    render(<VaultGraphView />);

    await waitFor(() => {
      expect(screen.getByText(/Vault graph IPC handlers are not available/i)).toBeInTheDocument();
    });
  });

  it('shows empty state when no nodes', async () => {
    (window as any).api = {
      vaultGraphNodes: vi.fn().mockResolvedValue({ nodes: [] }),
      vaultGraphEdges: vi.fn().mockResolvedValue({ edges: [] }),
    };

    render(<VaultGraphView />);

    await waitFor(() => {
      expect(screen.getByText(/No notes found/i)).toBeInTheDocument();
    });
  });
});

describe('VaultGraphView graph helpers', () => {
  it('uses orphans at 5px and clamps degree growth at 16px', () => {
    expect(computeNodeRadius(0)).toBe(5);
    expect(computeNodeRadius(2)).toBe(7);
    expect(computeNodeRadius(20)).toBe(16);
    expect(computeNodeRadius(200)).toBe(16);
  });

  it('builds an undirected one-hop neighbour map', () => {
    const neighbours = buildNeighbourMap(MOCK_DATA.edges);

    expect(neighbours.get('characters/ava.md')).toEqual(new Set(['locations/citadel.md', 'items/orb.md']));
    expect(neighbours.get('locations/citadel.md')).toEqual(new Set(['characters/ava.md']));
  });
});

// ─── Contrast floor test at Liquid Neon token values (spec §3, acceptance) ───
// Verifies body text contrast ≥ 4.5:1 at all three slider positions
// (soft=0, default≈40, sharp=100) using the real design-system token values.

describe('contrast floors with Liquid Neon token values', () => {
  beforeEach(() => {
    document.documentElement.style.setProperty('--text-header', 'rgb(237, 236, 246)');
    document.documentElement.style.setProperty('--text-body', 'rgb(191, 214, 232)');
    document.documentElement.style.setProperty('--bg-base', 'rgb(14, 17, 22)');
  });

  it('soft preset: body text contrast ≥ 4.5:1 against composited panel', () => {
    const floors = readContrastFloors();
    expect(floors.soft).toBeGreaterThanOrEqual(4.5);
  });

  it('default preset: body text contrast ≥ 4.5:1 against composited panel', () => {
    const floors = readContrastFloors();
    expect(floors.default).toBeGreaterThanOrEqual(4.5);
  });

  it('sharp preset: body text contrast ≥ 4.5:1 against composited panel', () => {
    const floors = readContrastFloors();
    expect(floors.sharp).toBeGreaterThanOrEqual(4.5);
  });
});
