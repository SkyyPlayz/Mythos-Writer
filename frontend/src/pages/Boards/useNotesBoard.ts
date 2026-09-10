/**
 * SKY-11192/SKY-11674: the shared board-state hook. Extracted from
 * BoardsTabPanel so the Notes Board tab and Brainstorm's Board page/chat
 * strip are two RENDERINGS of the same state, not two copies that happen to
 * agree — both call the exact same load/save functions against the exact
 * same `notesBoard:*` IPC surface and the exact same on-disk files. An edit
 * made from one home is immediately visible from the other because there is
 * only one persistence path here, not a sync between two.
 *
 * Scope: data loading (vault listing + board metadata + thumbnails) and the
 * move/resize/view-change mutators. Canvas-tool item creation, inline
 * rename, and breadcrumb navigation stay in BoardsTabPanel — those are Notes
 * Board tab UI, not board STATE, and Brainstorm's Board page does not carry
 * them (CEO ruling on SKY-11192: no folder-tree picker in Brainstorm, any
 * other folder is reached from the Notes tab).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { BoardItem, ItemLayout, BoardFurnitureItemData } from './BoardCanvas';
import { resolveNoteThumbs } from '../../lib/noteThumbnails';
import { boardFollowsChange } from './boardVaultChange';

interface VaultListItem {
  path: string;
  name: string;
  isDirectory: boolean;
  excerpt?: string;
}

/** Vault-relative path of a board child (item paths are relative to their board's folder). */
export function vaultPathOf(folderPath: string, itemPath: string): string {
  return folderPath ? `${folderPath}/${itemPath}` : itemPath;
}

/** How long to coalesce a burst of vault change events before reloading the board. */
const VAULT_CHANGE_RELOAD_MS = 200;

export interface UseNotesBoardResult {
  items: BoardItem[];
  savedLayout: Record<string, ItemLayout>;
  savedView: { zoom: number; panX: number; panY: number };
  /** SKY-11188 §4: board-only furniture. Brainstorm's Board page/chat strip
   *  don't render a furniture toolbar (no creation tools at all — see
   *  BrainstormBoardSurface.tsx), but pass this through to BoardCanvas
   *  anyway so a board that already has furniture (added from the Notes
   *  Board tab) still renders it correctly from Brainstorm's home too. */
  furniture: BoardFurnitureItemData[];
  /** Every touched child's own item key (v:/n:/x:), by path — a `line` furniture's from/to may name one (§4). */
  itemKeysByPath: Record<string, string>;
  /** Optimistic local update after a furniture CRUD call — the mutator functions themselves stay in BoardsTabPanel. */
  setFurniture: (updater: (prev: BoardFurnitureItemData[]) => BoardFurnitureItemData[]) => void;
  loading: boolean;
  error: string | null;
  handleItemMove: (itemPath: string, x: number, y: number) => void;
  handleItemResize: (itemPath: string, w: number, h: number) => void;
  handleViewChange: (zoom: number, panX: number, panY: number) => void;
  /** Force an immediate (non-silent) reload — e.g. right after Idea Collections files a new note. */
  reload: () => void;
}

/**
 * `folderPath` is vault-relative ('' = Home). See BoardsTabPanel's own
 * contract comment (SKY-11336) for why this must never be an absolute path.
 * The active notes vault ROOT is resolved on the main-process side of every
 * `notesBoard:*`/`listNotesVault` call, not passed over IPC — callers that
 * need to react to a vault-root change do so by changing `folderPath` (e.g.
 * resetting to Home), the same way BoardsTabPanel already does.
 */
export function useNotesBoard(
  folderPath: string,
  notesVaultValid: boolean,
): UseNotesBoardResult {
  const [items, setItems] = useState<BoardItem[]>([]);
  const [savedLayout, setSavedLayout] = useState<Record<string, ItemLayout>>({});
  const [savedView, setSavedView] = useState<{ zoom: number; panX: number; panY: number }>({ zoom: 100, panX: 0, panY: 0 });
  const [furniture, setFurniture] = useState<BoardFurnitureItemData[]>([]);
  const [itemKeysByPath, setItemKeysByPath] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A reload that finishes after a newer one started must not clobber it —
  // vault-change reloads and folder switches can overlap.
  const loadSeqRef = useRef(0);

  const loadBoard = useCallback(async (silent = false) => {
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

      // See BoardsTabPanel.tsx for the full SKY-11336 explanation of this
      // split: listNotesVault is recursive, a board shows only immediate
      // children, and child counts are derived from the same one listing.
      const directChildren: VaultListItem[] = [];
      const childCounts = new Map<string, { boards: number; cards: number }>();
      for (const vaultItem of vaultResult.items) {
        const slash = vaultItem.path.indexOf('/');
        if (slash === -1) {
          if (vaultItem.isDirectory || /\.md$/i.test(vaultItem.name)) directChildren.push(vaultItem);
          continue;
        }
        if (vaultItem.path.indexOf('/', slash + 1) !== -1) continue;
        const parent = vaultItem.path.slice(0, slash);
        const counts = childCounts.get(parent) ?? { boards: 0, cards: 0 };
        if (vaultItem.isDirectory) counts.boards += 1;
        else if (/\.md$/i.test(vaultItem.name)) counts.cards += 1;
        childCounts.set(parent, counts);
      }

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

      // SKY-11188: every TOUCHED child's own item key, by path — built
      // independently of layoutMap (a colour-only touch mints an id with no
      // layout entry), needed by furniture `line` items to find endpoints.
      const layoutMap: Record<string, ItemLayout> = {};
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
      if (seq === loadSeqRef.current) setLoading(false);
    }
  }, [folderPath, notesVaultValid]);

  useEffect(() => {
    void loadBoard();
  }, [loadBoard]);

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
        void loadBoard(true);
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

  const handleViewChange = useCallback((_zoom: number, _panX: number, _panY: number) => {
    // View is ephemeral within the session — see BoardsTabPanel's own note.
  }, []);

  const handleItemMove = useCallback((itemPath: string, x: number, y: number) => {
    window.api.notesBoardPatchLayout(folderPath, itemPath, { x, y }).then(() => {
      setSavedLayout((prev) => ({ ...prev, [itemPath]: { ...(prev[itemPath] ?? {}), x, y } }));
    }).catch((err) => {
      console.warn('[Boards] failed to persist item position', err);
    });
  }, [folderPath]);

  const handleItemResize = useCallback((itemPath: string, w: number, h: number) => {
    window.api.notesBoardPatchLayout(folderPath, itemPath, { w, h }).then(() => {
      setSavedLayout((prev) => ({ ...prev, [itemPath]: { ...(prev[itemPath] ?? {}), w, h } }));
    }).catch((err) => {
      console.warn('[Boards] failed to persist item size', err);
    });
  }, [folderPath]);

  const reload = useCallback(() => { void loadBoard(true); }, [loadBoard]);

  return {
    items, savedLayout, savedView, furniture, itemKeysByPath, setFurniture,
    loading, error, handleItemMove, handleItemResize, handleViewChange, reload,
  };
}
