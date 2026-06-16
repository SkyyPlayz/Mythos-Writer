import { render, screen, waitFor, fireEvent, within, act } from '@testing-library/react';
import { vi, beforeEach, describe, it, expect } from 'vitest';
import VaultGraphView, {
  buildNeighbourMap,
  computeNodeRadius,
  computeDepthVisible,
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

  it('treats the graph canvas as the single keyboard entry point and cycles nodes by degree then label', async () => {
    const onOpenNote = vi.fn();
    render(<VaultGraphView onOpenNote={onOpenNote} />);

    const canvas = await screen.findByRole('application', { name: /Notes Vault graph/i });
    expect(canvas).toHaveAttribute('tabindex', '0');

    fireEvent.keyDown(canvas, { key: 'Tab' });
    expect(screen.getByTestId('vault-node-characters/ava.md')).toHaveClass('vgv-graph-node--keyboard-focused');

    fireEvent.keyDown(canvas, { key: 'Tab' });
    expect(screen.getByTestId('vault-node-locations/citadel.md')).toHaveClass('vgv-graph-node--keyboard-focused');

    fireEvent.keyDown(canvas, { key: 'Tab', shiftKey: true });
    expect(screen.getByTestId('vault-node-characters/ava.md')).toHaveClass('vgv-graph-node--keyboard-focused');

    fireEvent.keyDown(canvas, { key: 'Enter' });
    expect(onOpenNote).toHaveBeenCalledWith('Characters/Ava.md');
  });

  it('announces graph summary and focused node details through a polite live region', async () => {
    render(<VaultGraphView />);

    const liveRegion = await screen.findByTestId('vault-graph-live-region');
    await waitFor(() => {
      expect(liveRegion).toHaveTextContent('3 notes. 2 connections. 0 orphan notes. No active filters.');
    });
    expect(liveRegion).toHaveAttribute('aria-live', 'polite');

    const canvas = screen.getByRole('application', { name: /Notes Vault graph/i });
    fireEvent.keyDown(canvas, { key: 'Tab' });

    expect(liveRegion).toHaveTextContent('Ava. characters note. 2 connections. Press Enter to open.');
  });

  it('shows an accessible legend popover when multiple categories are visible', async () => {
    render(<VaultGraphView />);

    await screen.findByTestId('vault-graph-view');
    const legendButton = screen.getByRole('button', { name: /legend/i });
    expect(legendButton).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(legendButton);

    expect(legendButton).toHaveAttribute('aria-expanded', 'true');
    const legend = screen.getByRole('dialog', { name: /graph category legend/i });
    expect(within(legend).getByText('Characters')).toBeInTheDocument();
    expect(within(legend).getByText('Locations')).toBeInTheDocument();
    expect(within(legend).getByText('Items')).toBeInTheDocument();
  });

  it('shows error state when v2 IPC handlers are unavailable', async () => {
    (window as any).api = { vaultGraphNodes: vi.fn().mockResolvedValue(undefined) };

    render(<VaultGraphView />);

    await waitFor(() => {
      expect(screen.getByText(/Vault graph IPC handlers are not available/i)).toBeInTheDocument();
    });
  });

  it('AC-GV-09: shows animated empty state with copy and open-note CTA when no wikilinks', async () => {
    (window as any).api = {
      vaultGraphNodes: vi.fn().mockResolvedValue({ nodes: [] }),
      vaultGraphEdges: vi.fn().mockResolvedValue({ edges: [] }),
    };

    const onOpenNote = vi.fn();
    render(<VaultGraphView onOpenNote={onOpenNote} mostRecentNotePath="Notes/recent.md" />);

    const emptyState = await screen.findByTestId('vault-graph-empty');
    expect(emptyState).toBeInTheDocument();
    expect(screen.getByText(/haven't linked up yet/i)).toBeInTheDocument();

    const cta = screen.getByTestId('vault-graph-open-note-cta');
    fireEvent.click(cta);
    expect(onOpenNote).toHaveBeenCalledWith('Notes/recent.md');
  });

  it('AC-GV-09: CTA calls onOpenNote with empty string when no mostRecentNotePath', async () => {
    (window as any).api = {
      vaultGraphNodes: vi.fn().mockResolvedValue({ nodes: [] }),
      vaultGraphEdges: vi.fn().mockResolvedValue({ edges: [] }),
    };

    const onOpenNote = vi.fn();
    render(<VaultGraphView onOpenNote={onOpenNote} />);

    const cta = await screen.findByTestId('vault-graph-open-note-cta');
    fireEvent.click(cta);
    expect(onOpenNote).toHaveBeenCalledWith('');
  });

  it('shows skeleton while loading, before data resolves', async () => {
    let resolveNodes!: (v: unknown) => void;
    (window as any).api = {
      vaultGraphNodes: vi.fn().mockReturnValue(new Promise((r) => { resolveNodes = r; })),
      vaultGraphEdges: vi.fn().mockResolvedValue({ edges: [] }),
    };

    render(<VaultGraphView />);
    expect(screen.getByTestId('vault-graph-skeleton')).toBeInTheDocument();
    await act(async () => { resolveNodes({ nodes: [] }); });
  });

  it('AC-GV-10: renders top-500 by degree + truncation banner when >=500 linked notes', async () => {
    const nodes = Array.from({ length: 520 }, (_, i) => ({
      id: `note-${i}`,
      label: `Note ${i}`,
      path: `note-${i}.md`,
      degree: i,
    }));
    const edges = nodes.slice(0, 50).map((n, i) => ({
      source: n.id,
      target: nodes[(i + 1) % 50].id,
    }));

    (window as any).api = {
      vaultGraphNodes: vi.fn().mockResolvedValue({ nodes }),
      vaultGraphEdges: vi.fn().mockResolvedValue({ edges }),
    };

    render(<VaultGraphView />);

    // applyForceLayout on 500 nodes is O(n²) — allow up to 15 s on slow CI runners
    const banner = await screen.findByTestId('vault-graph-truncation-banner', {}, { timeout: 15_000 });
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveTextContent('520 notes');
    expect(banner).toHaveTextContent('top 500');
    expect(screen.getByRole('button', { name: /show all/i })).toBeInTheDocument();
  }, 30_000);

  it('AC-GV-10: Show all button removes truncation, banner persists until dismissed', async () => {
    const nodes = Array.from({ length: 510 }, (_, i) => ({
      id: `note-${i}`,
      label: `Note ${i}`,
      path: `note-${i}.md`,
      degree: i,
    }));

    (window as any).api = {
      vaultGraphNodes: vi.fn().mockResolvedValue({ nodes }),
      vaultGraphEdges: vi.fn().mockResolvedValue({ edges: [] }),
    };

    render(<VaultGraphView />);
    // initial truncated layout (500 nodes) — allow up to 15 s on slow CI runners
    await screen.findByTestId('vault-graph-truncation-banner', {}, { timeout: 15_000 });

    // "show all" triggers a second applyForceLayout on all 510 nodes — wrap in act() to flush
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /show all/i })); });

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /show all/i })).not.toBeInTheDocument();
    }, { timeout: 15_000 });
    expect(screen.getByTestId('vault-graph-truncation-banner')).toBeInTheDocument();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /dismiss large vault notice/i })); });
    expect(screen.queryByTestId('vault-graph-truncation-banner')).not.toBeInTheDocument();
  }, 30_000);

  // ─── AC-GV-06: Category chip filter ──────────────────────────────────────────

  it('AC-GV-06: renders category filter chips, all active by default', async () => {
    render(<VaultGraphView />);

    await screen.findByTestId('vault-graph-view');

    const chipsGroup = screen.getByRole('group', { name: /category filters/i });
    const characterChip = within(chipsGroup).getByRole('button', { name: /characters filter/i });

    expect(characterChip).toHaveAttribute('aria-pressed', 'true');
    expect(characterChip).toHaveClass('vgv-chip--active');
  });

  it('AC-GV-06: toggling a category chip off hides nodes in that category', async () => {
    render(<VaultGraphView />);

    await screen.findByRole('button', { name: /open note Ava/i });

    const chipsGroup = screen.getByRole('group', { name: /category filters/i });
    const characterChip = within(chipsGroup).getByRole('button', { name: /characters filter/i });

    await act(async () => { fireEvent.click(characterChip); });

    expect(screen.queryByRole('button', { name: /open note Ava/i })).not.toBeInTheDocument();
    expect(characterChip).toHaveAttribute('aria-pressed', 'false');
    expect(characterChip).toHaveClass('vgv-chip--inactive');
  });

  it('AC-GV-06: re-enabling a chip restores nodes', async () => {
    render(<VaultGraphView />);

    await screen.findByRole('button', { name: /open note Ava/i });

    const chipsGroup = screen.getByRole('group', { name: /category filters/i });
    const characterChip = within(chipsGroup).getByRole('button', { name: /characters filter/i });

    await act(async () => { fireEvent.click(characterChip); }); // disable
    expect(screen.queryByRole('button', { name: /open note Ava/i })).not.toBeInTheDocument();

    await act(async () => { fireEvent.click(characterChip); }); // re-enable
    expect(await screen.findByRole('button', { name: /open note Ava/i })).toBeInTheDocument();
  });

  // ─── AC-GV-07: Depth slider ───────────────────────────────────────────────────

  it('AC-GV-07: renders depth slider with default value All', async () => {
    render(<VaultGraphView />);

    await screen.findByTestId('vault-graph-view');

    const slider = screen.getByLabelText(/depth limit/i);
    expect(slider).toBeInTheDocument();
    expect((slider as HTMLInputElement).value).toBe('7');
    expect(screen.getByText(/Depth: All/)).toBeInTheDocument();
  });

  it('AC-GV-07: with node selected and depth=1, only direct neighbours visible', async () => {
    render(<VaultGraphView />);

    const avaNode = await screen.findByRole('button', { name: /open note Ava/i });
    await act(async () => { fireEvent.click(avaNode); });

    const slider = screen.getByLabelText(/depth limit/i);
    await act(async () => { fireEvent.change(slider, { target: { value: '1' } }); });

    expect(screen.getByRole('button', { name: /open note Ava/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open note Citadel/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open note Orb/i })).toBeInTheDocument();
  });

  // ─── AC-GV-08: Search highlight / dim ────────────────────────────────────────

  it('AC-GV-08: search highlights matching nodes and dims non-matching', async () => {
    render(<VaultGraphView />);

    await screen.findByRole('button', { name: /open note Ava/i });

    const searchInput = screen.getByRole('searchbox', { name: /search nodes/i });
    await act(async () => { fireEvent.change(searchInput, { target: { value: 'Ava' } }); });

    expect(screen.getByTestId('vault-node-characters/ava.md')).toHaveClass('vgv-graph-node--search-match');
    expect(screen.getByTestId('vault-node-locations/citadel.md')).toHaveClass('vgv-graph-node--search-dimmed');
    expect(screen.getByTestId('vault-node-items/orb.md')).toHaveClass('vgv-graph-node--search-dimmed');
  });

  it('AC-GV-08: clearing search restores nodes to rest state', async () => {
    render(<VaultGraphView />);

    await screen.findByRole('button', { name: /open note Ava/i });

    const searchInput = screen.getByRole('searchbox', { name: /search nodes/i });
    await act(async () => { fireEvent.change(searchInput, { target: { value: 'Ava' } }); });
    await act(async () => { fireEvent.change(searchInput, { target: { value: '' } }); });

    expect(screen.getByTestId('vault-node-characters/ava.md')).not.toHaveClass('vgv-graph-node--search-match');
    expect(screen.getByTestId('vault-node-characters/ava.md')).not.toHaveClass('vgv-graph-node--search-dimmed');
    expect(screen.getByTestId('vault-node-locations/citadel.md')).not.toHaveClass('vgv-graph-node--search-dimmed');
  });

  it('AC-GV-08: Escape key clears search query', async () => {
    render(<VaultGraphView />);

    await screen.findByRole('button', { name: /open note Ava/i });

    const searchInput = screen.getByRole('searchbox', { name: /search nodes/i });
    await act(async () => { fireEvent.change(searchInput, { target: { value: 'Ava' } }); });
    await act(async () => { fireEvent.keyDown(window, { key: 'Escape' }); });

    expect((searchInput as HTMLInputElement).value).toBe('');
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

describe('computeDepthVisible', () => {
  const allIds = ['a', 'b', 'c', 'd'];
  const edges = [
    { source: 'a', target: 'b' },
    { source: 'b', target: 'c' },
  ];
  const neighbours = buildNeighbourMap(edges);

  it('returns null when depth >= 7 (unlimited)', () => {
    expect(computeDepthVisible('a', allIds, neighbours, 7)).toBeNull();
  });

  it('with a selected node and depth=1, returns node + direct neighbours', () => {
    const visible = computeDepthVisible('a', allIds, neighbours, 1);
    expect(visible).not.toBeNull();
    expect(visible!.has('a')).toBe(true);
    expect(visible!.has('b')).toBe(true);
    expect(visible!.has('c')).toBe(false);
  });

  it('with a selected node and depth=2, returns node + 2-hop neighbours', () => {
    const visible = computeDepthVisible('a', allIds, neighbours, 2);
    expect(visible!.has('a')).toBe(true);
    expect(visible!.has('b')).toBe(true);
    expect(visible!.has('c')).toBe(true);
  });

  it('with no selection, orphans are always visible', () => {
    const visible = computeDepthVisible(null, allIds, neighbours, 1);
    expect(visible!.has('d')).toBe(true);
  });
});

// ─── Contrast floor test at Liquid Neon token values ─────────────────────────

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
