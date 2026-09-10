/**
 * SKY-11184: Notes Board top-level tab panel.
 * Renders a breadcrumb nav + BoardCanvas for the current board folder.
 * BOARDS-SPEC.md §1, §5.
 * SKY-11186: resolves each note child's thumbnail (spec §9) alongside the
 * listing, threads the zoom-out limit setting through, and reloads the open
 * board when the Notes vault changes on disk.
 * SKY-11191 §11: cross-board search, the wiki-link overlay toggle and the
 * minimap toggle. All three are purely derived — the panel owns the two data
 * sources (the recursive vault listing and the Vault Graph's link index) and
 * the canvas owns the geometry; nothing new is written to Store B.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import BoardCanvas from './BoardCanvas';
import type { BoardTool, BoardFurnitureItemData } from './BoardCanvas';
import type { FurnitureKind } from './boardLod';
import { useNotesBoard, vaultPathOf } from './useNotesBoard';
import { boardWikiLinks, furnitureAnchorRects } from './boardLinks';
import type { VaultGraphEdge } from './boardLinks';
import { searchVaultIndex } from './boardSearch';
import type { BoardSearchHit, VaultIndexEntry } from './boardSearch';
import { validateRenameName } from '../../components/VaultBrowser/renameUtils';
import { basenameNoExt } from '../../crossTabLinkResolver';
import './BoardsTabPanel.css';

/**
 * SKY-11188 (§4/§5): default seed content per furniture kind, matching the
 * prototype's own `bdAdd` seeds exactly (owner-reports/…Liquid Neon.dc.html)
 * so a freshly-created column/checklist/table isn't empty chrome.
 */
const FURNITURE_SEEDS: Record<FurnitureKind, Record<string, unknown>> = {
  column: { title: 'New column', items: [{ t: 'First card' }] },
  check: { title: 'To-do', items: [{ t: 'First task', done: false }, { t: 'Second task', done: false }] },
  table: { title: 'Table', rows: [['Column', 'Column'], ['', ''], ['', '']] },
  image: { title: 'Image', w: 260, h: 150 },
  sketch: { title: 'Sketch', w: 260, h: 150 },
  swatch: { title: 'Palette', colors: null },
  // `line` is created by picking two items on the canvas, not from the
  // toolbar — it has no standalone seed (§4: "endpoints are item keys").
  line: {},
};

export const FURNITURE_TOOLBAR_KINDS: Array<{ kind: FurnitureKind; label: string }> = [
  { kind: 'column', label: 'Column' },
  { kind: 'check', label: 'To-do list' },
  { kind: 'table', label: 'Table' },
  { kind: 'image', label: 'Image' },
  { kind: 'sketch', label: 'Sketch' },
  { kind: 'swatch', label: 'Colour swatch' },
];

interface BreadcrumbEntry {
  folderPath: string;
  name: string;
}

export interface BoardsTabPanelProps {
  notesVaultRoot: string;
  notesVaultValid: boolean;
  /** SKY-11186: Settings → Editor → Notes Board zoom-out limit (percent). */
  minZoom?: number;
  /**
   * SKY-11615: navigate straight to a vault-relative folder — a `[[Folder]]`
   * wiki-link click elsewhere in the app. `seq` is bumped per request so
   * re-clicking the folder you are already on still re-navigates.
   */
  openFolderRequest?: { folderPath: string; seq: number } | null;
  /** SKY-11188: a column item's `ref` click — opens that vault-relative note path (§4). */
  onOpenNote?: (path: string) => void;
  /**
   * SKY-11188: live note paths (DesktopShell.allNotePaths), so a column `ref`
   * resolves by case-insensitive filename-stem — same rule as
   * `shared/wikiLinkRename.ts`/`notesBoard.ts`'s rename cascade and
   * `crossTabLinkResolver.ts`'s wikilink resolution — instead of being handed
   * to `onOpenNote` as if it were already an exact vault path.
   */
  notePaths?: string[];
}

/**
 * SKY-11336: a board's `folderPath` is VAULT-RELATIVE, and the vault root —
 * the Home board — is the empty string.
 *
 * That is the contract the main process already documents and enforces on
 * every `notesBoard:*` channel (main.ts sandboxes with `safeVaultDirIpcJoin`,
 * notesBoard.ts resolves with `path.join(vaultRoot, folderRelPath)`), so the
 * renderer normalises to it rather than teaching main a second, absolute form.
 * Seeding Home with the ABSOLUTE notes-vault root instead is what broke the
 * Home board for a whole beta: the absolute value slipped past the sandbox
 * (path.resolve collapses it back to root) and then resolved to a doubled,
 * non-existent folder, so every Home-level write landed nowhere.
 */
const HOME_CRUMB: BreadcrumbEntry = { folderPath: '', name: 'Home' };

/** SKY-11615: breadcrumb stack for an arbitrary vault-relative folder path,
 *  so a deep-linked board still shows the trail back up to Home. */
function breadcrumbForFolder(folderPath: string): BreadcrumbEntry[] {
  const crumbs: BreadcrumbEntry[] = [HOME_CRUMB];
  let parent = '';
  for (const segment of folderPath.split('/').filter(Boolean)) {
    parent = vaultPathOf(parent, segment);
    crumbs.push({ folderPath: parent, name: segment });
  }
  return crumbs;
}

/** SKY-11191: `aria-activedescendant` target for the nth search hit. */
const searchOptionId = (index: number): string => `boards-search-hit-${index}`;

/**
 * SKY-11187 §5: the canvas tool palette. Text labels rather than glyphs —
 * there is no owner mockup for this row yet, and a labelled control is the
 * one version that is unambiguous to both a screen reader and a first-time
 * user. Swap in the mockup's icons when the Boards chrome spec lands.
 */
const TOOLS: ReadonlyArray<{ id: BoardTool; label: string; title: string }> = [
  { id: 'select', label: 'Select', title: 'Select and move items' },
  { id: 'note', label: 'Note', title: 'Note tool — click the canvas to create a note' },
  { id: 'board', label: 'Board', title: 'Board tool — click the canvas to create a board' },
];

export default function BoardsTabPanel({ notesVaultRoot, notesVaultValid, minZoom, openFolderRequest, onOpenNote, notePaths }: BoardsTabPanelProps) {
  // Breadcrumb stack — bottom is home (vault root), top is current board
  const [breadcrumb, setBreadcrumb] = useState<BreadcrumbEntry[]>([HOME_CRUMB]);

  const currentFolder = breadcrumb[breadcrumb.length - 1].folderPath;

  // Reset breadcrumb when vault root changes
  useEffect(() => {
    setBreadcrumb([HOME_CRUMB]);
  }, [notesVaultRoot]);

  // SKY-11615: external deep-link (a `[[Folder]]` wiki-link click). Keyed on
  // `seq`, not the path, so the same folder can be requested twice.
  const requestSeq = openFolderRequest?.seq;
  const requestPath = openFolderRequest?.folderPath;
  useEffect(() => {
    if (requestSeq === undefined || requestPath === undefined) return;
    setBreadcrumb(breadcrumbForFolder(requestPath));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `seq` is the trigger; the path rides along with it.
  }, [requestSeq]);

  // SKY-11192/SKY-11674: the load/save slice (including SKY-11188's
  // furniture) is the shared hook — see useNotesBoard.ts. Brainstorm's
  // Board page and chat strip use the exact same hook against their own
  // mapped folder, so an edit from either home is the same state, not a sync.
  const {
    items, savedLayout, savedView, furniture, itemKeysByPath, setFurniture,
    loading, error, handleItemMove, handleItemResize, handleViewChange, reload,
  } = useNotesBoard(currentFolder, notesVaultValid);

  // SKY-11187 §5: the canvas tools and the inline rename they hand off to.
  const [activeTool, setActiveTool] = useState<BoardTool>('select');
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  /** A refused vault mutation (name collision, invalid characters, fs error). */
  const [actionError, setActionError] = useState<string | null>(null);

  // ── SKY-11191 §11: wiki-link overlay + minimap ──────────────────────────
  //
  // Both are VIEW state, deliberately not persisted anywhere: the ticket's
  // third acceptance criterion is that killing and reloading the app needs no
  // stored state for either to reconstruct. The overlay starts off (it is a
  // toggle, and an unasked-for web of lines over a fresh board is noise); the
  // minimap starts on, because it is the board's own shape and costs nothing
  // to read.
  const [wikiLinkOverlay, setWikiLinkOverlay] = useState(false);
  const [showMinimap, setShowMinimap] = useState(true);

  // The link graph itself is the Vault Graph's index (vaultGraph.ts) — the
  // one that already resolves `[[wikilinks]]` by note name and records
  // backlinks. Fetched only while the overlay is on, and refetched when the
  // watcher reports a topology change (a link added or removed).
  const [graphEdges, setGraphEdges] = useState<VaultGraphEdge[]>([]);

  useEffect(() => {
    if (!wikiLinkOverlay || !notesVaultValid) {
      setGraphEdges([]);
      return;
    }
    let cancelled = false;
    const fetchEdges = async () => {
      try {
        const res = await window.api.vaultGraphEdges('notes');
        if (!cancelled) setGraphEdges(res.edges);
      } catch (err) {
        // The overlay is an enhancement over a board that works without it —
        // a graph that cannot be read draws no connectors rather than
        // taking the board down with it.
        console.warn('[Boards] failed to read the vault link graph', err);
        if (!cancelled) setGraphEdges([]);
      }
    };
    void fetchEdges();
    const unsubscribe = window.api.onVaultGraphTopologyChanged?.(() => { void fetchEdges(); });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [wikiLinkOverlay, notesVaultValid]);

  const wikiLinks = useMemo(
    () =>
      wikiLinkOverlay
        ? boardWikiLinks({ folderPath: currentFolder, items, edges: graphEdges, furniture })
        : [],
    [wikiLinkOverlay, currentFolder, items, graphEdges, furniture],
  );

  // Ticket 5's `column` boxes are anchors the canvas does not lay out itself —
  // their geometry lives in Store B, so it is resolved here and handed over.
  const linkAnchors = useMemo(
    () => (wikiLinkOverlay ? furnitureAnchorRects(furniture) : undefined),
    [wikiLinkOverlay, furniture],
  );

  // ── SKY-11191 §11: cross-board search ───────────────────────────────────
  //
  // The name index is `listNotesVault('')` — already recursive, so one call
  // from the vault root indexes every folder and note. Loaded lazily on the
  // first keystroke and dropped when the vault changes, so a board that is
  // never searched never pays for the walk.
  const [searchQuery, setSearchQuery] = useState('');
  const [vaultIndex, setVaultIndex] = useState<VaultIndexEntry[] | null>(null);
  const [indexing, setIndexing] = useState(false);
  /** The hit to select once its board is open. `seq` re-fires on the same hit. */
  const [selectRequest, setSelectRequest] = useState<{ itemPath: string; seq: number } | null>(null);
  const selectSeqRef = useRef(0);

  useEffect(() => {
    // A vault mutation (create, rename, delete) invalidates the name index.
    setVaultIndex(null);
  }, [notesVaultRoot, items]);

  useEffect(() => {
    if (!searchQuery.trim() || vaultIndex !== null || !notesVaultValid) return;
    let cancelled = false;
    setIndexing(true);
    void (async () => {
      try {
        const res = (await window.api.listNotesVault('')) as { items: VaultIndexEntry[] } | { error: string };
        if (cancelled) return;
        setVaultIndex('error' in res ? [] : res.items);
      } catch {
        if (!cancelled) setVaultIndex([]);
      } finally {
        if (!cancelled) setIndexing(false);
      }
    })();
    return () => { cancelled = true; };
  }, [searchQuery, vaultIndex, notesVaultValid]);

  const searchHits = useMemo(
    () => (vaultIndex ? searchVaultIndex(vaultIndex, searchQuery) : []),
    [vaultIndex, searchQuery],
  );

  /**
   * Navigate to the board that CONTAINS the hit and select the item there —
   * including for a hit nested many boards down, which is why the breadcrumb
   * is rebuilt from the hit's folder path rather than pushed onto.
   */
  const handleSearchHit = useCallback((hit: BoardSearchHit) => {
    setBreadcrumb(breadcrumbForFolder(hit.boardPath));
    setSelectRequest({ itemPath: hit.itemPath, seq: ++selectSeqRef.current });
    setSearchQuery('');
  }, []);

  /** Which hit Enter would take. Reset whenever the result set changes. */
  const [activeHit, setActiveHit] = useState(0);
  useEffect(() => { setActiveHit(0); }, [searchQuery]);

  const handleSearchKeyDown = useCallback((e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { setSearchQuery(''); return; }
    if (searchHits.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveHit((i) => (i + 1) % searchHits.length);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveHit((i) => (i - 1 + searchHits.length) % searchHits.length);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSearchHit(searchHits[activeHit] ?? searchHits[0]);
    }
  }, [searchHits, activeHit, handleSearchHit]);


  // ── SKY-11187 §5: vault-mutating canvas operations ──────────────────────
  //
  // These are REAL filesystem mutations, not metadata edits (§1: the Notes
  // tab and this canvas are two renderings of one filesystem). Both go
  // through `notesBoard:createItem` / `notesBoard:renameItem`, which do the
  // fs work in main AND push `vault:notes-updated` — so the Notes tree
  // reflects them without waiting on the notes watcher.
  //
  // Home (currentFolder === '') is NOT special-cased anywhere below: the
  // root board creates, names and renames exactly like a nested one.

  const handleCreateItem = useCallback(async (kind: 'note' | 'folder', x: number, y: number) => {
    // One-shot tool: disarm before the await, so a second click landing
    // during the round-trip cannot create a second item.
    setActiveTool('select');
    setActionError(null);
    try {
      const created = await window.api.notesBoardCreateItem(currentFolder, kind, { x, y });
      reload();
      // Straight into inline rename — the placeholder name ("New note") is a
      // prompt, not a decision.
      setRenamingPath(created.itemPath);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }, [currentFolder, reload]);

  const handleRenameCommit = useCallback(async (itemPath: string, newName: string) => {
    setRenamingPath(null);
    // §5: an empty name is a no-op — leave the item exactly as it is. Checked
    // here as well as in main so the round-trip is skipped entirely.
    if (!newName.trim()) return;
    const invalid = validateRenameName(newName);
    if (invalid) { setActionError(invalid); return; }
    setActionError(null);
    try {
      const res = await window.api.notesBoardRenameItem(currentFolder, itemPath, newName);
      if ('error' in res) { setActionError(res.error); return; }
      if (!res.renamed) return; // unchanged name — nothing moved on disk
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }, [currentFolder, reload]);

  const handleRenameCancel = useCallback(() => setRenamingPath(null), []);
  const handleRequestRename = useCallback((itemPath: string) => setRenamingPath(itemPath), []);

  // Navigating to another board drops any half-finished rename and disarms
  // the tool — neither addresses anything on the board you just opened.
  useEffect(() => {
    setRenamingPath(null);
    setActiveTool('select');
    setActionError(null);
  }, [currentFolder]);

  // ── SKY-11188: furniture CRUD (§4) — structural ops, immediate writes,
  // matching notesBoard.ts's furnitureCreate/Update/Delete contract. ──
  const handleFurnitureCreate = useCallback(async (kind: FurnitureKind) => {
    try {
      const seed = FURNITURE_SEEDS[kind];
      // A simple grid so successive adds don't overlap each other —
      // "Tidy up"/drag is how a user actually arranges them afterwards.
      const col = furniture.length % 4;
      const row = Math.floor(furniture.length / 4);
      const x = 48 + col * 300;
      const y = 44 + row * 260;
      const { item } = await window.api.notesBoardFurnitureCreate(currentFolder, { k: kind, x, y, ...seed });
      setFurniture((prev) => [...prev, item as unknown as BoardFurnitureItemData]);
    } catch (err) {
      console.warn('[Boards] failed to create furniture', err);
    }
  }, [currentFolder, furniture.length, setFurniture]);

  const handleFurnitureMove = useCallback(async (id: string, x: number, y: number) => {
    try {
      const { item } = await window.api.notesBoardFurnitureUpdate(currentFolder, id, { x, y });
      if (item) setFurniture((prev) => prev.map((f) => (f.id === id ? (item as unknown as BoardFurnitureItemData) : f)));
    } catch (err) {
      console.warn('[Boards] failed to persist furniture position', err);
    }
  }, [currentFolder, setFurniture]);

  const handleFurnitureResize = useCallback(async (id: string, w: number, h: number) => {
    try {
      const { item } = await window.api.notesBoardFurnitureUpdate(currentFolder, id, { w, h });
      if (item) setFurniture((prev) => prev.map((f) => (f.id === id ? (item as unknown as BoardFurnitureItemData) : f)));
    } catch (err) {
      console.warn('[Boards] failed to persist furniture size', err);
    }
  }, [currentFolder, setFurniture]);

  const handleFurnitureColor = useCallback(async (id: string, hex: string) => {
    try {
      const { item } = await window.api.notesBoardFurnitureUpdate(currentFolder, id, { color: hex });
      if (item) setFurniture((prev) => prev.map((f) => (f.id === id ? (item as unknown as BoardFurnitureItemData) : f)));
    } catch (err) {
      console.warn('[Boards] failed to persist furniture colour', err);
    }
  }, [currentFolder, setFurniture]);

  const handleFurnitureCheckToggle = useCallback(async (id: string, index: number) => {
    const current = furniture.find((f) => f.id === id);
    if (!current || !current.items) return;
    const items = current.items.map((it, i) => (i === index ? { ...it, done: !it.done } : it));
    try {
      const { item } = await window.api.notesBoardFurnitureUpdate(currentFolder, id, { items });
      if (item) setFurniture((prev) => prev.map((f) => (f.id === id ? (item as unknown as BoardFurnitureItemData) : f)));
    } catch (err) {
      console.warn('[Boards] failed to persist checklist toggle', err);
    }
  }, [currentFolder, furniture, setFurniture]);

  const handleFurnitureDelete = useCallback(async (id: string) => {
    try {
      await window.api.notesBoardFurnitureDelete(currentFolder, id);
      // The server cascade-deletes every `line` referencing this item too
      // (§4) — mirror that locally so a stale line doesn't flash into empty
      // space for one frame before the next reload.
      const key = `x:${id}`;
      setFurniture((prev) => prev.filter((f) => f.id !== id && !(f.k === 'line' && (f.from === key || f.to === key))));
    } catch (err) {
      console.warn('[Boards] failed to delete furniture', err);
    }
  }, [currentFolder, setFurniture]);

  const handleOpenNoteRef = useCallback((ref: string) => {
    const stem = basenameNoExt(ref);
    const resolved = (notePaths ?? []).find((p) => basenameNoExt(p) === stem);
    if (!resolved) {
      console.warn('[Boards] column ref did not resolve to a note', ref);
      return;
    }
    onOpenNote?.(resolved);
  }, [onOpenNote, notePaths]);

  // ── SKY-11188: "Connect" tool — line furniture (§4) between two furniture
  // items, picked by two clicks (mirrors the prototype's bdTool==='line'). ──
  const [lineToolActive, setLineToolActive] = useState(false);
  const [lineFromId, setLineFromId] = useState<string | null>(null);

  const handleFurniturePick = useCallback(async (id: string) => {
    if (!lineFromId) {
      setLineFromId(id);
      return;
    }
    if (lineFromId === id) {
      setLineFromId(null);
      return;
    }
    const from = lineFromId;
    setLineFromId(null);
    setLineToolActive(false);
    try {
      const { item } = await window.api.notesBoardFurnitureCreate(currentFolder, {
        k: 'line',
        // `line` has no rendered box (BoardFurnitureLines draws it as an SVG
        // overlay from its endpoints' own boxes), but sanitizeFurniture
        // (notesBoard.ts) rejects any record missing x/y — without inert
        // coordinates here the connector survives the initial write but is
        // dropped on the very next reload.
        x: 0,
        y: 0,
        from: `x:${from}`,
        to: `x:${id}`,
        label: '',
        color: null,
      });
      setFurniture((prev) => [...prev, item as unknown as BoardFurnitureItemData]);
    } catch (err) {
      console.warn('[Boards] failed to create connector', err);
    }
  }, [currentFolder, lineFromId, setFurniture]);

  // BoardCanvas hands back the tile's path relative to the CURRENT board, so
  // join it onto the current folder to keep folderPath vault-relative at any
  // depth. A bare item path was only ever correct one level below Home.
  const handleEnterBoard = useCallback((itemPath: string) => {
    const folderName = items.find((i) => i.path === itemPath)?.name ?? itemPath.split('/').pop() ?? itemPath;
    setBreadcrumb((prev) => {
      const parent = prev[prev.length - 1].folderPath;
      return [...prev, { folderPath: vaultPathOf(parent, itemPath), name: folderName }];
    });
  }, [items]);

  const handleBreadcrumbClick = useCallback((index: number) => {
    setBreadcrumb((prev) => prev.slice(0, index + 1));
  }, []);

  if (!notesVaultValid) {
    return (
      <div className="boards-tab-panel__empty" role="main" aria-label="Boards">
        <p className="boards-tab-panel__empty-msg">No Notes vault selected. Open Settings to link a vault.</p>
      </div>
    );
  }

  return (
    <div className="boards-tab-panel" role="main" aria-label="Boards">
      {/*
        SKY-11191: the crumb bar scrolls horizontally, which makes it a
        clipping context — the search results have to drop out of a wrapper
        around it rather than out of the bar itself, or a long breadcrumb
        stack would cut them off.
      */}
      <div className="boards-tab-panel__chrome">
      {/* Breadcrumb nav */}
      <nav className="boards-tab-panel__breadcrumb" aria-label="Board navigation">
        {breadcrumb.map((crumb, i) => (
          // Home's folderPath is '' (HOME_CRUMB), so qualify by depth — the
          // crumb at a given index is stable for the life of the stack.
          <span key={`${i}:${crumb.folderPath}`} className="boards-tab-panel__breadcrumb-group">
            {i > 0 && <span className="boards-tab-panel__breadcrumb-sep" aria-hidden="true">/</span>}
            {i < breadcrumb.length - 1 ? (
              <button
                className="boards-tab-panel__breadcrumb-btn"
                onClick={() => handleBreadcrumbClick(i)}
                aria-label={`Navigate to ${crumb.name}`}
              >
                {crumb.name}
              </button>
            ) : (
              <span className="boards-tab-panel__breadcrumb-current" aria-current="page">{crumb.name}</span>
            )}
          </span>
        ))}

        {/*
          SKY-11187 §5: the placement tools. A radio group, because exactly
          one tool is armed at a time and arrow keys are the expected way to
          move between them; `aria-checked` carries the state that the neon
          pressed styling shows.
        */}
        <div className="boards-tab-panel__tools" role="radiogroup" aria-label="Board tools">
          {TOOLS.map((tool) => (
            <button
              key={tool.id}
              type="button"
              role="radio"
              aria-checked={activeTool === tool.id}
              className={
                'boards-tab-panel__tool' +
                (activeTool === tool.id ? ' boards-tab-panel__tool--active' : '')
              }
              data-tool={tool.id}
              title={tool.title}
              onClick={() => setActiveTool(tool.id)}
            >
              {tool.label}
            </button>
          ))}
        </div>

        {/*
          SKY-11191 §11: the two derived-view toggles. Plain toggle buttons
          rather than a second radio group — the overlay and the minimap are
          independent, and either can be on without the other.
        */}
        <div className="boards-tab-panel__view-toggles">
          <button
            type="button"
            className={
              'boards-tab-panel__toggle' +
              (wikiLinkOverlay ? ' boards-tab-panel__toggle--active' : '')
            }
            aria-pressed={wikiLinkOverlay}
            data-toggle="links"
            title="Show a dashed connector between cards on this board that link to each other"
            onClick={() => setWikiLinkOverlay((on) => !on)}
          >
            Links
          </button>
          <button
            type="button"
            className={
              'boards-tab-panel__toggle' + (showMinimap ? ' boards-tab-panel__toggle--active' : '')
            }
            aria-pressed={showMinimap}
            data-toggle="minimap"
            title="Show a small map of this board"
            onClick={() => setShowMinimap((on) => !on)}
          >
            Minimap
          </button>
        </div>

        {/*
          SKY-11191 §11: cross-board search. A real combobox — the results are
          the control's whole purpose, so the arrow keys have to walk them and
          `aria-activedescendant` has to name the one Enter would take. A bare
          field with a list of buttons under it would be reachable only by
          tabbing past every hit.
        */}
        <input
          type="search"
          className="boards-tab-panel__search-input"
          role="combobox"
          aria-label="Search all boards"
          aria-expanded={searchHits.length > 0}
          aria-controls="boards-search-results"
          aria-activedescendant={searchHits[activeHit] ? searchOptionId(activeHit) : undefined}
          aria-autocomplete="list"
          placeholder="Search all boards…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={handleSearchKeyDown}
        />
      </nav>

      {searchQuery.trim() && (
        <ul
          className="boards-tab-panel__search-results"
          id="boards-search-results"
          role="listbox"
          aria-label="Search results"
        >
          {searchHits.length === 0 ? (
            <li className="boards-tab-panel__search-empty" role="presentation">
              {indexing || vaultIndex === null ? 'Searching…' : 'No matching boards or notes'}
            </li>
          ) : (
            searchHits.map((hit, i) => (
              <li
                key={hit.vaultPath}
                id={searchOptionId(i)}
                role="option"
                aria-selected={i === activeHit}
                className={
                  'boards-tab-panel__search-hit' +
                  (i === activeHit ? ' boards-tab-panel__search-hit--active' : '')
                }
                data-kind={hit.kind}
                data-vault-path={hit.vaultPath}
                // mousedown, not click: the field keeps focus, so a pick can
                // never race the input's own blur handling.
                onMouseDown={(e) => { e.preventDefault(); handleSearchHit(hit); }}
                onMouseEnter={() => setActiveHit(i)}
              >
                <span className="boards-tab-panel__search-hit-name">{hit.name}</span>
                <span className="boards-tab-panel__search-hit-board">{hit.boardLabel}</span>
              </li>
            ))
          )}
        </ul>
      )}
      </div>

      {/* Canvas area */}
      {loading ? (
        <div className="boards-tab-panel__loading" role="status" aria-live="polite">Loading board…</div>
      ) : error ? (
        <div className="boards-tab-panel__error" role="alert">{error}</div>
      ) : (
        <div className="boards-tab-panel__canvas-wrap">
          {/*
            SKY-11187: an EMPTY board still renders the canvas. It used to
            render the empty message instead, which left the Note/Board tools
            with nothing to click on — the one board where creating the first
            item matters most (a fresh vault's Home) was the one board where
            it was impossible. The message is a hint layered over the canvas,
            not a replacement for it, so it never swallows the click.
          */}
          {items.length === 0 && furniture.length === 0 && (
            <p className="boards-tab-panel__empty-msg boards-tab-panel__empty-msg--overlay">
              This board is empty. Pick the Note or Board tool, then click anywhere to add one.
            </p>
          )}
          <BoardCanvas
            items={items}
            savedLayout={savedLayout}
            savedView={savedView}
            minZoom={minZoom}
            onItemMove={handleItemMove}
            onItemResize={handleItemResize}
            onViewChange={handleViewChange}
            onEnterBoard={handleEnterBoard}
            activeTool={activeTool}
            onCreateItem={handleCreateItem}
            renamingPath={renamingPath}
            onRequestRename={handleRequestRename}
            onRenameCommit={handleRenameCommit}
            onRenameCancel={handleRenameCancel}
            furniture={furniture}
            itemKeysByPath={itemKeysByPath}
            onFurnitureMove={handleFurnitureMove}
            onFurnitureResize={handleFurnitureResize}
            onFurnitureDelete={handleFurnitureDelete}
            onFurnitureCheckToggle={handleFurnitureCheckToggle}
            onFurnitureColor={handleFurnitureColor}
            onOpenNoteRef={handleOpenNoteRef}
            lineToolActive={lineToolActive}
            onFurniturePick={(id) => void handleFurniturePick(id)}
            wikiLinks={wikiLinks}
            wikiLinkOverlay={wikiLinkOverlay}
            linkAnchors={linkAnchors}
            showMinimap={showMinimap}
            selectRequest={selectRequest}
          />
        </div>
      )}

      {actionError && (
        <div className="boards-tab-panel__action-error" role="alert">
          {actionError}
          <button
            type="button"
            className="boards-tab-panel__action-error-dismiss"
            aria-label="Dismiss"
            onClick={() => setActionError(null)}
          >
            ×
          </button>
        </div>
      )}
      {/* SKY-11188 (§4/§5): add board-only furniture — mirrors the prototype's
          canvas context-menu "Add …" items as a reachable toolbar. */}
      {!loading && !error && (
        <div className="boards-tab-panel__furniture-toolbar" role="group" aria-label="Add furniture">
          {FURNITURE_TOOLBAR_KINDS.map(({ kind, label }) => (
            <button
              key={kind}
              type="button"
              className="boards-tab-panel__furniture-btn"
              onClick={() => void handleFurnitureCreate(kind)}
            >
              + {label}
            </button>
          ))}
          <button
            type="button"
            className={`boards-tab-panel__furniture-btn${lineToolActive ? ' boards-tab-panel__furniture-btn--active' : ''}`}
            aria-pressed={lineToolActive}
            onClick={() => { setLineToolActive((v) => !v); setLineFromId(null); }}
          >
            {lineToolActive ? (lineFromId ? 'Click the item to connect to…' : 'Click an item to connect…') : '+ Connector'}
          </button>
        </div>
      )}
    </div>
  );
}
