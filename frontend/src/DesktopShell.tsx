import { useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from 'react';
import type { Story, Chapter, Scene, Block, Manifest, DraftState, LayoutPrefs, EntityEntry, WritingMode, FocusPrefs } from './types';
import FocusModePrefsDialog from './FocusModePrefsDialog';
import ExportDialog, { type ExportScope } from './ExportDialog';
import KeyboardShortcutsDialog from './KeyboardShortcutsDialog';
import { applyTheme, applyLiquidNeonTokens } from './theme';
import LeftRail, { DEFAULT_LEFT_SIDEBAR_LAYOUT } from './LeftRail';
import RightSidebar from './RightSidebar';
import BottomBar from './BottomBar';
import BlockEditor, { type BlockEditorApi } from './BlockEditor';
import NoteViewer from './NoteViewer';
import type { WLSuggestion } from './WikiLinkHintExtension';
import EntityDetail from './EntityDetail';
import BrainstormPage from './BrainstormPage';
import EntriesPanel from './EntriesPanel';
import KanbanBoard from './KanbanBoard';
import VaultGraphView from './VaultGraphView';
import ManuscriptStructureView from './ManuscriptStructureView';
import TimelineSpreadsheet from './TimelineSpreadsheet';
import { useTextPrompt } from './useTextPrompt';
import SettingsPanel from './components/SettingsPanel';
import PromptHistoryPanel from './PromptHistoryPanel';
import SceneHistory from './SceneHistory';
import UpdateBanner from './UpdateBanner';
import SearchBar from './SearchBar';
import GlobalSearchPanel from './GlobalSearchPanel';
import TourModal from './TourModal';
import PaneTip from './PaneTip';
import BetaReadMargin from './BetaReadMargin';
import ProjectSwitcher from './ProjectSwitcher';
import DepthSlider, { type ViewDepth } from './DepthSlider';
import { useFocusMode } from './useFocusMode';
import SyncConflictModal, { type ResolvedConflictInfo, type LockfileConflictInfo } from './SyncConflictModal';
import {
  createInitialGettingStartedProgress,
  gettingStartedReducer,
  isGettingStartedVisible,
  type GettingStartedItemId,
  type GettingStartedProgress,
} from './gettingStartedReducer';
import TemplatePicker from './TemplatePicker';
import GlobalRightSidebar, { DEFAULT_PANELS, type PanelConfig } from './GlobalRightSidebar';
import { PanelDragProvider } from './PanelDragContext';
import type { DragSidebar } from './PanelDragContext';
// SKY-1695: Panel content components for the unified sidebar renderer
import StoryNavigator from './StoryNavigator';
import EntityBrowser from './EntityBrowser';
import SuggestionReview from './SuggestionReview';
import VaultBrowser from './components/VaultBrowser';
import ProgressDashboard from './ProgressDashboard';
import WritingAssistantPanel from './WritingAssistantPanel';
import ContinuityPanel from './ContinuityPanel';
import ScenePreviewPanel from './ScenePreviewPanel';
import './DesktopShell.css';

const DEFAULT_LAYOUT: LayoutPrefs = {
  leftWidth: 240,
  rightWidth: 260,
  bottomHeight: 32,
  rightTab: 'notes',
  leftTab: 'stories',
};

function generateId(): string {
  return crypto.randomUUID();
}

function now(): string {
  return new Date().toISOString();
}

function blocksToMarkdown(scene: Scene): string {
  const lines: string[] = [
    `---`,
    `id: ${scene.id}`,
    `title: "${scene.title.replace(/"/g, '\\"')}"`,
    `draftState: ${scene.draftState ?? 'in-progress'}`,
    `updatedAt: ${now()}`,
    `---`,
    '',
  ];
  for (const block of [...scene.blocks].sort((a, b) => a.order - b.order)) {
    switch (block.type) {
      case 'heading':
        lines.push(`# ${block.content}`);
        break;
      case 'dialogue':
        lines.push(`> ${block.content}`);
        break;
      case 'action':
        lines.push(`**${block.content}**`);
        break;
      case 'description':
        lines.push(`*${block.content}*`);
        break;
      case 'note':
        lines.push(`<!-- ${block.content} -->`);
        break;
      default:
        lines.push(block.content);
    }
    lines.push('');
  }
  return lines.join('\n');
}

type AppView = 'editor' | 'brainstorm' | 'kanban' | 'graph' | 'structure' | 'timeline' | 'entries';

interface SearchResultItem {
  docId: string;
  vault: 'story' | 'notes';
  kind: string;
  title: string;
  snippet: string;
  rank: number;
}

interface AppMenuBarProps {
  view: AppView;
  onSetView: (v: AppView) => void;
  onOpenSettings: () => void;
  onOpenHistory: () => void;
  onSearchNavigate: (result: SearchResultItem) => void;
  selectedStoryId?: string | null;
  activeVaultRoot: string;
  onProjectSwitched: (vaultRoot: string) => void;
  writingMode: WritingMode;
  onSetWritingMode: (m: WritingMode) => void;
  onOpenFocusPrefs: () => void;
  onOpenKeyboardShortcuts: () => void;
  onToggleDistractionFree: () => void;
  onOpenTour: () => void;
  onOpenExport?: (scope: ExportScope) => void;
  requestText: (label: string) => Promise<string | null>;
}

function AppMenuBar({ view, onSetView, onOpenSettings, onOpenHistory, onSearchNavigate, selectedStoryId, activeVaultRoot, onProjectSwitched, writingMode, onSetWritingMode, onOpenFocusPrefs, onOpenKeyboardShortcuts, onToggleDistractionFree, onOpenTour, onOpenExport, requestText }: AppMenuBarProps) {
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const [helpMenuOpen, setHelpMenuOpen] = useState(false);
  const helpMenuRef = useRef<HTMLDivElement>(null);
  const fileMenuRef = useRef<HTMLDivElement>(null);

  const handleExportEpub = () => {
    if (!selectedStoryId) {
      alert('Select a story first to export it as EPUB.');
      return;
    }
    window.api?.exportEpub?.(selectedStoryId)
      .then((res: { path: string | null; cancelled: boolean }) => {
        if (!res.cancelled && res.path) {
          alert(`EPUB saved to:\n${res.path}`);
        }
      })
      .catch((err: Error) => alert(`Export failed: ${err.message}`));
  };

  const handleExportFormat = () => {
    if (!selectedStoryId) { alert('Select a story first to export.'); return; }
    onOpenExport?.({ kind: 'story', storyId: selectedStoryId });
  };

  const handleExportDocx = () => {
    if (!selectedStoryId) {
      alert('Select a story first to export it as DOCX.');
      return;
    }
    window.api?.exportDocx?.(selectedStoryId)
      .then((res: { path: string | null; cancelled: boolean }) => {
        if (!res.cancelled && res.path) {
          alert(`DOCX saved to:\n${res.path}`);
        }
      })
      .catch((err: Error) => alert(`Export failed: ${err.message}`));
  };

  return (
    <div className="app-menu-bar">
      <span className="app-menu-brand">Mythos</span>
      <ProjectSwitcher activeVaultRoot={activeVaultRoot} onSwitched={onProjectSwitched} requestText={requestText} />
      <div className="app-menu-items" ref={fileMenuRef}>
        <div className="app-menu-item">
          <button
            className="app-menu-item-trigger"
            aria-haspopup="menu"
            aria-controls="file-menu"
            aria-expanded={fileMenuOpen}
            onClick={() => setFileMenuOpen(o => !o)}
            onBlur={(e) => {
              if (fileMenuRef.current && !fileMenuRef.current.contains(e.relatedTarget as Node)) {
                setFileMenuOpen(false);
              }
            }}
          >
            File
          </button>
          {fileMenuOpen && (
            <div id="file-menu" className="app-menu-dropdown" role="menu">
              <button className="app-menu-dropdown-item" role="menuitem" onClick={() => { setFileMenuOpen(false); window.api?.newStory?.(); }}>New Story</button>
              <button className="app-menu-dropdown-item" role="menuitem" onClick={() => { setFileMenuOpen(false); window.api?.openVault?.(); }}>Open Vault…</button>
              <div className="app-menu-separator" role="separator" />
              <button className="app-menu-dropdown-item" role="menuitem" onClick={() => { setFileMenuOpen(false); handleExportEpub(); }}>Export EPUB…</button>
              <button className="app-menu-dropdown-item" role="menuitem" onClick={() => { setFileMenuOpen(false); handleExportDocx(); }}>Export DOCX…</button>
              <button className="app-menu-dropdown-item" role="menuitem" onClick={() => { setFileMenuOpen(false); handleExportFormat(); }}>Export Markdown…</button>
              <button className="app-menu-dropdown-item" role="menuitem" onClick={() => { setFileMenuOpen(false); handleExportFormat(); }}>Export Plain Text…</button>
              <div className="app-menu-separator" role="separator" />
              <button className="app-menu-dropdown-item" role="menuitem" onClick={() => { setFileMenuOpen(false); onOpenHistory(); }}>Prompt History…</button>
              <div className="app-menu-separator" role="separator" />
              <button className="app-menu-dropdown-item" role="menuitem" onClick={() => { setFileMenuOpen(false); onOpenSettings(); }}>Settings…</button>
            </div>
          )}
        </div>
        <div className="app-menu-item" ref={helpMenuRef}>
          <button
            className="app-menu-item-trigger"
            aria-haspopup="menu"
            aria-controls="help-menu"
            aria-expanded={helpMenuOpen}
            onClick={() => setHelpMenuOpen(o => !o)}
            onBlur={(e) => {
              if (helpMenuRef.current && !helpMenuRef.current.contains(e.relatedTarget as Node)) {
                setHelpMenuOpen(false);
              }
            }}
          >
            Help
          </button>
          {helpMenuOpen && (
            <div id="help-menu" className="app-menu-dropdown" role="menu">
              <button
                className="app-menu-dropdown-item"
                role="menuitem"
                onClick={() => { setHelpMenuOpen(false); onOpenKeyboardShortcuts(); }}
              >
                Keyboard Shortcuts…
                <span className="app-menu-shortcut-hint">?</span>
              </button>
            </div>
          )}
        </div>
      </div>
      <SearchBar onNavigate={onSearchNavigate} />
      <div className="app-menu-view-toggle">
        <button
          className={`app-menu-view-btn${view === 'editor' ? ' active' : ''}`}
          onClick={() => onSetView('editor')}
          aria-pressed={view === 'editor'}
        >
          Editor
        </button>
        <button
          className={`app-menu-view-btn${view === 'brainstorm' ? ' active' : ''}`}
          onClick={() => onSetView('brainstorm')}
          aria-pressed={view === 'brainstorm'}
        >
          Brainstorm
        </button>
        <button
          className={`app-menu-view-btn${view === 'kanban' ? ' active' : ''}`}
          onClick={() => onSetView('kanban')}
          aria-pressed={view === 'kanban'}
        >
          Board
        </button>
        <button
          className={`app-menu-view-btn${view === 'graph' ? ' active' : ''}`}
          onClick={() => onSetView('graph')}
          aria-pressed={view === 'graph'}
        >
          Graph
        </button>
        <button
          className={`app-menu-view-btn${view === 'structure' ? ' active' : ''}`}
          onClick={() => onSetView('structure')}
          aria-pressed={view === 'structure'}
        >
          Structure
        </button>
        <button
          className={`app-menu-view-btn${view === 'timeline' ? ' active' : ''}`}
          onClick={() => onSetView('timeline')}
          aria-pressed={view === 'timeline'}
        >
          Timeline
        </button>
        <button
          className={`app-menu-view-btn${view === 'entries' ? ' active' : ''}`}
          onClick={() => onSetView('entries')}
          aria-pressed={view === 'entries'}
          data-testid="view-btn-entries"
        >
          Entries
        </button>
      </div>
      <div className="writing-mode-selector" aria-label="Writing mode">
        <button
          className={`writing-mode-btn${writingMode === 'normal' ? ' active' : ''}`}
          onClick={() => onSetWritingMode('normal')}
          aria-pressed={writingMode === 'normal'}
          title="Normal mode — full editor + sidebars (Ctrl+Shift+N)"
        >
          N
        </button>
        <button
          className={`writing-mode-btn${writingMode === 'focus' ? ' active' : ''}`}
          onClick={() => onSetWritingMode('focus')}
          aria-pressed={writingMode === 'focus'}
          title="Focus mode — distraction-free"
        >
          F
        </button>
        {writingMode === 'focus' && (
          <button
            className="writing-mode-prefs-btn"
            onClick={onOpenFocusPrefs}
            title="Configure Focus mode panels"
            aria-label="Focus mode preferences"
          >
            ⚙
          </button>
        )}
        <button
          className={`writing-mode-btn${writingMode === 'edit' ? ' active' : ''}`}
          onClick={() => onSetWritingMode('edit')}
          aria-pressed={writingMode === 'edit'}
          title="Edit mode — review with Writing Assistant + comments (Ctrl+Shift+E)"
        >
          E
        </button>
      </div>
      <button
        className="app-menu-df-btn"
        onClick={onToggleDistractionFree}
        aria-label="Enter distraction-free mode"
        title="Distraction-free mode (F11)"
      >
        ⊡
      </button>
      <button
        className="app-menu-tour-btn"
        onClick={onOpenTour}
        aria-label="Quick tour"
        title="Quick tour"
        data-testid="toolbar-tour-btn"
      >
        ?
      </button>
      <button
        className="app-menu-gear-btn"
        onClick={onOpenSettings}
        aria-label="Open settings"
        title="Settings"
      >
        ⚙
      </button>
    </div>
  );
}

// ─── Focus mode overlay ───

interface FocusModeOverlayProps {
  wordCount: number;
  readingMinutes: number;
  saveState: 'idle' | 'saved';
}

function FocusModeOverlay({ wordCount, readingMinutes, saveState }: FocusModeOverlayProps) {
  const [hintVisible, setHintVisible] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setHintVisible(false), 3000);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="focus-mode-overlay" aria-hidden="true">
      <div className={`focus-hint${hintVisible ? '' : ' focus-hint-hidden'}`}>
        Press Esc to exit focus mode
      </div>
      <div className="focus-status-bar">
        <span>{wordCount.toLocaleString()} words</span>
        <span>{readingMinutes} min read</span>
        {saveState === 'saved' && <span className="focus-save-ok">Saved ✓</span>}
      </div>
    </div>
  );
}

// ─── Chapter doc view ───

interface ChapterDocViewProps {
  chapter: Chapter;
  selectedSceneId: string | null;
  onSelectScene: (scene: Scene) => void;
}

function ChapterDocView({ chapter, selectedSceneId, onSelectScene }: ChapterDocViewProps) {
  const sortedScenes = useMemo(
    () => [...chapter.scenes].sort((a, b) => a.order - b.order),
    [chapter.scenes],
  );
  const selectedRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedSceneId]);

  return (
    <div className="chapter-doc-view">
      <div className="chapter-doc-header">{chapter.title}</div>
      <div className="chapter-doc-scenes">
        {sortedScenes.length === 0 ? (
          <div className="chapter-doc-empty">No scenes in this chapter yet.</div>
        ) : (
          sortedScenes.map((scene) => {
            const isActive = scene.id === selectedSceneId;
            const bodyText = scene.blocks
              .slice()
              .sort((a, b) => a.order - b.order)
              .map((b) => b.content)
              .join('\n\n')
              .trim();
            return (
              <div
                key={scene.id}
                ref={isActive ? selectedRef : null}
                className={`chapter-doc-scene${isActive ? ' active' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => onSelectScene(scene)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onSelectScene(scene); } }}
                aria-pressed={isActive}
              >
                <div className="chapter-doc-scene-title">{scene.title}</div>
                {bodyText && (
                  <div className="chapter-doc-scene-excerpt">
                    {bodyText.slice(0, 300)}{bodyText.length > 300 ? '…' : ''}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ─── Book outline view ───

interface BookOutlineViewProps {
  story: Story;
  selectedChapterId: string | null;
  selectedSceneId: string | null;
  onSelectScene: (scene: Scene, chapter: Chapter) => void;
}

function BookOutlineView({ story, selectedChapterId, selectedSceneId, onSelectScene }: BookOutlineViewProps) {
  const sortedChapters = useMemo(
    () => [...story.chapters].sort((a, b) => a.order - b.order),
    [story.chapters],
  );
  const activeSceneRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    activeSceneRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedSceneId]);

  return (
    <div className="book-outline-view">
      <div className="book-outline-header">{story.title}</div>
      <div className="book-outline-body">
        {sortedChapters.length === 0 ? (
          <div className="book-outline-empty">No chapters yet.</div>
        ) : (
          sortedChapters.map((chapter) => {
            const isActiveChapter = chapter.id === selectedChapterId;
            const sortedScenes = [...chapter.scenes].sort((a, b) => a.order - b.order);
            return (
              <div key={chapter.id} className={`book-outline-chapter${isActiveChapter ? ' active-chapter' : ''}`}>
                <div className="book-outline-chapter-title">{chapter.title}</div>
                <div className="book-outline-scene-list">
                  {sortedScenes.length === 0 ? (
                    <div className="book-outline-no-scenes">No scenes</div>
                  ) : (
                    sortedScenes.map((scene) => {
                      const isActiveScene = scene.id === selectedSceneId;
                      return (
                        <div
                          key={scene.id}
                          ref={isActiveScene ? activeSceneRef : null}
                          className={`book-outline-scene${isActiveScene ? ' active-scene' : ''}`}
                          role="button"
                          tabIndex={0}
                          onClick={() => onSelectScene(scene, chapter)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); onSelectScene(scene, chapter); }
                          }}
                          aria-current={isActiveScene ? 'true' : undefined}
                        >
                          {scene.title}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────

/** Match a KeyboardEvent against a shortcut string like 'ctrl+shift+v' or 'alt+v'. */
function matchesShortcut(e: KeyboardEvent, shortcut: string): boolean {
  const parts = shortcut.toLowerCase().split('+');
  const key = parts[parts.length - 1];
  const wantsCtrl = parts.includes('ctrl');
  const wantsShift = parts.includes('shift');
  const wantsAlt = parts.includes('alt');
  return (
    e.key.toLowerCase() === key &&
    !!(e.ctrlKey || e.metaKey) === wantsCtrl &&
    e.shiftKey === wantsShift &&
    e.altKey === wantsAlt
  );
}

interface DragState {
  target: 'left' | 'right';
  startX: number;
  startWidth: number;
}

export default function DesktopShell() {
  const { requestText, promptModal } = useTextPrompt();
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [stories, setStories] = useState<Story[]>([]);
  const [selectedScene, setSelectedScene] = useState<Scene | null>(null);
  const [selectedChapter, setSelectedChapter] = useState<Chapter | null>(null);
  const [selectedStory, setSelectedStory] = useState<Story | null>(null);
  const [selectedEntity, setSelectedEntity] = useState<EntityEntry | null>(null);
  const [vaultContext, setVaultContext] = useState<'file' | 'folder' | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeVaultRoot, setActiveVaultRoot] = useState<string>('');
  const [layout, setLayout] = useState<LayoutPrefs>(DEFAULT_LAYOUT);
  const [view, setView] = useState<AppView>('editor');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [gettingStartedProgress, setGettingStartedProgress] = useState<GettingStartedProgress | null>(null);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [seenEmptySceneHints, setSeenEmptySceneHints] = useState<Set<string>>(() => new Set());
  const [budgetToast, setBudgetToast] = useState<string | null>(null);
  const budgetToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Voice state (SKY-322) ───
  const [voiceActive, setVoiceActive] = useState(false);
  const [voiceToast, setVoiceToast] = useState<string | null>(null);
  const voiceSessionRef = useRef<string | null>(null);
  const speechRecogRef = useRef<SpeechRecognition | null>(null);
  const pttDownRef = useRef(false);
  const voiceToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [betaReadComments, setBetaReadComments] = useState<BetaReadComment[]>([]);
  const [betaReadLoading, setBetaReadLoading] = useState(false);
  const [exportScope, setExportScope] = useState<ExportScope | null>(null);
  const [focusModePrefsOpen, setFocusModePrefsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [viewDepth, setViewDepth] = useState<ViewDepth>('scene');
  const [showSceneHistory, setShowSceneHistory] = useState(false);
  const [snapshotSavedAt, setSnapshotSavedAt] = useState<string | null>(null);
  const [restoreKey, setRestoreKey] = useState(0);
  /** SKY-204: currently open vault note path (relative to notes vault root). */
  const [openedNotePath, setOpenedNotePath] = useState<string | null>(null);
  /** SKY-204: word count of the currently open vault note, updated live. */
  const [openedNoteWordCount, setOpenedNoteWordCount] = useState(0);

  // SKY-1694 (Wave 2a): left sidebar panel zone layout + right sidebar user-collapse toggle
  const [leftSidebarLayout, setLeftSidebarLayout] = useState<LeftSidebarLayout>(DEFAULT_LEFT_SIDEBAR_LAYOUT);
  const [rightSidebarUserCollapsed, setRightSidebarUserCollapsed] = useState(false);
  const leftSidebarLayoutRef = useRef<LeftSidebarLayout>(DEFAULT_LEFT_SIDEBAR_LAYOUT);

  const { distractionFree, toggle: toggleDistractionFree } = useFocusMode();
  const [saveState, setSaveState] = useState<'idle' | 'saved'>('idle');

  // ─── SKY-1686: Global right-sidebar state ───
  // undefined = settings not yet loaded (sidebar not rendered at all, no space taken).
  // true/false = settings loaded with an explicit rightSidebarVisible value.
  // E2E tests that seed settings without rightSidebarVisible keep undefined → no sidebar renders,
  // preserving the same layout as before this PR (fixes timeline TC-TL-06 overlap regression).
  const [grsVisible, setGrsVisible] = useState<boolean | undefined>(undefined);
  const [grsWidth, setGrsWidth] = useState(300);
  const [grsPanels, setGrsPanels] = useState<PanelConfig[]>(DEFAULT_PANELS);
  const [continuityCount, setContinuityCount] = useState(0);

  // ─── SKY-863: Sync conflict modal state ───
  const [syncConflictResolved, setSyncConflictResolved] = useState<ResolvedConflictInfo[]>([]);
  const [syncLockfileConflict, setSyncLockfileConflict] = useState<LockfileConflictInfo | null>(null);
  const [syncModalOpen, setSyncModalOpen] = useState(false);

  // ─── Voice session state (SKY-896) ───
  const [voiceListening, setVoiceListening] = useState(false);
  const voiceRecognitionRef = useRef<SpeechRecognition | null>(null);
  const voicePttActiveRef = useRef(false);
  const saveIndicatorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorApiRef = useRef<BlockEditorApi | null>(null);
  const [wikiLinkSuggestions, setWikiLinkSuggestions] = useState<WLSuggestion[]>([]);
  // SKY-192: entity registry for the auto-linker
  const [allEntities, setAllEntities] = useState<EntityEntry[]>([]);

  // SKY-130: cross-restart scene/cursor restore refs
  const pendingCursorPosRef = useRef<number | null>(null);
  const sceneRestoreAttemptedRef = useRef(false);
  const restoreInProgressRef = useRef(false);
  const saveCursorDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleEditorReady = useCallback((api: BlockEditorApi) => {
    editorApiRef.current = api;
  }, []);

  // SKY-152: seenTips — memoized to avoid new object reference on every render
  const seenTips = useMemo<Record<string, boolean>>(
    () => (appSettings as (AppSettings & { seenTips?: Record<string, boolean> }) | null)?.seenTips ?? {},
    [appSettings],
  );
  const handleDismissTip = useCallback(async (key: string) => {
    if (!appSettings) return;
    const updatedSettings = { ...appSettings, seenTips: { ...seenTips, [key]: true } } as AppSettings;
    setAppSettings(updatedSettings);
    window.api.settingsSet(updatedSettings).catch(() => {});
  }, [appSettings, seenTips]);

  const persistLeftSidebarLayout = useCallback((next: LeftSidebarLayout) => {
    setLeftSidebarLayout(next);
    leftSidebarLayoutRef.current = next;
    setAppSettings((prev) => {
      if (!prev) return prev;
      const updated = { ...prev, activeLayout: { ...prev.activeLayout, leftSidebar: next } } as AppSettings;
      window.api.settingsSet(updated).catch(() => {});
      return updated;
    });
  }, []);

  const persistGettingStartedProgress = useCallback((next: GettingStartedProgress) => {
    setGettingStartedProgress(next);
    setAppSettings((prev) => {
      if (!prev) return prev;
      const updated = { ...prev, gettingStartedProgress: next } as AppSettings;
      window.api.settingsSet(updated).catch(() => {});
      return updated;
    });
  }, []);

  const checkGettingStartedItem = useCallback((itemId: GettingStartedItemId) => {
    setGettingStartedProgress((prev) => {
      if (!prev) return prev;
      const next = gettingStartedReducer(prev, { type: 'CHECK_ITEM', itemId });
      setAppSettings((settings) => {
        if (!settings) return settings;
        const updated = { ...settings, gettingStartedProgress: next } as AppSettings;
        window.api.settingsSet(updated).catch(() => {});
        return updated;
      });
      return next;
    });
  }, []);

  const handleDismissGettingStarted = useCallback(() => {
    if (!gettingStartedProgress) return;
    persistGettingStartedProgress(gettingStartedReducer(gettingStartedProgress, { type: 'DISMISS' }));
  }, [gettingStartedProgress, persistGettingStartedProgress]);

  const handleToggleGsCollapsed = useCallback(() => {
    if (!gettingStartedProgress) return;
    persistGettingStartedProgress(gettingStartedReducer(gettingStartedProgress, { type: 'TOGGLE_COLLAPSE' }));
  }, [gettingStartedProgress, persistGettingStartedProgress]);

  const handleManualSnapshot = useCallback(async () => {
    if (!selectedScene) return;
    const content = selectedScene.blocks.map(b => b.content).join('\n\n');
    try {
      await window.api.snapshotSave?.(selectedScene.id, content);
      setSnapshotSavedAt(new Date().toLocaleTimeString());
    } catch {
      // non-fatal
    }
    // SKY-1611: also save a SQLite draft snapshot on manual save
    try {
      await window.api.draftsCreate?.(selectedScene.id, content);
    } catch {
      // non-fatal
    }
    // Notify useWritingScheduler on_save cadence listeners (AC-CAD-02)
    window.dispatchEvent(new CustomEvent('scene:saved'));
  }, [selectedScene]);

  const handleDraftRestore = useCallback((content: string) => {
    if (!selectedScene) return;
    const restoredBlock: Block = {
      id: generateId(),
      type: 'prose',
      content,
      order: 0,
      updatedAt: now(),
    };
    setSelectedScene(prev => prev ? { ...prev, blocks: [restoredBlock], updatedAt: now() } : null);
    setRestoreKey(k => k + 1);
  }, [selectedScene]);

  const handleSceneRestore = useCallback((content: string) => {
    if (!selectedScene) return;
    const restoredBlock: Block = {
      id: generateId(),
      type: 'prose',
      content,
      order: 0,
      updatedAt: now(),
    };
    setSelectedScene(prev => prev ? { ...prev, blocks: [restoredBlock], updatedAt: now() } : null);
    setRestoreKey(k => k + 1);
    setShowSceneHistory(false);
  }, [selectedScene]);

  const handleJumpToText = useCallback((text: string) => {
    editorApiRef.current?.jumpToText(text);
  }, []);

  const handleInsertWikiLink = useCallback((link: string, anchorText: string) => {
    editorApiRef.current?.insertWikiLink(link, anchorText);
  }, []);

  const handleEditorAcceptWikiLink = useCallback((id: string, link: string, anchorText: string) => {
    editorApiRef.current?.insertWikiLink(link, anchorText);
    setWikiLinkSuggestions((prev) => prev.filter((s) => s.id !== id));
    window.api?.suggestionsAccept?.(id).catch(() => {});
  }, []);

  const handleEditorRejectWikiLink = useCallback((id: string) => {
    setWikiLinkSuggestions((prev) => prev.filter((s) => s.id !== id));
    window.api?.suggestionsReject?.(id).catch(() => {});
  }, []);
  const dragState = useRef<DragState | null>(null);

  // ─── Beta-Read Mode (MYT-237) ───

  const loadBetaReadComments = useCallback(async (sceneId: string) => {
    try {
      const res = await window.api.betaReadList(sceneId);
      setBetaReadComments(res.comments ?? []);
    } catch {
      setBetaReadComments([]);
    }
  }, []);

  useEffect(() => {
    if (selectedScene) {
      loadBetaReadComments(selectedScene.id);
    } else {
      setBetaReadComments([]);
    }
  }, [selectedScene, loadBetaReadComments]);

  useEffect(() => {
    setSnapshotSavedAt(null);
    setShowSceneHistory(false);
    setRestoreKey(0);
  }, [selectedScene?.id]);

  const handleBetaReadRequest = useCallback(async (selectedText: string) => {
    if (!selectedScene || betaReadLoading) return;
    setBetaReadLoading(true);
    try {
      const context = `You are a beta reader giving constructive feedback. Highlight strengths, flag anything confusing, and suggest one improvement. Be concise (2–4 sentences).\n\nPassage:\n\n${selectedText}`;
      const res = await window.api.agentWritingAssistant(selectedText, context);
      const commentText: string = res?.text ?? 'No feedback generated.';
      await window.api.betaReadCreate(selectedScene.id, selectedText, commentText);
      await loadBetaReadComments(selectedScene.id);
    } catch {
      // non-fatal
    } finally {
      setBetaReadLoading(false);
    }
  }, [selectedScene, betaReadLoading, loadBetaReadComments]);

  const handleBetaReadDismiss = useCallback(async (id: string) => {
    try {
      await window.api.betaReadDismiss(id);
      setBetaReadComments((prev) => prev.filter((c) => c.id !== id));
    } catch {
      // non-fatal
    }
  }, []);

  useEffect(() => {
    if (!window.api.onBudgetCapHit) return;
    const unsub = window.api.onBudgetCapHit((event) => {
      const windowLabel = event.reason === 'daily_token_cap' ? 'daily' : 'hourly';
      const msg = `${event.agentLabel} paused: ${windowLabel} token cap reached.`;
      setBudgetToast(msg);
      if (budgetToastTimer.current) clearTimeout(budgetToastTimer.current);
      budgetToastTimer.current = setTimeout(() => setBudgetToast(null), 5000);
    });
    return () => {
      unsub();
      if (budgetToastTimer.current) clearTimeout(budgetToastTimer.current);
    };
  }, []);

  // ─── Voice input (SKY-322) ───

  const stopVoice = useCallback(async () => {
    if (speechRecogRef.current) {
      speechRecogRef.current.onresult = null;
      speechRecogRef.current.onerror = null;
      try { speechRecogRef.current.stop(); } catch { /* already stopped */ }
      speechRecogRef.current = null;
    }
    if (voiceRecognitionRef.current) {
      try { voiceRecognitionRef.current.stop(); } catch { /* already stopped */ }
      voiceRecognitionRef.current = null;
    }
    const sessionId = voiceSessionRef.current;
    voiceSessionRef.current = null;
    pttDownRef.current = false;
    voicePttActiveRef.current = false;
    setVoiceActive(false);
    setVoiceListening(false);
    if (sessionId) {
      window.api.voiceStop(sessionId).catch(() => {});
    }
  }, []);

  const startVoice = useCallback(async () => {
    if (voiceSessionRef.current) return;
    const micDeviceId = appSettings?.voice?.micDeviceId;
    let sessionId: string;
    try {
      const res = await window.api.voiceStart(micDeviceId) as { sessionId: string };
      sessionId = res.sessionId;
    } catch {
      setVoiceToast('Failed to start voice input.');
      if (voiceToastTimerRef.current) clearTimeout(voiceToastTimerRef.current);
      voiceToastTimerRef.current = setTimeout(() => setVoiceToast(null), 4000);
      return;
    }
    voiceSessionRef.current = sessionId;
    setVoiceActive(true);
    setVoiceListening(true);

    const SpeechRecognitionCtor: (new () => SpeechRecognition) | undefined = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      setVoiceToast('Web Speech API not available.');
      if (voiceToastTimerRef.current) clearTimeout(voiceToastTimerRef.current);
      voiceToastTimerRef.current = setTimeout(() => setVoiceToast(null), 4000);
      voiceSessionRef.current = null;
      setVoiceActive(false);
      window.api.voiceStop(sessionId).catch(() => {});
      return;
    }

    const recog = new SpeechRecognitionCtor();
    recog.continuous = true;
    recog.interimResults = true;
    recog.onresult = (evt) => {
      const sid = voiceSessionRef.current;
      if (!sid) return;
      for (let i = evt.resultIndex; i < evt.results.length; i++) {
        const r = evt.results[i];
        if (r[0]) {
          window.api.voiceLocalTranscript(sid, r[0].transcript, r.isFinal);
        }
      }
    };
    recog.onerror = (evt) => {
      const msg = evt.error === 'not-allowed'
        ? 'Microphone permission denied. Check your system settings.'
        : evt.error !== 'aborted' ? 'Voice recognition error. Please try again.' : null;
      if (msg) {
        setVoiceToast(msg);
        if (voiceToastTimerRef.current) clearTimeout(voiceToastTimerRef.current);
        voiceToastTimerRef.current = setTimeout(() => setVoiceToast(null), 4000);
      }
      const sid = voiceSessionRef.current;
      speechRecogRef.current = null;
      voiceSessionRef.current = null;
      pttDownRef.current = false;
      setVoiceActive(false);
      if (sid) window.api.voiceStop(sid).catch(() => {});
    };
    speechRecogRef.current = recog;
    voiceRecognitionRef.current = recog;
    recog.start();
  }, [appSettings?.voice?.micDeviceId]);

  // Subscribe to transcript push events — insert final text at cursor
  useEffect(() => {
    if (!window.api?.onVoiceTranscript) return;
    const unsub = window.api.onVoiceTranscript(({ text, isFinal }) => {
      if (!isFinal) return;
      const trimmed = text.trim();
      if (!trimmed) return;
      if (editorApiRef.current) {
        editorApiRef.current.insertText(trimmed + ' ');
      } else {
        setVoiceToast('Voice captured — open a scene to insert text.');
        if (voiceToastTimerRef.current) clearTimeout(voiceToastTimerRef.current);
        voiceToastTimerRef.current = setTimeout(() => setVoiceToast(null), 4000);
      }
    });
    return () => {
      unsub();
      if (voiceToastTimerRef.current) clearTimeout(voiceToastTimerRef.current);
    };
  }, []);

  // Keyboard shortcuts: toggle (Ctrl+Shift+V) and push-to-talk (Alt+V hold)
  useEffect(() => {
    if (!appSettings?.voice?.enabled) return;
    const voiceMode = appSettings.voice.voiceMode ?? 'toggle';
    const toggleShortcut = appSettings.voice.toggleShortcut ?? 'ctrl+shift+v';
    const pttKey = appSettings.voice.pttKey ?? 'alt+v';

    const onKeyDown = (e: KeyboardEvent) => {
      if (voiceMode === 'toggle' && matchesShortcut(e, toggleShortcut)) {
        e.preventDefault();
        if (voiceSessionRef.current) {
          stopVoice().catch(() => {});
        } else {
          startVoice().catch(() => {});
        }
      } else if (voiceMode === 'push-to-talk' && matchesShortcut(e, pttKey)) {
        if (!pttDownRef.current) {
          e.preventDefault();
          pttDownRef.current = true;
          startVoice().catch(() => {});
        }
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (voiceMode === 'push-to-talk' && matchesShortcut(e, pttKey)) {
        pttDownRef.current = false;
        stopVoice().catch(() => {});
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [
    appSettings?.voice?.enabled,
    appSettings?.voice?.voiceMode,
    appSettings?.voice?.toggleShortcut,
    appSettings?.voice?.pttKey,
    startVoice,
    stopVoice,
  ]);

  const loadVault = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [m, s, rootResult] = await Promise.all([
        window.api.readManifest() as Promise<Manifest>,
        (window.api.settingsGet?.() ?? Promise.resolve(null)).catch(() => null),
        (window.api.getVaultRoot?.() ?? Promise.resolve(null)).catch(() => null),
      ]);
      setManifest(m);
      setStories(m.stories ?? []);
      if (m.layout) {
        setLayout({ ...DEFAULT_LAYOUT, ...m.layout });
      }
      if (s) {
        setAppSettings(s);
        // Restore global right sidebar state from persisted settings (SKY-1686)
        if (typeof s.rightSidebarVisible === 'boolean') setGrsVisible(s.rightSidebarVisible);
        if (typeof s.rightSidebarWidth === 'number') setGrsWidth(s.rightSidebarWidth);
        if (Array.isArray(s.rightSidebarPanels) && s.rightSidebarPanels.length > 0) setGrsPanels(s.rightSidebarPanels as PanelConfig[]);
        // SKY-1694: restore left sidebar layout from persisted AppSettings
        if (s.activeLayout?.leftSidebar) {
          setLeftSidebarLayout(s.activeLayout.leftSidebar);
          leftSidebarLayoutRef.current = s.activeLayout.leftSidebar;
        }
        setGettingStartedProgress(
          createInitialGettingStartedProgress(
            undefined,
            s.onboardingStartMode,
            s.gettingStartedProgress,
          ),
        );
        applyTheme(s.theme);
        // Load background image data URL if a custom path is stored
        const lg = s.liquidNeon;
        if (lg?.background && lg.background !== 'default') {
          window.api.loadBgImage?.(lg.background)
            .then((res: { dataUrl: string | null }) => applyLiquidNeonTokens(lg, res?.dataUrl))
            .catch(() => applyLiquidNeonTokens(lg));
        } else {
          applyLiquidNeonTokens(lg);
        }
      }
      if (rootResult?.vaultRoot) setActiveVaultRoot(rootResult.vaultRoot);

      // SKY-863: run conflict check after vault is ready.
      // Non-fatal: errors here must not prevent opening the vault.
      try {
        if (typeof window.api?.checkVaultConflicts === 'function') {
          const conflicts = await window.api.checkVaultConflicts();
          if (conflicts && !conflicts.dismissed) {
            if ((conflicts.resolved?.length ?? 0) > 0 || conflicts.lockfileConflict) {
              setSyncConflictResolved(conflicts.resolved ?? []);
              setSyncLockfileConflict(conflicts.lockfileConflict ?? null);
              setSyncModalOpen(true);
            }
          }
        }
      } catch {
        // conflict check is best-effort
      }
    } catch (e) {
      setError('Failed to load vault: ' + String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadVault();
  }, [loadVault]);

  // SKY-863: handle sync conflict modal dismiss
  const handleSyncConflictContinue = useCallback(async (suppress: boolean) => {
    setSyncModalOpen(false);
    if (suppress) {
      try {
        await window.api?.dismissSyncWarning?.();
      } catch {
        // non-fatal
      }
    }
  }, []);

  // SKY-204: auto-open today's daily note when journal mode is enabled.
  // Runs once after settings load; creates the note silently in the background.
  useEffect(() => {
    if (!appSettings?.journalMode?.enabled) return;
    window.api.dailyNoteOpenToday().then((r) => {
      if (r.created) {
        // Note was just created — open it automatically.
        setOpenedNotePath(r.path);
        setSelectedScene(null);
        setSelectedChapter(null);
        setSelectedStory(null);
        setSelectedEntity(null);
      }
    }).catch(() => {});
  // Only run when journal mode enabled setting becomes truthy (settings load or toggle).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appSettings?.journalMode?.enabled]);

  // SKY-192: load entities for the auto-linker on mount and vault changes
  const loadEntities = useCallback(async () => {
    try {
      const res = await window.api.entityList();
      setAllEntities(res.entities ?? []);
    } catch {
      // non-fatal; auto-linker just won't suggest anything
    }
  }, []);

  useEffect(() => {
    loadEntities();
  }, [loadEntities]);

  useEffect(() => {
    const off = window.api.onVaultFileChanged(() => {
      loadEntities();
    });
    return off;
  }, [loadEntities]);

  // Handle project switches pushed from main process
  useEffect(() => {
    if (!window.api?.onProjectSwitched) return;
    const unsub = window.api.onProjectSwitched((data: { vaultRoot: string }) => {
      setActiveVaultRoot(data.vaultRoot);
      // Reset selection state and reload vault content
      setSelectedScene(null);
      setSelectedChapter(null);
      setSelectedStory(null);
      setSelectedEntity(null);
      // SKY-130: allow restore to fire again for the new project
      sceneRestoreAttemptedRef.current = false;
      loadVault();
    });
    return () => unsub?.();
  }, [loadVault]);

  const handleProjectSwitched = useCallback((vaultRoot: string) => {
    setActiveVaultRoot(vaultRoot);
    setSelectedScene(null);
    setSelectedChapter(null);
    setSelectedStory(null);
    setSelectedEntity(null);
    // SKY-130: allow restore to fire again for the new project
    sceneRestoreAttemptedRef.current = false;
    loadVault();
  }, [loadVault]);

  const persistManifest = useCallback(async (m: Manifest) => {
    try {
      await window.api.writeManifest(m);
    } catch (e) {
      console.error('Failed to persist manifest:', e);
    }
  }, []);

  const scheduleManifestSave = useCallback((m: Manifest) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => persistManifest(m), 900);
  }, [persistManifest]);

  const updateManifest = useCallback((updatedStories: Story[], updatedLayout?: LayoutPrefs) => {
    setStories(updatedStories);
    if (!manifest) return;
    const updated: Manifest = {
      ...manifest,
      stories: updatedStories,
      layout: updatedLayout ?? layout,
    };
    setManifest(updated);
    scheduleManifestSave(updated);
  }, [manifest, layout, scheduleManifestSave]);

  const persistLayout = useCallback((newLayout: LayoutPrefs) => {
    setLayout(newLayout);
    if (!manifest) return;
    const updated: Manifest = { ...manifest, layout: newLayout };
    setManifest(updated);
    scheduleManifestSave(updated);
  }, [manifest, scheduleManifestSave]);

  const persistGrsSettings = useCallback((patch: { visible?: boolean; width?: number; panels?: PanelConfig[] }) => {
    if (!appSettings) return;
    const updated: AppSettings = {
      ...appSettings,
      ...(patch.visible !== undefined ? { rightSidebarVisible: patch.visible } : {}),
      ...(patch.width !== undefined ? { rightSidebarWidth: patch.width } : {}),
      ...(patch.panels !== undefined ? { rightSidebarPanels: patch.panels } : {}),
    };
    setAppSettings(updated);
    window.api.settingsSet(updated).catch(() => {});
  }, [appSettings]);

  const handleGrsVisibilityChange = useCallback((visible: boolean) => {
    setGrsVisible(visible);
    persistGrsSettings({ visible });
  }, [persistGrsSettings]);

  const handleGrsWidthChange = useCallback((width: number) => {
    setGrsWidth(width);
    persistGrsSettings({ width });
  }, [persistGrsSettings]);

  const handleGrsPanelsChange = useCallback((panels: PanelConfig[]) => {
    setGrsPanels(panels);
    persistGrsSettings({ panels });
  }, [persistGrsSettings]);

  // SKY-1695: Unified drop handler for panel drag-and-drop across both sidebars.
  const handlePanelDrop = useCallback((
    panelId: SidebarPanelId,
    fromSidebar: DragSidebar,
    fromIndex: number,
    toSidebar: DragSidebar,
    toIndex: number,
  ) => {
    if (fromSidebar === toSidebar) {
      if (fromSidebar === 'left') {
        const cur = leftSidebarLayoutRef.current;
        const panels = [...cur.panels];
        const [removed] = panels.splice(fromIndex, 1);
        panels.splice(toIndex > fromIndex ? toIndex - 1 : toIndex, 0, removed);
        persistLeftSidebarLayout({ ...cur, panels });
      } else {
        const next = [...grsPanels];
        const [removed] = next.splice(fromIndex, 1);
        next.splice(toIndex > fromIndex ? toIndex - 1 : toIndex, 0, removed);
        setGrsPanels(next);
        persistGrsSettings({ panels: next });
      }
    } else if (fromSidebar === 'left') {
      // left → right: remove from left, insert into right
      const cur = leftSidebarLayoutRef.current;
      persistLeftSidebarLayout({ ...cur, panels: cur.panels.filter((_, i) => i !== fromIndex) });
      const rightNext = [...grsPanels];
      rightNext.splice(toIndex, 0, { id: panelId, collapsed: false });
      setGrsPanels(rightNext);
      persistGrsSettings({ panels: rightNext });
    } else {
      // right → left: remove from right, insert into left
      const rightNext = grsPanels.filter((_, i) => i !== fromIndex);
      setGrsPanels(rightNext);
      persistGrsSettings({ panels: rightNext });
      const cur = leftSidebarLayoutRef.current;
      const leftPanels = [...cur.panels];
      leftPanels.splice(toIndex, 0, { id: panelId, collapsed: false });
      persistLeftSidebarLayout({ ...cur, panels: leftPanels });
    }
  }, [grsPanels, persistLeftSidebarLayout, persistGrsSettings]);

  const setWritingMode = useCallback((mode: WritingMode) => {
    let newLayout: LayoutPrefs = { ...layout, writingMode: mode };
    if (mode === 'edit') {
      newLayout = { ...newLayout, leftTab: 'review', rightTab: 'ai' };
    }
    persistLayout(newLayout);
  }, [layout, persistLayout]);

  const handleGettingStartedAction = useCallback((itemId: GettingStartedItemId) => {
    checkGettingStartedItem(itemId);
    if (itemId === 'brainstorm') {
      setView('brainstorm');
      return;
    }
    if (itemId === 'notes-vault') {
      setView('editor');
      persistLayout({ ...layout, leftTab: 'vault' });
      return;
    }
    if (itemId === 'add-character') {
      setView('brainstorm');
      return;
    }
    if (itemId === 'write-scene') {
      setView('editor');
      if (!selectedScene) editorApiRef.current?.focus();
    }
  }, [checkGettingStartedItem, layout, selectedScene, persistLayout]);

  // ─── Writing mode keyboard shortcuts ───
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl+/ opens the keyboard shortcuts dialog from anywhere.
      if (e.key === '/' && (e.ctrlKey || e.metaKey) && !e.altKey) {
        e.preventDefault();
        setShortcutsOpen(true);
        return;
      }
      // ? key opens the keyboard shortcuts dialog, but not from text inputs.
      if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const target = e.target as HTMLElement;
        const inText =
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable;
        if (!inText) {
          e.preventDefault();
          setShortcutsOpen(true);
          return;
        }
      }

      const mod = e.metaKey || e.ctrlKey;
      // Ctrl/Cmd+, — open Settings (standard platform convention for preferences)
      if (mod && !e.shiftKey && !e.altKey && e.key === ',') {
        e.preventDefault();
        setSettingsOpen(true);
        return;
      }
      // Ctrl+K — open global vault search
      if (mod && !e.shiftKey && !e.altKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setGlobalSearchOpen(true);
        return;
      }
      // Ctrl/Cmd+S — manual save (creates a draft snapshot) — SKY-1611
      if (mod && !e.shiftKey && !e.altKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        void handleManualSnapshot();
        return;
      }
      // SKY-1694: Ctrl+[ / Cmd+[ — toggle left sidebar; Ctrl+] / Cmd+] — toggle right sidebar
      if (mod && !e.shiftKey && !e.altKey && e.key === '[') {
        e.preventDefault();
        const next = { ...leftSidebarLayoutRef.current, sidebarCollapsed: !leftSidebarLayoutRef.current.sidebarCollapsed };
        persistLeftSidebarLayout(next);
        return;
      }
      if (mod && !e.shiftKey && !e.altKey && e.key === ']') {
        e.preventDefault();
        setRightSidebarUserCollapsed(prev => !prev);
        return;
      }
      // SKY-1694: Ctrl+Shift+L / Ctrl+Shift+R — move focus to left/right sidebar
      if (mod && e.shiftKey && !e.altKey && (e.key === 'L' || e.key === 'l')) {
        e.preventDefault();
        const el = document.querySelector<HTMLElement>('.lr-nav-zone button:first-child, .lr-panel-content :is(button,input,textarea,[tabindex="0"])');
        el?.focus();
        return;
      }
      if (mod && e.shiftKey && !e.altKey && (e.key === 'R' || e.key === 'r')) {
        e.preventDefault();
        const el = document.querySelector<HTMLElement>('.right-sidebar [role="tab"][aria-selected="true"], .right-sidebar button');
        el?.focus();
        return;
      }
      if (!mod || !e.shiftKey) return;
      if (e.key === 'F' || e.key === 'f') {
        e.preventDefault();
        setWritingMode('focus');
      } else if (e.key === 'E' || e.key === 'e') {
        e.preventDefault();
        setWritingMode('edit');
      } else if (e.key === 'N' || e.key === 'n') {
        e.preventDefault();
        setWritingMode('normal');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setWritingMode, setShortcutsOpen, setGlobalSearchOpen, setSettingsOpen, handleManualSnapshot, persistLeftSidebarLayout]);

  // ─── Panel resize drag handlers ───

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragState.current) return;
      const { target, startX, startWidth } = dragState.current;
      const delta = e.clientX - startX;
      const newWidth = Math.max(160, Math.min(500, startWidth + (target === 'left' ? delta : -delta)));
      setLayout((prev) => {
        const next = { ...prev, [target === 'left' ? 'leftWidth' : 'rightWidth']: newWidth };
        return next;
      });
    };

    const onMouseUp = () => {
      if (!dragState.current) return;
      dragState.current = null;
      setLayout((curr) => {
        persistLayout(curr);
        return curr;
      });
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [persistLayout]);

  const startDrag = useCallback((target: 'left' | 'right', e: React.MouseEvent) => {
    e.preventDefault();
    dragState.current = {
      target,
      startX: e.clientX,
      startWidth: target === 'left' ? layout.leftWidth : layout.rightWidth,
    };
  }, [layout]);

  const adjustPanelWidth = useCallback((target: 'left' | 'right', delta: number) => {
    const key = target === 'left' ? 'leftWidth' : 'rightWidth';
    const newWidth = Math.max(160, Math.min(500, layout[key] + delta));
    persistLayout({ ...layout, [key]: newWidth });
  }, [layout, persistLayout]);

  // ─── Story/scene management ───

  const persistSceneMarkdown = useCallback(async (scene: Scene) => {
    try {
      await window.api.writeVault(scene.path, blocksToMarkdown(scene));
    } catch (e) {
      console.error('Failed to write scene markdown:', e);
    }
  }, []);

  const handleBlocksChange = useCallback((blocks: Block[]) => {
    if (!selectedScene || !selectedChapter || !selectedStory) return;
    const updatedScene: Scene = { ...selectedScene, blocks, updatedAt: now() };
    setSelectedScene(updatedScene);
    const updatedStories = stories.map((story) =>
      story.id !== selectedStory.id ? story : {
        ...story,
        chapters: story.chapters.map((ch) =>
          ch.id !== selectedChapter.id ? ch : {
            ...ch,
            scenes: ch.scenes.map((sc) => sc.id !== updatedScene.id ? sc : updatedScene),
          }
        ),
      }
    );
    updateManifest(updatedStories);
    persistSceneMarkdown(updatedScene);
    const content = blocks.map((b) => b.content).join('\n\n');
    if (content.trim()) {
      checkGettingStartedItem('write-scene');
      setSeenEmptySceneHints((prev) => new Set(prev).add(selectedScene.id));
    }
    window.api.snapshotSave?.(selectedScene.id, content).catch(() => {});
    // Flash "Saved" in the distraction-free status bar ~1200ms after the last edit
    if (saveIndicatorTimer.current) clearTimeout(saveIndicatorTimer.current);
    saveIndicatorTimer.current = setTimeout(() => {
      setSaveState('saved');
      saveIndicatorTimer.current = setTimeout(() => setSaveState('idle'), 1500);
    }, 1200);
  }, [selectedScene, selectedChapter, selectedStory, stories, updateManifest, persistSceneMarkdown, checkGettingStartedItem]);

  const handleDraftStateChange = useCallback((state: DraftState) => {
    if (!selectedScene || !selectedChapter || !selectedStory) return;
    const updatedScene: Scene = { ...selectedScene, draftState: state, updatedAt: now() };
    setSelectedScene(updatedScene);
    const updatedStories = stories.map((story) =>
      story.id !== selectedStory.id ? story : {
        ...story,
        chapters: story.chapters.map((ch) =>
          ch.id !== selectedChapter.id ? ch : {
            ...ch,
            scenes: ch.scenes.map((sc) => sc.id !== updatedScene.id ? sc : updatedScene),
          }
        ),
      }
    );
    updateManifest(updatedStories);
  }, [selectedScene, selectedChapter, selectedStory, stories, updateManifest]);

  const createStory = useCallback(async () => {
    const title = await requestText('Story title:');
    if (!title?.trim()) return;
    const id = generateId();
    const story: Story = {
      id, title: title.trim(), path: `stories/${id}`,
      chapters: [], createdAt: now(), updatedAt: now(),
    };
    updateManifest([...stories, story]);
  }, [stories, updateManifest, requestText]);

  const createChapter = useCallback(async (storyId: string) => {
    const title = await requestText('Chapter title:');
    if (!title?.trim()) return;
    const id = generateId();
    const chapter: Chapter = {
      id, title: title.trim(),
      path: `stories/${storyId}/chapters/${id}`,
      order: stories.find((s) => s.id === storyId)?.chapters.length ?? 0,
      scenes: [], createdAt: now(), updatedAt: now(),
    };
    updateManifest(stories.map((s) =>
      s.id !== storyId ? s : { ...s, chapters: [...s.chapters, chapter] }
    ));
  }, [stories, updateManifest, requestText]);

  const handleSelectScene = useCallback((scene: Scene, chapter: Chapter, story: Story) => {
    setSelectedScene(scene);
    setSelectedChapter(chapter);
    setSelectedStory(story);
    setSelectedEntity(null);
    setOpenedNotePath(null);
    setVaultContext('file');
    editorApiRef.current?.focus();
    setTimeout(() => {
      if (document.activeElement?.classList.contains('vb-rename-input')) return;
      editorApiRef.current?.focus();
    }, 0);
    if (!restoreInProgressRef.current) {
      // User-initiated open: clear any pending cursor restore and reset cursor to 0
      pendingCursorPosRef.current = null;
      // SKY-130: persist the newly active scene (cursor will be updated as user types/scrolls)
      window.api.sessionSaveScene({
        sceneId: scene.id,
        scenePath: scene.path,
        scrollTop: 0,
        cursorLine: 0,
      }).catch(() => {});
    }
  }, []);

  const createScene = useCallback(async (storyId: string, chapterId: string) => {
    const title = await requestText('Scene title:');
    if (!title?.trim()) return;
    const id = generateId();
    const story = stories.find((s) => s.id === storyId)!;
    const chapter = story.chapters.find((c) => c.id === chapterId)!;
    const scene: Scene = {
      id, title: title.trim(),
      path: `stories/${storyId}/chapters/${chapterId}/scenes/${id}.md`,
      order: chapter.scenes.length, chapterId, storyId,
      blocks: [], draftState: 'in-progress',
      createdAt: now(), updatedAt: now(),
    };
    updateManifest(stories.map((s) =>
      s.id !== storyId ? s : {
        ...s,
        chapters: s.chapters.map((ch) =>
          ch.id !== chapterId ? ch : { ...ch, scenes: [...ch.scenes, scene] }
        ),
      }
    ));
    // Auto-navigate to the newly created scene so the editor opens immediately.
    handleSelectScene(scene, chapter, story);
    setViewDepth('scene');
    window.api?.writeVault?.(scene.path, blocksToMarkdown(scene)).catch(() => {});
  }, [stories, updateManifest, requestText, handleSelectScene]);

  const handleReorderScenes = useCallback((storyId: string, chapterId: string, orderedIds: string[]) => {
    const updatedStories = stories.map((s) =>
      s.id !== storyId ? s : {
        ...s,
        chapters: s.chapters.map((ch) =>
          ch.id !== chapterId ? ch : {
            ...ch,
            scenes: orderedIds.map((id, idx) => {
              const scene = ch.scenes.find((sc) => sc.id === id)!;
              return { ...scene, order: idx };
            }),
          }
        ),
      }
    );
    updateManifest(updatedStories);
  }, [stories, updateManifest]);

  const handleMoveScene = useCallback((
    storyId: string,
    sceneId: string,
    fromChapterId: string,
    toChapterId: string,
    insertBeforeSceneId: string | null,
  ) => {
    const updatedStories = stories.map((s) => {
      if (s.id !== storyId) return s;
      const fromChapter = s.chapters.find((c) => c.id === fromChapterId);
      if (!fromChapter) return s;
      const scene = fromChapter.scenes.find((sc) => sc.id === sceneId);
      if (!scene) return s;
      const updatedChapters = s.chapters.map((ch) => {
        if (ch.id === fromChapterId) {
          const remaining = ch.scenes
            .filter((sc) => sc.id !== sceneId)
            .map((sc, idx) => ({ ...sc, order: idx }));
          return { ...ch, scenes: remaining };
        }
        if (ch.id === toChapterId) {
          const withoutScene = ch.scenes.filter((sc) => sc.id !== sceneId);
          const insertIdx = insertBeforeSceneId
            ? withoutScene.findIndex((sc) => sc.id === insertBeforeSceneId)
            : withoutScene.length;
          const idx = insertIdx === -1 ? withoutScene.length : insertIdx;
          const updatedScene = { ...scene, chapterId: toChapterId, order: idx };
          const newScenes = [
            ...withoutScene.slice(0, idx),
            updatedScene,
            ...withoutScene.slice(idx),
          ].map((sc, i) => ({ ...sc, order: i }));
          return { ...ch, scenes: newScenes };
        }
        return ch;
      });
      return { ...s, chapters: updatedChapters };
    });
    updateManifest(updatedStories);
  }, [stories, updateManifest]);

  // SKY-127: Update window chrome neon border context based on selected vault item
  useEffect(() => {
    if (vaultContext) {
      document.documentElement.setAttribute('data-context', vaultContext);
    } else {
      document.documentElement.removeAttribute('data-context');
    }
  }, [vaultContext]);

  // Insert final voice transcripts into the active editor
  useEffect(() => {
    if (!window.api.onVoiceTranscript) return;
    return window.api.onVoiceTranscript(({ text, isFinal }) => {
      if (isFinal && text.trim()) editorApiRef.current?.insertText(text.trim() + ' ');
    });
  }, []);

  // Voice toggle / push-to-talk keyboard shortcut: Ctrl+Shift+M
  useEffect(() => {
    if (!appSettings?.voice?.enabled) return;
    const pttMode = appSettings.voice.pushToTalkMode ?? false;

    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || !e.shiftKey || (e.key !== 'M' && e.key !== 'm')) return;
      e.preventDefault();
      if (pttMode) {
        if (!voicePttActiveRef.current) {
          voicePttActiveRef.current = true;
          startVoice();
        }
      } else {
        if (voiceSessionRef.current) stopVoice(); else startVoice();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (!pttMode || !voicePttActiveRef.current) return;
      // Stop on release of any key in the combo
      if (e.key === 'M' || e.key === 'm' || e.key === 'Control' || e.key === 'Meta' || e.key === 'Shift') {
        stopVoice();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [appSettings?.voice?.enabled, appSettings?.voice?.pushToTalkMode, startVoice, stopVoice]);

  // Cleanup any active voice session on unmount
  useEffect(() => () => { stopVoice(); }, [stopVoice]);

  // SKY-130: restore last-opened scene + cursor after vault loads
  useEffect(() => {
    if (loading || sceneRestoreAttemptedRef.current) return;
    if (!appSettings?.lastOpenedScene || stories.length === 0) return;
    sceneRestoreAttemptedRef.current = true;
    const { sceneId, cursorLine } = appSettings.lastOpenedScene;
    for (const story of stories) {
      for (const chapter of story.chapters) {
        const scene = chapter.scenes.find((sc) => sc.id === sceneId);
        if (scene) {
          restoreInProgressRef.current = true;
          pendingCursorPosRef.current = cursorLine;
          handleSelectScene(scene, chapter, story);
          restoreInProgressRef.current = false;
          return;
        }
      }
    }
    // Scene not found (deleted/moved) — silently skip per spec
  }, [loading, appSettings, stories, handleSelectScene]);

  // SKY-206: keep outline highlight in sync with the active scene (immediate on selection change)
  // SKY-130: debounced cursor persistence as user types/navigates
  const handleCursorPosChange = useCallback((pos: number) => {
    if (!selectedScene) return;
    if (saveCursorDebounceRef.current) clearTimeout(saveCursorDebounceRef.current);
    saveCursorDebounceRef.current = setTimeout(() => {
      window.api.sessionSaveScene({
        sceneId: selectedScene.id,
        scenePath: selectedScene.path,
        scrollTop: 0,
        cursorLine: pos,
      }).catch(() => {});
    }, 1000);
  }, [selectedScene]);

  // Navigate to a scene from a backlink click by looking it up by path in the loaded stories.
  // If no scene matches, treat the path as a vault note and open it in the NoteViewer (SKY-204).
  const handleOpenSceneByPath = useCallback((scenePath: string) => {
    for (const story of stories) {
      for (const chapter of story.chapters) {
        const scene = chapter.scenes.find((sc) => sc.path === scenePath);
        if (scene) {
          setOpenedNotePath(null);
          handleSelectScene(scene, chapter, story);
          return;
        }
      }
    }
    // Not a story scene — open as a vault note.
    setSelectedScene(null);
    setSelectedChapter(null);
    setSelectedStory(null);
    setSelectedEntity(null);
    setOpenedNotePath(scenePath);
    checkGettingStartedItem('notes-vault');
  }, [stories, handleSelectScene, checkGettingStartedItem]);

  // SKY-795 §4 — Enter key on the timeline jumps into the editor for the focused scene.
  const handleOpenSceneById = useCallback((sceneId: string) => {
    for (const story of stories) {
      for (const chapter of story.chapters) {
        const scene = chapter.scenes.find((sc) => sc.id === sceneId);
        if (scene) {
          setOpenedNotePath(null);
          handleSelectScene(scene, chapter, story);
          setView('editor');
          return;
        }
      }
    }
  }, [stories, handleSelectScene]);

  const handleSelectEntity = useCallback((entity: EntityEntry) => {
    setSelectedEntity(entity);
    setSelectedScene(null);
    setSelectedChapter(null);
    setSelectedStory(null);
    if (entity.type === 'character') checkGettingStartedItem('add-character');
  }, [checkGettingStartedItem]);

  // SKY-616: navigate to entity page when user clicks an @-mention chip
  const handleEntityMentionClick = useCallback((entityId: string) => {
    window.api.entityRead(entityId).then((entity) => {
      if (entity) {
        setSelectedEntity(entity);
        setSelectedScene(null);
        setSelectedChapter(null);
        setSelectedStory(null);
        if (entity.type === 'character') checkGettingStartedItem('add-character');
      }
    }).catch(() => {});
  }, [checkGettingStartedItem]);

  const handleSearchNavigate = useCallback((result: SearchResultItem) => {
    if (result.vault === 'story') {
      // Navigate to scene by docId
      for (const story of stories) {
        for (const chapter of story.chapters) {
          const scene = chapter.scenes.find((sc) => sc.id === result.docId);
          if (scene) {
            handleSelectScene(scene, chapter, story);
            setView('editor');
            return;
          }
        }
      }
    } else {
      // Navigate to entity by docId — look up in manifest entities
      window.api?.entityRead(result.docId)
        .then((entry: EntityEntry | null) => {
          if (entry) {
            handleSelectEntity(entry);
            setView('editor');
          }
        })
        .catch(() => {});
    }
  }, [stories, handleSelectScene, handleSelectEntity]);

  // SKY-1695: Renders any sidebar panel's content. Both sidebars call this so
  // panels render correctly regardless of which sidebar they live in.
  const renderSidebarPanel = useCallback((id: SidebarPanelId): ReactNode => {
    const showTemplateCta =
      appSettings?.onboardingStartMode === 'blank' &&
      !(gettingStartedProgress?.completedItems.includes('write-scene'));
    switch (id) {
      case 'stories':
        return (
          <StoryNavigator
            stories={stories}
            selectedSceneId={selectedScene?.id ?? null}
            onSelectScene={(sc, ch, st) => { handleSelectScene(sc, ch, st); setViewDepth('scene'); }}
            onCreateStory={createStory}
            onCreateChapter={createChapter}
            onCreateScene={createScene}
            onReorderScenes={handleReorderScenes}
            showTemplateCta={showTemplateCta}
            onTemplateCtaClick={() => setTemplatePickerOpen(true)}
          />
        );
      case 'entities':
        return (
          <EntityBrowser
            onSelectEntity={handleSelectEntity}
            selectedEntityId={selectedEntity?.id ?? null}
            onEntityCreated={(entity) => {
              if (entity.type === 'character' && gettingStartedProgress) {
                persistGettingStartedProgress(gettingStartedReducer(gettingStartedProgress, { type: 'CHECK_ITEM', itemId: 'add-character' }));
              }
            }}
          />
        );
      case 'vault':
        return (
          <VaultBrowser
            stories={stories}
            selectedSceneId={selectedScene?.id ?? null}
            onSelectScene={(sc, ch, st) => { handleSelectScene(sc, ch, st); setViewDepth('scene'); }}
            onCreateStory={createStory}
            onCreateChapter={createChapter}
            onCreateScene={createScene}
            onOpenFile={handleOpenSceneByPath}
            onContextChange={setVaultContext}
            onExport={(scope: ExportScope) => setExportScope(scope)}
            journalModeEnabled={appSettings?.journalMode?.enabled ?? false}
          />
        );
      case 'review':
        return <SuggestionReview onOpenVaultPath={handleOpenSceneByPath} />;
      case 'progress':
        return <ProgressDashboard stories={stories} />;
      case 'writing-assistant':
        return (
          <WritingAssistantPanel
            scene={selectedScene}
            enabled={appSettings?.agents?.writingAssistant?.enabled ?? true}
            scanIntervalSeconds={appSettings?.agents?.writingAssistant?.scanIntervalSeconds ?? 30}
            waScanInterval={appSettings?.waScanInterval}
            cadenceTrigger={appSettings?.agents?.writingAssistant?.cadenceTrigger}
            idleHeartbeatConstantInterval={appSettings?.agents?.writingAssistant?.idleHeartbeatConstantInterval}
            idleDebounceSeconds={appSettings?.agents?.writingAssistant?.idleDebounceSeconds}
            isActive={view === 'editor'}
            isPageFocused={view === 'editor'}
            onJumpToText={handleJumpToText}
          />
        );
      case 'archive-continuity':
        return (
          <ContinuityPanel
            scene={selectedScene}
            enabled={appSettings?.agents?.archive?.enabled ?? true}
            archiveScanScope={appSettings?.archiveScanScope ?? 'active_scene'}
            archiveStoryEditConsentGiven={appSettings?.archiveStoryEditConsentGiven ?? false}
            onCountChange={setContinuityCount}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        );
      case 'scene-preview':
        return (
          <ScenePreviewPanel
            scene={selectedScene}
            chapter={selectedChapter}
            story={selectedStory}
          />
        );
      default:
        return null;
    }
  }, [
    stories, selectedScene, selectedEntity, selectedChapter, selectedStory,
    handleSelectScene, setViewDepth, createStory, createChapter, createScene,
    handleReorderScenes, setTemplatePickerOpen, handleSelectEntity,
    gettingStartedProgress, persistGettingStartedProgress,
    handleOpenSceneByPath, setVaultContext, setExportScope, appSettings,
    view, handleJumpToText,
    setContinuityCount, setSettingsOpen,
  ]);

  const handleNavigateScene = useCallback((direction: 'prev' | 'next') => {
    if (!selectedStory || !selectedScene) return;
    const allScenes: { scene: Scene; chapter: Chapter }[] = [];
    for (const ch of [...selectedStory.chapters].sort((a, b) => a.order - b.order)) {
      for (const sc of [...ch.scenes].sort((a, b) => a.order - b.order)) {
        allScenes.push({ scene: sc, chapter: ch });
      }
    }
    const idx = allScenes.findIndex((s) => s.scene.id === selectedScene.id);
    const nextIdx = direction === 'prev' ? idx - 1 : idx + 1;
    if (nextIdx >= 0 && nextIdx < allScenes.length) {
      const { scene, chapter } = allScenes[nextIdx];
      handleSelectScene(scene, chapter, selectedStory);
    }
  }, [selectedStory, selectedScene, handleSelectScene]);

  // ─── Header depth slider navigation (MYT-378) ───

  const depthCanPrev = useMemo(() => {
    if (!selectedStory) return false;
    if (viewDepth === 'scene') {
      if (!selectedChapter || !selectedScene) return false;
      const sorted = [...selectedChapter.scenes].sort((a, b) => a.order - b.order);
      return sorted.findIndex((s) => s.id === selectedScene.id) > 0;
    }
    if (viewDepth === 'chapter') {
      if (!selectedChapter) return false;
      const sorted = [...selectedStory.chapters].sort((a, b) => a.order - b.order);
      return sorted.findIndex((c) => c.id === selectedChapter.id) > 0;
    }
    return stories.findIndex((s) => s.id === selectedStory.id) > 0;
  }, [viewDepth, selectedScene, selectedChapter, selectedStory, stories]);

  const depthCanNext = useMemo(() => {
    if (!selectedStory) return false;
    if (viewDepth === 'scene') {
      if (!selectedChapter || !selectedScene) return false;
      const sorted = [...selectedChapter.scenes].sort((a, b) => a.order - b.order);
      const idx = sorted.findIndex((s) => s.id === selectedScene.id);
      return idx >= 0 && idx < sorted.length - 1;
    }
    if (viewDepth === 'chapter') {
      if (!selectedChapter) return false;
      const sorted = [...selectedStory.chapters].sort((a, b) => a.order - b.order);
      const idx = sorted.findIndex((c) => c.id === selectedChapter.id);
      return idx >= 0 && idx < sorted.length - 1;
    }
    const idx = stories.findIndex((s) => s.id === selectedStory.id);
    return idx >= 0 && idx < stories.length - 1;
  }, [viewDepth, selectedScene, selectedChapter, selectedStory, stories]);

  const depthContextLabel = useMemo(() => {
    if (!selectedStory) return '';
    if (viewDepth === 'scene' && selectedChapter && selectedScene) {
      return `${selectedChapter.title} › ${selectedScene.title}`;
    }
    if (viewDepth === 'chapter' && selectedChapter) {
      return `${selectedStory.title} › ${selectedChapter.title}`;
    }
    return selectedStory.title;
  }, [viewDepth, selectedScene, selectedChapter, selectedStory]);

  // §6: empty state — depth=scene but selected chapter has no scenes
  const depthIsEmpty = useMemo(
    () => viewDepth === 'scene' && selectedChapter !== null && selectedChapter.scenes.length === 0,
    [viewDepth, selectedChapter],
  );

  const handleDepthPrev = useCallback(() => {
    if (!selectedStory) return;
    if (viewDepth === 'scene') {
      if (!selectedChapter || !selectedScene) return;
      const sorted = [...selectedChapter.scenes].sort((a, b) => a.order - b.order);
      const idx = sorted.findIndex((s) => s.id === selectedScene.id);
      if (idx > 0) handleSelectScene(sorted[idx - 1], selectedChapter, selectedStory);
    } else if (viewDepth === 'chapter') {
      if (!selectedChapter) return;
      const sorted = [...selectedStory.chapters].sort((a, b) => a.order - b.order);
      const idx = sorted.findIndex((c) => c.id === selectedChapter.id);
      if (idx > 0) {
        const prev = sorted[idx - 1];
        const firstScene = [...prev.scenes].sort((a, b) => a.order - b.order)[0];
        if (firstScene) {
          handleSelectScene(firstScene, prev, selectedStory);
        } else {
          setSelectedScene(null);
          setSelectedChapter(prev);
          setSelectedEntity(null);
        }
      }
    } else {
      const idx = stories.findIndex((s) => s.id === selectedStory.id);
      if (idx > 0) {
        const prev = stories[idx - 1];
        const firstCh = [...prev.chapters].sort((a, b) => a.order - b.order)[0];
        const firstSc = firstCh ? [...firstCh.scenes].sort((a, b) => a.order - b.order)[0] : null;
        if (firstSc && firstCh) {
          handleSelectScene(firstSc, firstCh, prev);
        } else if (firstCh) {
          setSelectedScene(null);
          setSelectedChapter(firstCh);
          setSelectedStory(prev);
          setSelectedEntity(null);
        } else {
          setSelectedScene(null);
          setSelectedChapter(null);
          setSelectedStory(prev);
          setSelectedEntity(null);
        }
      }
    }
  }, [viewDepth, selectedScene, selectedChapter, selectedStory, stories, handleSelectScene]);

  const handleDepthNext = useCallback(() => {
    if (!selectedStory) return;
    if (viewDepth === 'scene') {
      if (!selectedChapter || !selectedScene) return;
      const sorted = [...selectedChapter.scenes].sort((a, b) => a.order - b.order);
      const idx = sorted.findIndex((s) => s.id === selectedScene.id);
      if (idx >= 0 && idx < sorted.length - 1) handleSelectScene(sorted[idx + 1], selectedChapter, selectedStory);
    } else if (viewDepth === 'chapter') {
      if (!selectedChapter) return;
      const sorted = [...selectedStory.chapters].sort((a, b) => a.order - b.order);
      const idx = sorted.findIndex((c) => c.id === selectedChapter.id);
      if (idx >= 0 && idx < sorted.length - 1) {
        const next = sorted[idx + 1];
        const firstScene = [...next.scenes].sort((a, b) => a.order - b.order)[0];
        if (firstScene) {
          handleSelectScene(firstScene, next, selectedStory);
        } else {
          setSelectedScene(null);
          setSelectedChapter(next);
          setSelectedEntity(null);
        }
      }
    } else {
      const idx = stories.findIndex((s) => s.id === selectedStory.id);
      if (idx >= 0 && idx < stories.length - 1) {
        const next = stories[idx + 1];
        const firstCh = [...next.chapters].sort((a, b) => a.order - b.order)[0];
        const firstSc = firstCh ? [...firstCh.scenes].sort((a, b) => a.order - b.order)[0] : null;
        if (firstSc && firstCh) {
          handleSelectScene(firstSc, firstCh, next);
        } else if (firstCh) {
          setSelectedScene(null);
          setSelectedChapter(firstCh);
          setSelectedStory(next);
          setSelectedEntity(null);
        } else {
          setSelectedScene(null);
          setSelectedChapter(null);
          setSelectedStory(next);
          setSelectedEntity(null);
        }
      }
    }
  }, [viewDepth, selectedScene, selectedChapter, selectedStory, stories, handleSelectScene]);

  const handleViewDepthChange = useCallback((newDepth: ViewDepth) => {
    setViewDepth(newDepth);
    if (newDepth === 'scene' && !selectedScene && selectedChapter && selectedStory) {
      const first = [...selectedChapter.scenes].sort((a, b) => a.order - b.order)[0];
      if (first) handleSelectScene(first, selectedChapter, selectedStory);
    }
  }, [selectedScene, selectedChapter, selectedStory, handleSelectScene]);

  if (loading) {
    return (
      <div className="shell-loading">
        <div className="shell-loading-inner">
          <div className="shell-loading-spinner" />
          <p>Loading your vault…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="shell-error">
        <p>{error}</p>
      </div>
    );
  }

  const agentFlags = {
    writingAssistant: appSettings?.agents?.writingAssistant?.enabled ?? true,
    brainstorm: appSettings?.agents?.brainstorm?.enabled ?? true,
    archive: appSettings?.agents?.archive?.enabled ?? true,
  };

  const writingMode: WritingMode = layout.writingMode ?? 'normal';
  const focusPrefs: FocusPrefs = {
    showLeftSidebar: false, showRightSidebar: false, showBottomBar: false,
    showTitleBar: true, showStatusBar: true, showTabBar: true,
    showSidebarButtons: true, showScrollbars: true, showFileTreeArrows: true,
    ...layout.focusPrefs,
  };
  const inFocusOrDF = writingMode === 'focus' || distractionFree;
  const showLeftSidebar = !distractionFree && (writingMode !== 'focus' || focusPrefs.showLeftSidebar);
  // SKY-1694: rightSidebarUserCollapsed allows Ctrl+] to toggle right sidebar independently of focus mode
  const showRightSidebar = !distractionFree && !rightSidebarUserCollapsed && (writingMode !== 'focus' || focusPrefs.showRightSidebar);
  const showBottomBar = !distractionFree && (writingMode !== 'focus' || focusPrefs.showBottomBar);
  const showTitleBar = !distractionFree && (writingMode !== 'focus' || focusPrefs.showTitleBar);
  const showTabBar = !distractionFree && (writingMode !== 'focus' || focusPrefs.showTabBar);
  const showStatusOverlay = distractionFree && focusPrefs.showStatusBar;

  const focusWordCount = selectedScene
    ? selectedScene.blocks.map(b => b.content.trim().split(/\s+/).filter(Boolean).length).reduce((a, c) => a + c, 0)
    : 0;
  const focusReadingMinutes = Math.max(1, Math.round(focusWordCount / 238));

  const shellClasses = [
    'desktop-shell',
    `writing-mode-${writingMode}`,
    distractionFree && 'distraction-free',
    inFocusOrDF && !focusPrefs.showSidebarButtons && 'focus-hide-sidebar-btns',
    inFocusOrDF && !focusPrefs.showScrollbars && 'focus-hide-scrollbars',
    inFocusOrDF && !focusPrefs.showFileTreeArrows && 'focus-hide-tree-arrows',
  ].filter(Boolean).join(' ');

  return (
    <PanelDragProvider onDrop={handlePanelDrop}>
    <div className={shellClasses}>
      <UpdateBanner />
      {showTitleBar && (
        <AppMenuBar
          view={view}
          onSetView={setView}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenHistory={() => setHistoryOpen(true)}
          onSearchNavigate={handleSearchNavigate}
          selectedStoryId={selectedStory?.id ?? null}
          activeVaultRoot={activeVaultRoot}
          onProjectSwitched={handleProjectSwitched}
          writingMode={writingMode}
          onSetWritingMode={setWritingMode}
          onOpenFocusPrefs={() => setFocusModePrefsOpen(true)}
          onOpenKeyboardShortcuts={() => setShortcutsOpen(true)}
          onToggleDistractionFree={toggleDistractionFree}
          onOpenTour={() => setTourOpen(true)}
          onOpenExport={(scope: ExportScope) => setExportScope(scope)}
          requestText={requestText}
        />
      )}
      {showStatusOverlay && (
        <FocusModeOverlay
          wordCount={focusWordCount}
          readingMinutes={focusReadingMinutes}
          saveState={saveState}
        />
      )}
      {settingsOpen && (
        <SettingsPanel
          onClose={() => setSettingsOpen(false)}
          onSaved={(s) => {
            setAppSettings(s);
            applyTheme(s.theme);
            applyLiquidNeonTokens(s.liquidNeon);
          }}
          focusPrefs={focusPrefs}
          onFocusPrefsChange={(prefs) => persistLayout({ ...layout, focusPrefs: prefs })}
        />
      )}
      {historyOpen && (
        <PromptHistoryPanel onClose={() => setHistoryOpen(false)} />
      )}
      {focusModePrefsOpen && (
        <FocusModePrefsDialog
          prefs={focusPrefs}
          onChange={(prefs) => persistLayout({ ...layout, focusPrefs: prefs })}
          onClose={() => setFocusModePrefsOpen(false)}
        />
      )}
      {shortcutsOpen && (
        <KeyboardShortcutsDialog onClose={() => setShortcutsOpen(false)} />
      )}
      {tourOpen && (
        <TourModal onClose={() => setTourOpen(false)} />
      )}
      {exportScope && <ExportDialog scope={exportScope} stories={stories} onClose={() => setExportScope(null)} />}
      {templatePickerOpen && (
        <TemplatePicker
          onApplied={() => { setTemplatePickerOpen(false); }}
          onClose={() => setTemplatePickerOpen(false)}
        />
      )}
      {/* SKY-1686: shell-main-row wraps all view-specific content + global right sidebar */}
      <div className="shell-main-row">
      {view === 'brainstorm' && (
        <BrainstormPage
          onClose={() => setView('editor')}
          enabled={agentFlags.brainstorm}
          onFirstSubmit={() => checkGettingStartedItem('brainstorm')}
          onNavigateToEntity={(entityId) => {
            window.api.entityRead(entityId).then((entity) => {
              if (entity) {
                setSelectedEntity(entity);
                setView('editor');
              }
            }).catch(() => {});
          }}
          onNavigateToScene={async (sceneId) => {
            for (const story of stories) {
              for (const chapter of story.chapters) {
                const scene = chapter.scenes.find((sc) => sc.id === sceneId);
                if (scene) {
                  handleSelectScene(scene, chapter, story);
                  setView('editor');
                  return true;
                }
              }
            }
            return false;
          }}
        />
      )}
      {view === 'entries' && (
        <div className="shell-entries">
          <EntriesPanel storyTitle={selectedStory?.title ?? ''} />
        </div>
      )}
      {view === 'kanban' && (
        <div className="shell-kanban">
          {selectedStory ? (
            <KanbanBoard
              key={selectedStory.id}
              boardPath={`${selectedStory.path}/kanban.md`}
              storyTitle={selectedStory.title}
            />
          ) : (
            <div className="shell-editor-empty">
              <div className="shell-editor-empty-icon">🗂️</div>
              <h2>No Story Selected</h2>
              <p>Select a story from the Editor view to open its Scene Board.</p>
            </div>
          )}
        </div>
      )}
      {view === 'graph' && (
        <div className="shell-graph">
          <VaultGraphView onOpenNote={handleOpenSceneByPath} />
        </div>
      )}
      {view === 'timeline' && (
        <div className="shell-timeline">
          <TimelineSpreadsheet story={selectedStory} onOpenScene={handleOpenSceneById} />
        </div>
      )}
      {view === 'structure' && (
        <div className="shell-structure">
          <ManuscriptStructureView
            story={selectedStory ?? null}
            onSelectScene={(scene, chapter, story) => {
              handleSelectScene(scene, chapter, story);
              setView('editor');
            }}
            onReorderScenes={handleReorderScenes}
            onMoveScene={handleMoveScene}
            onCreateScene={createScene}
            onCreateChapter={createChapter}
            vaultRoot={activeVaultRoot}
          />
        </div>
      )}
      {view === 'editor' && <div className="shell-panels">
      {/* Left rail */}
      {showLeftSidebar && (
        <div className="shell-left" style={{ width: layout.leftWidth }}>
          <LeftRail
            activeView={view}
            onViewChange={(v) => setView(v)}
            leftSidebarLayout={leftSidebarLayout}
            onLeftSidebarLayoutChange={persistLeftSidebarLayout}
            renderPanelContent={renderSidebarPanel}
            rightPanelCount={grsPanels.length}
          />
        </div>
      )}

      {/* Left resize handle */}
      {showLeftSidebar && (
        <div
          role="separator"
          aria-label="Resize left panel"
          aria-orientation="vertical"
          aria-valuenow={layout.leftWidth}
          aria-valuemin={160}
          aria-valuemax={500}
          tabIndex={0}
          className="shell-divider shell-divider-left"
          onMouseDown={(e) => startDrag('left', e)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') { e.preventDefault(); adjustPanelWidth('left', +8); }
            else if (e.key === 'ArrowLeft') { e.preventDefault(); adjustPanelWidth('left', -8); }
            else if (e.key === 'Home') { e.preventDefault(); persistLayout({ ...layout, leftWidth: 160 }); }
            else if (e.key === 'End') { e.preventDefault(); persistLayout({ ...layout, leftWidth: 500 }); }
          }}
        />
      )}

      {/* Center + bottom */}
      <div className="shell-center-column">
        <div className="shell-editor">
          {selectedStory && showTabBar && (
            <DepthSlider
              depth={viewDepth}
              onDepthChange={handleViewDepthChange}
              canPrev={depthCanPrev}
              canNext={depthCanNext}
              onPrev={handleDepthPrev}
              onNext={handleDepthNext}
              contextLabel={depthContextLabel}
              writingMode={writingMode}
              isEmpty={depthIsEmpty}
            />
          )}
          {viewDepth === 'book' && selectedStory ? (
            <BookOutlineView
              story={selectedStory}
              selectedChapterId={selectedChapter?.id ?? null}
              selectedSceneId={selectedScene?.id ?? null}
              onSelectScene={(sc, ch) => {
                handleSelectScene(sc, ch, selectedStory);
                setViewDepth('scene');
              }}
            />
          ) : viewDepth === 'chapter' && selectedChapter ? (
            <ChapterDocView
              chapter={selectedChapter}
              selectedSceneId={selectedScene?.id ?? null}
              onSelectScene={(sc) => {
                if (selectedStory) {
                  handleSelectScene(sc, selectedChapter, selectedStory);
                  setViewDepth('scene');
                }
              }}
            />
          ) : selectedScene ? (
            <div className="shell-editor-scene-wrap">
              <div className="scene-snapshot-toolbar">
                <button
                  className="scene-snapshot-save"
                  onClick={handleManualSnapshot}
                >
                  Save snapshot now
                </button>
                <span className="scene-autosave" aria-live="polite">
                  {snapshotSavedAt ? `Snapshot saved ${snapshotSavedAt}` : ''}
                </span>
                <button
                  className="btn-history"
                  onClick={() => setShowSceneHistory(true)}
                  aria-label="Open scene history"
                >
                  History
                </button>
              </div>
              <div className={`shell-editor-beta-wrap${isGettingStartedVisible(gettingStartedProgress) && !seenEmptySceneHints.has(selectedScene.id) ? ' shell-editor-beta-wrap--hint' : ''}`}>
                <BlockEditor
                  key={`${selectedScene.id}-${restoreKey}`}
                  scene={selectedScene}
                  onBlocksChange={handleBlocksChange}
                  onDraftStateChange={handleDraftStateChange}
                  onEditorReady={handleEditorReady}
                  onBetaReadRequest={handleBetaReadRequest}
                  wikiLinkSuggestions={wikiLinkSuggestions}
                  onAcceptWikiLink={handleEditorAcceptWikiLink}
                  onRejectWikiLink={handleEditorRejectWikiLink}
                  autoLinkerEntities={allEntities}
                  autoLinkerMode={appSettings?.autoLinker?.mode ?? 'suggest'}
                  initialCursorPos={pendingCursorPosRef.current ?? undefined}
                  onCursorPosChange={handleCursorPosChange}
                  onEntityClick={handleEntityMentionClick}
                  emptySceneHint={
                    isGettingStartedVisible(gettingStartedProgress) &&
                    !seenEmptySceneHints.has(selectedScene.id)
                      ? 'Start writing here, or open Brainstorm (Ctrl+B) to spark ideas.'
                      : ''
                  }
                />
                {(betaReadComments.length > 0 || betaReadLoading) && (
                  <div className="shell-beta-margin">
                    {betaReadLoading && (
                      <div className="br-loading" aria-live="polite">
                        <span className="wa-spinner" aria-hidden="true" />
                        Reading…
                      </div>
                    )}
                    <BetaReadMargin
                      comments={betaReadComments}
                      onDismiss={handleBetaReadDismiss}
                    />
                  </div>
                )}
              </div>
              {showSceneHistory && (
                <SceneHistory
                  sceneId={selectedScene.id}
                  scenePath={selectedScene.path}
                  currentContent={selectedScene.blocks.map(b => b.content).join('\n\n')}
                  onRestore={handleSceneRestore}
                  onClose={() => setShowSceneHistory(false)}
                />
              )}
            </div>
          ) : selectedEntity ? (
            <EntityDetail
              key={selectedEntity.id}
              entity={selectedEntity}
              onClose={() => setSelectedEntity(null)}
              onUpdated={(updated) => setSelectedEntity(updated)}
              onDeleted={() => setSelectedEntity(null)}
              onOpenScene={handleOpenSceneByPath}
            />
          ) : openedNotePath ? (
            // SKY-204: vault note viewer (daily notes and any other .md file)
            <NoteViewer
              key={openedNotePath}
              path={openedNotePath}
              onWordCountChange={setOpenedNoteWordCount}
              onClose={() => setOpenedNotePath(null)}
            />
          ) : (
            <div className="shell-editor-empty">
              <div className="shell-editor-empty-icon">✍️</div>
              <h2>Welcome to Mythos Writer</h2>
              {stories.length === 0 ? (
                <>
                  <p>Create your first story to begin writing.</p>
                  <button
                    className="shell-editor-empty-cta"
                    onClick={createStory}
                    data-testid="shell-empty-new-story"
                  >
                    New Story
                  </button>
                </>
              ) : (
                <>
                  <p>Select a scene from the left panel to start writing.</p>
                  <PaneTip
                    tipKey="editor"
                    text="Tip: Use Ctrl+Shift+F for distraction-free Focus mode, and press ? to see all keyboard shortcuts."
                    seen={seenTips['editor'] ?? false}
                    onDismiss={handleDismissTip}
                  />
                </>
              )}
            </div>
          )}
        </div>
        {showBottomBar && (
          <BottomBar
            selectedScene={selectedScene}
            selectedChapter={selectedChapter}
            selectedStory={selectedStory}
            onNavigateScene={handleNavigateScene}
            activeNotePath={openedNotePath}
            activeNoteWordCount={openedNoteWordCount}
            isVoiceActive={voiceActive}
          />
        )}
      </div>

      {/* Right resize handle */}
      {showRightSidebar && (
        <div
          role="separator"
          aria-label="Resize right panel"
          aria-orientation="vertical"
          aria-valuenow={layout.rightWidth}
          aria-valuemin={160}
          aria-valuemax={500}
          tabIndex={0}
          className="shell-divider shell-divider-right"
          onMouseDown={(e) => startDrag('right', e)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') { e.preventDefault(); adjustPanelWidth('right', +8); }
            else if (e.key === 'ArrowRight') { e.preventDefault(); adjustPanelWidth('right', -8); }
            else if (e.key === 'Home') { e.preventDefault(); persistLayout({ ...layout, rightWidth: 160 }); }
            else if (e.key === 'End') { e.preventDefault(); persistLayout({ ...layout, rightWidth: 500 }); }
          }}
        />
      )}

      {/* Right sidebar */}
      {showRightSidebar && (
        <div className="shell-right" style={{ width: layout.rightWidth }}>
          <RightSidebar
            activeTab={layout.rightTab}
            onTabChange={(tab) => persistLayout({ ...layout, rightTab: tab })}
            selectedScene={selectedScene}
            selectedChapter={selectedChapter}
            selectedStory={selectedStory}
            writingAssistantEnabled={agentFlags.writingAssistant}
            archiveEnabled={agentFlags.archive}
            scanIntervalSeconds={appSettings?.agents?.writingAssistant?.scanIntervalSeconds ?? 30}
            waScanInterval={appSettings?.waScanInterval}
            cadenceTrigger={appSettings?.agents?.writingAssistant?.cadenceTrigger}
            idleHeartbeatConstantInterval={appSettings?.agents?.writingAssistant?.idleHeartbeatConstantInterval}
            idleDebounceSeconds={appSettings?.agents?.writingAssistant?.idleDebounceSeconds}
            isPageFocused={view === 'editor'}
            onJumpToText={handleJumpToText}
            onInsertWikiLink={handleInsertWikiLink}
            onWikiLinkSuggestionsChange={setWikiLinkSuggestions}
            onGettingStartedAction={handleGettingStartedAction}
            onDismissGettingStarted={handleDismissGettingStarted}
            onToggleGsCollapsed={handleToggleGsCollapsed}
            gettingStartedProgress={gettingStartedProgress}
            onSelectScene={(sc, ch) => {
              if (selectedStory) {
                handleSelectScene(sc, ch, selectedStory);
                setViewDepth('scene');
              }
            }}
            currentSceneContent={selectedScene?.blocks.map(b => b.content).join('\n\n') ?? ''}
            onDraftRestore={handleDraftRestore}
          />
        </div>
      )}
      </div>}{/* end shell-panels */}

      {/* SKY-1686: Global right sidebar — only rendered once rightSidebarVisible is known from settings.
           undefined = settings not yet loaded or not seeded → omit entirely so layout is unchanged.
           This prevents the collapsed-edge strip from narrowing sibling views (e.g. timeline) before
           settings arrive, which caused TC-TL-06 detail-card pointer-event regression. */}
      {grsVisible !== undefined && <GlobalRightSidebar
        visible={grsVisible as boolean}
        width={grsWidth}
        panels={grsPanels}
        onVisibilityChange={handleGrsVisibilityChange}
        onWidthChange={handleGrsWidthChange}
        onPanelsChange={handleGrsPanelsChange}
        renderPanelContent={renderSidebarPanel}
        continuityIssueCount={continuityCount}
        leftPanelCount={leftSidebarLayout.panels.length}
      />}

      </div>{/* end shell-main-row */}
      {budgetToast && (
        <div className="budget-toast" role="alert" aria-live="assertive">
          {budgetToast}
        </div>
      )}
      {voiceToast && (
        <div className="voice-toast" role="status" aria-live="polite">
          {voiceToast}
        </div>
      )}
      {voiceListening && (
        <div className="voice-listening-badge" role="status" aria-live="polite" aria-label="Voice input active">
          Listening…
        </div>
      )}
      <GlobalSearchPanel
        open={globalSearchOpen}
        defaultScope={view === 'editor' ? 'story' : view === 'brainstorm' ? 'notes' : 'both'}
        onNavigate={(result) => {
          handleSearchNavigate(result);
          setGlobalSearchOpen(false);
        }}
        onClose={() => setGlobalSearchOpen(false)}
      />
      {promptModal}
      {syncModalOpen && (
        <SyncConflictModal
          resolved={syncConflictResolved}
          lockfileConflict={syncLockfileConflict}
          onContinue={handleSyncConflictContinue}
        />
      )}
    </div>
    </PanelDragProvider>
  );
}
