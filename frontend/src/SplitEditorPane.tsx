import {
  type CSSProperties,
  forwardRef,
  useImperativeHandle,
  useState,
  useRef,
  useEffect,
  useMemo,
  useCallback,
} from 'react';
import type { Scene, Chapter, Story, Block, EntityEntry } from './types';
import type { WLSuggestion } from './WikiLinkHintExtension';
import type { AutoLinkerMode } from './AutoLinkerExtension';
import type { WikiLinkCandidate } from './crossTabLinkResolver';
import BlockEditor, { type BlockEditorApi } from './BlockEditor';
import { SceneEditorEmptyState } from './SceneEditorEmptyState';
import WorkspaceTabBar from './WorkspaceTabBar';
import EntityBrowser from './EntityBrowser';
import './SplitEditorPane.css';

// ─── Compact per-pane scene selector ───

interface PaneSceneSelectorProps {
  scene: Scene | null;
  stories: Story[];
  onSelect: (scene: Scene, chapter: Chapter, story: Story) => void;
}

/** SKY-8907: imperative handle so the pane's empty-state action card can
 * trigger "Go to scene" without lifting the popover's open state. */
export interface PaneSceneSelectorHandle {
  openPicker: () => void;
}

const PaneSceneSelector = forwardRef<PaneSceneSelectorHandle, PaneSceneSelectorProps>(
  function PaneSceneSelector({ scene, stories, onSelect }, ref) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const containerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    useImperativeHandle(ref, () => ({ openPicker: () => setOpen(true) }), []);

    useEffect(() => {
      if (!open) {
        setQuery('');
        return;
      }
      // Small delay so the popover is in the DOM before focusing
      const id = setTimeout(() => inputRef.current?.focus(), 10);
      return () => clearTimeout(id);
    }, [open]);

    useEffect(() => {
      if (!open) return;
      const onOutside = (e: MouseEvent) => {
        if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
          setOpen(false);
        }
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') setOpen(false);
      };
      document.addEventListener('mousedown', onOutside);
      document.addEventListener('keydown', onKey);
      return () => {
        document.removeEventListener('mousedown', onOutside);
        document.removeEventListener('keydown', onKey);
      };
    }, [open]);

    const allScenes = useMemo(() => {
      const results: { scene: Scene; chapter: Chapter; story: Story }[] = [];
      for (const st of stories) {
        for (const ch of [...st.chapters].sort((a, b) => a.order - b.order)) {
          for (const sc of [...ch.scenes].sort((a, b) => a.order - b.order)) {
            results.push({ scene: sc, chapter: ch, story: st });
          }
        }
      }
      return results;
    }, [stories]);

    const filtered = useMemo(() => {
      if (!query.trim()) return allScenes;
      const q = query.toLowerCase();
      return allScenes.filter(({ scene: sc, chapter, story }) =>
        sc.title.toLowerCase().includes(q) ||
        chapter.title.toLowerCase().includes(q) ||
        story.title.toLowerCase().includes(q),
      );
    }, [allScenes, query]);

    return (
      <div ref={containerRef} className="spe-scene-selector">
        <button
          className="spe-scene-btn"
          onClick={() => setOpen(o => !o)}
          aria-haspopup="listbox"
          aria-expanded={open}
          title="Select scene for this pane"
          data-testid="spe-scene-btn"
        >
          <span className="spe-scene-title">
            {scene ? scene.title : 'Select scene…'}
          </span>
          <span className="spe-scene-caret" aria-hidden="true">▾</span>
        </button>

        {open && (
          <div className="spe-scene-popover" role="dialog" aria-label="Select scene">
            <input
              ref={inputRef}
              className="spe-scene-search"
              placeholder="Filter scenes…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              aria-label="Filter scenes"
              data-testid="spe-scene-search"
            />
            <ul className="spe-scene-list" role="listbox" aria-label="Scenes">
              {filtered.length === 0 ? (
                <li className="spe-scene-empty">No scenes match</li>
              ) : (
                filtered.map(({ scene: sc, chapter, story }) => (
                  <li key={sc.id} role="option" aria-selected={sc.id === scene?.id}>
                    <button
                      className={`spe-scene-option${sc.id === scene?.id ? ' spe-scene-option--selected' : ''}`}
                      onClick={() => { onSelect(sc, chapter, story); setOpen(false); }}
                      data-testid={`spe-scene-option-${sc.id}`}
                    >
                      <span className="spe-scene-option-path">
                        {story.title} › {chapter.title}
                      </span>
                      <span className="spe-scene-option-title">{sc.title}</span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        )}
      </div>
    );
  },
);

// ─── Split editor pane ───

export interface SplitEditorPaneProps {
  paneNumber: 1 | 2;
  isFocused: boolean;
  scene: Scene | null;
  chapter: Chapter | null;
  story: Story | null;
  stories: Story[];
  onFocus: () => void;
  onSelectScene: (scene: Scene, chapter: Chapter, story: Story) => void;
  onBlocksChange: (blocks: Block[]) => void;
  onEditorReady: (api: BlockEditorApi) => void;
  wikiLinkSuggestions?: WLSuggestion[];
  onAcceptWikiLink?: (id: string, link: string, anchorText: string) => void;
  onRejectWikiLink?: (id: string) => void;
  autoLinkerEntities?: EntityEntry[];
  autoLinkerMode?: AutoLinkerMode;
  onEntityClick?: (entityId: string) => void;
  /** SKY-5702: called when the user clicks a [[wiki link]] in this pane. */
  onWikiLinkClick?: (target: string) => void;
  /** SKY-5702: resolvable note/story titles, for unresolved [[link]] styling. */
  resolvedWikiLinkTitles?: ReadonlySet<string>;
  /** SKY-5702: cross-vault candidate list for the [[ autocomplete popup. */
  wikiLinkCandidates?: WikiLinkCandidate[];
  /** When true, shows loading empty state instead of the editor. */
  sceneLoading?: boolean;
  /** Flex grow value for split container sizing. */
  style?: CSSProperties;

  // ─── SKY-8907: Obsidian-style per-pane tab strip (owned by the shell) ───
  /** Omitted entirely → no tab strip renders (back-compat for non-split callers/tests). */
  tabs?: WorkspaceTab[];
  activeTabId?: string | null;
  onTabSelect?: (tabId: string) => void;
  onTabClose?: (tabId: string) => void;
  onTabReorder?: (fromIndex: number, toIndex: number) => void;
  onNewTab?: () => void;
  /** Notifies the shell a drag started in THIS pane's strip (for cross-pane drop routing). */
  onTabDragStart?: (tab: WorkspaceTab) => void;
  /** True while a tab dragged from the OTHER pane's strip is over this one. */
  acceptsTabDrop?: boolean;
  /** A tab from the other pane was dropped on this pane's strip — the shell moves it. */
  onTabStripDrop?: () => void;
  /** Empty-pane action card: "Create new scene". */
  onCreateNewDoc?: () => void;
  /** Empty-pane action card: "Close" — collapses this (empty) pane. */
  onCloseEmptyPane?: () => void;
  /** SKY-9342: per-pane ⋮ menu — "Close pane" action (always-available). */
  onClosePane?: () => void;
  /** SKY-9342: per-pane ⋮ menu — "Split pane" action. */
  onSplitPane?: () => void;

  // ─── SKY-9920 (M5 item 5): Entity Browser as an openable document tab ───
  /** True when the active tab in THIS pane is the Entity Browser — renders
   * it in place of the scene editor. */
  activeTabIsEntityBrowser?: boolean;
  onSelectEntity?: (entity: EntityEntry) => void;
  selectedEntityId?: string | null;
  /** + picker: opens/focuses the Entity Browser tab in this pane. Omitted →
   * the + button stays a single-click "new scene" action (back-compat). */
  onOpenEntityBrowser?: () => void;
}

export default function SplitEditorPane({
  paneNumber,
  isFocused,
  scene,
  stories,
  onFocus,
  onSelectScene,
  onBlocksChange,
  onEditorReady,
  wikiLinkSuggestions,
  onAcceptWikiLink,
  onRejectWikiLink,
  autoLinkerEntities,
  autoLinkerMode = 'suggest',
  onEntityClick,
  onWikiLinkClick,
  resolvedWikiLinkTitles,
  wikiLinkCandidates,
  sceneLoading = false,
  style,
  tabs,
  activeTabId = null,
  onTabSelect,
  onTabClose,
  onTabReorder,
  onNewTab,
  onTabDragStart,
  acceptsTabDrop = false,
  onTabStripDrop,
  onCreateNewDoc,
  onCloseEmptyPane,
  onClosePane,
  onSplitPane,
  activeTabIsEntityBrowser = false,
  onSelectEntity,
  selectedEntityId = null,
  onOpenEntityBrowser,
}: SplitEditorPaneProps) {
  const hasAnyScenes = useMemo(
    () => stories.some(st => st.chapters.some(ch => ch.scenes.length > 0)),
    [stories],
  );
  const paneLabel = `Pane ${paneNumber}`;
  const sceneSelectorRef = useRef<PaneSceneSelectorHandle>(null);

  // ── SKY-9342: per-pane ⋮ menu ─────────────────────────────────────────────
  const [paneMenuOpen, setPaneMenuOpen] = useState(false);
  const paneMenuBtnRef = useRef<HTMLButtonElement>(null);
  const paneMenuRef = useRef<HTMLDivElement>(null);

  const closePaneMenu = useCallback(() => setPaneMenuOpen(false), []);

  useEffect(() => {
    if (!paneMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (
        paneMenuBtnRef.current?.contains(e.target as Node) ||
        paneMenuRef.current?.contains(e.target as Node)
      ) return;
      setPaneMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [paneMenuOpen]);

  return (
    <div
      className={`spe-pane${isFocused ? ' spe-pane--focused' : ''}`}
      data-testid={`split-pane-${paneNumber}`}
      style={style}
    >
      {/* Click-to-focus capture: only the non-interactive parts should trigger focus transfer */}
      <div
        className="spe-focus-capture"
        onClick={onFocus}
        aria-hidden="true"
      />

      {/* SKY-8907: per-pane tab strip — sits above the pane header (Obsidian
          layout), owned entirely by the shell (tab list/active id/handlers).
          SKY-9342: the strip also hosts the per-pane ⋮ menu button. */}
      {tabs && (
        <div
          className={`spe-tab-strip${acceptsTabDrop ? ' spe-tab-strip--drop-target' : ''}`}
          data-testid={`split-pane-${paneNumber}-tab-strip`}
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
            onTabSelect={onTabSelect ?? (() => {})}
            onTabClose={onTabClose ?? (() => {})}
            onTabReorder={onTabReorder ?? (() => {})}
            onNewTab={onNewTab ?? (() => {})}
            onTabDragStart={onTabDragStart}
            newTabTitle="New scene in this pane"
            allowCloseLastTab
            hideAgentsChip
            newTabPrimaryLabel="New scene"
            newTabPickerItems={onOpenEntityBrowser ? [
              { key: 'entities', label: 'Entity Browser', onSelect: onOpenEntityBrowser },
            ] : undefined}
          />

          {/* SKY-9342: per-pane ⋮ menu */}
          {(onClosePane ?? onSplitPane) && (
            <div className="spe-pane-menu-wrap">
              <button
                ref={paneMenuBtnRef}
                type="button"
                className={['spe-pane-menu-btn', paneMenuOpen ? 'spe-pane-menu-btn--open' : ''].filter(Boolean).join(' ')}
                aria-label={`Pane ${paneNumber} options`}
                aria-haspopup="menu"
                aria-expanded={paneMenuOpen}
                onClick={() => setPaneMenuOpen((o) => !o)}
                data-testid={`split-pane-${paneNumber}-pane-menu-btn`}
              >
                ⋮
              </button>
              {paneMenuOpen && (
                <div
                  ref={paneMenuRef}
                  className="spe-pane-menu"
                  role="menu"
                  aria-label={`Pane ${paneNumber} options`}
                  data-testid={`split-pane-${paneNumber}-pane-menu`}
                >
                  {onSplitPane && (
                    <button
                      type="button"
                      role="menuitem"
                      className="spe-pane-menu-item"
                      onClick={() => { closePaneMenu(); onSplitPane(); }}
                      data-testid={`split-pane-${paneNumber}-pane-menu-split`}
                    >
                      Split pane
                    </button>
                  )}
                  {onClosePane && (
                    <button
                      type="button"
                      role="menuitem"
                      className="spe-pane-menu-item spe-pane-menu-item--close"
                      onClick={() => { closePaneMenu(); onClosePane(); }}
                      data-testid={`split-pane-${paneNumber}-pane-menu-close`}
                    >
                      Close pane
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="spe-header">
        <span
          className="spe-label"
          aria-label={isFocused ? `${paneLabel} (focused)` : paneLabel}
        >
          {paneLabel}
        </span>
        {isFocused && <span className="spe-focused-badge" aria-hidden="true">●</span>}
        {!activeTabIsEntityBrowser && (
          <PaneSceneSelector
            ref={sceneSelectorRef}
            scene={scene}
            stories={stories}
            onSelect={onSelectScene}
          />
        )}
      </div>

      <div className="spe-content" onClick={onFocus}>
        {activeTabIsEntityBrowser ? (
          <EntityBrowser
            onSelectEntity={onSelectEntity ?? (() => {})}
            selectedEntityId={selectedEntityId}
          />
        ) : scene && !sceneLoading ? (
          <BlockEditor
            key={scene.id}
            scene={scene}
            onBlocksChange={onBlocksChange}
            onDraftStateChange={() => {}}
            onEditorReady={onEditorReady}
            wikiLinkSuggestions={wikiLinkSuggestions}
            onAcceptWikiLink={onAcceptWikiLink}
            onRejectWikiLink={onRejectWikiLink}
            autoLinkerEntities={autoLinkerEntities}
            autoLinkerMode={autoLinkerMode}
            onEntityClick={onEntityClick}
            onWikiLinkClick={onWikiLinkClick}
            resolvedWikiLinkTitles={resolvedWikiLinkTitles}
            wikiLinkCandidates={wikiLinkCandidates}
          />
        ) : (
          <SceneEditorEmptyState
            variant={
              sceneLoading ? 'loading' :
              hasAnyScenes ? 'select-scene' :
              'no-scenes-yet'
            }
            onCreateNew={sceneLoading ? undefined : onCreateNewDoc}
            onGoTo={sceneLoading ? undefined : (
              hasAnyScenes ? () => sceneSelectorRef.current?.openPicker() : undefined
            )}
            onClosePane={sceneLoading ? undefined : onCloseEmptyPane}
          />
        )}
      </div>
    </div>
  );
}
