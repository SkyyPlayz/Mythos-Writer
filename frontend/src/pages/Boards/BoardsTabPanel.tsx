/**
 * SKY-11184: Notes Board top-level tab panel.
 * Renders a breadcrumb nav + BoardCanvas for the current board folder.
 * BOARDS-SPEC.md §1, §5.
 */
import { useCallback, useEffect, useState } from 'react';
import BoardCanvas from './BoardCanvas';
import type { BoardItem, ItemLayout } from './BoardCanvas';
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
}

export default function BoardsTabPanel({ notesVaultRoot, notesVaultValid }: BoardsTabPanelProps) {
  // Breadcrumb stack — bottom is home (vault root), top is current board
  const [breadcrumb, setBreadcrumb] = useState<BreadcrumbEntry[]>([
    { folderPath: notesVaultRoot, name: 'Home' },
  ]);

  const currentFolder = breadcrumb[breadcrumb.length - 1].folderPath;

  // Reset breadcrumb when vault root changes
  useEffect(() => {
    setBreadcrumb([{ folderPath: notesVaultRoot, name: 'Home' }]);
  }, [notesVaultRoot]);

  const [items, setItems] = useState<BoardItem[]>([]);
  const [savedLayout, setSavedLayout] = useState<Record<string, ItemLayout>>({});
  const [savedView, setSavedView] = useState<{ zoom: number; panX: number; panY: number }>({ zoom: 100, panX: 0, panY: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch board data: IPC gives us the metadata store + vault listing
  const loadBoard = useCallback(async (folderPath: string) => {
    if (!folderPath || !notesVaultValid) return;
    setLoading(true);
    setError(null);
    try {
      const [vaultResult, meta] = await Promise.all([
        window.api.listNotesVault(folderPath) as Promise<{ items: VaultListItem[] } | { error: string }>,
        window.api.notesBoardGet(folderPath),
      ]);

      if ('error' in vaultResult) {
        setError(vaultResult.error);
        setItems([]);
        return;
      }

      // Build items: vault items are canonical (spec §1 — Store B never hides a note)
      // listNotesVault returns the immediate directory listing
      const directChildren = vaultResult.items;

      // Map vault items to BoardItems, counting children for board tiles
      const boardItemsPromises = directChildren.map(async (vaultItem): Promise<BoardItem> => {
        if (vaultItem.isDirectory) {
          // Count direct children for the tile subtitle (from vault, not metadata — spec §5)
          const childResult = await window.api.listNotesVault(vaultItem.path) as { items: VaultListItem[] } | { error: string };
          const childItems = 'items' in childResult ? childResult.items : [];
          return {
            path: vaultItem.path,
            kind: 'folder',
            name: vaultItem.name,
            childBoards: childItems.filter((c) => c.isDirectory).length,
            childCards: childItems.filter((c) => !c.isDirectory && c.name.endsWith('.md')).length,
          };
        }
        return {
          path: vaultItem.path,
          kind: 'note',
          name: vaultItem.name.replace(/\.md$/, ''),
          excerpt: vaultItem.excerpt,
        };
      });

      const resolvedItems = await Promise.all(boardItemsPromises);

      // Build saved layout: the store returns layout keyed by path (resolved by the IPC layer)
      // Map from the metadata children list (path → stored layout)
      const layoutMap: Record<string, ItemLayout> = {};
      for (const child of meta.children) {
        if (meta.layout[`v:${child.id ?? ''}`] || meta.layout[`n:${child.id ?? ''}`]) {
          const key = child.kind === 'folder' ? `v:${child.id}` : `n:${child.id}`;
          const storedLayout = meta.layout[key];
          if (storedLayout) {
            layoutMap[child.path] = storedLayout;
          }
        }
      }

      setItems(resolvedItems);
      setSavedLayout(layoutMap);
      setSavedView(meta.view ?? { zoom: 100, panX: 0, panY: 0 });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [notesVaultValid]);

  useEffect(() => {
    loadBoard(currentFolder);
  }, [currentFolder, loadBoard]);

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
    } catch {
      // non-fatal: position stays in local state
    }
  }, [currentFolder]);

  const handleItemResize = useCallback(async (itemPath: string, w: number, h: number) => {
    try {
      await window.api.notesBoardPatchLayout(currentFolder, itemPath, { w, h });
      setSavedLayout((prev) => ({
        ...prev,
        [itemPath]: { ...(prev[itemPath] ?? {}), w, h },
      }));
    } catch {
      // non-fatal
    }
  }, [currentFolder]);

  const handleEnterBoard = useCallback((folderPath: string) => {
    const folderName = items.find((i) => i.path === folderPath)?.name ?? folderPath.split(/[\\/]/).pop() ?? folderPath;
    setBreadcrumb((prev) => [...prev, { folderPath, name: folderName }]);
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
          <span key={crumb.folderPath} className="boards-tab-panel__breadcrumb-group">
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
          onItemMove={handleItemMove}
          onItemResize={handleItemResize}
          onViewChange={handleViewChange}
          onEnterBoard={handleEnterBoard}
        />
      )}
    </div>
  );
}
