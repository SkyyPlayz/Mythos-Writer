// SKY-2096 (Phase 2 #3): Notes tab layout — vault tree + editor + Brainstorm sidebar + sub-view toggles.
// Spec: vault tree (left) + markdown editor (center) + Brainstorm chat (right), with Graph and Entities
// as in-tab sub-view toggles.
// SKY-3626: N/F/E writing mode controls added to editor sub-view toolbar.
import { useCallback, useRef } from 'react';
import VaultBrowser, { type VaultBrowserProps } from './components/VaultBrowser';
import VaultGraphView from './VaultGraphView';
import EntityBrowser from './EntityBrowser';
import BrainstormPage from './BrainstormPage';
import NoteViewer from './NoteViewer';
import type { Story, Scene, Chapter, WritingMode } from './types';
import type { EntityEntry } from './types';
import type { ExportScope } from './ExportDialog';
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
  onExport?: (scope: ExportScope) => void;
  journalModeEnabled?: boolean;
  // BrainstormPage passthrough
  brainstormEnabled?: boolean;
  voiceEnabled?: boolean;
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
  brainstormCollapsed,
  onBrainstormCollapsedChange,
  stories,
  selectedSceneId,
  onSelectScene,
  onCreateStory,
  onCreateChapter,
  onCreateScene,
  onOpenFile,
  onExport,
  journalModeEnabled,
  brainstormEnabled,
  voiceEnabled = false,
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
}: NotesTabPanelProps) {
  const isDraggingLeft = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);

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
      </div>

      {/* Main layout row: left sidebar + center + right sidebar */}
      <div className="notes-tab-body">
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
          {notesSubView === 'editor' && activeNotePath && (
            <NoteViewer
              key={activeNotePath}
              path={activeNotePath}
              previewMode={activeNotePreview}
              onPreviewModeChange={onActiveNotePreviewChange}
              onWordCountChange={onActiveNoteWordCountChange}
              onWikiLinkClick={onWikiLinkClick}
              onClose={onCloseActiveNote}
            />
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
              <VaultGraphView onOpenNote={onOpenFile} />
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
                <span className="notes-right-sidebar-title">Brainstorm</span>
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
                <BrainstormPage
                  onClose={() => onBrainstormCollapsedChange(true)}
                  enabled={brainstormEnabled ?? true}
                  voiceEnabled={voiceEnabled}
                  onFirstSubmit={onFirstSubmit}
                  onNavigateToEntity={onNavigateToEntity}
                  onNavigateToScene={onNavigateToScene}
                  activeStorySlug={activeStorySlug}
                  archiveContinuityEnabled={archiveContinuityEnabled}
                  activeScene={activeScene}
                />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
