# Vault Graph View — Design Document

**Issue:** MYT-348  
**Phase:** 5 — Story Planning Surfaces  
**Status:** First-cut implemented

---

## Overview

The Vault Graph View is an Obsidian-compatible interactive graph of Notes Vault notes and their `[[wiki-link]]` relationships. It surfaces connections between worldbuilding notes (characters, locations, lore, scene cards) so the author can explore and navigate their vault visually.

It is distinct from the **Story Timeline** (which is archive-driven and sequenced per story) and the **Scene Crafter board** (per-story Kanban). The graph is vault-wide and link-topology-driven.

---

## Node / Edge Schema

### Nodes

Each node represents a single markdown file in the Notes Vault.

| Field | Source | Description |
|-------|--------|-------------|
| `id` | `frontmatter.id` or `file.path` | Stable identifier; frontmatter id wins to survive renames |
| `label` | `frontmatter.title` or filename stem | Display name |
| `path` | Vault-relative file path | Used to open the note on click |
| `folder` | Parent directory of `path` | One level; used by folder filter (`undefined` for root files) |
| `tags` | `frontmatter.tags[]` | Used by tag filter; frontmatter array, all values cast to strings |

Nodes with a `frontmatter.id` survive file renames without breaking edges. Files without `id` fall back to `path`, so edges are still resolved for plain Obsidian notes.

### Edges

Each edge represents a `[[wiki-link]]` from one note to another.

| Field | Value | Description |
|-------|-------|-------------|
| `source` | Node id of the linking file | Resolved via id or path |
| `target` | Node id of the linked file | Resolved by stem lookup |

Regex used to extract links:

```
/\[\[([^\]|#]+?)(?:[|#][^\]]*?)?\]\]/g
```

This strips display aliases (`[[target|alias]]`) and heading/block anchors (`[[target#heading]]`), normalising to the bare target stem. The stem is lowercased before lookup so `[[Scene One]]` matches `scene one.md`.

Duplicate edges (same source/target pair) are deduplicated via a `Set<string>` keyed on `"source→target"`. Self-links are dropped.

---

## Layout Algorithm

**Choice: Custom Fruchterman–Reingold force-directed layout, computed once on data load.**

React Flow already supports arbitrary node positions so any layout can be pre-computed and injected as initial positions. The F-R algorithm was chosen because:

- It is well-understood and produces readable "organic" graphs without a heavy library dependency.
- A single-pass run of ~80 iterations at startup is imperceptible for ≤ 2,000 nodes (< 30 ms on a modern CPU).
- It naturally clusters densely-linked notes (e.g. all character notes that reference the same location) close together, matching author mental models.
- React Flow's built-in `fitView` handles zoom normalisation so the initial layout does not need to be tuned per vault.

**Alternatives considered:**

| Option | Reason rejected |
|--------|-----------------|
| dagre (hierarchical) | Implies a root/parent hierarchy that vault notes don't have |
| elkjs (ELK layered) | Heavyweight WASM dependency; overkill for note graphs |
| d3-force (live simulation) | Continuous re-render is expensive at 1k+ nodes; one-shot is sufficient |
| Random / grid | Poor readability for link-heavy vaults |

**Layout parameters:**

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Canvas size | 900 × 700 | Matches typical 1080p viewport minus chrome |
| Initial placement | Circle | Prevents degenerate start positions |
| Repulsion constant `k` | `sqrt(W*H / N)` | Standard F-R normalisation |
| Iterations | 80 | Empirically converges in < 30 ms for 2 000 nodes |
| Cooling schedule | `temp = W / (iter + 1)` | Linear cool-down prevents oscillation |
| Boundary clamping | `[40, W-40] × [40, H-40]` | Prevents nodes escaping visible canvas |

---

## Performance Budget

**Target: 5,000 notes at interactive frame rates (≥ 30 fps, < 2 s load).**

### Node sampling

When the vault exceeds 2,000 notes the handler returns the first 2,000 by file order. This keeps the layout pass bounded at ~30 ms. The sampling threshold is a constant `MAX_NODES = 2000` in the IPC handler; it can be raised as profiling data matures.

### Layout complexity

F-R is O(N² × iterations) for repulsion. At N = 2,000 and 80 iterations this is ~320 M scalar operations — acceptable in Node.js (~200 ms worst case). The computation runs once on data arrival and results are stored in React state; subsequent filter changes re-run `buildFlowElements` but skip the F-R pass only over the filtered subset, which is typically much smaller.

If the filtered set is a reasonable size (< 500 nodes) the re-layout after a filter change runs in < 10 ms.

### React Flow rendering

React Flow virtualises off-screen nodes. At 2,000 visible nodes, pan/zoom stays at 60 fps on modern hardware because React Flow uses CSS transforms rather than canvas redraws. The MiniMap renders a scaled SVG overlay; at this node count it is still smooth.

For vaults approaching the 5,000-note target a future optimisation is to skip the F-R pass and use a hierarchical clustering + circular layout per cluster.

---

## Filtering UI

Two optional filter dropdowns appear in the toolbar when the data contains multiple values:

### Folder filter

- Dropdown with "All folders" default + one option per unique `folder` value.
- When active, only nodes whose `folder` matches the selected value are shown.
- Nodes at vault root (`folder === undefined`) are only shown when "All folders" is selected.
- Edges are re-filtered to only include pairs where both endpoints survive.

### Tag filter

- Dropdown with "All tags" default + one option per unique tag across all nodes.
- When active, only nodes whose `tags` array includes the selected tag are shown.
- Edges re-filtered the same way.

Filters compose: if both are set, a node must satisfy both. This lets the author narrow to e.g. "characters tagged #antagonist".

Both filters are in-memory — no IPC round-trip. The `buildFlowElements` function re-runs on filter change and updates React Flow state via `setNodes` / `setEdges`.

---

## IPC Contract

**Channel:** `vault:graph-data` (constant `IPC_CHANNELS.VAULT_GRAPH_DATA`)

**Request:** `undefined` (no payload)

**Response:** `VaultGraphDataResponse`

```typescript
interface VaultGraphDataResponse {
  nodes: VaultGraphNode[];
  edges: VaultGraphEdge[];
}

interface VaultGraphNode {
  id: string;
  label: string;
  path: string;
  folder?: string;
  tags?: string[];
}

interface VaultGraphEdge {
  source: string;
  target: string;
}
```

The preload bridge exposes this as `window.api.vaultGraphData()`.

The handler reads from the live vault filesystem (not the manifest) so it always reflects the current state of markdown files, including notes the user edits in Obsidian. This is intentional: the graph is a real-time view of the vault's link topology.

---

## Frontend Architecture

**File:** `frontend/src/VaultGraphView.tsx`  
**Styles:** `frontend/src/VaultGraphView.css`  
**Tests:** `frontend/src/VaultGraphView.test.tsx`

The component:

1. Calls `window.api.vaultGraphData()` once on mount.
2. On success, stores the raw `VaultGraphData` in state.
3. When data or filters change, `buildFlowElements` filters nodes/edges, runs `applyForceLayout` on the filtered set, and produces React Flow `Node[]` / `Edge[]` arrays.
4. React Flow renders the graph with `MiniMap`, `Background` (dot pattern), and `Controls`.
5. Node click fires `onOpenNote(path)`, which the shell uses to navigate to the note in the editor view.

The component is wired into `DesktopShell.tsx` as the `'graph'` view, reachable via the **Graph** button in the top navigation bar.

---

## Open Questions / Future Work

| Item | Priority | Notes |
|------|----------|-------|
| Live reload on vault file change | Medium | Subscribe to `vault:file-changed` push events and re-fetch graph |
| Node colour by entity type | Low | Requires entity-type metadata in the IPC response |
| Raise sampling threshold above 2,000 | Low | Benchmark first; F-R may need to be replaced with a clustering approach |
| Persist graph layout per vault | Low | Store node positions in manifest so repeated opens skip the layout pass |
| Search-to-highlight | Low | Type in toolbar to highlight matching nodes without filtering others out |
| Unlinked note detection | Medium | Surface isolated notes (degree 0) in a separate list |
