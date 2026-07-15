import { render, screen, waitFor, fireEvent, within, act } from '@testing-library/react';
import { vi, beforeEach, describe, it, expect } from 'vitest';
import VaultGraphView, {
  buildNeighbourMap,
  categoryColor,
  computeNodeRadius,
  computeDepthVisible,
  deriveNodeBlurb,
  FALLBACK_BLURB,
  hexToRgba,
  PHYSICS_SLIDER_DEFS,
  relayoutSim,
  stepSim,
  SIM_DEFAULTS,
  type SimNodeState,
  type VaultGraphData,
} from './VaultGraphView';
import { readContrastFloors } from './themeAxis';

const MOCK_DATA: VaultGraphData = {
  nodes: [
    { id: 'characters/ava.md', label: 'Ava.md', path: 'Characters/Ava.md', category: 'characters', vault: 'notes', degree: 2 },
    { id: 'locations/citadel.md', label: 'Citadel.md', path: 'Locations/Citadel.md', category: 'locations', vault: 'notes', degree: 1 },
    { id: 'items/orb.md', label: 'Orb.md', path: 'Items/Orb.md', category: 'items', vault: 'notes', degree: 1 },
  ],
  edges: [
    { source: 'characters/ava.md', target: 'locations/citadel.md', weight: 1 },
    { source: 'characters/ava.md', target: 'items/orb.md', weight: 1 },
  ],
};

const MIXED_VAULT_DATA: VaultGraphData = {
  nodes: [
    { id: 'characters/ava.md', label: 'Ava.md', path: 'Characters/Ava.md', category: 'characters', vault: 'notes', degree: 1 },
    {
      id: 'story:story-1:chapter-1:scene-1',
      label: 'Scene One',
      path: 'Story/Chapter One/Scene One.md',
      category: 'scenes',
      vault: 'story',
      storyId: 'story-1',
      chapterId: 'chapter-1',
      sceneId: 'scene-1',
      degree: 1,
    },
  ],
  edges: [
    { source: 'characters/ava.md', target: 'story:story-1:chapter-1:scene-1', weight: 1, crossVault: true },
  ],
};

beforeEach(() => {
  // GH #650: scope persists in localStorage — clear it so tests stay isolated.
  window.localStorage.clear();
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
    expect((window as any).api.vaultGraphNodes).toHaveBeenCalledWith('notes');
    expect((window as any).api.vaultGraphEdges).toHaveBeenCalledWith('notes');
    expect(screen.getByText(/3 notes · 2 links/)).toBeInTheDocument();
  });

  it('renders vault scope selector with Notes selected by default', async () => {
    render(<VaultGraphView />);

    await screen.findByTestId('vault-graph-view');

    const scopeGroup = screen.getByRole('group', { name: /vault scope/i });
    expect(within(scopeGroup).getByRole('button', { name: /notes/i })).toHaveAttribute('aria-pressed', 'true');
    expect(within(scopeGroup).getByRole('button', { name: /story/i })).toHaveAttribute('aria-pressed', 'false');
    expect(within(scopeGroup).getByRole('button', { name: /both/i })).toHaveAttribute('aria-pressed', 'false');
  });

  it('selecting Story scope reloads graph data with scope=story', async () => {
    render(<VaultGraphView />);

    await screen.findByTestId('vault-graph-view');
    const scopeGroup = screen.getByRole('group', { name: /vault scope/i });
    await act(async () => {
      fireEvent.click(within(scopeGroup).getByRole('button', { name: /^story$/i }));
    });

    expect((window as any).api.vaultGraphNodes).toHaveBeenLastCalledWith('story');
    expect((window as any).api.vaultGraphEdges).toHaveBeenLastCalledWith('story');
    expect(within(scopeGroup).getByRole('button', { name: /^story$/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it('supports mixed-vault story nodes, story routing, and cross-vault edge styling', async () => {
    (window as any).api = {
      vaultGraphNodes: vi.fn().mockResolvedValue({ nodes: MIXED_VAULT_DATA.nodes }),
      vaultGraphEdges: vi.fn().mockResolvedValue({ edges: MIXED_VAULT_DATA.edges }),
    };
    const onOpenNote = vi.fn();
    const onOpenScene = vi.fn();

    render(<VaultGraphView initialVaultScope="both" onOpenNote={onOpenNote} onOpenScene={onOpenScene} />);

    const sceneNode = await screen.findByRole('button', { name: /select scene Scene One/i });
    expect(within(sceneNode).getByTestId('vault-graph-node-circle')).toHaveClass('vgv-node-circle--scenes');
    expect(screen.getByRole('button', { name: /scenes filter/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('vault-edge-characters/ava.md__story:story-1:chapter-1:scene-1')).toHaveClass('vgv-graph-edge--cross-vault');

    // M26: double-click opens the scene (single click only selects)
    fireEvent.doubleClick(sceneNode);

    expect(onOpenScene).toHaveBeenCalledWith('story-1', 'chapter-1', 'scene-1');
    expect(onOpenNote).not.toHaveBeenCalled();
  });

  it('renders circular category-token nodes with radius based on degree', async () => {
    render(<VaultGraphView />);

    const avaNode = await screen.findByRole('button', { name: /select note Ava/i });
    const circle = within(avaNode).getByTestId('vault-graph-node-circle');

    expect(circle).toHaveAttribute('r', String(computeNodeRadius(2)));
    expect(circle).toHaveClass('vgv-node-circle--characters');
    expect(circle.getAttribute('style')).toContain('--ln-graph-node-characters');
  });

  it('dims non-neighbour nodes and unrelated edges on hover', async () => {
    render(<VaultGraphView />);

    const citadelNode = await screen.findByRole('button', { name: /select note Citadel/i });
    fireEvent.mouseEnter(citadelNode);

    expect(screen.getByTestId('vault-node-characters/ava.md')).not.toHaveClass('vgv-graph-node--dimmed');
    expect(screen.getByTestId('vault-node-items/orb.md')).toHaveClass('vgv-graph-node--dimmed');
    expect(screen.getByTestId('vault-edge-characters/ava.md__items/orb.md')).toHaveClass('vgv-graph-edge--dimmed');

    fireEvent.mouseLeave(citadelNode);
    expect(screen.getByTestId('vault-node-items/orb.md')).not.toHaveClass('vgv-graph-node--dimmed');
  });

  it('M26: click selects without opening, double-click opens, canvas click deselects', async () => {
    const onOpenNote = vi.fn();
    render(<VaultGraphView onOpenNote={onOpenNote} />);

    const avaNode = await screen.findByRole('button', { name: /select note Ava/i });
    fireEvent.click(avaNode);

    // Prototype gNodesR pick (6182): click only selects and shows the card.
    expect(onOpenNote).not.toHaveBeenCalled();
    expect(screen.getByTestId('vault-node-characters/ava.md')).toHaveClass('vgv-graph-node--selected');

    fireEvent.doubleClick(avaNode);
    expect(onOpenNote).toHaveBeenCalledWith('Characters/Ava.md');

    fireEvent.click(screen.getByTestId('vault-graph-canvas'));
    expect(screen.getByTestId('vault-node-characters/ava.md')).not.toHaveClass('vgv-graph-node--selected');
  });

  it('renders reset, zoom in, and zoom out controls', async () => {
    render(<VaultGraphView />);

    await screen.findByTestId('vault-graph-view');
    expect(screen.getByRole('button', { name: /zoom out/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /zoom in/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /fit graph view/i })).toBeInTheDocument();
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

    // M26: first Enter selects (shows the node card), second Enter opens.
    fireEvent.keyDown(canvas, { key: 'Enter' });
    expect(onOpenNote).not.toHaveBeenCalled();
    expect(screen.getByTestId('vault-node-characters/ava.md')).toHaveClass('vgv-graph-node--selected');

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

    expect(liveRegion).toHaveTextContent('Ava. characters note. 2 connections. Press Enter to select; press Enter again to open.');
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

    await screen.findByRole('button', { name: /select note Ava/i });

    const chipsGroup = screen.getByRole('group', { name: /category filters/i });
    const characterChip = within(chipsGroup).getByRole('button', { name: /characters filter/i });

    await act(async () => { fireEvent.click(characterChip); });

    expect(screen.queryByRole('button', { name: /select note Ava/i })).not.toBeInTheDocument();
    expect(characterChip).toHaveAttribute('aria-pressed', 'false');
    expect(characterChip).toHaveClass('vgv-chip--inactive');
  });

  it('AC-GV-06: re-enabling a chip restores nodes', async () => {
    render(<VaultGraphView />);

    await screen.findByRole('button', { name: /select note Ava/i });

    const chipsGroup = screen.getByRole('group', { name: /category filters/i });
    const characterChip = within(chipsGroup).getByRole('button', { name: /characters filter/i });

    await act(async () => { fireEvent.click(characterChip); }); // disable
    expect(screen.queryByRole('button', { name: /select note Ava/i })).not.toBeInTheDocument();

    await act(async () => { fireEvent.click(characterChip); }); // re-enable
    expect(await screen.findByRole('button', { name: /select note Ava/i })).toBeInTheDocument();
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

    const avaNode = await screen.findByRole('button', { name: /select note Ava/i });
    await act(async () => { fireEvent.click(avaNode); });

    const slider = screen.getByLabelText(/depth limit/i);
    await act(async () => { fireEvent.change(slider, { target: { value: '1' } }); });

    expect(screen.getByRole('button', { name: /select note Ava/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /select note Citadel/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /select note Orb/i })).toBeInTheDocument();
  });

  // ─── AC-GV-08: Search highlight / dim ────────────────────────────────────────

  it('AC-GV-08: search highlights matching nodes and dims non-matching', async () => {
    render(<VaultGraphView />);

    await screen.findByRole('button', { name: /select note Ava/i });

    const searchInput = screen.getByRole('searchbox', { name: /search nodes/i });
    await act(async () => { fireEvent.change(searchInput, { target: { value: 'Ava' } }); });

    expect(screen.getByTestId('vault-node-characters/ava.md')).toHaveClass('vgv-graph-node--search-match');
    expect(screen.getByTestId('vault-node-locations/citadel.md')).toHaveClass('vgv-graph-node--search-dimmed');
    expect(screen.getByTestId('vault-node-items/orb.md')).toHaveClass('vgv-graph-node--search-dimmed');
  });

  it('AC-GV-08: clearing search restores nodes to rest state', async () => {
    render(<VaultGraphView />);

    await screen.findByRole('button', { name: /select note Ava/i });

    const searchInput = screen.getByRole('searchbox', { name: /search nodes/i });
    await act(async () => { fireEvent.change(searchInput, { target: { value: 'Ava' } }); });
    await act(async () => { fireEvent.change(searchInput, { target: { value: '' } }); });

    expect(screen.getByTestId('vault-node-characters/ava.md')).not.toHaveClass('vgv-graph-node--search-match');
    expect(screen.getByTestId('vault-node-characters/ava.md')).not.toHaveClass('vgv-graph-node--search-dimmed');
    expect(screen.getByTestId('vault-node-locations/citadel.md')).not.toHaveClass('vgv-graph-node--search-dimmed');
  });

  it('AC-GV-08: Escape key clears search query', async () => {
    render(<VaultGraphView />);

    await screen.findByRole('button', { name: /select note Ava/i });

    const searchInput = screen.getByRole('searchbox', { name: /search nodes/i });
    await act(async () => { fireEvent.change(searchInput, { target: { value: 'Ava' } }); });
    await act(async () => { fireEvent.keyDown(window, { key: 'Escape' }); });

    expect((searchInput as HTMLInputElement).value).toBe('');
  });

  // ─── GH #650: vault scope persistence ────────────────────────────────────────

  it('GH #650: restores the persisted scope and fetches with it', async () => {
    window.localStorage.setItem('mythos:vaultGraph:scope', 'both');

    render(<VaultGraphView />);
    await screen.findByTestId('vault-graph-view');

    expect((window as any).api.vaultGraphNodes).toHaveBeenCalledWith('both');
    expect((window as any).api.vaultGraphEdges).toHaveBeenCalledWith('both');
    const scopeGroup = screen.getByRole('group', { name: /vault scope/i });
    expect(within(scopeGroup).getByRole('button', { name: /^both$/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it('GH #650: falls back to notes when the stored scope is invalid', async () => {
    window.localStorage.setItem('mythos:vaultGraph:scope', 'bogus');

    render(<VaultGraphView />);
    await screen.findByTestId('vault-graph-view');

    expect((window as any).api.vaultGraphNodes).toHaveBeenCalledWith('notes');
    const scopeGroup = screen.getByRole('group', { name: /vault scope/i });
    expect(within(scopeGroup).getByRole('button', { name: /^notes$/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it('GH #650: persists a user scope change to localStorage', async () => {
    render(<VaultGraphView />);

    await screen.findByTestId('vault-graph-view');
    const scopeGroup = screen.getByRole('group', { name: /vault scope/i });
    await act(async () => {
      fireEvent.click(within(scopeGroup).getByRole('button', { name: /^story$/i }));
    });

    expect(window.localStorage.getItem('mythos:vaultGraph:scope')).toBe('story');
  });

  it('GH #650: explicit initialVaultScope prop overrides the stored scope without clobbering it', async () => {
    window.localStorage.setItem('mythos:vaultGraph:scope', 'both');

    render(<VaultGraphView initialVaultScope="story" />);
    await screen.findByTestId('vault-graph-view');

    expect((window as any).api.vaultGraphNodes).toHaveBeenCalledWith('story');
    expect(window.localStorage.getItem('mythos:vaultGraph:scope')).toBe('both');
  });

  it('GH #650: falls back to notes when localStorage access throws', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage denied');
    });

    render(<VaultGraphView />);
    await screen.findByTestId('vault-graph-view');

    expect((window as any).api.vaultGraphNodes).toHaveBeenCalledWith('notes');
    getItem.mockRestore();
  });

  it('GH #650: hides the empty-state CTA when no onOpenNote handler is provided (pop-out)', async () => {
    (window as any).api = {
      vaultGraphNodes: vi.fn().mockResolvedValue({ nodes: [] }),
      vaultGraphEdges: vi.fn().mockResolvedValue({ edges: [] }),
    };

    render(<VaultGraphView />);

    await screen.findByTestId('vault-graph-empty');
    expect(screen.queryByTestId('vault-graph-open-note-cta')).not.toBeInTheDocument();
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

// ─── M21: force sim step (deterministic port of prototype stepSim) ───────────

function simNode(x: number, y: number, extra: Partial<SimNodeState> = {}): SimNodeState {
  return { x, y, vx: 0, vy: 0, fx: null, fy: null, ...extra };
}

describe('stepSim (M21 prototype physics port)', () => {
  it('applies center pull, repulsion, spring links, damping, and returns energy', () => {
    const sim = new Map<string, SimNodeState>([
      ['a', simNode(480, 325)],
      ['b', simNode(520, 325)],
    ]);

    const energy = stepSim(sim, ['a', 'b'], [['a', 'b']], SIM_DEFAULTS, () => 0.5);

    // Hand-computed with prototype constants (kC=0.00252, kR=6020 capped at
    // 3.4, kL=0.0088, linkDist=120, damping ×0.85):
    //   a.vx = (0.0504 - 3.4 - 0.704) * 0.85 = -3.44556
    const a = sim.get('a')!;
    const b = sim.get('b')!;
    expect(a.vx).toBeCloseTo(-3.44556, 5);
    expect(b.vx).toBeCloseTo(3.44556, 5);
    expect(a.vy).toBeCloseTo(0, 8);
    expect(a.x).toBeCloseTo(476.55444, 5);
    expect(b.x).toBeCloseTo(523.44556, 5);
    expect(a.y).toBeCloseTo(325, 8);
    expect(energy).toBeCloseTo(6.89112, 5);
  });

  it('clamps velocity to ±4.5 and positions to the 1000×640 sim bounds', () => {
    const fast = new Map<string, SimNodeState>([['a', simNode(500, 325, { vx: 100 })]]);
    stepSim(fast, ['a'], [], SIM_DEFAULTS, () => 0.5);
    expect(fast.get('a')!.vx).toBe(4.5);
    expect(fast.get('a')!.x).toBe(504.5);

    const corner = new Map<string, SimNodeState>([['a', simNode(0, 0)]]);
    stepSim(corner, ['a'], [], SIM_DEFAULTS, () => 0.5);
    expect(corner.get('a')!.x).toBe(36); // clamped to min X
    expect(corner.get('a')!.y).toBe(42); // clamped to min Y
  });

  it('holds pinned nodes at fx/fy with zero velocity and 1 energy each', () => {
    const sim = new Map<string, SimNodeState>([
      ['a', simNode(400, 300, { fx: 100, fy: 100, vx: 2, vy: 2 })],
    ]);

    const energy = stepSim(sim, ['a'], [], SIM_DEFAULTS, () => 0.5);

    const a = sim.get('a')!;
    expect(a.x).toBe(100);
    expect(a.y).toBe(100);
    expect(a.vx).toBe(0);
    expect(a.vy).toBe(0);
    expect(energy).toBe(1);
  });

  it('ignores hidden nodes and edges touching hidden nodes', () => {
    const sim = new Map<string, SimNodeState>([
      ['a', simNode(480, 325)],
      ['hidden', simNode(481, 325)],
    ]);

    stepSim(sim, ['a'], [['a', 'hidden']], SIM_DEFAULTS, () => 0.5);

    const hidden = sim.get('hidden')!;
    expect(hidden.x).toBe(481); // untouched
    expect(hidden.vx).toBe(0);
  });
});

describe('relayoutSim (M21)', () => {
  it('clears pins and randomizes velocities in the ±30 range', () => {
    const sim = new Map<string, SimNodeState>([
      ['a', simNode(200, 200, { fx: 200, fy: 200 })],
      ['b', simNode(400, 400, { vx: 1, vy: -1 })],
    ]);

    relayoutSim(sim, () => 0.75);

    for (const p of sim.values()) {
      expect(p.fx).toBeNull();
      expect(p.fy).toBeNull();
      expect(p.vx).toBeCloseTo(15, 8); // (0.75 - 0.5) * 60
      expect(p.vy).toBeCloseTo(15, 8);
    }
  });
});

// ─── M21: category color mapping ─────────────────────────────────────────────

describe('categoryColor (M21 prototype gCats mapping)', () => {
  it('maps categories to the prototype default palette', () => {
    expect(categoryColor('characters')).toBe('#00f0ff');
    expect(categoryColor('locations')).toBe('#9b5fff');
    expect(categoryColor('factions')).toBe('#ff4dff');
    expect(categoryColor('items')).toBe('#ff9a3d');
    expect(categoryColor('systems')).toBe('#2fe6c8');
    expect(categoryColor('scenes')).toBe('#ffd319'); // Story gold cluster
    expect(categoryColor('history')).toBe('#e0b3ff'); // History / Lore
  });

  it('honors per-category recolor overrides', () => {
    expect(categoryColor('characters', { characters: '#123456' })).toBe('#123456');
    expect(categoryColor('locations', { characters: '#123456' })).toBe('#9b5fff');
  });

  it('hexToRgba converts hex + alpha like the prototype hexA helper', () => {
    expect(hexToRgba('#00f0ff', 0.55)).toBe('rgba(0,240,255,0.550)');
    expect(hexToRgba('#ffd319', 2)).toBe('rgba(255,211,25,1.000)');
  });
});

// ─── M21: star nodes, pinning, inspector, toggles ────────────────────────────

describe('VaultGraphView M21 vault graph v2', () => {
  beforeEach(() => {
    window.localStorage.clear();
    (window as any).api = {
      vaultGraphNodes: vi.fn().mockResolvedValue({ nodes: MOCK_DATA.nodes }),
      vaultGraphEdges: vi.fn().mockResolvedValue({ edges: MOCK_DATA.edges }),
    };
  });

  it('renders a star-glow disc per node from the category gradient', async () => {
    render(<VaultGraphView />);

    const avaNode = await screen.findByRole('button', { name: /select note Ava/i });
    const star = within(avaNode).getByTestId('vault-graph-star');

    expect(star).toHaveClass('vgv-star-disc');
    expect(star.getAttribute('fill')).toMatch(/^url\(#vgv-star-.*-characters\)$/);
    // Star disc is 2× the token-circle radius (degree 2 → r 7 → disc 14)
    expect(star).toHaveAttribute('r', String(computeNodeRadius(2) * 2));
    // lnPulse timing ported from the prototype: 3 + (id.length % 4)s
    const id = 'characters/ava.md';
    expect(star.getAttribute('style')).toContain(`animation-duration: ${3 + (id.length % 4)}s`);
  });

  it('recoloring a category updates its star gradient stops', async () => {
    const { container } = render(<VaultGraphView />);

    await screen.findByRole('button', { name: /select note Ava/i });
    // M26: the recolor wheel lives in the always-mounted left panel now.
    const input = screen.getByLabelText('Recolor Characters');
    await act(async () => { fireEvent.change(input, { target: { value: '#112233' } }); });

    const stop = container.querySelector('radialGradient[id$="-characters"] stop[offset="42%"]');
    expect(stop).not.toBeNull();
    expect(stop!.getAttribute('stop-color')).toBe('#112233');
  });

  it('exposes separate note↔note and story↔note line color inputs with prototype defaults', async () => {
    render(<VaultGraphView />);

    await screen.findByTestId('vault-graph-view');

    expect((screen.getByLabelText('Note ↔ note links color') as HTMLInputElement).value).toBe('#9fc0e8');
    expect((screen.getByLabelText('Story ↔ note links color') as HTMLInputElement).value).toBe('#ffd319');
  });

  it('dragging a node pins it at the drop position; Re-layout clears the pin', async () => {
    render(<VaultGraphView />);

    const avaNode = await screen.findByRole('button', { name: /select note Ava/i });
    const avaGroup = screen.getByTestId('vault-node-characters/ava.md');

    await act(async () => {
      fireEvent.mouseDown(avaNode, { button: 0, clientX: 100, clientY: 100 });
      fireEvent.mouseMove(window, { clientX: 700, clientY: 400 });
    });

    expect(avaGroup).toHaveClass('vgv-graph-node--pinned');
    // jsdom rect is 0×0 → the drag maps through the 1000×640 fallback viewport
    expect(avaGroup.getAttribute('transform')).toBe('translate(700 400)');

    await act(async () => { fireEvent.mouseUp(window); });
    // Pin survives releasing the mouse (M21: drag-to-pin)
    expect(avaGroup).toHaveClass('vgv-graph-node--pinned');
    expect(avaGroup.getAttribute('transform')).toBe('translate(700 400)');

    await act(async () => { fireEvent.click(screen.getByTestId('vault-graph-relayout')); });
    expect(avaGroup).not.toHaveClass('vgv-graph-node--pinned');
  });

  it('a drag does not open the note, a double-click still does', async () => {
    const onOpenNote = vi.fn();
    render(<VaultGraphView onOpenNote={onOpenNote} />);

    const avaNode = await screen.findByRole('button', { name: /select note Ava/i });

    await act(async () => {
      fireEvent.mouseDown(avaNode, { button: 0, clientX: 100, clientY: 100 });
      fireEvent.mouseMove(window, { clientX: 700, clientY: 400 });
      fireEvent.mouseUp(window);
      fireEvent.click(avaNode); // browser fires a click right after mouseup
      fireEvent.doubleClick(avaNode); // a trailing dblclick is swallowed too
    });
    expect(onOpenNote).not.toHaveBeenCalled();

    // After the trailing-click window closes, a double-click opens the note
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    await act(async () => { fireEvent.doubleClick(avaNode); });
    expect(onOpenNote).toHaveBeenCalledWith('Characters/Ava.md');
  });

  it('selecting a node opens the inspector with title, category, blurb, and clickable connections', async () => {
    const onOpenNote = vi.fn();
    render(<VaultGraphView onOpenNote={onOpenNote} />);

    const avaNode = await screen.findByRole('button', { name: /select note Ava/i });
    fireEvent.click(avaNode);

    const inspector = screen.getByTestId('vault-graph-inspector');
    expect(within(inspector).getByTestId('vault-graph-inspector-title')).toHaveTextContent('Ava');
    expect(within(inspector).getByText('Character')).toBeInTheDocument();
    // M26: click selects only — no note open until the card button/dblclick
    expect(onOpenNote).not.toHaveBeenCalled();
    // M26: blurb falls back to the prototype copy when no note IPC is mocked
    expect(within(inspector).getByTestId('vault-graph-inspector-blurb')).toHaveTextContent(FALLBACK_BLURB);

    const connections = within(inspector).getAllByTestId(/^vault-graph-inspector-conn-/);
    expect(connections).toHaveLength(2);

    // Connection rows re-select without opening (prototype gSel.conns pick)
    fireEvent.click(within(inspector).getByTestId('vault-graph-inspector-conn-locations/citadel.md'));
    expect(screen.getByTestId('vault-graph-inspector-title')).toHaveTextContent('Citadel');
    expect(onOpenNote).not.toHaveBeenCalled();

    // The explicit open button opens the selected node
    fireEvent.click(screen.getByTestId('vault-graph-inspector-open'));
    expect(onOpenNote).toHaveBeenLastCalledWith('Locations/Citadel.md');
  });

  it('closes the inspector when the canvas is clicked', async () => {
    render(<VaultGraphView />);

    const avaNode = await screen.findByRole('button', { name: /select note Ava/i });
    fireEvent.click(avaNode);
    expect(screen.getByTestId('vault-graph-inspector')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('vault-graph-canvas'));
    expect(screen.queryByTestId('vault-graph-inspector')).not.toBeInTheDocument();
  });

  it('Story cluster toggle hides and restores story (scenes) nodes', async () => {
    (window as any).api = {
      vaultGraphNodes: vi.fn().mockResolvedValue({ nodes: MIXED_VAULT_DATA.nodes }),
      vaultGraphEdges: vi.fn().mockResolvedValue({ edges: MIXED_VAULT_DATA.edges }),
    };

    render(<VaultGraphView initialVaultScope="both" />);

    await screen.findByRole('button', { name: /select scene Scene One/i });
    // M26: the toolbar switch and the left-panel gold card drive one state.
    const toggle = screen.getByTestId('vault-graph-story-toggle');
    const cardToggle = screen.getByTestId('vault-graph-story-card-toggle');
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(cardToggle).toHaveAttribute('aria-checked', 'true');

    await act(async () => { fireEvent.click(toggle); });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(cardToggle).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByRole('button', { name: /select scene Scene One/i })).not.toBeInTheDocument();
    // The switch mirrors the Scenes chip (single visibility source)
    expect(screen.getByRole('button', { name: /scenes filter/i })).toHaveAttribute('aria-pressed', 'false');

    await act(async () => { fireEvent.click(cardToggle); });
    expect(await screen.findByRole('button', { name: /select scene Scene One/i })).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-checked', 'true');
  });

  it('zoom buttons use multiplicative prototype steps and Fit resets to 100%', async () => {
    render(<VaultGraphView />);

    await screen.findByTestId('vault-graph-view');
    const pct = screen.getByTestId('vault-graph-zoom-pct');
    expect(pct).toHaveTextContent('100%');

    fireEvent.click(screen.getByRole('button', { name: /zoom in/i }));
    expect(pct).toHaveTextContent('118%');

    fireEvent.click(screen.getByRole('button', { name: /fit graph view/i }));
    expect(pct).toHaveTextContent('100%');
  });

  it('M26: Fit resets the viewport but keeps the selection and its node card', async () => {
    render(<VaultGraphView />);

    const avaNode = await screen.findByRole('button', { name: /select note Ava/i });
    fireEvent.click(avaNode);
    expect(screen.getByTestId('vault-graph-inspector')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /zoom in/i }));
    fireEvent.click(screen.getByTestId('vault-graph-fit'));

    expect(screen.getByTestId('vault-graph-zoom-pct')).toHaveTextContent('100%');
    // Prototype gZoomReset (7165) only touches zoom/pan — the card stays.
    expect(screen.getByTestId('vault-graph-inspector')).toBeInTheDocument();
    expect(screen.getByTestId('vault-node-characters/ava.md')).toHaveClass('vgv-graph-node--selected');
  });
});

// ─── M26: left panel, physics sliders, node card, persistence ────────────────

describe('VaultGraphView M26 vault graph refinements', () => {
  beforeEach(() => {
    window.localStorage.clear();
    (window as any).api = {
      vaultGraphNodes: vi.fn().mockResolvedValue({ nodes: MOCK_DATA.nodes }),
      vaultGraphEdges: vi.fn().mockResolvedValue({ edges: MOCK_DATA.edges }),
    };
  });

  it('renders the left panel with category rows: eye toggle, recolor wheel, count', async () => {
    render(<VaultGraphView />);

    await screen.findByTestId('vault-graph-view');
    const panel = screen.getByTestId('vault-graph-left-panel');

    // One row per category chip, each with an eye toggle + wheel + count
    const eye = within(panel).getByTestId('vault-graph-eye-characters');
    expect(eye).toHaveAttribute('aria-pressed', 'true');
    expect(within(panel).getByLabelText('Recolor Characters')).toBeInTheDocument();
    expect(within(panel).getByTestId('vault-graph-count-characters')).toHaveTextContent('1');
    expect(within(panel).getByTestId('vault-graph-count-locations')).toHaveTextContent('1');
    expect(within(panel).getByTestId('vault-graph-count-items')).toHaveTextContent('1');
    expect(within(panel).getByTestId('vault-graph-count-scenes')).toHaveTextContent('0');

    // Gold story-cluster card + forces sliders + hint are all present
    expect(within(panel).getByTestId('vault-graph-story-card')).toBeInTheDocument();
    for (const { key } of PHYSICS_SLIDER_DEFS) {
      expect(within(panel).getByTestId(`vault-graph-physics-${key}`)).toBeInTheDocument();
    }
  });

  it('eye toggle hides the category from the sim but keeps its count', async () => {
    render(<VaultGraphView />);

    await screen.findByRole('button', { name: /select note Ava/i });
    const eye = screen.getByTestId('vault-graph-eye-characters');

    await act(async () => { fireEvent.click(eye); });

    expect(eye).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('button', { name: /select note Ava/i })).not.toBeInTheDocument();
    // Counts describe the vault, not the current visibility
    expect(screen.getByTestId('vault-graph-count-characters')).toHaveTextContent('1');
    // The bottom chip strip mirrors the same state
    expect(screen.getByRole('button', { name: /characters filter/i })).toHaveAttribute('aria-pressed', 'false');

    await act(async () => { fireEvent.click(eye); });
    expect(await screen.findByRole('button', { name: /select note Ava/i })).toBeInTheDocument();
  });

  it('physics sliders show prototype defaults and re-settle the sim live', async () => {
    render(<VaultGraphView />);

    await screen.findByRole('button', { name: /select note Ava/i });

    const slider = screen.getByTestId('vault-graph-physics-linkDistance') as HTMLInputElement;
    expect(slider.value).toBe(String(SIM_DEFAULTS.linkDistance));
    expect(slider.min).toBe('40');
    expect(slider.max).toBe('240');
    expect(screen.getByTestId('vault-graph-physics-linkDistance-value')).toHaveTextContent('120');

    const before = screen.getByTestId('vault-node-characters/ava.md').getAttribute('transform');
    await act(async () => { fireEvent.change(slider, { target: { value: '240' } }); });

    expect(screen.getByTestId('vault-graph-physics-linkDistance-value')).toHaveTextContent('240');
    // The sim re-settles under the new parameters — positions move.
    const after = screen.getByTestId('vault-node-characters/ava.md').getAttribute('transform');
    expect(after).not.toBe(before);
  });

  it('clamps out-of-range physics values to the prototype slider ranges', async () => {
    render(<VaultGraphView />);

    await screen.findByTestId('vault-graph-view');
    const slider = screen.getByTestId('vault-graph-physics-repelForce') as HTMLInputElement;

    await act(async () => { fireEvent.change(slider, { target: { value: '9999' } }); });
    expect(screen.getByTestId('vault-graph-physics-repelForce-value')).toHaveTextContent('30');
  });

  it('persists recolors, hidden categories, and physics across remounts', async () => {
    const { unmount } = render(<VaultGraphView />);

    await screen.findByRole('button', { name: /select note Ava/i });
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Recolor Characters'), { target: { value: '#112233' } });
      fireEvent.change(screen.getByLabelText('Note ↔ note links color'), { target: { value: '#445566' } });
      fireEvent.click(screen.getByTestId('vault-graph-eye-items'));
      fireEvent.change(screen.getByTestId('vault-graph-physics-centerForce'), { target: { value: '12' } });
    });
    unmount();

    render(<VaultGraphView />);
    await screen.findByTestId('vault-graph-view');

    expect((screen.getByLabelText('Recolor Characters') as HTMLInputElement).value).toBe('#112233');
    expect((screen.getByLabelText('Note ↔ note links color') as HTMLInputElement).value).toBe('#445566');
    expect(screen.getByTestId('vault-graph-eye-items')).toHaveAttribute('aria-pressed', 'false');
    expect((screen.getByTestId('vault-graph-physics-centerForce') as HTMLInputElement).value).toBe('12');
    expect(screen.queryByRole('button', { name: /select note Orb/i })).not.toBeInTheDocument();
  });

  it('ignores corrupted stored view state and falls back to defaults', async () => {
    window.localStorage.setItem('mythos:vaultGraph:viewState', '{not json');

    render(<VaultGraphView />);
    await screen.findByTestId('vault-graph-view');

    expect((screen.getByLabelText('Recolor Characters') as HTMLInputElement).value).toBe('#00f0ff');
    expect((screen.getByTestId('vault-graph-physics-linkDistance') as HTMLInputElement).value).toBe('120');
  });

  it('the Filters toolbar button collapses the left panel and persists it', async () => {
    const { unmount } = render(<VaultGraphView />);

    await screen.findByTestId('vault-graph-view');
    const toggle = screen.getByTestId('vault-graph-panel-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    await act(async () => { fireEvent.click(toggle); });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('vault-graph-left-panel')).not.toBeInTheDocument();
    unmount();

    render(<VaultGraphView />);
    await screen.findByTestId('vault-graph-view');
    expect(screen.getByTestId('vault-graph-panel-toggle')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('vault-graph-left-panel')).not.toBeInTheDocument();
  });

  it('node card shows the first prose line of the note as its blurb', async () => {
    (window as any).api.readNotesVault = vi.fn().mockResolvedValue({
      content: '---\ntitle: Ava\n---\n# Heading\n\nAva is the **reluctant heir** of [[Veynn|the city]].\n',
      path: 'Characters/Ava.md',
    });

    render(<VaultGraphView />);
    const avaNode = await screen.findByRole('button', { name: /select note Ava/i });
    fireEvent.click(avaNode);

    await waitFor(() => {
      expect(screen.getByTestId('vault-graph-inspector-blurb'))
        .toHaveTextContent('Ava is the reluctant heir of the city.');
    });
    expect((window as any).api.readNotesVault).toHaveBeenCalledWith('Characters/Ava.md');
  });

  it('node card falls back to the prototype blurb when the note has no prose', async () => {
    (window as any).api.readNotesVault = vi.fn().mockResolvedValue({
      content: '---\ntitle: Ava\n---\n# Only headings here\n',
      path: 'Characters/Ava.md',
    });

    render(<VaultGraphView />);
    const avaNode = await screen.findByRole('button', { name: /select note Ava/i });
    fireEvent.click(avaNode);

    await waitFor(() => {
      expect((window as any).api.readNotesVault).toHaveBeenCalled();
    });
    expect(screen.getByTestId('vault-graph-inspector-blurb')).toHaveTextContent(FALLBACK_BLURB);
  });
});

describe('deriveNodeBlurb (M26)', () => {
  it('skips frontmatter, headings, lists, quotes, and fences', () => {
    const content = [
      '---',
      'title: Test',
      'tags: [a, b]',
      '---',
      '# Heading',
      '> quoted line',
      '- list item',
      '```',
      'code line',
      '```',
      'First real prose line.',
    ].join('\n');
    expect(deriveNodeBlurb(content)).toBe('First real prose line.');
  });

  it('unwraps wiki links (aliases win) and strips inline markup', () => {
    expect(deriveNodeBlurb('The [[Broker]] fears *daylight* and `salt`.')).toBe('The Broker fears daylight and salt.');
    expect(deriveNodeBlurb('[[Veynn|The last city]] still stands.')).toBe('The last city still stands.');
  });

  it('clamps to 180 chars with an ellipsis', () => {
    const long = 'a'.repeat(400);
    const blurb = deriveNodeBlurb(long);
    expect(blurb).toHaveLength(180);
    expect(blurb!.endsWith('…')).toBe(true);
  });

  it('returns null for empty or prose-free content', () => {
    expect(deriveNodeBlurb('')).toBeNull();
    expect(deriveNodeBlurb('# Heading only\n\n- list\n')).toBeNull();
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
