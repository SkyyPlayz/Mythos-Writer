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
import type { BoardItem, BoardTool, BoardFurnitureItemData, ItemLayout } from './BoardCanvas';
import type { FurnitureKind } from './boardLod';
import RecentlyDeletedPanel from './RecentlyDeletedPanel';
import { resolveNoteThumbs } from '../../lib/noteThumbnails';
import { boardFollowsChange } from './boardVaultChange';
import { boardWikiLinks, furnitureAnchorRects } from './boardLinks';
import type { VaultGraphEdge } from './boardLinks';
import { searchVaultIndex } from './boardSearch';
import type { BoardSearchHit, VaultIndexEntry } from './boardSearch';
import { validateRenameName } from '../../components/VaultBrowser/renameUtils';
import { basenameNoExt } from '../../crossTabLinkResolver';
import { useToast } from '../../hooks/useToast';
import { Toast } from '../../components/Toast/Toast';
import { pushUndo, undo as undoLastAction } from '../../lib/notesUndoStack';
import { NodeIcon } from '../../NodeIcon';
import type { VaultIconEntry } from '../../iconUtils';
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

interface VaultListItem {
  path: string;
  name: string;
  isDirectory: boolean;
  excerpt?: string;
}

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

/** Vault-relative path of a board child (item paths are relative to their board's folder). */
function vaultPathOf(folderPath: string, itemPath: string): string {
  return folderPath ? `${folderPath}/${itemPath}` : itemPath;
}

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

/** How long to coalesce a burst of vault change events before reloading the board. */
const VAULT_CHANGE_RELOAD_MS = 200;

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

  const [items, setItems] = useState<BoardItem[]>([]);
  const [savedLayout, setSavedLayout] = useState<Record<string, ItemLayout>>({});
  const [savedView, setSavedView] = useState<{ zoom: number; panX: number; panY: number }>({ zoom: 100, panX: 0, panY: 0 });
  // SKY-11188: board-only furniture + every touched child's own item key.
  // SKY-11191 reads the same array for its `column` items' `ref`s (§11) —
  // one source, so an overlay connector can never point at a stale box.
  const [furniture, setFurniture] = useState<BoardFurnitureItemData[]>([]);
  const [itemKeysByPath, setItemKeysByPath] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // SKY-11190: icon+colour map, keyed by FULL vault-relative path — same
  // `.mythos/icons.json` store the vault tree reads (SKY-9310), so setting
  // an icon here shows up there too, and vice versa.
  const [iconMap, setIconMap] = useState<Record<string, VaultIconEntry>>({});

  // SKY-11187 §5: the canvas tools and the inline rename they hand off to.
  const [activeTool, setActiveTool] = useState<BoardTool>('select');
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  /** A refused vault mutation (name collision, invalid characters, fs error). */
  const [actionError, setActionError] = useState<string | null>(null);

  // A reload that finishes after a newer one started must not clobber it —
  // vault-change reloads and breadcrumb navigation can overlap.
  const loadSeqRef = useRef(0);

  // Fetch board data: IPC gives us the metadata store + vault listing.
  // `silent` keeps the current board on screen while it refreshes (a vault
  // change must not flash the loading state over a board the user is on).
  const loadBoard = useCallback(async (folderPath: string, silent = false) => {
    // '' is the Home board (vault root), not "no board" — see HOME_CRUMB.
    if (!notesVaultValid) return;
    const seq = ++loadSeqRef.current;
    if (!silent) setLoading(true);
    setError(null);
    try {
      const [vaultResult, meta, icons] = await Promise.all([
        window.api.listNotesVault(folderPath) as Promise<{ items: VaultListItem[] } | { error: string }>,
        window.api.notesBoardGet(folderPath),
        window.api.notesVaultReadIcons(),
      ]);
      if (seq !== loadSeqRef.current) return;
      setIconMap(icons);

      if ('error' in vaultResult) {
        setError(vaultResult.error);
        setItems([]);
        setFurniture([]);
        return;
      }

      // Vault items are canonical for what a board shows (spec §1 — Store B
      // never hides a note), but listNotesVault is RECURSIVE: vault.ts's
      // listVaultFiles walks the entire subtree. A board shows only its
      // IMMEDIATE children (SKY-11336 defect A — Home rendered every
      // descendant as a top-level card), so split that one listing by depth:
      //   no separator  → an immediate child of this board;
      //   one separator → a grandchild, which only feeds its parent tile's
      //                   child counts (spec §5).
      // Deriving the counts here also removes the per-folder listNotesVault
      // round-trip the tiles used to make — an N+1 that re-walked every
      // subtree (and, being recursive, counted descendants rather than direct
      // children). listVaultFiles always emits '/' regardless of platform
      // (SKY-8881), so splitting on it is correct on Windows too.
      const directChildren: VaultListItem[] = [];
      const childCounts = new Map<string, { boards: number; cards: number }>();
      for (const vaultItem of vaultResult.items) {
        const slash = vaultItem.path.indexOf('/');
        if (slash === -1) {
          // Mirror notesBoard.ts's listImmediateChildren: a board's children
          // are folders and .md notes, so item paths stay 1:1 with
          // meta.children (and nothing undraggable renders as a card).
          if (vaultItem.isDirectory || /\.md$/i.test(vaultItem.name)) directChildren.push(vaultItem);
          continue;
        }
        if (vaultItem.path.indexOf('/', slash + 1) !== -1) continue; // deeper than a grandchild
        const parent = vaultItem.path.slice(0, slash);
        const counts = childCounts.get(parent) ?? { boards: 0, cards: 0 };
        if (vaultItem.isDirectory) counts.boards += 1;
        else if (/\.md$/i.test(vaultItem.name)) counts.cards += 1;
        childCounts.set(parent, counts);
      }

      // SKY-11186 / spec §9: one batched resolve for this board's notes — the
      // card's default SIZE depends on whether it has a thumbnail (§6), so
      // this has to be known before layout, not lazily per visible card. The
      // ~256px derivative itself is fetched lazily by the card that needs it.
      const notePaths = directChildren
        .filter((v) => !v.isDirectory)
        .map((v) => vaultPathOf(folderPath, v.path));
      const thumbs = notePaths.length > 0 ? await resolveNoteThumbs(notePaths) : {};
      if (seq !== loadSeqRef.current) return;

      const resolvedItems: BoardItem[] = directChildren.map((vaultItem) => {
        if (vaultItem.isDirectory) {
          const counts = childCounts.get(vaultItem.path) ?? { boards: 0, cards: 0 };
          return {
            path: vaultItem.path,
            kind: 'folder',
            name: vaultItem.name,
            childBoards: counts.boards,
            childCards: counts.cards,
          };
        }
        return {
          path: vaultItem.path,
          kind: 'note',
          name: vaultItem.name.replace(/\.md$/i, ''),
          excerpt: vaultItem.excerpt,
          thumb: thumbs[vaultPathOf(folderPath, vaultItem.path)],
        };
      });

      // Store B layout is keyed by each child's STABLE id (§3). meta.children
      // reports paths relative to this board's own folder — the same contract
      // item.path now follows — so the two line up 1:1.
      const layoutMap: Record<string, ItemLayout> = {};
      // SKY-11188: every TOUCHED child's own item key, by path — a `line`
      // furniture's from/to may name one (§4). Built independently of
      // layoutMap: a colour-only touch mints an id without a layout entry.
      const keysByPath: Record<string, string> = {};
      for (const child of meta.children) {
        if (!child.id) continue;
        const key = `${child.kind === 'folder' ? 'v' : 'n'}:${child.id}`;
        keysByPath[child.path] = key;
        const storedLayout = meta.layout[key];
        if (storedLayout) layoutMap[child.path] = storedLayout;
      }

      setItems(resolvedItems);
      setSavedLayout(layoutMap);
      setItemKeysByPath(keysByPath);
      setFurniture((meta.furniture ?? []) as BoardFurnitureItemData[]);
      setSavedView(meta.view ?? { zoom: 100, panX: 0, panY: 0 });
    } catch (err) {
      if (seq !== loadSeqRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      // Whichever load finishes LAST clears the flag — a silent reload that
      // superseded a visible one must not leave "Loading board…" on screen.
      if (seq === loadSeqRef.current) setLoading(false);
    }
  }, [notesVaultValid]);

  useEffect(() => {
    loadBoard(currentFolder);
  }, [currentFolder, loadBoard]);

  // SKY-11186: a note edited, an image deleted, moved or rewritten, a
  // thumbnail toggled off from the editor — the open board must follow the
  // vault. The Notes watcher emits `vault:notes-updated` (notes and folders)
  // and `vault:notes-asset-changed` (images) with the changed path; only a
  // change this board can see triggers a reload (boardFollowsChange), bursts
  // are coalesced, and the reload is silent.
  const itemsRef = useRef<BoardItem[]>([]);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    if (!notesVaultValid) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onVaultChange = (data: { path?: string } | undefined) => {
      const shown = itemsRef.current.map((item) => item.thumb?.src);
      if (!boardFollowsChange(currentFolder, data?.path, shown)) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void loadBoard(currentFolder, true);
      }, VAULT_CHANGE_RELOAD_MS);
    };
    const unsubscribes = [
      window.api.onVaultNotesUpdated?.(onVaultChange),
      window.api.onVaultNotesAssetChanged?.(onVaultChange),
    ];
    return () => {
      if (timer) clearTimeout(timer);
      for (const unsub of unsubscribes) unsub?.();
    };
  }, [notesVaultValid, currentFolder, loadBoard]);

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

  const handleViewChange = useCallback((_zoom: number, _panX: number, _panY: number) => {
    // View is UI state — persisted via the board metadata store
    // We don't call patchLayout here; view is stored separately (spec §3 "view" field)
    // For this ticket, view is ephemeral within the session; persistence will come in a later pass
  }, []);

  const handleItemMove = useCallback(async (itemPath: string, x: number, y: number) => {
    try {
      await window.api.notesBoardPatchLayout(currentFolder, itemPath, { x, y });
      setSavedLayout((prev) => ({
        ...prev,
        [itemPath]: { ...(prev[itemPath] ?? {}), x, y },
      }));
    } catch (err) {
      // Non-fatal — the position stays in local state for this session. Logged
      // rather than swallowed: an "item not found" here is exactly the shape
      // SKY-11336 took, and a bare `catch {}` hid it for a whole beta.
      console.warn('[Boards] failed to persist item position', err);
    }
  }, [currentFolder]);

  const handleItemResize = useCallback(async (itemPath: string, w: number, h: number) => {
    try {
      await window.api.notesBoardPatchLayout(currentFolder, itemPath, { w, h });
      setSavedLayout((prev) => ({
        ...prev,
        [itemPath]: { ...(prev[itemPath] ?? {}), w, h },
      }));
    } catch (err) {
      // Non-fatal — see handleItemMove.
      console.warn('[Boards] failed to persist item size', err);
    }
  }, [currentFolder]);

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
      await loadBoard(currentFolder, true);
      // Straight into inline rename — the placeholder name ("New note") is a
      // prompt, not a decision.
      setRenamingPath(created.itemPath);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }, [currentFolder, loadBoard]);

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
      await loadBoard(currentFolder, true);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }, [currentFolder, loadBoard]);

  const handleRenameCancel = useCallback(() => setRenamingPath(null), []);
  const handleRequestRename = useCallback((itemPath: string) => setRenamingPath(itemPath), []);

  // ── SKY-11189 §7/§8: trash split by target type + deferred-delete undo ──
  const { toast, showToast, clearToast } = useToast(8000);
  const [recentlyDeletedOpen, setRecentlyDeletedOpen] = useState(false);
  const [recentlyDeletedEntries, setRecentlyDeletedEntries] = useState<NotesBoardPendingEntry[]>([]);
  const recentlyDeletedBtnRef = useRef<HTMLButtonElement>(null);

  const refreshRecentlyDeleted = useCallback(async () => {
    const res = await window.api.notesBoardRecentlyDeletedList();
    setRecentlyDeletedEntries(res.entries);
  }, []);

  const handleToggleRecentlyDeleted = useCallback(() => {
    setRecentlyDeletedOpen((prev) => {
      const next = !prev;
      if (next) void refreshRecentlyDeleted();
      return next;
    });
  }, [refreshRecentlyDeleted]);

  const handleTrashItems = useCallback(async (itemPaths: string[]) => {
    const targets = itemPaths
      .map((p) => items.find((i) => i.path === p))
      .filter((i): i is BoardItem => i != null)
      .map((i) => ({
        kind: i.kind,
        itemPath: i.path,
        label: i.kind === 'note' ? `${i.name}.md` : i.name,
      }));
    if (targets.length === 0) return;
    setActionError(null);
    try {
      const { entries } = await window.api.notesBoardTrashItems(currentFolder, targets);
      await loadBoard(currentFolder, true);
      // Restoring the whole batch means restoring every DISTINCT group it
      // touched (a folder target's descendants share its group, but two
      // unrelated top-level targets from one multi-select do not — see
      // notesTrash.ts). One entry per group is enough to name to `restore`.
      const seenGroups = new Set<string>();
      const restoreIds: string[] = [];
      for (const entry of entries) {
        if (seenGroups.has(entry.groupId)) continue;
        seenGroups.add(entry.groupId);
        restoreIds.push(entry.id);
      }
      const label = targets.length > 1 ? `Deleted ${targets.length} items` : `Deleted "${targets[0]!.label}"`;
      pushUndo({
        label,
        undo: async () => {
          await Promise.all(restoreIds.map((id) => window.api.notesBoardRestore(id)));
          await loadBoard(currentFolder, true);
        },
      });
      showToast(label, 'info');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }, [items, currentFolder, loadBoard, showToast]);

  const handleUndoToast = useCallback(() => {
    clearToast();
    void undoLastAction();
  }, [clearToast]);

  const handleRestoreFromPanel = useCallback(async (id: string) => {
    await window.api.notesBoardRestore(id);
    await Promise.all([refreshRecentlyDeleted(), loadBoard(currentFolder, true)]);
  }, [refreshRecentlyDeleted, currentFolder, loadBoard]);

  const handleEmptyTrash = useCallback(async () => {
    await window.api.notesBoardEmptyTrash();
    await refreshRecentlyDeleted();
  }, [refreshRecentlyDeleted]);

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
  }, [currentFolder, furniture.length]);

  const handleFurnitureMove = useCallback(async (id: string, x: number, y: number) => {
    try {
      const { item } = await window.api.notesBoardFurnitureUpdate(currentFolder, id, { x, y });
      if (item) setFurniture((prev) => prev.map((f) => (f.id === id ? (item as unknown as BoardFurnitureItemData) : f)));
    } catch (err) {
      console.warn('[Boards] failed to persist furniture position', err);
    }
  }, [currentFolder]);

  const handleFurnitureResize = useCallback(async (id: string, w: number, h: number) => {
    try {
      const { item } = await window.api.notesBoardFurnitureUpdate(currentFolder, id, { w, h });
      if (item) setFurniture((prev) => prev.map((f) => (f.id === id ? (item as unknown as BoardFurnitureItemData) : f)));
    } catch (err) {
      console.warn('[Boards] failed to persist furniture size', err);
    }
  }, [currentFolder]);

  const handleFurnitureColor = useCallback(async (id: string, hex: string) => {
    try {
      const { item } = await window.api.notesBoardFurnitureUpdate(currentFolder, id, { color: hex });
      if (item) setFurniture((prev) => prev.map((f) => (f.id === id ? (item as unknown as BoardFurnitureItemData) : f)));
    } catch (err) {
      console.warn('[Boards] failed to persist furniture colour', err);
    }
  }, [currentFolder]);

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
  }, [currentFolder, furniture]);

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
  }, [currentFolder]);

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
  }, [currentFolder, lineFromId]);

  // SKY-11190: itemPath is relative to the current board (BoardCanvas's
  // contract — see handleEnterBoard below); resolve to the full
  // vault-relative key the icon store and vault tree both use.
  const handleSetIcon = useCallback(async (itemPath: string, icon: string | null, color: string | null) => {
    const full = currentFolder ? `${currentFolder}/${itemPath}` : itemPath;
    try {
      await window.api.notesVaultSetIcon(full, icon, color ?? undefined);
      setIconMap((prev) => {
        const next = { ...prev };
        if (icon) next[full] = color ? { icon, color } : icon;
        else delete next[full];
        return next;
      });
    } catch (err) {
      console.warn('[Boards] failed to persist icon', err);
    }
  }, [currentFolder]);

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
                {iconMap[crumb.folderPath] && (
                  <span className="boards-tab-panel__breadcrumb-icon">
                    <NodeIcon icon={iconMap[crumb.folderPath]} fallback={null} />
                  </span>
                )}
                {crumb.name}
              </button>
            ) : (
              <span className="boards-tab-panel__breadcrumb-current" aria-current="page">
                {iconMap[crumb.folderPath] && (
                  <span className="boards-tab-panel__breadcrumb-icon">
                    <NodeIcon icon={iconMap[crumb.folderPath]} fallback={null} />
                  </span>
                )}
                {crumb.name}
              </span>
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

        {/* SKY-11189 §8: vault-wide, not scoped to the open board — a Notes
            tab tree delete lands here exactly like a canvas delete. */}
        <div className="boards-tab-panel__recently-deleted">
          <button
            type="button"
            ref={recentlyDeletedBtnRef}
            className="boards-tab-panel__recently-deleted-btn"
            aria-haspopup="dialog"
            aria-expanded={recentlyDeletedOpen}
            onClick={handleToggleRecentlyDeleted}
          >
            Recently Deleted
          </button>
        </div>
      </nav>

      {/* SKY-11189 §8: dropped out of <nav> itself for the same reason the
          search results are (comment above) — the crumb bar's overflow-x:auto
          makes it a vertical clipping context too, so an absolutely-positioned
          panel nested inside it never actually paints on screen. */}
      <RecentlyDeletedPanel
        open={recentlyDeletedOpen}
        onClose={() => setRecentlyDeletedOpen(false)}
        entries={recentlyDeletedEntries}
        onRestore={handleRestoreFromPanel}
        onEmpty={handleEmptyTrash}
        anchorRef={recentlyDeletedBtnRef}
      />

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
            onTrashItems={handleTrashItems}
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
            iconMap={iconMap}
            folderPath={currentFolder}
            onSetIcon={handleSetIcon}
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

      {/* SKY-11189 §8: immediate feedback for a trash action, mirroring
          CanvasBoard.tsx's own delete-toast-with-undo precedent. Ctrl+Z
          works whether or not this toast is still showing (DesktopShell's
          undo stack, not this component, is the source of truth). */}
      <Toast
        message={toast?.message ?? null}
        level={toast?.level}
        action={toast ? { label: 'Undo', onClick: handleUndoToast } : undefined}
        onDismiss={clearToast}
      />
    </div>
  );
}
