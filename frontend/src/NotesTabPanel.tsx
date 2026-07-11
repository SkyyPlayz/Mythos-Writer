// SKY-2096 (Phase 2 #3): Notes tab layout — vault tree + editor + Brainstorm sidebar + sub-view toggles.
// Spec: vault tree (left) + markdown editor (center) + Brainstorm chat (right), with Graph and Entities
// as in-tab sub-view toggles.
// SKY-3626: N/F/E writing mode controls added to editor sub-view toolbar.
// M16 (Beta 3): note splits, [[wiki link]] hover previews, and the right-panel
// Agent/Properties tabs (properties + backlinks + tags, frontmatter-backed).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import VaultBrowser, { type VaultBrowserProps } from './components/VaultBrowser';
import VaultGraphView from './VaultGraphView';
import EntityBrowser from './EntityBrowser';
import BrainstormPage from './BrainstormPage';
import ContinuityPanel from './ContinuityPanel';
import NoteViewer from './NoteViewer';
import NoteSplitPane from './NoteSplitPane';
import NoteProperties from './NoteProperties';
import Backlinks from './Backlinks';
import WikiLinkHoverPreview, { type WikiLinkPreviewResolver } from './WikiLinkHoverPreview';
import type { Story, Scene, Chapter, WritingMode } from './types';
import type { EntityEntry } from './types';
import type { ExportScope } from './ExportDialog';
import type { WikiLinkCandidate } from './crossTabLinkResolver';
import './NotesTabPanel.css';

const MIN_SIDEBAR_W = 160;
const MAX_SIDEBAR_W = 500;
const RIGHT_SIDEBAR_W = 340;

const NOTES_SUBVIEWS: { id: NotesSubView; label: string }[] = [
  { id: 'editor', label: 'Editor' },
  { id: 'graph', label: 'Graph' },
  { id: 'entities', label: 'Entities' },
];

export interface NotesTabPanelProps {
  notesSubView: NotesSubView;
  onNotesSubViewChange: (v: NotesSubView) => void;
  notesSidebarWidth: number;
  notesSidebarCollapsed: boolean;
  onNotesSidebarWidthChange: (w: number) => void;
  onNotesSidebarCollapsedChange: (c: boolean) => void;
  activeNotePath: string | null;
  activeNotePreview: boolean;
  onActiveNotePreviewChange: (preview: boolean) => void;
  onActiveNoteWordCountChange: (wordCount: number) => void;
  onCloseActiveNote: () => void;
  onWikiLinkClick: (target: string) => void;
  // GH #650: [[ autocomplete candidates + resolved-link styling for the Notes
  // tab editor (previously only wired on the story-side NoteViewer).
  resolvedWikiLinkTitles?: ReadonlySet<string>;
  wikiLinkCandidates?: WikiLinkCandidate[];
  /** M16: stems resolving to story scenes, for gold [[scene link]] styling. */
  sceneWikiLinkTitles?: ReadonlySet<string>;
  /** M16: hover-preview resolver for [[wiki links]] in the notes editor. */
  resolveWikiLinkPreview?: WikiLinkPreviewResolver;
  /** M16: all notes-vault file paths, for the split-pane note selector. */
  notePaths?: string[];
  /** Beta 4 M4: shell-driven note split — set when a note tab is dragged onto
   * a split drop zone or "Open to the side" is picked; the token makes
   * repeated requests for the same path re-apply. */
  noteSplitRequest?: { path: string; token: number } | null;
  brainstormCollapsed: boolean;
  onBrainstormCollapsedChange: (collapsed: boolean) => void;
  // VaultBrowser passthrough
  stories: VaultBrowserProps['stories'];
  selectedSceneId: string | null;
  onSelectScene: (scene: Scene, chapter: Chapter, story: Story) => void;
  onCreateStory: () => void;
  onCreateChapter: (storyId: string) => void;
  onCreateScene: (storyId: string, chapterId: string) => void;
  onOpenFile?: (path: string) => void;
  onOpenScene?: (storyId: string, chapterId: string, sceneId: string) => void;
  onExport?: (scope: ExportScope) => void;
  journalModeEnabled?: boolean;
  /** M15: notes-tree context menu "Open in new tab"; falls back to onOpenFile. */
  onOpenInNewTab?: (path: string) => void;
  /** M15: notes-tree context menu "Beta read" (disabled until wired). */
  onBetaRead?: (path: string) => void;
  /** M15: notes-tree context menu "Continuity check" (disabled until wired). */
  onContinuityCheck?: (path: string) => void;
  // BrainstormPage passthrough
  brainstormEnabled?: boolean;
  voiceEnabled?: boolean;
  ttsSettings?: import('./hooks/useTtsPlayer').TtsEngineSettings;
  voicePrefs?: import('./hooks/useTtsPlayer').TtsVoicePrefs & { micDeviceId?: string; inputLanguage?: string };
  onFirstSubmit?: () => void;
  onNavigateToEntity?: (entityId: string) => void;
  onNavigateToScene?: (sceneId: string) => Promise<boolean>;
  /** SKY-2306: slug of the currently selected story for scene_crafter_card acceptance. */
  activeStorySlug?: string | null;
  /** SKY-2585: gate ContinuityPanel in Brainstorm sidebar. */
  archiveContinuityEnabled?: boolean;
  /** SKY-2585: active scene forwarded to ContinuityPanel for scene-scoped listing. */
  activeScene?: Scene | null;
  // Entity browser
  onSelectEntity: (entity: EntityEntry) => void;
  selectedEntityId: string | null;
  // SKY-3626: N/F/E writing mode controls for Notes editor
  writingMode?: WritingMode;
  onSetWritingMode?: (mode: WritingMode) => void;
  onOpenFocusPrefs?: () => void;
  /** SKY-3201: open the standalone Brainstorm tab seeded with the given text. */
  onOpenBrainstorm?: (seedText: string) => void;
}

export default function NotesTabPanel({
  notesSubView,
  onNotesSubViewChange,
  notesSidebarWidth,
  notesSidebarCollapsed,
  onNotesSidebarWidthChange,
  onNotesSidebarCollapsedChange,
  activeNotePath,
  activeNotePreview,
  onActiveNotePreviewChange,
  onActiveNoteWordCountChange,
  onCloseActiveNote,
  onWikiLinkClick,
  resolvedWikiLinkTitles,
  wikiLinkCandidates,
  sceneWikiLinkTitles,
  resolveWikiLinkPreview,
  notePaths,
  noteSplitRequest,
  brainstormCollapsed,
  onBrainstormCollapsedChange,
  stories,
  selectedSceneId,
  onSelectScene,
  onCreateStory,
  onCreateChapter,
  onCreateScene,
  onOpenFile,
  onOpenScene,
  onExport,
  journalModeEnabled,
  onOpenInNewTab,
  onBetaRead,
  onContinuityCheck,
  brainstormEnabled,
  voiceEnabled = false,
  ttsSettings,
  voicePrefs,
  onFirstSubmit,
  onNavigateToEntity,
  onNavigateToScene,
  activeStorySlug,
  archiveContinuityEnabled,
  activeScene,
  onSelectEntity,
  selectedEntityId,
  writingMode,
  onSetWritingMode,
  onOpenFocusPrefs,
  onOpenBrainstorm,
}: NotesTabPanelProps) {
  const isDraggingLeft = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);

  // ── M16: note split + right-panel tab + hover-preview state ──
  const notesBodyRef = useRef<HTMLDivElement>(null);
  const splitRowRef = useRef<HTMLDivElement>(null);
  const [noteSplitPath, setNoteSplitPath] = useState<string | null>(null);
  const [noteSplitRatio, setNoteSplitRatio] = useState(0.5);
  const [rightTab, setRightTab] = useState<'agent' | 'props'>('agent');

  const mdNotePaths = useMemo(
    () => (notePaths ?? []).filter((p) => p.toLowerCase().endsWith('.md')),
    [notePaths],
  );

  const handleToggleNoteSplit = useCallback(() => {
    setNoteSplitPath((prev) => {
      if (prev) return null;
      // Prototype toggleNSplit: default to another note when one exists.
      const other = mdNotePaths.find((p) => p !== activeNotePath);
      return other ?? activeNotePath;
    });
  }, [mdNotePaths, activeNotePath]);

  // Beta 4 M4: apply a shell-driven split request (note tab dragged onto a
  // split drop zone / context-menu "Open to the side").
  const appliedSplitTokenRef = useRef(0);
  useEffect(() => {
    if (!noteSplitRequest || noteSplitRequest.token === appliedSplitTokenRef.current) return;
    appliedSplitTokenRef.current = noteSplitRequest.token;
    setNoteSplitPath(noteSplitRequest.path);
  }, [noteSplitRequest]);

  const handleSplitDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const row = splitRowRef.current;
    if (!row) return;
    const rect = row.getBoundingClientRect();
    const handleMove = (ev: MouseEvent) => {
      if (rect.width <= 0) return;
      const ratio = (ev.clientX - rect.left) / rect.width;
      setNoteSplitRatio(Math.max(0.25, Math.min(0.75, ratio)));
    };
    const handleUp = () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  }, []);

  const handleLeftDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingLeft.current = true;
    dragStartX.current = e.clientX;
    dragStartWidth.current = notesSidebarWidth;

    const handleMouseMove = (ev: MouseEvent) => {
      if (!isDraggingLeft.current) return;
      const delta = ev.clientX - dragStartX.current;
      const next = Math.max(MIN_SIDEBAR_W, Math.min(MAX_SIDEBAR_W, dragStartWidth.current + delta));
      onNotesSidebarWidthChange(next);
    };
    const handleMouseUp = () => {
      isDraggingLeft.current = false;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [notesSidebarWidth, onNotesSidebarWidthChange]);

  const handleLeftDividerKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      onNotesSidebarWidthChange(Math.min(MAX_SIDEBAR_W, notesSidebarWidth + 8));
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      onNotesSidebarWidthChange(Math.max(MIN_SIDEBAR_W, notesSidebarWidth - 8));
    } else if (e.key === 'Home') {
      e.preventDefault();
      onNotesSidebarWidthChange(MIN_SIDEBAR_W);
    } else if (e.key === 'End') {
      e.preventDefault();
      onNotesSidebarWidthChange(MAX_SIDEBAR_W);
    }
  }, [notesSidebarWidth, onNotesSidebarWidthChange]);

  return (
    <div
      id="app-tabpanel-notes"
      role="tabpanel"
      aria-labelledby="app-tab-notes"
      className="notes-tab-panel"
      data-testid="notes-tab-panel"
    >
      {/* Sub-view toggle toolbar */}
      <div className="notes-tab-toolbar" role="toolbar" aria-label="Notes views">
        <div
          className="notes-subview-toggle"
          role="tablist"
          aria-label="Notes sub-view"
        >
          {NOTES_SUBVIEWS.map(({ id, label }) => (
            <button
              key={id}
              role="tab"
              aria-selected={notesSubView === id}
              className={`notes-subview-btn${notesSubView === id ? ' notes-subview-btn--active' : ''}`}
              onClick={() => onNotesSubViewChange(id)}
              data-testid={`notes-subview-${id}`}
            >
              {label}
            </button>
          ))}
        </div>
        {/* SKY-3626: N/F/E writing-mode controls — Notes editor only */}
        {notesSubView === 'editor' && writingMode !== undefined && onSetWritingMode && (
          <div className="nfe-mode-group" aria-label="Writing mode" data-testid="nfe-mode-group">
            <button
              className={`nfe-mode-btn${writingMode === 'normal' ? ' active' : ''}`}
              onClick={() => onSetWritingMode('normal')}
              aria-pressed={writingMode === 'normal'}
              title="Normal mode — full editor + sidebars (Ctrl+Shift+N)"
              data-testid="writing-mode-normal"
            >N</button>
            <button
              className={`nfe-mode-btn${writingMode === 'focus' ? ' active' : ''}`}
              onClick={() => onSetWritingMode('focus')}
              aria-pressed={writingMode === 'focus'}
              title="Focus mode — distraction-free"
              data-testid="writing-mode-focus"
            >F</button>
            {writingMode === 'focus' && onOpenFocusPrefs && (
              <button
                className="nfe-mode-prefs"
                onClick={onOpenFocusPrefs}
                title="Configure Focus mode panels"
                aria-label="Focus mode preferences"
              >⚙</button>
            )}
            <button
              className={`nfe-mode-btn${writingMode === 'edit' ? ' active' : ''}`}
              onClick={() => onSetWritingMode('edit')}
              aria-pressed={writingMode === 'edit'}
              title="Edit mode — review with Writing Assistant + comments (Ctrl+Shift+E)"
              data-testid="writing-mode-edit"
            >E</button>
          </div>
        )}
        {/* M16: note split toggle — prototype "Split notes" header button. */}
        {notesSubView === 'editor' && activeNotePath && (
          <button
            className={`notes-split-toggle-btn${noteSplitPath ? ' notes-split-toggle-btn--active' : ''}`}
            aria-label="Split notes"
            aria-pressed={!!noteSplitPath}
            title="Split notes"
            data-testid="notes-split-toggle"
            onClick={handleToggleNoteSplit}
            type="button"
          >
            ⫿ Split
          </button>
        )}
        {onOpenBrainstorm && activeNotePath && (
          <button
            className="notes-open-brainstorm-btn"
            aria-label="Open current note in Brainstorm"
            data-testid="notes-open-brainstorm-btn"
            onClick={() => {
              const name = activeNotePath.split(/[\\/]/).pop()?.replace(/\.md$/, '') ?? 'this note';
              onOpenBrainstorm(`Brainstorm ideas about "${name}"`);
            }}
            type="button"
          >
            ✦ Open in Brainstorm
          </button>
        )}
      </div>

      {/* Main layout row: left sidebar + center + right sidebar */}
      <div className="notes-tab-body" ref={notesBodyRef}>
        {/* Left sidebar — Notes vault tree */}
        {notesSidebarCollapsed ? (
          <button
            className="notes-sidebar-peek-btn"
            aria-label="Expand notes sidebar"
            data-testid="notes-sidebar-expand"
            onClick={() => onNotesSidebarCollapsedChange(false)}
          >
            ›
          </button>
        ) : (
          <div
            className="notes-tab-sidebar-left"
            style={{ width: notesSidebarWidth }}
          >
            <div className="notes-sidebar-header">
              <span className="notes-vault-badge" aria-label="Notes Vault">
                Notes Vault
              </span>
              <button
                className="notes-sidebar-collapse-btn"
                aria-label="Collapse notes sidebar"
                data-testid="notes-sidebar-collapse"
                onClick={() => onNotesSidebarCollapsedChange(true)}
              >
                ‹
              </button>
            </div>
            <div className="notes-sidebar-content">
              <VaultBrowser
                stories={stories}
                selectedSceneId={selectedSceneId}
                onSelectScene={onSelectScene}
                onCreateStory={onCreateStory}
                onCreateChapter={onCreateChapter}
                onCreateScene={onCreateScene}
                onOpenFile={onOpenFile}
                onExport={onExport}
                journalModeEnabled={journalModeEnabled}
                initialScope="notes"
                lockScope
                onOpenInNewTab={onOpenInNewTab}
                onBetaRead={onBetaRead}
                onContinuityCheck={onContinuityCheck}
              />
            </div>
          </div>
        )}

        {/* Left resize handle */}
        {!notesSidebarCollapsed && (
          <div
            role="separator"
            aria-label="Resize notes sidebar"
            aria-orientation="vertical"
            aria-valuenow={notesSidebarWidth}
            aria-valuemin={MIN_SIDEBAR_W}
            aria-valuemax={MAX_SIDEBAR_W}
            tabIndex={0}
            className="notes-tab-divider"
            onMouseDown={handleLeftDividerMouseDown}
            onKeyDown={handleLeftDividerKeyDown}
          />
        )}

        {/* Center — sub-view body */}
        <div className="notes-tab-center" data-testid="notes-tab-center">
          {notesSubView === 'editor' && activeNotePath && !noteSplitPath && (
            <NoteViewer
              key={activeNotePath}
              path={activeNotePath}
              previewMode={activeNotePreview}
              onPreviewModeChange={onActiveNotePreviewChange}
              onWordCountChange={onActiveNoteWordCountChange}
              onWikiLinkClick={onWikiLinkClick}
              resolvedWikiLinkTitles={resolvedWikiLinkTitles}
              sceneWikiLinkTitles={sceneWikiLinkTitles}
              wikiLinkCandidates={wikiLinkCandidates}
              onClose={onCloseActiveNote}
            />
          )}
          {/* M16: note split — active note + a second note side by side. */}
          {notesSubView === 'editor' && activeNotePath && noteSplitPath && (
            <div className="notes-split-row" ref={splitRowRef} data-testid="notes-split-row">
              <div className="notes-split-main" style={{ flex: noteSplitRatio }}>
                <NoteViewer
                  key={activeNotePath}
                  path={activeNotePath}
                  previewMode={activeNotePreview}
                  onPreviewModeChange={onActiveNotePreviewChange}
                  onWordCountChange={onActiveNoteWordCountChange}
                  onWikiLinkClick={onWikiLinkClick}
                  resolvedWikiLinkTitles={resolvedWikiLinkTitles}
                  sceneWikiLinkTitles={sceneWikiLinkTitles}
                  wikiLinkCandidates={wikiLinkCandidates}
                  onClose={onCloseActiveNote}
                />
              </div>
              <div
                className="notes-split-divider"
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize note split"
                data-testid="notes-split-divider"
                onMouseDown={handleSplitDividerMouseDown}
              >
                <div className="notes-split-divider-grip" aria-hidden="true" />
              </div>
              <NoteSplitPane
                style={{ flex: 1 - noteSplitRatio }}
                path={noteSplitPath}
                notePaths={mdNotePaths}
                onChangePath={setNoteSplitPath}
                onClose={() => setNoteSplitPath(null)}
                onWikiLinkClick={onWikiLinkClick}
                resolvedWikiLinkTitles={resolvedWikiLinkTitles}
                sceneWikiLinkTitles={sceneWikiLinkTitles}
                wikiLinkCandidates={wikiLinkCandidates}
              />
            </div>
          )}
          {notesSubView === 'editor' && !activeNotePath && (
            <div
              className="notes-editor-placeholder"
              data-testid="notes-editor-placeholder"
            >
              <div className="notes-editor-placeholder-icon">📝</div>
              <h2>Notes Editor</h2>
              <p>Select a note from the sidebar to start editing.</p>
            </div>
          )}
          {notesSubView === 'graph' && (
            <div className="notes-graph-view" data-testid="notes-graph-view">
              <VaultGraphView onOpenNote={onOpenFile} onOpenScene={onOpenScene} />
            </div>
          )}
          {notesSubView === 'entities' && (
            <div className="notes-entities-view" data-testid="notes-entities-view">
              <EntityBrowser
                onSelectEntity={onSelectEntity}
                selectedEntityId={selectedEntityId}
              />
            </div>
          )}
        </div>

        {/* Right sidebar — Brainstorm chat */}
        {brainstormCollapsed ? (
          <button
            className="notes-brainstorm-peek-btn"
            aria-label="Expand Brainstorm panel"
            data-testid="notes-brainstorm-expand"
            onClick={() => onBrainstormCollapsedChange(false)}
          >
            ‹
          </button>
        ) : (
          <>
            <div className="notes-tab-divider notes-tab-divider--right" aria-hidden="true" />
            <div
              className="notes-tab-sidebar-right"
              style={{ width: RIGHT_SIDEBAR_W }}
              data-testid="notes-brainstorm-panel"
            >
              <div className="notes-right-sidebar-header">
                {/* M16: Agent (default, Brainstorm chat + continuity flags) /
                    Properties (frontmatter props + backlinks + tags) tabs —
                    prototype nrTabs. */}
                <div className="notes-right-tabs" role="tablist" aria-label="Notes side panel">
                  <button
                    role="tab"
                    aria-selected={rightTab === 'agent'}
                    className={`notes-right-tab${rightTab === 'agent' ? ' notes-right-tab--active' : ''}`}
                    data-testid="notes-right-tab-agent"
                    onClick={() => setRightTab('agent')}
                    type="button"
                  >
                    Agent
                  </button>
                  <button
                    role="tab"
                    aria-selected={rightTab === 'props'}
                    className={`notes-right-tab${rightTab === 'props' ? ' notes-right-tab--active' : ''}`}
                    data-testid="notes-right-tab-props"
                    onClick={() => setRightTab('props')}
                    type="button"
                  >
                    Properties
                  </button>
                </div>
                <button
                  className="notes-sidebar-collapse-btn"
                  aria-label="Collapse Brainstorm panel"
                  data-testid="notes-brainstorm-collapse"
                  onClick={() => onBrainstormCollapsedChange(true)}
                >
                  ›
                </button>
              </div>
              <div className="notes-right-sidebar-content">
                {rightTab === 'agent' ? (
                  <div className="notes-agent-col">
                    {/* M16: continuity flags (3 actions) above the chat —
                        prototype "CONTINUITY FLAGS" then "CHAT" (HTML 2400+).
                        Compact BrainstormPage hides its own facts column, so
                        the flags dock here instead. */}
                    {archiveContinuityEnabled && (
                      <div className="notes-agent-continuity" data-testid="notes-continuity-flags">
                        <ContinuityPanel scene={activeScene ?? null} enabled />
                      </div>
                    )}
                    <div className="notes-agent-chat">
                      <BrainstormPage
                        onClose={() => onBrainstormCollapsedChange(true)}
                        enabled={brainstormEnabled ?? true}
                        voiceEnabled={voiceEnabled}
                        ttsSettings={ttsSettings}
                        voicePrefs={voicePrefs}
                        onFirstSubmit={onFirstSubmit}
                        onNavigateToEntity={onNavigateToEntity}
                        onNavigateToScene={onNavigateToScene}
                        activeStorySlug={activeStorySlug}
                        archiveContinuityEnabled={archiveContinuityEnabled}
                        activeScene={activeScene}
                        compact
                      />
                    </div>
                  </div>
                ) : activeNotePath ? (
                  <div className="notes-right-props-scroll" data-testid="notes-right-props">
                    <NoteProperties key={activeNotePath} path={activeNotePath} />
                    <Backlinks
                      notePath={activeNotePath}
                      stories={stories}
                      onOpenNote={(path) => (onOpenInNewTab ?? onOpenFile)?.(path)}
                      onOpenScene={onSelectScene}
                    />
                  </div>
                ) : (
                  <div className="notes-right-props-empty" data-testid="notes-right-props-empty">
                    Open a note to see its properties, backlinks, and tags.
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {/* M16: hover-preview card for [[wiki links]] anywhere in the notes
            body (rich + preview modes, both split panes). */}
        {resolveWikiLinkPreview && (
          <WikiLinkHoverPreview
            containerRef={notesBodyRef}
            resolvePreview={resolveWikiLinkPreview}
          />
        )}
      </div>
    </div>
  );
}
