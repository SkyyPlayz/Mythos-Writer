/**
 * SKY-3097 (v0.3): WorkspaceTabBar — Obsidian-style draggable/closeable tab row.
 * SKY-5704 (GH#643 Tabs-1): keyboard reorder, scroll-overflow, drag affordance.
 *
 * Standalone component; wired into DesktopShell by PE-C (SKY-3098).
 * AC-LN-06: X closes immediately, no popover. Active-tab close selects left neighbor.
 * AC-LN-09: role="tablist" + role="tab" + aria-selected + arrow-key focus management.
 * AC-LN-10: active tab gets --accent bottom border + --bg-surface background.
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import './WorkspaceTabBar.css';

export interface WorkspaceTabBarProps {
  tabs: WorkspaceTab[];
  activeTabId: string | null;
  onTabSelect: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onTabReorder: (fromIndex: number, toIndex: number) => void;
  /** Called when the + button is clicked; parent shows a content picker overlay. */
  onNewTab: () => void;
}

export default function WorkspaceTabBar({
  tabs,
  activeTabId,
  onTabSelect,
  onTabClose,
  onTabReorder,
  onNewTab,
}: WorkspaceTabBarProps) {
  // ── Drag-to-reorder state ─────────────────────────────────────────────────
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const dragSrcIndex = useRef<number | null>(null);

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
    [tabs.length, handleTabReorder],
  );

  // ── Global Ctrl+W / Ctrl+Tab keyboard shortcuts ───────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
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
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      // Blank drag image (same pattern as DockedTabBar)
      const blank = new Image();
      blank.src =
        'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
      e.dataTransfer.setDragImage(blank, 0, 0);
    }
  }, []);

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

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="wtb-root" role="tablist" aria-label="Workspace tabs">
      {/* SKY-5704: scrollable strip so overflow tabs stay reachable without
          pushing the pinned + button off-screen. */}
      <div className={['wtb-tabs-scroll', tabs.length === 0 ? 'wtb-tabs-scroll--empty' : '']
        .filter(Boolean)
        .join(' ')}
      >
        {tabs.map((tab, i) => {
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
                onClick={() => onTabSelect(tab.id)}
                onKeyDown={(e) => handleTabKeyDown(e, i)}
                title={tab.title}
              >
                {tab.icon && (
                  <span className="wtb-tab-icon" aria-hidden="true">
                    {tab.icon}
                  </span>
                )}
                <span className="wtb-tab-label">{tab.title}</span>
              </button>

              <button
                className="wtb-tab-close"
                aria-label={`Close ${tab.title}`}
                tabIndex={-1}
                onClick={() => handleClose(tab.id)}
              >
                x
              </button>
            </div>
          );
        })}
      </div>

      <button
        className="wtb-new-tab-btn"
        aria-label="Open new tab"
        title="New tab"
        onClick={onNewTab}
        data-testid="wtb-new-tab-btn"
      >
        +
      </button>

      {/* SKY-5704: announce reorders (drag or keyboard) to assistive tech. */}
      <div className="sr-only" role="status" aria-live="polite">
        {moveAnnouncement}
      </div>
    </div>
  );
}
