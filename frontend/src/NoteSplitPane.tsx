// M16 (Beta 3 Liquid Neon): notes split pane — prototype `toggleNSplit`
// (HTML 1281–1299): SPLIT badge, a note selector, a close button, and the
// second note rendered beside the active one.
// SKY-9784 (M8): the bare <select>+single-✕ header never grew into an
// Obsidian-parity tab strip (SKY-8907/SKY-9342 shipped that for the Story
// split editor's SplitEditorPane only). This pane now owns a real
// WorkspaceTabBar — tabs, +, overflow ▾, drag-to-reorder, and a per-pane ⋮
// menu — reused via NotesPaneTabStrip so the primary Notes pane (wired in
// NotesTabPanel) gets the identical strip while split.
import { useState, useEffect, useRef, type CSSProperties } from 'react';
import NoteViewer from './NoteViewer';
import WorkspaceTabBar from './WorkspaceTabBar';
import type { WikiLinkCandidate } from './crossTabLinkResolver';
import './NoteSplitPane.css';

export interface NotesPaneTabStripProps {
  paneNumber: 1 | 2;
  tabs: WorkspaceTab[];
  activeTabId: string | null;
  onTabSelect: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onTabReorder: (fromIndex: number, toIndex: number) => void;
  onNewTab: () => void;
  onTabDragStart?: (tab: WorkspaceTab) => void;
  /** True while a tab dragged from the OTHER Notes pane's strip is over this one. */
  acceptsTabDrop?: boolean;
  /** A tab from the other Notes pane was dropped on this pane's strip. */
  onTabStripDrop?: () => void;
  /** Per-pane ⋮ menu — "Close pane" (always available; closes the Notes split). */
  onClosePane: () => void;
}

/** SKY-9784: shared per-pane tab strip for the Notes split — same shape as
 * SplitEditorPane's strip (WorkspaceTabBar + ⋮ menu), reused by both the
 * primary Notes pane (NotesTabPanel) and this split pane. */
export function NotesPaneTabStrip({
  paneNumber,
  tabs,
  activeTabId,
  onTabSelect,
  onTabClose,
  onTabReorder,
  onNewTab,
  onTabDragStart,
  acceptsTabDrop = false,
  onTabStripDrop,
  onClosePane,
}: NotesPaneTabStripProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (
        menuBtnRef.current?.contains(e.target as Node) ||
        menuRef.current?.contains(e.target as Node)
      ) return;
      setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [menuOpen]);

  return (
    <div
      className={`nsp-tab-strip${acceptsTabDrop ? ' nsp-tab-strip--drop-target' : ''}`}
      data-testid={`notes-split-pane-${paneNumber}-tab-strip`}
      onDragOver={(e) => { if (acceptsTabDrop) e.preventDefault(); }}
      onDrop={(e) => {
        if (!acceptsTabDrop) return;
        e.preventDefault();
        onTabStripDrop?.();
      }}
    >
      <WorkspaceTabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onTabSelect={onTabSelect}
        onTabClose={onTabClose}
        onTabReorder={onTabReorder}
        onNewTab={onNewTab}
        onTabDragStart={onTabDragStart}
        newTabTitle="New note — via the notes explorer"
        allowCloseLastTab
        hideAgentsChip
      />
      <div className="nsp-pane-menu-wrap">
        <button
          ref={menuBtnRef}
          type="button"
          className={['nsp-pane-menu-btn', menuOpen ? 'nsp-pane-menu-btn--open' : ''].filter(Boolean).join(' ')}
          aria-label={`Notes pane ${paneNumber} options`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
          data-testid={`notes-split-pane-${paneNumber}-pane-menu-btn`}
        >
          ⋮
        </button>
        {menuOpen && (
          <div
            ref={menuRef}
            className="nsp-pane-menu"
            role="menu"
            aria-label={`Notes pane ${paneNumber} options`}
            data-testid={`notes-split-pane-${paneNumber}-pane-menu`}
          >
            <button
              type="button"
              role="menuitem"
              className="nsp-pane-menu-item nsp-pane-menu-item--close"
              onClick={() => { setMenuOpen(false); onClosePane(); }}
              data-testid={`notes-split-pane-${paneNumber}-pane-menu-close`}
            >
              Close pane
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export interface NoteSplitPaneProps {
  /** SKY-9784: this pane's own tab strip (open/close/reorder/overflow), same
   * data model as the Story split editor's per-pane strip. */
  tabs: WorkspaceTab[];
  activeTabId: string | null;
  onTabSelect: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onTabReorder: (fromIndex: number, toIndex: number) => void;
  onNewTab: () => void;
  onTabDragStart?: (tab: WorkspaceTab) => void;
  acceptsTabDrop?: boolean;
  onTabStripDrop?: () => void;
  /** Notes-Vault-relative path of the active tab, shown in this pane. */
  path: string;
  onClose: () => void;
  // NoteViewer passthrough (same wiring as the primary pane).
  onWikiLinkClick?: (target: string) => void;
  resolvedWikiLinkTitles?: ReadonlySet<string>;
  sceneWikiLinkTitles?: ReadonlySet<string>;
  wikiLinkCandidates?: WikiLinkCandidate[];
  style?: CSSProperties;
}

export default function NoteSplitPane({
  tabs,
  activeTabId,
  onTabSelect,
  onTabClose,
  onTabReorder,
  onNewTab,
  onTabDragStart,
  acceptsTabDrop = false,
  onTabStripDrop,
  path,
  onClose,
  onWikiLinkClick,
  resolvedWikiLinkTitles,
  sceneWikiLinkTitles,
  wikiLinkCandidates,
  style,
}: NoteSplitPaneProps) {
  return (
    <div className="nsp-pane" data-testid="note-split-pane" style={style}>
      <NotesPaneTabStrip
        paneNumber={2}
        tabs={tabs}
        activeTabId={activeTabId}
        onTabSelect={onTabSelect}
        onTabClose={onTabClose}
        onTabReorder={onTabReorder}
        onNewTab={onNewTab}
        onTabDragStart={onTabDragStart}
        acceptsTabDrop={acceptsTabDrop}
        onTabStripDrop={onTabStripDrop}
        onClosePane={onClose}
      />
      <div className="nsp-body">
        <NoteViewer
          key={path}
          path={path}
          onWikiLinkClick={onWikiLinkClick}
          resolvedWikiLinkTitles={resolvedWikiLinkTitles}
          sceneWikiLinkTitles={sceneWikiLinkTitles}
          wikiLinkCandidates={wikiLinkCandidates}
        />
      </div>
    </div>
  );
}
