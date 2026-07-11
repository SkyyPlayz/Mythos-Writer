/**
 * SKY-3097 (v0.3): WorkspaceTabBar — Obsidian-style draggable/closeable tab row.
 * SKY-5704 (GH#643 Tabs-1): keyboard reorder, scroll-overflow, drag affordance.
 * Beta 3 M6: Liquid Neon restyle (prototype HTML 136–165 + renderVals tab logic
 * ~4013–4044): glass strip, neon active tab, right-click context menu
 * (Open to the side / Pop out into new window / Close tab), agents status chip.
 * Beta 4 M4 (§4): tabs are documents — the last tab is not closable (prototype
 * `closable: tabIds.length > 1`), drags carry the document identity for the
 * shell's split drop zones, `+` creates a provisional scene (§1.5), and
 * non-document views render a single static pseudo-tab (prototype ~5713).
 *
 * Standalone component; wired into DesktopShell by PE-C (SKY-3098).
 * AC-LN-06: X closes immediately, no popover. Active-tab close selects left neighbor.
 * AC-LN-09: role="tablist" + role="tab" + aria-selected + arrow-key focus management.
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import './WorkspaceTabBar.css';

export interface WorkspaceTabBarProps {
  tabs: WorkspaceTab[];
  activeTabId: string | null;
  onTabSelect: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onTabReorder: (fromIndex: number, toIndex: number) => void;
  /** Beta 4 M4 (§1.5): the + button creates a provisional scene in the shell. */
  onNewTab: () => void;
  /** GH#643 split panes: Shift+click / Shift+Enter on a tab opens it in the split pane. */
  onTabOpenInSplit?: (tabId: string) => void;
  /** Beta3 M6: context-menu "Pop out into new window" — shell wires to a floating window. */
  onTabPopOut?: (tabId: string) => void;
  /** Beta3 M6: agents status chip; false shows the prototype "All agents idle" state. */
  agentsActive?: boolean;
  /** Beta 4 M4: notifies the shell a tab drag started so it can mount the
   * split drop zones (drag DOWN/RIGHT → split pane, §4). Cleared by the
   * shell's document-level dragend/drop listeners. */
  onTabDragStart?: (tab: WorkspaceTab) => void;
  /** Beta 4 M4: render a single non-interactive view pseudo-tab instead of
   * document tabs (Scene Crafter/Entities — prototype tabList fallback). */
  staticTabLabel?: string;
  /** Tooltip for the + button (prototype 512). */
  newTabTitle?: string;
}

/** Drag payload MIME so the shell's split-pane drop zone can recognize tab drags. */
export const WORKSPACE_TAB_DRAG_MIME = 'application/x-mythos-workspace-tab';

export default function WorkspaceTabBar({
  tabs,
  activeTabId,
  onTabSelect,
  onTabClose,
  onTabReorder,
  onNewTab,
  onTabOpenInSplit,
  onTabPopOut,
  agentsActive = false,
  onTabDragStart,
  staticTabLabel,
  newTabTitle = 'New blank scene — it only saves once you type',
}: WorkspaceTabBarProps) {
  // ── Drag-to-reorder state ─────────────────────────────────────────────────
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const dragSrcIndex = useRef<number | null>(null);

  // ── Beta3 M6: right-click context menu (prototype 138–156) ──────────────
  // Anchored strip-relative so it escapes the scroll strip's overflow clip.
  const [ctxMenu, setCtxMenu] = useState<{ tabId: string; left: number; top: number } | null>(
    null,
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // ── Roving-tabIndex refs for arrow-key focus management ───────────────────
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // ── SKY-5704: keyboard-reorder focus-follow + a11y move announcement ─────
  const pendingFocusIdRef = useRef<string | null>(null);
  const [moveAnnouncement, setMoveAnnouncement] = useState('');

  useEffect(() => {
    if (pendingFocusIdRef.current === null) return;
    const idx = tabs.findIndex((t) => t.id === pendingFocusIdRef.current);
    pendingFocusIdRef.current = null;
    if (idx !== -1) tabRefs.current[idx]?.focus();
  }, [tabs]);

  // ── SKY-5704: keep the active tab in view when the strip overflows ────────
  useEffect(() => {
    if (activeTabId === null) return;
    const idx = tabs.findIndex((t) => t.id === activeTabId);
    tabRefs.current[idx]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeTabId, tabs]);

  // ── Close with active-tab selection (AC-LN-06) ───────────────────────────
  // Declared before handleTabKeyDown and keyboard useEffect so they can reference it.
  const handleClose = useCallback(
    (tabId: string) => {
      if (tabId === activeTabId && tabs.length > 1) {
        const idx = tabs.findIndex((t) => t.id === tabId);
        // Select left, or right if closing the first tab
        const nextActive = idx > 0 ? tabs[idx - 1].id : tabs[1].id;
        onTabSelect(nextActive);
      }
      onTabClose(tabId);
    },
    [tabs, activeTabId, onTabClose, onTabSelect],
  );

  // ── Beta3 M6: right-click toggles the tab context menu (prototype tabCtx,
  // HTML 3732) — same tab toggles off, another tab moves the menu there. ────
  const handleTabContextMenu = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>, tabId: string) => {
      e.preventDefault();
      // Prototype 141 anchors the popover at left:0/top:34px of the tab;
      // measure before setState — currentTarget is only valid during dispatch.
      const rootRect = rootRef.current?.getBoundingClientRect();
      const tabRect = e.currentTarget.getBoundingClientRect();
      const left = rootRect ? tabRect.left - rootRect.left : 0;
      const top = (rootRect ? tabRect.top - rootRect.top : 0) + 34;
      setCtxMenu((cur) => (cur?.tabId === tabId ? null : { tabId, left, top }));
    },
    [],
  );

  // ── Beta3 M6: menu dismissal — mousedown outside (like WindowChrome
  // popovers); right-button presses fall through to each tab's toggle. ─────
  useEffect(() => {
    if (ctxMenu === null) return;
    const onDown = (e: MouseEvent) => {
      if (e.button === 2) return;
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setCtxMenu(null);
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [ctxMenu]);

  // ── SKY-5704: keyboard reorder — Ctrl+Shift+ArrowLeft/Right moves the
  // focused tab one slot and keeps focus on it (mirrors the drag gesture). ──
  const handleTabReorder = useCallback(
    (index: number, delta: -1 | 1) => {
      const toIndex = index + delta;
      if (toIndex < 0 || toIndex >= tabs.length) return;
      pendingFocusIdRef.current = tabs[index].id;
      setMoveAnnouncement(
        `${tabs[index].title} moved to position ${toIndex + 1} of ${tabs.length}`,
      );
      onTabReorder(index, toIndex);
    },
    [tabs, onTabReorder],
  );

  // ── Arrow-key focus management (AC-LN-09) ────────────────────────────────
  const handleTabKeyDown = useCallback(
    (e: React.KeyboardEvent, index: number) => {
      if (tabs.length === 0) return;
      if (e.ctrlKey && e.shiftKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        e.preventDefault();
        handleTabReorder(index, e.key === 'ArrowRight' ? 1 : -1);
      } else if (e.shiftKey && e.key === 'Enter' && onTabOpenInSplit) {
        // GH#643: keyboard path for open-in-split-pane.
        e.preventDefault();
        onTabOpenInSplit(tabs[index].id);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        tabRefs.current[(index + 1) % tabs.length]?.focus();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        tabRefs.current[(index - 1 + tabs.length) % tabs.length]?.focus();
      } else if (e.key === 'Home') {
        e.preventDefault();
        tabRefs.current[0]?.focus();
      } else if (e.key === 'End') {
        e.preventDefault();
        tabRefs.current[tabs.length - 1]?.focus();
      }
    },
    [tabs, handleTabReorder, onTabOpenInSplit],
  );

  // ── Global Ctrl+W / Ctrl+Tab keyboard shortcuts ───────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Beta3 M6: Escape dismisses the tab context menu (prototype 3918).
        setCtxMenu(null);
        return;
      }
      if (!e.ctrlKey) return;
      if (e.key === 'w') {
        if (activeTabId !== null) {
          e.preventDefault();
          handleClose(activeTabId);
        }
      } else if (!e.shiftKey && e.key === 'Tab') {
        if (tabs.length === 0) return;
        e.preventDefault();
        const idx = tabs.findIndex((t) => t.id === activeTabId);
        const next = idx === -1 ? 0 : (idx + 1) % tabs.length;
        onTabSelect(tabs[next].id);
      } else if (e.shiftKey && e.key === 'Tab') {
        if (tabs.length === 0) return;
        e.preventDefault();
        const idx = tabs.findIndex((t) => t.id === activeTabId);
        const prev = idx === -1 ? 0 : (idx - 1 + tabs.length) % tabs.length;
        onTabSelect(tabs[prev].id);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeTabId, tabs, handleClose, onTabSelect]);

  // ── Drag handlers ─────────────────────────────────────────────────────────
  const handleDragStart = useCallback((e: React.DragEvent, index: number) => {
    dragSrcIndex.current = index;
    setDraggingIndex(index);
    const tab = tabs[index];
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      // GH#643→M4: carry the document identity so drop targets outside this
      // bar (the shell's split drop zones) can act on it. Feature-detected —
      // jsdom fireEvent stubs often omit setData.
      if (tab && typeof e.dataTransfer.setData === 'function') {
        e.dataTransfer.setData(
          WORKSPACE_TAB_DRAG_MIME,
          JSON.stringify({
            id: tab.id,
            kind: tab.kind,
            docId: tab.docId ?? null,
            docPath: tab.docPath ?? null,
            title: tab.title,
          }),
        );
      }
      // Blank drag image (same pattern as DockedTabBar)
      const blank = new Image();
      blank.src =
        'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
      e.dataTransfer.setDragImage(blank, 0, 0);
    }
    // M4: dataTransfer payloads are unreadable during dragover, so the shell
    // captures the dragged tab up front for its drop-zone highlight/label.
    if (tab) onTabDragStart?.(tab);
  }, [tabs, onTabDragStart]);

  const handleDragEnd = useCallback(() => {
    dragSrcIndex.current = null;
    setDraggingIndex(null);
    setDropTargetIndex(null);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    if (dragSrcIndex.current === null || dragSrcIndex.current === index) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    setDropTargetIndex(index);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, index: number) => {
      if (dragSrcIndex.current === null) return;
      e.preventDefault();
      const from = dragSrcIndex.current;
      dragSrcIndex.current = null;
      setDraggingIndex(null);
      setDropTargetIndex(null);
      if (from !== index) {
        setMoveAnnouncement(`${tabs[from].title} moved to position ${index + 1} of ${tabs.length}`);
        onTabReorder(from, index);
      }
    },
    [onTabReorder, tabs],
  );

  const menuTab = ctxMenu === null ? undefined : tabs.find((t) => t.id === ctxMenu.tabId);

  // Beta 4 M4: the last document tab is not closable (prototype
  // `closable: tabIds.length > 1`) — an empty strip would orphan the editor.
  const closable = tabs.length > 1;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="wtb-root" role="tablist" aria-label="Workspace tabs" ref={rootRef}>
      {/* SKY-5704: scrollable strip so overflow tabs stay reachable without
          pushing the pinned + button off-screen. */}
      <div
        className={['wtb-tabs-scroll', tabs.length === 0 && !staticTabLabel ? 'wtb-tabs-scroll--empty' : '']
          .filter(Boolean)
          .join(' ')}
        onScroll={() => setCtxMenu(null)}
      >
        {/* Beta 4 M4: non-document views show the view name as a single static
            pseudo-tab (prototype tabList fallback, ~5713). */}
        {staticTabLabel && (
          <div className="wtb-tab-slot wtb-tab-slot--active wtb-tab-slot--static">
            <div className="wtb-tab wtb-tab--active wtb-tab--static" data-testid="wtb-static-tab">
              <span className="wtb-tab-dot wtb-tab-dot--static" aria-hidden="true" />
              <span className="wtb-tab-label">{staticTabLabel}</span>
            </div>
          </div>
        )}
        {!staticTabLabel && tabs.map((tab, i) => {
          const isActive = tab.id === activeTabId;
          return (
            /*
             * Each slot is a wrapper div containing two sibling buttons:
             * role="tab" (the main tab area) and close (x).
             * Siblings — not parent/child — avoids nested-button DOM violation.
             */
            <div
              key={tab.id}
              className={[
                'wtb-tab-slot',
                isActive ? 'wtb-tab-slot--active' : '',
                dropTargetIndex === i ? 'wtb-tab-slot--drop-target' : '',
                draggingIndex === i ? 'wtb-tab-slot--dragging' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <button
                ref={(el) => {
                  tabRefs.current[i] = el;
                }}
                role="tab"
                id={`workspace-tab-${tab.id}`}
                aria-selected={isActive}
                aria-controls={`workspace-panel-${tab.id}`}
                tabIndex={isActive ? 0 : -1}
                className={['wtb-tab', isActive ? 'wtb-tab--active' : '']
                  .filter(Boolean)
                  .join(' ')}
                draggable
                onDragStart={(e) => handleDragStart(e, i)}
                onDragEnd={handleDragEnd}
                onDragOver={(e) => handleDragOver(e, i)}
                onDragLeave={() => setDropTargetIndex(null)}
                onDrop={(e) => handleDrop(e, i)}
                onClick={(e) => {
                  // GH#643: Shift+click opens the tab in the split pane.
                  if (e.shiftKey && onTabOpenInSplit) onTabOpenInSplit(tab.id);
                  else onTabSelect(tab.id);
                }}
                onContextMenu={(e) => handleTabContextMenu(e, tab.id)}
                onKeyDown={(e) => handleTabKeyDown(e, i)}
                title={onTabOpenInSplit ? `${tab.title} (Shift+click: open in split pane)` : tab.title}
                data-status={tab.status}
                data-provisional={tab.provisional || undefined}
              >
                {/* Prototype 147: neon status dot — cyan on the active tab. */}
                <span className="wtb-tab-dot" aria-hidden="true" />
                <span className="wtb-tab-label">{tab.title}</span>
              </button>

              {closable && (
                <button
                  className="wtb-tab-close"
                  aria-label={`Close ${tab.title}`}
                  tabIndex={-1}
                  onClick={() => handleClose(tab.id)}
                >
                  {/* Prototype 151: 9px rounded X */}
                  <svg
                    width="9"
                    height="9"
                    viewBox="0 0 12 12"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    aria-hidden="true"
                  >
                    <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
                  </svg>
                </button>
              )}
            </div>
          );
        })}
      </div>

      <button
        className="wtb-new-tab-btn"
        aria-label="Open new tab"
        title={newTabTitle}
        onClick={onNewTab}
        data-testid="wtb-new-tab-btn"
      >
        {/* Prototype 158: 13px plus */}
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>

      <div className="wtb-spacer" />

      {/* Beta3 M6: agents status chip (prototype 161–164). */}
      <div className="wtb-agents-chip" data-testid="wtb-agents-chip">
        <span
          className={['wtb-agents-dot', agentsActive ? 'wtb-agents-dot--active' : '']
            .filter(Boolean)
            .join(' ')}
          aria-hidden="true"
        />
        <span>{agentsActive ? 'Agents working' : 'All agents idle'}</span>
      </div>

      {/* Beta3 M6: tab context menu (prototype 141–145). */}
      {ctxMenu !== null && menuTab && (
        <div
          ref={menuRef}
          className="wtb-ctx-menu"
          style={{ left: ctxMenu.left, top: ctxMenu.top }}
          role="menu"
          aria-label={`${menuTab.title} tab actions`}
          data-testid="wtb-tab-context-menu"
        >
          <button
            type="button"
            role="menuitem"
            className="wtb-ctx-item"
            data-testid="wtb-ctx-open-side"
            onClick={() => {
              setCtxMenu(null);
              onTabOpenInSplit?.(menuTab.id);
            }}
          >
            Open to the side
          </button>
          <button
            type="button"
            role="menuitem"
            className="wtb-ctx-item"
            data-testid="wtb-ctx-pop-out"
            onClick={() => {
              setCtxMenu(null);
              onTabPopOut?.(menuTab.id);
            }}
          >
            Pop out into new window
          </button>
          <button
            type="button"
            role="menuitem"
            className="wtb-ctx-item wtb-ctx-item--close"
            data-testid="wtb-ctx-close"
            onClick={() => {
              setCtxMenu(null);
              handleClose(menuTab.id);
            }}
          >
            Close tab
          </button>
          <div className="wtb-ctx-hint">Drag tabs to reorder · right-click for this menu</div>
        </div>
      )}

      {/* SKY-5704: announce reorders (drag or keyboard) to assistive tech. */}
      <div className="sr-only" role="status" aria-live="polite">
        {moveAnnouncement}
      </div>
    </div>
  );
}
