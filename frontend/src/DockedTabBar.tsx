/**
 * SKY-1698 (Wave 2d): Custom panel tabs docked in the main tab bar.
 *
 * Renders to the right of the built-in view tabs (with a visual divider).
 * Panels dropped here become new custom tabs; a second panel dropped onto an
 * existing tab groups them (max 5 panels/tab, stacked vertically when active).
 *
 * AC-T-01 … AC-T-08 satisfied here and in DesktopShell.
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import { usePanelDrag } from './PanelDragContext';
import './DockedTabBar.css';

// ── Constants ──────────────────────────────────────────────────────────────────

export const DOCKED_TAB_PANEL_LABELS: Record<string, string> = {
  'writing-assistant': 'Writing Assistant',
  'archive-continuity': 'Continuity',
  'scene-preview': 'Scene Preview',
  stories: 'Story Navigator',
  entities: 'Entity Browser',
  vault: 'Vault Browser',
  'vault-graph': 'Graph',
  review: 'Suggestion Review',
  progress: 'Writing Goals',
  timeline: 'Timeline',
};

const ALL_PANEL_IDS: SidebarPanelId[] = [
  'stories',
  'entities',
  'vault',
  'vault-graph',
  'review',
  'progress',
  'timeline',
  'writing-assistant',
  'archive-continuity',
  'scene-preview',
];

const MAX_PANELS_PER_TAB = 5;
const LABEL_TRUNCATE = 16;

function truncateLabel(s: string): string {
  return s.length > LABEL_TRUNCATE ? s.slice(0, LABEL_TRUNCATE) + '…' : s;
}

function tabDisplayLabel(tab: DockedTab): string {
  const first = DOCKED_TAB_PANEL_LABELS[tab.panels[0]] ?? tab.panels[0];
  return truncateLabel(first);
}

// ── ClosePopover ───────────────────────────────────────────────────────────────

function ClosePopover({
  onSendToSidebar,
  onRemove,
  onDismiss,
}: {
  onSendToSidebar: () => void;
  onRemove: () => void;
  onDismiss: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onDismiss();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onDismiss]);

  return (
    <div className="dtb-close-popover" ref={ref} role="dialog" aria-label="Close tab options">
      <button
        className="dtb-close-popover-btn dtb-close-popover-btn--primary"
        onClick={onSendToSidebar}
        autoFocus
      >
        Send back to right sidebar
      </button>
      <button className="dtb-close-popover-btn" onClick={onRemove}>
        Remove panel
      </button>
    </div>
  );
}

// ── SlotZone ──────────────────────────────────────────────────────────────────
// Drop zone between tabs for both "new panel tab" and "tab reorder" drops.

function SlotZone({
  insertIndex,
  active,
  onPanelDragOver,
  onPanelDrop,
  onTabReorderDragOver,
  onTabReorderDrop,
  onLeave,
}: {
  insertIndex: number;
  active: boolean;
  onPanelDragOver: (e: React.DragEvent, idx: number) => void;
  onPanelDrop: (e: React.DragEvent, idx: number) => void;
  onTabReorderDragOver: (e: React.DragEvent, idx: number) => void;
  onTabReorderDrop: (e: React.DragEvent, idx: number) => void;
  onLeave: () => void;
}) {
  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      // Tab-reorder drag and panel drag are distinguished by the tabDragSrcIndex
      // ref, but we can't access it directly here — the parent handles dispatch.
      onPanelDragOver(e, insertIndex);
      onTabReorderDragOver(e, insertIndex);
    },
    [insertIndex, onPanelDragOver, onTabReorderDragOver],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      onPanelDrop(e, insertIndex);
      onTabReorderDrop(e, insertIndex);
    },
    [insertIndex, onPanelDrop, onTabReorderDrop],
  );

  return (
    <div
      className={`dtb-slot-zone${active ? ' dtb-slot-zone--active' : ''}`}
      aria-hidden="true"
      onDragOver={handleDragOver}
      onDragLeave={onLeave}
      onDrop={handleDrop}
    />
  );
}

// ── Props ──────────────────────────────────────────────────────────────────────

export interface DockedTabBarProps {
  dockedTabs: DockedTab[];
  activeDockedTabId: string | null;
  onTabSelect: (tabId: string) => void;
  /** AC-T-06: action 'send-to-sidebar' = add to right sidebar; 'remove' = discard. */
  onTabClose: (tabId: string, action: 'send-to-sidebar' | 'remove') => void;
  /** AC-T-05: reorder among custom tabs only (not before built-in tabs). */
  onTabReorder: (fromIndex: number, toIndex: number) => void;
  /** Panel IDs currently placed in sidebars/floating — excluded from picker. */
  dockedPanelIds: SidebarPanelId[];
  /** AC-T-08 ([+] button or "Dock as tab" menu item). */
  onAddPanelAsNewTab: (panelId: SidebarPanelId) => void;
}

// ── DockedTabBar ───────────────────────────────────────────────────────────────

export default function DockedTabBar({
  dockedTabs,
  activeDockedTabId,
  onTabSelect,
  onTabClose,
  onTabReorder,
  dockedPanelIds,
  onAddPanelAsNewTab,
}: DockedTabBarProps) {
  const {
    dragState,
    commitTabBarDrop,
    commitTabGroupDrop,
  } = usePanelDrag();

  // Whether a panel drag is currently live
  const isPanelDragging = dragState !== null;

  // ── × close popover ───────────────────────────────────────────────────────
  const [closePopoverTabId, setClosePopoverTabId] = useState<string | null>(null);

  // ── Drop indicator state ──────────────────────────────────────────────────
  // null = no active indicator. Number = slot index active (between-tab zone).
  const [dropSlotIndex, setDropSlotIndex] = useState<number | null>(null);
  // Tab being highlighted as a group drop target
  const [groupDropTabId, setGroupDropTabId] = useState<string | null>(null);

  // ── Tab drag-to-reorder (custom tabs only, no panel drag) ─────────────────
  const tabDragSrcIndex = useRef<number | null>(null);

  const handleTabDragStart = useCallback(
    (e: React.DragEvent, index: number) => {
      if (isPanelDragging) { e.preventDefault(); return; }
      tabDragSrcIndex.current = index;
      e.dataTransfer.effectAllowed = 'move';
      const blank = new Image();
      blank.src =
        'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
      e.dataTransfer.setDragImage(blank, 0, 0);
    },
    [isPanelDragging],
  );

  const handleTabDragEnd = useCallback(() => {
    tabDragSrcIndex.current = null;
    setDropSlotIndex(null);
    setGroupDropTabId(null);
  }, []);

  // ── Panel drag over / drop handlers for slot zones ────────────────────────

  const handlePanelDragOver = useCallback(
    (e: React.DragEvent, insertIndex: number) => {
      if (!isPanelDragging) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      setDropSlotIndex(insertIndex);
      setGroupDropTabId(null);
    },
    [isPanelDragging],
  );

  const handlePanelDrop = useCallback(
    (e: React.DragEvent, insertIndex: number) => {
      if (!isPanelDragging) return;
      e.preventDefault();
      e.stopPropagation();
      setDropSlotIndex(null);
      setGroupDropTabId(null);
      commitTabBarDrop(insertIndex);
    },
    [isPanelDragging, commitTabBarDrop],
  );

  // ── Tab reorder drag over / drop handlers for slot zones ──────────────────

  const handleReorderDragOver = useCallback(
    (e: React.DragEvent, toIndex: number) => {
      if (tabDragSrcIndex.current === null || isPanelDragging) return;
      if (tabDragSrcIndex.current === toIndex) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      setDropSlotIndex(toIndex);
    },
    [isPanelDragging],
  );

  const handleReorderDrop = useCallback(
    (e: React.DragEvent, toIndex: number) => {
      if (tabDragSrcIndex.current === null || isPanelDragging) return;
      e.preventDefault();
      e.stopPropagation();
      const from = tabDragSrcIndex.current;
      tabDragSrcIndex.current = null;
      setDropSlotIndex(null);
      if (from !== toIndex) onTabReorder(from, toIndex);
    },
    [isPanelDragging, onTabReorder],
  );

  const handleSlotLeave = useCallback(() => {
    setDropSlotIndex(null);
  }, []);

  // ── Group drop (drop panel onto existing tab) ─────────────────────────────

  const handleGroupDragOver = useCallback(
    (e: React.DragEvent, tabId: string, panelCount: number) => {
      if (!isPanelDragging) return;
      if (panelCount >= MAX_PANELS_PER_TAB) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      setGroupDropTabId(tabId);
      setDropSlotIndex(null);
    },
    [isPanelDragging],
  );

  const handleGroupDrop = useCallback(
    (e: React.DragEvent, tabId: string) => {
      if (!isPanelDragging) return;
      e.preventDefault();
      e.stopPropagation();
      setGroupDropTabId(null);
      setDropSlotIndex(null);
      commitTabGroupDrop(tabId);
    },
    [isPanelDragging, commitTabGroupDrop],
  );

  // Clear indicators when panel drag ends
  useEffect(() => {
    if (!isPanelDragging) {
      setDropSlotIndex(null);
      setGroupDropTabId(null);
    }
  }, [isPanelDragging]);

  // ── Picker ([+] button) ───────────────────────────────────────────────────
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pickerOpen) return;
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [pickerOpen]);

  const allDockedInTabs = dockedTabs.flatMap((t) => t.panels);
  const available = ALL_PANEL_IDS.filter(
    (id) => !dockedPanelIds.includes(id) && !allDockedInTabs.includes(id),
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="dtb-root">
      {/* Visual divider separating built-in tabs from custom tabs (AC-T-04) */}
      <div className="dtb-divider" aria-hidden="true" role="separator" />

      {/* Drop zone before first tab (slot 0) */}
      {(dockedTabs.length > 0 || isPanelDragging) && (
        <SlotZone
          insertIndex={0}
          active={dropSlotIndex === 0}
          onPanelDragOver={handlePanelDragOver}
          onPanelDrop={handlePanelDrop}
          onTabReorderDragOver={handleReorderDragOver}
          onTabReorderDrop={handleReorderDrop}
          onLeave={handleSlotLeave}
        />
      )}

      {/* Custom tabs */}
      {dockedTabs.map((tab, i) => {
        const isActive = tab.id === activeDockedTabId;
        const isGroupTarget = groupDropTabId === tab.id;
        const label = tabDisplayLabel(tab);
        const extraCount = tab.panels.length - 1;
        const fullTitle = tab.panels.map((id) => DOCKED_TAB_PANEL_LABELS[id] ?? id).join(', ');

        return (
          <div key={tab.id} className="dtb-tab-wrapper">
            <button
              className={[
                'dtb-tab',
                isActive ? 'dtb-tab--active' : '',
                isGroupTarget ? 'dtb-tab--group-target' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              draggable
              onDragStart={(e) => handleTabDragStart(e, i)}
              onDragEnd={handleTabDragEnd}
              onDragOver={(e) => handleGroupDragOver(e, tab.id, tab.panels.length)}
              onDragLeave={() => setGroupDropTabId(null)}
              onDrop={(e) => handleGroupDrop(e, tab.id)}
              onClick={() => { setClosePopoverTabId(null); onTabSelect(tab.id); }}
              aria-pressed={isActive}
              aria-label={`${label}${extraCount > 0 ? ` plus ${extraCount} more` : ''} panel tab`}
              title={fullTitle}
            >
              <span className="dtb-tab-label">{label}</span>
              {extraCount > 0 && (
                <span className="dtb-tab-badge" aria-label={`+${extraCount} more panels`}>
                  +{extraCount}
                </span>
              )}
              {/* AC-T-06: × shows popover */}
              <span
                className="dtb-tab-close"
                role="button"
                tabIndex={0}
                aria-label={`Close ${label} tab`}
                title="Close tab"
                onClick={(e) => {
                  e.stopPropagation();
                  setClosePopoverTabId((prev) => (prev === tab.id ? null : tab.id));
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    setClosePopoverTabId((prev) => (prev === tab.id ? null : tab.id));
                  }
                }}
              >
                ×
              </span>

              {closePopoverTabId === tab.id && (
                <ClosePopover
                  onSendToSidebar={() => {
                    setClosePopoverTabId(null);
                    onTabClose(tab.id, 'send-to-sidebar');
                  }}
                  onRemove={() => {
                    setClosePopoverTabId(null);
                    onTabClose(tab.id, 'remove');
                  }}
                  onDismiss={() => setClosePopoverTabId(null)}
                />
              )}
            </button>

            {/* Slot zone after each tab */}
            <SlotZone
              insertIndex={i + 1}
              active={dropSlotIndex === i + 1}
              onPanelDragOver={handlePanelDragOver}
              onPanelDrop={handlePanelDrop}
              onTabReorderDragOver={handleReorderDragOver}
              onTabReorderDrop={handleReorderDrop}
              onLeave={handleSlotLeave}
            />
          </div>
        );
      })}

      {/* Full-width drop zone shown when dragging and no tabs exist yet */}
      {isPanelDragging && dockedTabs.length === 0 && (
        <div
          className={`dtb-empty-drop${dropSlotIndex !== null ? ' dtb-empty-drop--active' : ''}`}
          aria-hidden="true"
          onDragOver={(e) => handlePanelDragOver(e, -1)}
          onDragLeave={handleSlotLeave}
          onDrop={(e) => handlePanelDrop(e, -1)}
        />
      )}

      {/* [+] button (AC-T-08 keyboard path) */}
      <div className="dtb-add-wrapper" ref={pickerRef}>
        <button
          className="dtb-add-btn"
          aria-label="Dock a panel as a new tab"
          title="Add panel tab"
          aria-expanded={pickerOpen}
          onClick={() => setPickerOpen((v) => !v)}
          data-testid="dtb-add-btn"
        >
          +
        </button>
        {pickerOpen && (
          <div className="dtb-picker" role="menu" aria-label="Choose panel to dock as tab">
            {available.length === 0 ? (
              <div className="dtb-picker-empty">All panels are already placed</div>
            ) : (
              available.map((id) => (
                <button
                  key={id}
                  className="dtb-picker-item"
                  role="menuitem"
                  onClick={() => {
                    onAddPanelAsNewTab(id);
                    setPickerOpen(false);
                  }}
                >
                  {DOCKED_TAB_PANEL_LABELS[id] ?? id}
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
