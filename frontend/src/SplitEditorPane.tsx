import { type CSSProperties, useState, useRef, useEffect, useMemo } from 'react';
import type { Scene, Chapter, Story, Block, EntityEntry } from './types';
import type { WLSuggestion } from './WikiLinkHintExtension';
import type { AutoLinkerMode } from './AutoLinkerExtension';
import BlockEditor, { type BlockEditorApi } from './BlockEditor';
import { SceneEditorEmptyState } from './SceneEditorEmptyState';
import './SplitEditorPane.css';

// ─── Compact per-pane scene selector ───

interface PaneSceneSelectorProps {
  scene: Scene | null;
  stories: Story[];
  onSelect: (scene: Scene, chapter: Chapter, story: Story) => void;
}

function PaneSceneSelector({ scene, stories, onSelect }: PaneSceneSelectorProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
}

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
  /** When true, shows loading empty state instead of the editor. */
  sceneLoading?: boolean;
  /** Flex grow value for split container sizing. */
  style?: CSSProperties;
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
  sceneLoading = false,
  style,
}: SplitEditorPaneProps) {
  const hasAnyScenes = useMemo(
    () => stories.some(st => st.chapters.some(ch => ch.scenes.length > 0)),
    [stories],
  );
  const paneLabel = `Pane ${paneNumber}`;

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

      <div className="spe-header">
        <span
          className="spe-label"
          aria-label={isFocused ? `${paneLabel} (focused)` : paneLabel}
        >
          {paneLabel}
        </span>
        {isFocused && <span className="spe-focused-badge" aria-hidden="true">●</span>}
        <PaneSceneSelector
          scene={scene}
          stories={stories}
          onSelect={onSelectScene}
        />
      </div>

      <div className="spe-content" onClick={onFocus}>
        {scene && !sceneLoading ? (
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
          />
        ) : (
          <SceneEditorEmptyState
            variant={
              sceneLoading ? 'loading' :
              hasAnyScenes ? 'select-scene' :
              'no-scenes-yet'
            }
          />
        )}
      </div>
    </div>
  );
}
