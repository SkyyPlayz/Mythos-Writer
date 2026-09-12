/**
 * SKY-11192 (Notes Board 9/9): the ONE board state, shared by every surface
 * that shows a board.
 *
 * The owner ruling on SKY-10724 is that Brainstorm's Board page and the Notes
 * Board tab are two views of one thing, "editable from either location" — not
 * two stores kept in step. This hook is what makes that literally true rather
 * than aspirationally true.
 *
 * There is no client-side shared store here, and there deliberately isn't one.
 * A board's state IS the filesystem: the vault listing says which children
 * exist, and the `notesBoard:*` Store B sidecar says where they sit. Both
 * surfaces call the same IPC against the same `folderPath`, so a card moved in
 * one is already moved in the other the next time either reads — there is no
 * sync step that could drift, and no merge to design for. The `vault:notes-updated`
 * subscription below is what closes the loop while both are mounted at once
 * (the chat strip and the Notes Board tab can be on screen together).
 *
 * Extracted verbatim from BoardsTabPanel (SKY-11184/11186/11187) so that the
 * Notes Board tab's behaviour is the definition of "a board", and Brainstorm
 * inherits it instead of reimplementing a lookalike.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { BoardFurnitureItemData, BoardItem, BoardTool, ItemLayout } from './BoardCanvas';
import { resolveNoteThumbs } from '../../lib/noteThumbnails';
import { boardFollowsChange } from './boardVaultChange';
import { validateRenameName } from '../../components/VaultBrowser/renameUtils';

interface VaultListItem {
  path: string;
  name: string;
  isDirectory: boolean;
  excerpt?: string;
}

/** How long to coalesce a burst of vault change events before reloading the board. */
const VAULT_CHANGE_RELOAD_MS = 200;

/**
 * SKY-11336: a board's `folderPath` is VAULT-RELATIVE, and the vault root —
 * the Home board — is the empty string. Seeding Home with the ABSOLUTE notes
 * root instead is what broke the Home board for a whole beta, so every caller
 * of this hook passes the relative form and nothing here resolves it.
 */
export function vaultPathOf(folderPath: string, itemPath: string): string {
  return folderPath ? `${folderPath}/${itemPath}` : itemPath;
}

export interface VaultBoard {
  items: BoardItem[];
  savedLayout: Record<string, ItemLayout>;
  /**
   * SKY-11188: board-only furniture (columns, checklists, tables, lines).
   * Loaded here because it arrives on the same `notesBoardGet` call as the
   * layout — so every surface rendering this folder shows the same furniture,
   * which is what spec §1's "the canvas must not differ" requires.
   *
   * The CRUD lives with whichever surface offers a furniture toolbar (today
   * only the Notes Board tab), so this exposes the setter rather than eight
   * handlers most callers would never use.
   */
  furniture: BoardFurnitureItemData[];
  setFurniture: React.Dispatch<React.SetStateAction<BoardFurnitureItemData[]>>;
  /** SKY-11188: every touched child's own item key, by path — `line` endpoints. */
  itemKeysByPath: Record<string, string>;
  savedView: { zoom: number; panX: number; panY: number };
  loading: boolean;
  /** The folder could not be listed — genuinely gone, or unreadable. */
  error: string | null;
  /** A refused vault mutation (name collision, invalid characters, fs error). */
  actionError: string | null;
  dismissActionError: () => void;
  /**
   * Surface a refused mutation a CALLER performed, in the same banner the
   * hook's own create/rename failures use. SKY-11189's trash/restore lives
   * with whichever surface offers the trash chrome (today only the Notes Board
   * tab), so it needs the channel without the hook owning the operation.
   */
  reportActionError: (message: string | null) => void;
  activeTool: BoardTool;
  setActiveTool: (tool: BoardTool) => void;
  renamingPath: string | null;
  onItemMove: (itemPath: string, x: number, y: number) => void;
  onItemResize: (itemPath: string, w: number, h: number) => void;
  onCreateItem: (kind: 'note' | 'folder', x: number, y: number) => void;
  onRequestRename: (itemPath: string) => void;
  onRenameCommit: (itemPath: string, newName: string) => void;
  onRenameCancel: () => void;
  /** Re-read this board from disk. `silent` keeps the current board on screen. */
  reload: (silent?: boolean) => Promise<void>;
}

/**
 * @param folderPath vault-relative folder this board renders ('' = Home).
 * @param notesVaultValid false parks the hook — no IPC, no subscription.
 */
export function useVaultBoard(folderPath: string, notesVaultValid: boolean): VaultBoard {
  const [items, setItems] = useState<BoardItem[]>([]);
  const [savedLayout, setSavedLayout] = useState<Record<string, ItemLayout>>({});
  const [savedView, setSavedView] = useState<{ zoom: number; panX: number; panY: number }>({ zoom: 100, panX: 0, panY: 0 });
  // SKY-11188: board-only furniture + every touched child's own item key.
  const [furniture, setFurniture] = useState<BoardFurnitureItemData[]>([]);
  const [itemKeysByPath, setItemKeysByPath] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // SKY-11187 §5: the canvas tools and the inline rename they hand off to.
  const [activeTool, setActiveTool] = useState<BoardTool>('select');
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // A reload that finishes after a newer one started must not clobber it —
  // vault-change reloads and board navigation can overlap.
  const loadSeqRef = useRef(0);

  const loadBoard = useCallback(async (target: string, silent = false) => {
    // '' is the Home board (vault root), not "no board".
    if (!notesVaultValid) return;
    const seq = ++loadSeqRef.current;
    if (!silent) setLoading(true);
    setError(null);
    try {
      const [vaultResult, meta] = await Promise.all([
        window.api.listNotesVault(target) as Promise<{ items: VaultListItem[] } | { error: string }>,
        window.api.notesBoardGet(target),
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
      // subtree. listVaultFiles always emits '/' regardless of platform
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
      // this has to be known before layout, not lazily per visible card.
      const notePaths = directChildren
        .filter((v) => !v.isDirectory)
        .map((v) => vaultPathOf(target, v.path));
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
          thumb: thumbs[vaultPathOf(target, vaultItem.path)],
        };
      });

      // Store B layout is keyed by each child's STABLE id (§3). meta.children
      // reports paths relative to this board's own folder — the same contract
      // item.path follows — so the two line up 1:1.
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
      setFurniture(meta.furniture as BoardFurnitureItemData[]);
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

  const reload = useCallback((silent = false) => loadBoard(folderPath, silent), [loadBoard, folderPath]);

  useEffect(() => {
    void loadBoard(folderPath);
  }, [folderPath, loadBoard]);

  // SKY-11186: a note edited, an image deleted, moved or rewritten, a
  // thumbnail toggled off from the editor — the open board must follow the
  // vault. This is also what keeps two SIMULTANEOUSLY MOUNTED boards over the
  // same folder honest (SKY-11192: the chat strip and the Notes Board tab),
  // because every vault mutation in either one emits here.
  const itemsRef = useRef<BoardItem[]>([]);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    if (!notesVaultValid) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onVaultChange = (data: { path?: string } | undefined) => {
      const shown = itemsRef.current.map((item) => item.thumb?.src);
      if (!boardFollowsChange(folderPath, data?.path, shown)) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void loadBoard(folderPath, true);
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
  }, [notesVaultValid, folderPath, loadBoard]);

  const onItemMove = useCallback(async (itemPath: string, x: number, y: number) => {
    try {
      await window.api.notesBoardPatchLayout(folderPath, itemPath, { x, y });
      setSavedLayout((prev) => ({ ...prev, [itemPath]: { ...(prev[itemPath] ?? {}), x, y } }));
    } catch (err) {
      // Non-fatal — the position stays in local state for this session. Logged
      // rather than swallowed: an "item not found" here is exactly the shape
      // SKY-11336 took, and a bare `catch {}` hid it for a whole beta.
      console.warn('[Boards] failed to persist item position', err);
    }
  }, [folderPath]);

  const onItemResize = useCallback(async (itemPath: string, w: number, h: number) => {
    try {
      await window.api.notesBoardPatchLayout(folderPath, itemPath, { w, h });
      setSavedLayout((prev) => ({ ...prev, [itemPath]: { ...(prev[itemPath] ?? {}), w, h } }));
    } catch (err) {
      // Non-fatal — see onItemMove.
      console.warn('[Boards] failed to persist item size', err);
    }
  }, [folderPath]);

  // ── SKY-11187 §5: vault-mutating canvas operations ──────────────────────
  //
  // REAL filesystem mutations, not metadata edits (§1: the Notes tab and this
  // canvas are two renderings of one filesystem). Both go through
  // `notesBoard:createItem` / `notesBoard:renameItem`, which do the fs work in
  // main AND push `vault:notes-updated` — so every other mounted surface,
  // including the Notes tree and a second board over the same folder, follows
  // without waiting on the notes watcher.
  //
  // Home (folderPath === '') is NOT special-cased: the root board creates,
  // names and renames exactly like a nested one.

  const onCreateItem = useCallback(async (kind: 'note' | 'folder', x: number, y: number) => {
    // One-shot tool: disarm before the await, so a second click landing during
    // the round-trip cannot create a second item.
    setActiveTool('select');
    setActionError(null);
    try {
      const created = await window.api.notesBoardCreateItem(folderPath, kind, { x, y });
      await loadBoard(folderPath, true);
      // Straight into inline rename — the placeholder name is a prompt, not a
      // decision.
      setRenamingPath(created.itemPath);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }, [folderPath, loadBoard]);

  const onRenameCommit = useCallback(async (itemPath: string, newName: string) => {
    setRenamingPath(null);
    // §5: an empty name is a no-op — leave the item exactly as it is. Checked
    // here as well as in main so the round-trip is skipped entirely.
    if (!newName.trim()) return;
    const invalid = validateRenameName(newName);
    if (invalid) { setActionError(invalid); return; }
    setActionError(null);
    try {
      const res = await window.api.notesBoardRenameItem(folderPath, itemPath, newName);
      if ('error' in res) { setActionError(res.error); return; }
      if (!res.renamed) return; // unchanged name — nothing moved on disk
      await loadBoard(folderPath, true);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }, [folderPath, loadBoard]);

  const onRenameCancel = useCallback(() => setRenamingPath(null), []);
  const onRequestRename = useCallback((itemPath: string) => setRenamingPath(itemPath), []);
  const dismissActionError = useCallback(() => setActionError(null), []);
  const reportActionError = useCallback((message: string | null) => setActionError(message), []);

  // Navigating to another board drops any half-finished rename and disarms the
  // tool — neither addresses anything on the board you just opened.
  useEffect(() => {
    setRenamingPath(null);
    setActiveTool('select');
    setActionError(null);
  }, [folderPath]);

  return {
    items,
    savedLayout,
    furniture,
    setFurniture,
    itemKeysByPath,
    savedView,
    loading,
    error,
    actionError,
    dismissActionError,
    reportActionError,
    activeTool,
    setActiveTool,
    renamingPath,
    onItemMove,
    onItemResize,
    onCreateItem,
    onRequestRename,
    onRenameCommit,
    onRenameCancel,
    reload,
  };
}
