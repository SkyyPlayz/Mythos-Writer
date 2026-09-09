/**
 * SKY-11184: Notes Board top-level tab panel.
 * Renders a breadcrumb nav + BoardCanvas for the current board folder.
 * BOARDS-SPEC.md §1, §5.
 * SKY-11186: resolves each note child's thumbnail (spec §9) alongside the
 * listing, threads the zoom-out limit setting through, and reloads the open
 * board when the Notes vault changes on disk.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import BoardCanvas from './BoardCanvas';
import type { BoardItem, ItemLayout } from './BoardCanvas';
import { resolveNoteThumbs } from '../../lib/noteThumbnails';
import { boardFollowsChange } from './boardVaultChange';
import './BoardsTabPanel.css';

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

/** How long to coalesce a burst of vault change events before reloading the board. */
const VAULT_CHANGE_RELOAD_MS = 200;

export default function BoardsTabPanel({ notesVaultRoot, notesVaultValid, minZoom }: BoardsTabPanelProps) {
  // Breadcrumb stack — bottom is home (vault root), top is current board
  const [breadcrumb, setBreadcrumb] = useState<BreadcrumbEntry[]>([HOME_CRUMB]);

  const currentFolder = breadcrumb[breadcrumb.length - 1].folderPath;

  // Reset breadcrumb when vault root changes
  useEffect(() => {
    setBreadcrumb([HOME_CRUMB]);
  }, [notesVaultRoot]);

  const [items, setItems] = useState<BoardItem[]>([]);
  const [savedLayout, setSavedLayout] = useState<Record<string, ItemLayout>>({});
  const [savedView, setSavedView] = useState<{ zoom: number; panX: number; panY: number }>({ zoom: 100, panX: 0, panY: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      const [vaultResult, meta] = await Promise.all([
        window.api.listNotesVault(folderPath) as Promise<{ items: VaultListItem[] } | { error: string }>,
        window.api.notesBoardGet(folderPath),
      ]);
      if (seq !== loadSeqRef.current) return;

      if ('error' in vaultResult) {
        setError(vaultResult.error);
        setItems([]);
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
      for (const child of meta.children) {
        if (!child.id) continue;
        const storedLayout = meta.layout[`${child.kind === 'folder' ? 'v' : 'n'}:${child.id}`];
        if (storedLayout) layoutMap[child.path] = storedLayout;
      }

      setItems(resolvedItems);
      setSavedLayout(layoutMap);
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
      </nav>

      {/* Canvas area */}
      {loading ? (
        <div className="boards-tab-panel__loading" role="status" aria-live="polite">Loading board…</div>
      ) : error ? (
        <div className="boards-tab-panel__error" role="alert">{error}</div>
      ) : items.length === 0 ? (
        <div className="boards-tab-panel__empty">
          <p className="boards-tab-panel__empty-msg">This board is empty. Create folders or notes in the Notes tab to see them here.</p>
        </div>
      ) : (
        <BoardCanvas
          items={items}
          savedLayout={savedLayout}
          savedView={savedView}
          minZoom={minZoom}
          onItemMove={handleItemMove}
          onItemResize={handleItemResize}
          onViewChange={handleViewChange}
          onEnterBoard={handleEnterBoard}
        />
      )}
    </div>
  );
}
