import { useState, useEffect, useCallback, useRef, useMemo, useReducer, type ReactNode } from 'react';
import { useToast } from './hooks/useToast';
import { Toast } from './components/Toast/Toast';
import type { Story, Chapter, Scene, Block, Manifest, DraftState, LayoutPrefs, EntityEntry, WritingMode, FocusPrefs } from './types';
import FocusModePrefsDialog from './FocusModePrefsDialog';
import ExportDialog, { type ExportScope } from './ExportDialog';
import KeyboardShortcutsDialog from './KeyboardShortcutsDialog';
import { applyTheme, applyLiquidNeonTokens, applyPageBackgroundTokens } from './theme';
import LeftRail, { DEFAULT_LEFT_SIDEBAR_LAYOUT } from './LeftRail';
import BottomBar from './BottomBar';
import BlockEditor, { type BlockEditorApi } from './BlockEditor';
import NoteViewer from './NoteViewer';
import type { WLSuggestion } from './WikiLinkHintExtension';
import EntityDetail from './EntityDetail';
import SceneCrafterPage from './pages/SceneCrafter/SceneCrafterPage';
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
import { stepScene, computeStepState } from './stepScene';
import { useFocusMode } from './useFocusMode';
import { TOPBAR_HIDE_EVENT } from './useTopBarVisibility';
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
import DockedTabBar from './DockedTabBar';
import SplitEditorPane from './SplitEditorPane';
import TabBar from './TabBar';
import StorySubViewBar from './StorySubViewBar';
import NotesTabPanel from './NotesTabPanel';
import { resolveCrossTabLink, type CrossTabLinkMatch } from './crossTabLinkResolver';
import {
  tabbedShellReducer,
  DEFAULT_TABBED_SHELL_STATE,
  serializeTabbedShellState,
  deserializeTabbedShellState,
  type TabbedShellState,
} from './tabbedShellState';
import LayoutPicker from './LayoutPicker';
import LayoutManagerDialog from './LayoutManagerDialog';
import { getAllLayouts, mergeWithBuiltins, migrateV1Layout, snapshotCurrentLayout } from './WorkspaceLayoutManager';
// SKY-1695: Panel content components for the unified sidebar renderer
import StoryNavigator from './StoryNavigator';
import EntityBrowser from './EntityBrowser';
import SuggestionReview from './SuggestionReview';
import VaultBrowser from './components/VaultBrowser';
import ProgressDashboard from './ProgressDashboard';
import WritingAssistantPanel from './WritingAssistantPanel';
import ContinuityPanel from './ContinuityPanel';
import ContinuityPeekPanel from './components/ContinuityPanel/ContinuityPanel';
import ScenePreviewPanel from './ScenePreviewPanel';
import StoryTimeline from './StoryTimeline';
import AeonLaneView from './AeonLaneView';
import OutlinePlanningPanel from './OutlinePlanningPanel';
import SceneNotesPanel from './SceneNotesPanel';
import ScenePropertiesPanel from './ScenePropertiesPanel';
import WindowChrome from './components/ui/WindowChrome';
import BrainstormPage from './BrainstormPage';
import './DesktopShell.css';

const DEFAULT_LAYOUT: LayoutPrefs = {
  leftWidth: 240,
  rightWidth: 400,
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

interface SearchResultItem {
  docId: string;
  vault: 'story' | 'notes';
  kind: string;
  title: string;
  snippet: string;
  rank: number;
}

interface VaultBindingState {
  storyPath: string;
  notesPath: string;
  storyValid: boolean;
  notesValid: boolean;
}

const EMPTY_MANIFEST: Manifest = {
  version: '1',
  vaultRoot: '',
  stories: [],
  entities: [],
  suggestions: [],
  scenes: [],
  chapters: [],
};

function isValidVaultPath(result: { valid?: boolean; exists?: boolean; writable?: boolean; error?: string } | null | undefined): boolean {
  if (!result) return false;
  if (typeof result.valid === 'boolean') return result.valid;
  return Boolean(result.exists && result.writable && !result.error);
}

function labelFromPath(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

interface AppMenuBarProps {
  onOpenSettings: () => void;
  onOpenHistory: () => void;
  onSearchNavigate: (result: SearchResultItem) => void;
  selectedStoryId?: string | null;
  activeVaultRoot: string;
  onProjectSwitched: (vaultRoot: string) => void;
  onOpenKeyboardShortcuts: () => void;
  onToggleDistractionFree: () => void;
  /** SKY-3207 (B4): toggle the top bar hidden state. */
  onToggleTopBar: () => void;
  /** SKY-3207 (B4): current hidden state — drives the toggle button aria-label. */
  topBarHidden: boolean;
  onOpenTour: () => void;
  onOpenExport?: (scope: ExportScope) => void;
  requestText: (label: string) => Promise<string | null>;
  // SKY-1698 (Wave 2d): docked tab bar props
  dockedTabs: DockedTab[];
  activeDockedTabId: string | null;
  onDockedTabSelect: (tabId: string) => void;
  onDockedTabClose: (tabId: string, action: 'send-to-sidebar' | 'remove') => void;
  onDockedTabReorder: (fromIndex: number, toIndex: number) => void;
  dockedPanelIds: SidebarPanelId[];
  onAddPanelAsNewTab: (panelId: SidebarPanelId) => void;
}

// SKY-2964: writing-mode selector removed from AppMenuBar — canonical controls live in StorySubViewBar (above the page)
export function AppMenuBar({ onOpenSettings, onOpenHistory, onSearchNavigate, selectedStoryId, activeVaultRoot, onProjectSwitched, onOpenKeyboardShortcuts, onToggleDistractionFree, onToggleTopBar, topBarHidden, onOpenTour, onOpenExport, requestText, dockedTabs, activeDockedTabId, onDockedTabSelect, onDockedTabClose, onDockedTabReorder, dockedPanelIds, onAddPanelAsNewTab }: AppMenuBarProps) {
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
      {/* SKY-1698 (Wave 2d): custom panel tabs right of built-in tabs (AC-T-04) */}
      <DockedTabBar
        dockedTabs={dockedTabs}
        activeDockedTabId={activeDockedTabId}
        onTabSelect={onDockedTabSelect}
        onTabClose={onDockedTabClose}
        onTabReorder={onDockedTabReorder}
        dockedPanelIds={dockedPanelIds}
        onAddPanelAsNewTab={onAddPanelAsNewTab}
      />
      <button
        className="app-menu-topbar-btn"
        onClick={onToggleTopBar}
        aria-label={topBarHidden ? 'Show top bar' : 'Hide top bar'}
        title={`${topBarHidden ? 'Show' : 'Hide'} top bar (Ctrl+Shift+H)`}
        data-testid="toolbar-hide-topbar-btn"
      >
        ▲
      </button>
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
  // SKY-2966: stable ref so navigator sync callbacks don't re-subscribe on every render
  const storiesRef = useRef<Story[]>([]);
  storiesRef.current = stories;
  const [selectedScene, setSelectedScene] = useState<Scene | null>(null);
  const [selectedChapter, setSelectedChapter] = useState<Chapter | null>(null);
  const [selectedStory, setSelectedStory] = useState<Story | null>(null);
  const [selectedEntity, setSelectedEntity] = useState<EntityEntry | null>(null);
  const [vaultContext, setVaultContext] = useState<'file' | 'folder' | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeVaultRoot, setActiveVaultRoot] = useState<string>('');
  const [editorSelectionText, setEditorSelectionText] = useState<string>('');
  const [continuityPeekOverlayOpen, setContinuityPeekOverlayOpen] = useState(false);
  const [layout, setLayout] = useState<LayoutPrefs>(DEFAULT_LAYOUT);
  const [view, setView] = useState<StorySubView>('editor');
  const [timelineMode, setTimelineMode] = useState<'spreadsheet' | 'aeon'>('spreadsheet');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [gettingStartedProgress, setGettingStartedProgress] = useState<GettingStartedProgress | null>(null);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [seenEmptySceneHints, setSeenEmptySceneHints] = useState<Set<string>>(() => new Set());
  const [vaultBinding, setVaultBinding] = useState<VaultBindingState>({ storyPath: '', notesPath: '', storyValid: true, notesValid: true });
  const { toast: budgetToastState, showToast: showBudgetToast } = useToast(5000);
  const { toast: voiceToastState, showToast: showVoiceToast } = useToast(4000);
  const { toast: upgradeToastState, showToast: showUpgradeToast } = useToast(5000);

  // ─── Voice state (SKY-322) ───
  const [voiceActive, setVoiceActive] = useState(false);
  const voiceSessionRef = useRef<string | null>(null);
  const speechRecogRef = useRef<SpeechRecognition | null>(null);
  const pttDownRef = useRef(false);
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
  const [notePreviewMode, setNotePreviewMode] = useState(false);
  const [notesBrainstormCollapsed, setNotesBrainstormCollapsed] = useState(false);
  const [ambiguousLink, setAmbiguousLink] = useState<{ rawTarget: string; matches: CrossTabLinkMatch[] } | null>(null);
  const [sceneFlashId, setSceneFlashId] = useState<string | null>(null);

  // SKY-1694 (Wave 2a): left sidebar panel zone layout
  const [leftSidebarLayout, setLeftSidebarLayout] = useState<LeftSidebarLayout>(DEFAULT_LEFT_SIDEBAR_LAYOUT);
  const leftSidebarLayoutRef = useRef<LeftSidebarLayout>(DEFAULT_LEFT_SIDEBAR_LAYOUT);

  const { distractionFree, toggle: toggleDistractionFree } = useFocusMode();

  // ─── SKY-3207 (B4): Hideable top bar ───
  const [topBarHidden, setTopBarHiddenRaw] = useState(false);
  // Transient peek state when the user hovers the thin reveal strip
  const [topBarPeekVisible, setTopBarPeekVisible] = useState(false);

  const setTopBarHidden = useCallback((hidden: boolean) => {
    setTopBarHiddenRaw(hidden);
    if (!hidden) setTopBarPeekVisible(false);
    setAppSettings((prev) => {
      if (!prev) return prev;
      const updated = { ...prev, topBarHidden: hidden };
      window.api.settingsSet(updated).catch(() => {});
      return updated;
    });
  }, []);

  const toggleTopBar = useCallback(() => {
    setTopBarHiddenRaw((prev) => {
      const next = !prev;
      if (!next) setTopBarPeekVisible(false);
      setAppSettings((settings) => {
        if (!settings) return settings;
        const updated = { ...settings, topBarHidden: next };
        window.api.settingsSet(updated).catch(() => {});
        return updated;
      });
      return next;
    });
  }, []);

  // Part C integration: listen for programmatic hide/show requests dispatched via useTopBarVisibility()
  useEffect(() => {
    const handler = (e: Event) => {
      const { hidden } = (e as CustomEvent<{ hidden: boolean }>).detail;
      setTopBarHidden(hidden);
    };
    window.addEventListener(TOPBAR_HIDE_EVENT, handler);
    return () => window.removeEventListener(TOPBAR_HIDE_EVENT, handler);
  }, [setTopBarHidden]);

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

  // SKY-1698 (Wave 2d): custom panel tabs in the main tab bar
  const [dockedTabs, setDockedTabs] = useState<DockedTab[]>([]);
  const [activeDockedTabId, setActiveDockedTabId] = useState<string | null>(null);

  // SKY-1699 (Wave 2e): split window — 2-pane manuscript editing
  const [splitWindowEnabled, setSplitWindowEnabled] = useState(false);
  const [splitRatio, setSplitRatio] = useState(50);
  const [focusedPane, setFocusedPane] = useState<1 | 2>(1);
  const [pane2Scene, setPane2Scene] = useState<Scene | null>(null);
  const [pane2Chapter, setPane2Chapter] = useState<Chapter | null>(null);
  const [pane2Story, setPane2Story] = useState<Story | null>(null);
  const pane2EditorApiRef = useRef<BlockEditorApi | null>(null);
  const splitContainerRef = useRef<HTMLDivElement | null>(null);
  const splitDragRef = useRef<{ startX: number; startRatio: number; containerWidth: number } | null>(null);

  // SKY-2094 (Phase 2 #1): two-tab app shell state (Story / Notes).
  const [tabShell, dispatchTabShell] = useReducer(tabbedShellReducer, DEFAULT_TABBED_SHELL_STATE);
  // Keep a ref to avoid stale closures when persisting.
  const tabShellRef = useRef<TabbedShellState>(DEFAULT_TABBED_SHELL_STATE);
  useEffect(() => { tabShellRef.current = tabShell; }, [tabShell]);
  // SKY-2102: Sync active tab to :root dataset so page-bg CSS can differentiate Story vs Notes.
  useEffect(() => {
    document.documentElement.dataset.activeTab = tabShell.activeTab;
  }, [tabShell.activeTab]);

  // SKY-1700 (Wave 2f): named workspace layouts
  const [workspaceLayouts, setWorkspaceLayouts] = useState<WorkspaceLayout[]>([]);
  const [activeLayoutId, setActiveLayoutId] = useState<string | null>(null);
  const [layoutPickerForceOpen, setLayoutPickerForceOpen] = useState(false);
  const [layoutManagerOpen, setLayoutManagerOpen] = useState(false);
  const [layoutHasUnsavedChanges, setLayoutHasUnsavedChanges] = useState(false);

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
  const [allNotePaths, setAllNotePaths] = useState<string[]>([]);

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

  const handleWaAutoApplyCategoriesChange = useCallback(
    (categories: Partial<Record<SuggestionCategory, boolean>>) => {
      setAppSettings((prev) => {
        if (!prev) return prev;
        const updated: AppSettings = {
          ...prev,
          agents: {
            ...prev.agents,
            writingAssistant: { ...prev.agents.writingAssistant, autoApplyCategories: categories },
          },
        };
        window.api.settingsSet(updated).catch(() => {});
        return updated;
      });
    },
    [],
  );

  const handleManualSnapshot = useCallback(async () => {
    if (!selectedScene) return;
    const content = editorApiRef.current?.getMarkdown() ?? selectedScene.blocks.map(b => b.content).join('\n\n');
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
      showBudgetToast(msg, 'warn');
    });
    return () => { unsub(); };
  }, [showBudgetToast]);

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
      showVoiceToast('Failed to start voice input.');
      return;
    }
    voiceSessionRef.current = sessionId;
    setVoiceActive(true);
    setVoiceListening(true);

    // SKY-3189 (G3): Web Speech requires Google's servers which are absent in packaged Electron builds.
    // Block it in packaged mode so it never presents as working-but-silently-failing.
    const SpeechRecognitionCtor: (new () => SpeechRecognition) | undefined =
      window.api?.isPackaged ? undefined : (window.SpeechRecognition ?? window.webkitSpeechRecognition);
    if (!SpeechRecognitionCtor) {
      const msg = window.api?.isPackaged
        ? 'Voice STT not configured — set up a provider in Settings → Voice.'
        : 'Web Speech API not available.';
      showVoiceToast(msg);
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
      if (msg) showVoiceToast(msg);
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
  }, [appSettings?.voice?.micDeviceId, showVoiceToast]);

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
        showVoiceToast('Voice captured — open a scene to insert text.');
      }
    });
    return () => { unsub(); };
  }, [showVoiceToast]);

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
    let cachedSettings: AppSettings | null = null;
    try {
      const [s, rootResult, vaultPaths] = await Promise.all([
        (window.api.settingsGet?.() ?? Promise.resolve(null)).catch(() => null),
        (window.api.getVaultRoot?.() ?? Promise.resolve(null)).catch(() => null),
        (window.api.vaultGetPaths?.() ?? Promise.resolve(null)).catch(() => null),
      ]);
      cachedSettings = s;

      let storyValid = true;
      let notesValid = true;
      let storyPath = rootResult?.vaultRoot ?? '';
      let notesPath = '';
      if (vaultPaths) {
        storyPath = vaultPaths.storyVaultPath ?? storyPath;
        notesPath = vaultPaths.notesVaultPath ?? '';
        const [storyResult, notesResult] = await Promise.all([
          window.api.validatePath(storyPath).catch(() => null),
          window.api.validatePath(notesPath).catch(() => null),
        ]);
        storyValid = isValidVaultPath(storyResult);
        notesValid = isValidVaultPath(notesResult);
        setVaultBinding({ storyPath, notesPath, storyValid, notesValid });
      } else {
        setVaultBinding((prev) => ({ ...prev, storyPath, storyValid: true, notesValid: true }));
      }

      // Apply rightSidebarVisible before readManifest() — readManifest can throw on
      // fresh installs (no vault yet), and grsVisible must be resolved regardless so
      // GlobalRightSidebar renders and the Getting Started panel becomes visible.
      if (s && typeof s.rightSidebarVisible === 'boolean') {
        setGrsVisible(s.rightSidebarVisible);
      }

      const m = storyValid
        ? await window.api.readManifest() as Manifest
        : { ...EMPTY_MANIFEST, vaultRoot: storyPath };
      setManifest(m);
      setStories(m.stories ?? []);
      if (m.layout) {
        setLayout({ ...DEFAULT_LAYOUT, ...m.layout });
      }
      if (s) {
        setAppSettings(s);
        // SKY-3207 (B4): restore top-bar hidden state per-vault
        if (typeof s.topBarHidden === 'boolean') setTopBarHiddenRaw(s.topBarHidden);
        // Restore global right sidebar state from persisted settings (SKY-1686).
        // On first launch rightSidebarVisible is undefined; auto-open the sidebar
        // when the GettingStarted panel should be shown so it's immediately visible.
        const initGsProgress = createInitialGettingStartedProgress(
          undefined,
          s.onboardingStartMode,
          s.gettingStartedProgress,
        );
        setGrsVisible(s.rightSidebarVisible ?? isGettingStartedVisible(initGsProgress));
        if (typeof s.rightSidebarWidth === 'number') setGrsWidth(s.rightSidebarWidth);
        if (Array.isArray(s.rightSidebarPanels) && s.rightSidebarPanels.length > 0) setGrsPanels(s.rightSidebarPanels as PanelConfig[]);
        // SKY-1694: restore left sidebar layout from persisted AppSettings
        if (s.activeLayout?.leftSidebar) {
          setLeftSidebarLayout(s.activeLayout.leftSidebar);
          leftSidebarLayoutRef.current = s.activeLayout.leftSidebar;
        }
        // SKY-1697: restore floating panels from persisted AppSettings (AC-F-06).
        if (Array.isArray(s.activeLayout?.floatingPanels)) {
          for (const entry of s.activeLayout!.floatingPanels!) {
            window.api.panelFloat?.(entry.panelId, {
              sourceSidebar: entry.lastDockSidebar,
              x: entry.x,
              y: entry.y,
              width: entry.width,
              height: entry.height,
            }).catch(() => {});
          }
        }
        // SKY-1698: restore docked custom tabs from persisted AppSettings.
        if (Array.isArray(s.activeLayout?.dockedTabs) && s.activeLayout!.dockedTabs!.length > 0) {
          setDockedTabs(s.activeLayout!.dockedTabs!);
        }
        // SKY-1699: restore split window ratio from persisted AppSettings.
        if (typeof s.activeLayout?.splitWindow?.splitRatio === 'number') {
          setSplitRatio(s.activeLayout.splitWindow.splitRatio);
        }
        // SKY-2094: restore two-tab shell state.
        if (s.activeLayout?.tabShell) {
          const restored = deserializeTabbedShellState(s.activeLayout.tabShell);
          dispatchTabShell({ type: 'SET_TAB', tab: restored.activeTab });
          dispatchTabShell({ type: 'SET_STORY_SUBVIEW', subView: restored.storySubView });
          dispatchTabShell({ type: 'SET_NOTES_SUBVIEW', subView: restored.notesSubView });
          dispatchTabShell({ type: 'SET_STORY_SIDEBAR_WIDTH', width: restored.storySidebarWidth });
          dispatchTabShell({ type: 'SET_NOTES_SIDEBAR_WIDTH', width: restored.notesSidebarWidth });
          dispatchTabShell({ type: 'SET_STORY_SIDEBAR_COLLAPSED', collapsed: restored.storySidebarCollapsed });
          dispatchTabShell({ type: 'SET_NOTES_SIDEBAR_COLLAPSED', collapsed: restored.notesSidebarCollapsed });
          tabShellRef.current = restored;
          setView(restored.storySubView);
        } else if (s.onboardingComplete && !s.notesTabUpgradeToastShown) {
          dispatchTabShell({ type: 'SET_TAB', tab: 'story' });
          showUpgradeToast('Your notes are in the new Notes tab.', 'info');
          const updated = { ...s, notesTabUpgradeToastShown: true } as AppSettings;
          setAppSettings(updated);
          window.api.settingsSet(updated).catch(() => {});
        }
        // SKY-1700 (Wave 2f): restore named layouts + run v1→v2 migration.
        {
          let settingsToUse = s;
          if (!s.layoutMigrationDone) {
            const migrationPatch = migrateV1Layout(s);
            settingsToUse = { ...s, ...migrationPatch };
            // Persist migration synchronously (fire-and-forget).
            window.api.settingsSet(settingsToUse).catch(() => {});
          }
          const allLayouts = getAllLayouts(settingsToUse);
          setWorkspaceLayouts(settingsToUse.workspaceLayouts ?? []);
          setActiveLayoutId(settingsToUse.activeLayoutId ?? null);
          // Restore right sidebar state from activeLayout if available (overrides legacy fields).
          if (settingsToUse.activeLayout?.rightSidebar) {
            const rs = settingsToUse.activeLayout.rightSidebar;
            setGrsVisible(rs.visible);
            setGrsWidth(rs.width);
            if (rs.panels.length > 0) setGrsPanels(rs.panels as PanelConfig[]);
          }
          // On app start, load the default layout if no named layout is active.
          if (settingsToUse.activeLayoutId == null) {
            const defaultLayout = allLayouts.find((l) => l.isDefault) ?? allLayouts[0];
            if (defaultLayout) {
              // Apply default only if no explicit left sidebar layout was already restored.
              if (!settingsToUse.activeLayout?.leftSidebar) {
                const ll: LeftSidebarLayout = {
                  panels: defaultLayout.leftSidebar.panels,
                  sidebarCollapsed: !defaultLayout.leftSidebar.visible,
                };
                setLeftSidebarLayout(ll);
                leftSidebarLayoutRef.current = ll;
              }
            }
          }
        }
        setGettingStartedProgress(
          createInitialGettingStartedProgress(
            undefined,
            s.onboardingStartMode,
            s.gettingStartedProgress,
          ),
        );
        applyTheme(s.theme);
        applyPageBackgroundTokens(s.pageBackground);
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
      else if (storyPath) setActiveVaultRoot(storyPath);

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
      // Ensure grsVisible is resolved even when vault loading fails (e.g. no vault
      // on fresh install). Without this, grsVisible stays undefined and
      // GlobalRightSidebar never renders, so the Getting Started panel is invisible.
      if (cachedSettings && typeof cachedSettings.rightSidebarVisible === 'boolean') {
        setGrsVisible(cachedSettings.rightSidebarVisible);
      }
    } finally {
      setLoading(false);
    }
  }, [showUpgradeToast]);

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
      const [entityResult, notesResult] = await Promise.all([
        window.api.entityList(),
        window.api.listNotesVault?.().catch(() => null),
      ]);
      setAllEntities(entityResult.entities ?? []);
      setAllNotePaths(
        notesResult && !('error' in notesResult)
          ? (notesResult.items ?? []).filter((item) => !item.isDirectory).map((item) => item.path)
          : [],
      );
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
      window.api.navigatorReportManifest?.().catch(() => {});
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

  // SKY-1697: Remove a panel from its sidebar and float it in a new window.
  const persistFloatingPanels = useCallback((panels: FloatingPanelEntry[]) => {
    setAppSettings((prev) => {
      if (!prev) return prev;
      const updated: AppSettings = { ...prev, activeLayout: { ...prev.activeLayout, leftSidebar: leftSidebarLayoutRef.current, floatingPanels: panels } };
      window.api.settingsSet(updated).catch(() => {});
      return updated;
    });
  }, []);

  // SKY-1698 (Wave 2d): Persist dockedTabs array to AppSettings.
  const persistDockedTabs = useCallback((tabs: DockedTab[]) => {
    setAppSettings((prev) => {
      if (!prev) return prev;
      const updated: AppSettings = { ...prev, activeLayout: { ...prev.activeLayout, leftSidebar: leftSidebarLayoutRef.current, dockedTabs: tabs } };
      window.api.settingsSet(updated).catch(() => {});
      return updated;
    });
  }, []);

  // SKY-2094: Persist tab shell state to AppSettings.
  const persistTabShell = useCallback((next: TabbedShellState) => {
    setAppSettings((prev) => {
      if (!prev) return prev;
      const updated: AppSettings = {
        ...prev,
        activeLayout: {
          ...prev.activeLayout,
          leftSidebar: leftSidebarLayoutRef.current,
          tabShell: serializeTabbedShellState(next),
        },
      };
      window.api.settingsSet(updated).catch(() => {});
      return updated;
    });
  }, []);

  const handleTabChange = useCallback((tab: AppTab) => {
    if (tab === 'story') {
      // Restore the story sub-view the user was in before switching to Notes.
      setView(tabShellRef.current.storySubView);
    }
    dispatchTabShell({ type: 'SET_TAB', tab });
    tabShellRef.current = { ...tabShellRef.current, activeTab: tab };
    persistTabShell({ ...tabShellRef.current, activeTab: tab });
  }, [persistTabShell]);

  const focusContinuitySearch = useCallback(() => {
    window.setTimeout(() => {
      document.querySelector<HTMLInputElement>('input[aria-label="Search entities in Notes Vault"]')?.focus();
    }, 0);
  }, []);

  // SKY-1699 (Wave 2e): Persist split ratio to AppSettings.
  const persistSplitRatio = useCallback((ratio: number) => {
    setSplitRatio(ratio);
    setAppSettings((prev) => {
      if (!prev) return prev;
      const updated: AppSettings = {
        ...prev,
        activeLayout: {
          ...prev.activeLayout,
          leftSidebar: leftSidebarLayoutRef.current,
          splitWindow: { splitRatio: ratio },
        },
      };
      window.api.settingsSet(updated).catch(() => {});
      return updated;
    });
  }, []);

  // SKY-1700 (Wave 2f): Persist layout library to AppSettings.
  const persistLayoutLibrary = useCallback((
    layouts: WorkspaceLayout[],
    newActiveLayoutId: string | null,
  ) => {
    const userLayouts = layouts.filter((l) => !l.isBuiltIn);
    setWorkspaceLayouts(userLayouts);
    setActiveLayoutId(newActiveLayoutId);
    setAppSettings((prev) => {
      if (!prev) return prev;
      const updated: AppSettings = {
        ...prev,
        workspaceLayouts: userLayouts,
        activeLayoutId: newActiveLayoutId,
      };
      window.api.settingsSet(updated).catch(() => {});
      return updated;
    });
  }, []);

  // Apply a layout snapshot to all live UI state.
  const applyLayout = useCallback((layout: WorkspaceLayout) => {
    // Left sidebar
    const ll: LeftSidebarLayout = {
      panels: layout.leftSidebar.panels,
      sidebarCollapsed: !layout.leftSidebar.visible,
    };
    setLeftSidebarLayout(ll);
    leftSidebarLayoutRef.current = ll;
    persistLeftSidebarLayout(ll);
    // Right sidebar
    setGrsVisible(layout.rightSidebar.visible);
    setGrsWidth(layout.rightSidebar.width);
    setGrsPanels(layout.rightSidebar.panels as PanelConfig[]);
    // Split window
    setSplitWindowEnabled(layout.splitWindow.enabled);
    setSplitRatio(layout.splitWindow.splitRatio);
    // Docked tabs
    setDockedTabs(layout.dockedTabs);
    // Persist all panel state in one AppSettings write.
    setAppSettings((prev) => {
      if (!prev) return prev;
      const updated: AppSettings = {
        ...prev,
        rightSidebarVisible: layout.rightSidebar.visible,
        rightSidebarWidth: layout.rightSidebar.width,
        rightSidebarPanels: layout.rightSidebar.panels,
        activeLayout: {
          leftSidebar: ll,
          floatingPanels: [],
          dockedTabs: layout.dockedTabs,
          splitWindow: { splitRatio: layout.splitWindow.splitRatio },
          rightSidebar: layout.rightSidebar,
        },
      };
      window.api.settingsSet(updated).catch(() => {});
      return updated;
    });
    setLayoutHasUnsavedChanges(false);
  }, [persistLeftSidebarLayout]);

  const handleSelectLayout = useCallback((layoutId: string) => {
    const allLayouts = mergeWithBuiltins(workspaceLayouts);
    const layout = allLayouts.find((l) => l.id === layoutId);
    if (!layout) return;
    applyLayout(layout);
    persistLayoutLibrary(workspaceLayouts, layoutId);
  }, [workspaceLayouts, applyLayout, persistLayoutLibrary]);

  const handleSaveCurrentAs = useCallback((name: string) => {
    const id = crypto.randomUUID();
    const snapshot = snapshotCurrentLayout({
      id,
      name,
      isDefault: false,
      leftSidebarLayout: leftSidebarLayoutRef.current,
      leftSidebarVisible: !leftSidebarLayoutRef.current.sidebarCollapsed,
      leftSidebarWidth: layout.leftWidth,
      rightSidebarVisible: grsVisible ?? false,
      rightSidebarWidth: grsWidth,
      rightSidebarPanels: grsPanels as unknown as RightSidebarPanel[],
      floatingPanels: appSettings?.activeLayout?.floatingPanels ?? [],
      dockedTabs,
      splitWindowEnabled,
      splitRatio,
    });
    const newLayouts = [...workspaceLayouts, snapshot];
    persistLayoutLibrary(newLayouts, id);
    setLayoutHasUnsavedChanges(false);
  }, [workspaceLayouts, layout.leftWidth, grsVisible, grsWidth, grsPanels, dockedTabs, splitWindowEnabled, splitRatio, appSettings, persistLayoutLibrary]);

  const handleLayoutRename = useCallback((id: string, name: string) => {
    const allLayouts = mergeWithBuiltins(workspaceLayouts);
    const newLayouts = allLayouts.map((l) => l.id === id ? { ...l, name } : l);
    persistLayoutLibrary(newLayouts, activeLayoutId);
  }, [workspaceLayouts, activeLayoutId, persistLayoutLibrary]);

  const handleLayoutDelete = useCallback((id: string) => {
    const allLayouts = mergeWithBuiltins(workspaceLayouts);
    const newLayouts = allLayouts.filter((l) => l.id !== id);
    const newActiveId = activeLayoutId === id ? null : activeLayoutId;
    persistLayoutLibrary(newLayouts, newActiveId);
  }, [workspaceLayouts, activeLayoutId, persistLayoutLibrary]);

  const handleLayoutSetDefault = useCallback((id: string) => {
    const allLayouts = mergeWithBuiltins(workspaceLayouts);
    const newLayouts = allLayouts.map((l) => ({ ...l, isDefault: l.id === id }));
    persistLayoutLibrary(newLayouts, activeLayoutId);
  }, [workspaceLayouts, activeLayoutId, persistLayoutLibrary]);

  const handleLayoutDuplicate = useCallback((id: string) => {
    const allLayouts = mergeWithBuiltins(workspaceLayouts);
    const src = allLayouts.find((l) => l.id === id);
    if (!src) return;
    const copy: WorkspaceLayout = {
      ...src,
      id: crypto.randomUUID(),
      name: `${src.name} (copy)`,
      isDefault: false,
      isBuiltIn: false,
      createdAt: Date.now(),
    };
    const newLayouts = [...workspaceLayouts, copy];
    persistLayoutLibrary(newLayouts, activeLayoutId);
  }, [workspaceLayouts, activeLayoutId, persistLayoutLibrary]);

  // SKY-1698: Remove a panel from its source sidebar before docking it as a tab.
  const removePanelFromSource = useCallback((panelId: SidebarPanelId, sourceSidebar: DragSidebar) => {
    if (sourceSidebar === 'left') {
      const cur = leftSidebarLayoutRef.current;
      persistLeftSidebarLayout({ ...cur, panels: cur.panels.filter((p) => p.id !== panelId) });
    } else {
      const next = grsPanels.filter((p) => p.id !== panelId);
      setGrsPanels(next);
      persistGrsSettings({ panels: next });
    }
  }, [grsPanels, persistLeftSidebarLayout, persistGrsSettings]);

  // SKY-1698: Panel dropped on main tab bar — create a new custom tab (AC-T-01).
  const handleTabBarDrop = useCallback((panelId: SidebarPanelId, sourceSidebar: DragSidebar, insertAfterTabIndex: number) => {
    removePanelFromSource(panelId, sourceSidebar);
    const newTab: DockedTab = { id: crypto.randomUUID(), panels: [panelId] };
    setDockedTabs((prev) => {
      const arr = [...prev];
      const insertAt = insertAfterTabIndex < 0 ? arr.length : Math.min(insertAfterTabIndex, arr.length);
      arr.splice(insertAt, 0, newTab);
      persistDockedTabs(arr);
      return arr;
    });
    setActiveDockedTabId(newTab.id);
  }, [removePanelFromSource, persistDockedTabs]);

  // SKY-1698: Panel dropped on an existing custom tab — group it (AC-T-03, max 5).
  const handleTabGroupDrop = useCallback((panelId: SidebarPanelId, sourceSidebar: DragSidebar, targetTabId: string) => {
    removePanelFromSource(panelId, sourceSidebar);
    setDockedTabs((prev) => {
      const arr = prev.map((tab) => {
        if (tab.id !== targetTabId) return tab;
        if (tab.panels.includes(panelId) || tab.panels.length >= 5) return tab;
        return { ...tab, panels: [...tab.panels, panelId] };
      });
      persistDockedTabs(arr);
      return arr;
    });
    setActiveDockedTabId(targetTabId);
  }, [removePanelFromSource, persistDockedTabs]);

  // SKY-1698: "Dock as tab" from panel ⋮ menu — appends as new tab at end (AC-T-08).
  const handleDockPanelAsTab = useCallback((panelId: SidebarPanelId, sourceSidebar: DragSidebar) => {
    handleTabBarDrop(panelId, sourceSidebar, -1);
  }, [handleTabBarDrop]);

  // SKY-1698: Close a custom tab (AC-T-06).
  const handleTabClose = useCallback((tabId: string, action: 'send-to-sidebar' | 'remove') => {
    setDockedTabs((prev) => {
      const tab = prev.find((t) => t.id === tabId);
      if (!tab) return prev;
      if (action === 'send-to-sidebar') {
        setGrsPanels((cur) => {
          const toAdd = tab.panels.filter((id) => !cur.some((p) => p.id === id));
          const next = [...cur, ...toAdd.map((id) => ({ id, collapsed: false as const }))];
          persistGrsSettings({ panels: next });
          return next;
        });
      }
      const arr = prev.filter((t) => t.id !== tabId);
      persistDockedTabs(arr);
      return arr;
    });
    setActiveDockedTabId((prev) => (prev === tabId ? null : prev));
  }, [persistGrsSettings, persistDockedTabs]);

  // SKY-1698: Reorder custom tabs by drag (AC-T-05).
  const handleTabReorder = useCallback((fromIndex: number, toIndex: number) => {
    setDockedTabs((prev) => {
      const arr = [...prev];
      const [removed] = arr.splice(fromIndex, 1);
      arr.splice(toIndex > fromIndex ? toIndex - 1 : toIndex, 0, removed);
      persistDockedTabs(arr);
      return arr;
    });
  }, [persistDockedTabs]);

  // SKY-1698: Add a panel as a new tab from the [+] picker.
  const handleAddPanelAsNewTab = useCallback((panelId: SidebarPanelId) => {
    const inRight = grsPanels.some((p) => p.id === panelId);
    handleTabBarDrop(panelId, inRight ? 'right' : 'left', -1);
  }, [grsPanels, handleTabBarDrop]);

  // SKY-1698: flat list of panel IDs already placed in docked tabs (for [+] picker filter).
  // Must be before early returns (loading/error) to satisfy rules-of-hooks.
  const dockedPanelIds = useMemo<SidebarPanelId[]>(
    () => dockedTabs.flatMap((t) => t.panels),
    [dockedTabs],
  );

  // SKY-1698: Selecting a built-in view clears any active docked tab (they're mutually exclusive).
  // SKY-2094: also persists story sub-view to tab shell state.
  const handleSetView = useCallback((v: StorySubView) => {
    setView(v);
    setActiveDockedTabId(null);
    const next = { ...tabShellRef.current, storySubView: v };
    dispatchTabShell({ type: 'SET_STORY_SUBVIEW', subView: v });
    tabShellRef.current = next;
    persistTabShell(next);
  }, [persistTabShell]);

  // SKY-2096: Switch Notes sub-view and persist.
  const handleNotesSubViewChange = useCallback((sv: NotesSubView) => {
    const next = { ...tabShellRef.current, notesSubView: sv };
    dispatchTabShell({ type: 'SET_NOTES_SUBVIEW', subView: sv });
    tabShellRef.current = next;
    persistTabShell(next);
  }, [persistTabShell]);

  const handleGettingStartedAction = useCallback((itemId: GettingStartedItemId) => {
    checkGettingStartedItem(itemId);
    if (itemId === 'brainstorm') { handleTabChange('notes'); return; }
    if (itemId === 'notes-vault') { handleNotesSubViewChange('editor'); handleTabChange('notes'); return; }
    if (itemId === 'add-character') { handleTabChange('notes'); return; }
    if (itemId === 'write-scene') {
      handleSetView('editor');
      handleTabChange('story');
      if (!selectedScene) editorApiRef.current?.focus();
    }
  }, [checkGettingStartedItem, handleTabChange, handleNotesSubViewChange, handleSetView, selectedScene]);

  const handleOpenContinuityEntityNote = useCallback((notePath: string) => {
    setSelectedScene(null);
    setSelectedChapter(null);
    setSelectedStory(null);
    setSelectedEntity(null);
    setOpenedNotePath(notePath);
    handleNotesSubViewChange('editor');
    handleTabChange('notes');
    setContinuityPeekOverlayOpen(false);
    checkGettingStartedItem('notes-vault');
  }, [checkGettingStartedItem, handleNotesSubViewChange, handleTabChange]);

  // SKY-2096: Notes left-sidebar width + collapsed state.
  const handleNotesSidebarWidthChange = useCallback((w: number) => {
    const next = { ...tabShellRef.current, notesSidebarWidth: w };
    dispatchTabShell({ type: 'SET_NOTES_SIDEBAR_WIDTH', width: w });
    tabShellRef.current = next;
    persistTabShell(next);
  }, [persistTabShell]);

  const handleNotesSidebarCollapsedChange = useCallback((c: boolean) => {
    const next = { ...tabShellRef.current, notesSidebarCollapsed: c };
    dispatchTabShell({ type: 'SET_NOTES_SIDEBAR_COLLAPSED', collapsed: c });
    tabShellRef.current = next;
    persistTabShell(next);
  }, [persistTabShell]);

  const handleFloatPanel = useCallback((panelId: SidebarPanelId, sourceSidebar: DragSidebar) => {
    // Remove from source sidebar.
    if (sourceSidebar === 'left') {
      const cur = leftSidebarLayoutRef.current;
      persistLeftSidebarLayout({ ...cur, panels: cur.panels.filter((p) => p.id !== panelId) });
    } else {
      const next = grsPanels.filter((p) => p.id !== panelId);
      setGrsPanels(next);
      persistGrsSettings({ panels: next });
    }
    // Create floating window. Position comes from cursor (main.ts uses getCursorScreenPoint).
    window.api.panelFloat?.(panelId, { sourceSidebar }).catch(() => {});
    // Add to floating panels list in settings.
    setAppSettings((prev) => {
      if (!prev) return prev;
      const existing = prev.activeLayout?.floatingPanels ?? [];
      if (existing.some((e) => e.panelId === panelId)) return prev;
      const entry: FloatingPanelEntry = { panelId, x: 0, y: 0, width: 360, height: 600, alwaysOnTop: false, lastDockSidebar: sourceSidebar };
      const updated: AppSettings = { ...prev, activeLayout: { ...prev.activeLayout, leftSidebar: leftSidebarLayoutRef.current, floatingPanels: [...existing, entry] } };
      window.api.settingsSet(updated).catch(() => {});
      return updated;
    });
  }, [grsPanels, persistLeftSidebarLayout, persistGrsSettings]);

  // SKY-1697: Listen for floating panel closed/docked events.
  useEffect(() => {
    if (!window.api.onPanelFloatClosed) return;
    return window.api.onPanelFloatClosed((data) => {
      const { panelId, docked, bounds } = data;
      // Always remove from floatingPanels.
      setAppSettings((prev) => {
        if (!prev) return prev;
        const panels = (prev.activeLayout?.floatingPanels ?? []).filter((e) => e.panelId !== panelId);
        const updated: AppSettings = { ...prev, activeLayout: { ...prev.activeLayout, leftSidebar: leftSidebarLayoutRef.current, floatingPanels: panels } };
        window.api.settingsSet(updated).catch(() => {});
        return updated;
      });
      if (docked) {
        // Dock-back: add to right sidebar (or last known sidebar).
        const dockSidebar = (appSettings?.activeLayout?.floatingPanels ?? []).find((e) => e.panelId === panelId)?.lastDockSidebar ?? 'right';
        if (dockSidebar === 'left') {
          const cur = leftSidebarLayoutRef.current;
          persistLeftSidebarLayout({ ...cur, panels: [...cur.panels, { id: panelId as SidebarPanelId, collapsed: false }] });
        } else {
          setGrsPanels((prev) => {
            if (prev.some((p) => p.id === panelId)) return prev;
            return [...prev, { id: panelId as SidebarPanelId, collapsed: false }];
          });
          persistGrsSettings({ panels: [...grsPanels, { id: panelId as SidebarPanelId, collapsed: false }] });
        }
      }
      // Update the saved bounds for this panel using the final window position.
      persistFloatingPanels(
        (appSettings?.activeLayout?.floatingPanels ?? [])
          .filter((e) => e.panelId !== panelId)
          .concat(docked ? [] : [{ panelId, ...bounds, alwaysOnTop: false, lastDockSidebar: 'right' }])
      );
    });
  }, [appSettings?.activeLayout?.floatingPanels, grsPanels, persistLeftSidebarLayout, persistGrsSettings, persistFloatingPanels]);

  // SKY-1697: Update saved bounds on debounced move/resize.
  useEffect(() => {
    if (!window.api.onPanelFloatBoundsChanged) return;
    return window.api.onPanelFloatBoundsChanged((data) => {
      const { panelId, x, y, width, height } = data;
      setAppSettings((prev) => {
        if (!prev) return prev;
        const panels = (prev.activeLayout?.floatingPanels ?? []).map((e) =>
          e.panelId === panelId ? { ...e, x, y, width, height } : e
        );
        const updated: AppSettings = { ...prev, activeLayout: { ...prev.activeLayout, leftSidebar: leftSidebarLayoutRef.current, floatingPanels: panels } };
        window.api.settingsSet(updated).catch(() => {});
        return updated;
      });
    });
  }, []);

  // SKY-2966: Report current scene to floating navigator panels whenever selection changes.
  useEffect(() => {
    window.api.navigatorReportScene?.(selectedScene?.id ?? null).catch(() => {});
  }, [selectedScene]);

  // SKY-2966: Refresh stories when a floating navigator panel modifies the manifest.
  useEffect(() => {
    if (!window.api.onNavigatorManifestChanged) return;
    const unsub = window.api.onNavigatorManifestChanged(() => {
      (window.api.readManifest() as Promise<Manifest>).then((m) => {
        setStories(m?.stories ?? []);
      }).catch(() => {});
    });
    return () => unsub?.();
  }, []);

  const setWritingMode = useCallback((mode: WritingMode) => {
    let newLayout: LayoutPrefs = { ...layout, writingMode: mode };
    if (mode === 'edit') {
      newLayout = { ...newLayout, leftTab: 'review' };
    }
    persistLayout(newLayout);
  }, [layout, persistLayout]);

  // SKY-1699: Toggle split window on/off (declared early so keyboard useEffect can reference it).
  const handleToggleSplitWindow = useCallback(() => {
    setSplitWindowEnabled((prev) => {
      if (prev) {
        // Closing split: focused pane's scene becomes the active scene.
        if (focusedPane === 2 && pane2Scene && pane2Chapter && pane2Story) {
          setSelectedScene(pane2Scene);
          setSelectedChapter(pane2Chapter);
          setSelectedStory(pane2Story);
        }
        setFocusedPane(1);
        setPane2Scene(null);
        setPane2Chapter(null);
        setPane2Story(null);
      }
      return !prev;
    });
  }, [focusedPane, pane2Scene, pane2Chapter, pane2Story]);

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
      // SKY-2099: tab-aware shortcut map.
      if (mod && !e.shiftKey && !e.altKey && (e.key === 'e' || e.key === 'E')) {
        e.preventDefault();
        if (tabShellRef.current.activeTab === 'notes') {
          setNotePreviewMode((prev) => !prev);
        } else {
          setWritingMode(layout.writingMode === 'edit' ? 'normal' : 'edit');
        }
        return;
      }
      if (mod && !e.shiftKey && !e.altKey && (e.key === 'k' || e.key === 'K')) {
        if (tabShellRef.current.activeTab === 'story') {
          e.preventDefault();
          handleSetView('kanban');
        }
        return;
      }
      if (mod && !e.shiftKey && !e.altKey && (e.key === 't' || e.key === 'T')) {
        if (tabShellRef.current.activeTab === 'story') {
          e.preventDefault();
          // SKY-2464: Toggle 'timeline' left sidebar panel.
          // Previously called handleSetView('timeline') to open TimelineSpreadsheet sub-view.
          const cur = leftSidebarLayoutRef.current;
          const existing = cur.panels.find((p) => p.id === 'timeline');
          const isOpen = existing != null && !existing.collapsed && !cur.sidebarCollapsed;
          if (isOpen) {
            persistLeftSidebarLayout({
              ...cur,
              panels: cur.panels.map((p) => p.id === 'timeline' ? { ...p, collapsed: true } : p),
            });
          } else if (existing != null) {
            persistLeftSidebarLayout({
              ...cur,
              sidebarCollapsed: false,
              panels: cur.panels.map((p) => p.id === 'timeline' ? { ...p, collapsed: false } : p),
            });
          } else {
            persistLeftSidebarLayout({
              ...cur,
              sidebarCollapsed: false,
              panels: [...cur.panels, { id: 'timeline', collapsed: false }],
            });
          }
        }
        return;
      }
      if (mod && !e.shiftKey && !e.altKey && (e.key === 'g' || e.key === 'G')) {
        if (tabShellRef.current.activeTab === 'notes') {
          e.preventDefault();
          handleNotesSubViewChange('graph');
        }
        return;
      }
      if (mod && !e.shiftKey && !e.altKey && (e.key === 'b' || e.key === 'B')) {
        if (tabShellRef.current.activeTab === 'notes') {
          e.preventDefault();
          setNotesBrainstormCollapsed((prev) => !prev);
        }
        return;
      }
      // Ctrl/Cmd+S — save the active tab.
      if (mod && !e.shiftKey && !e.altKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        if (tabShellRef.current.activeTab === 'notes') {
          window.dispatchEvent(new Event('mythos:save-note'));
        } else {
          void handleManualSnapshot();
        }
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
        handleGrsVisibilityChange(!(grsVisible ?? false));
        return;
      }
      // SKY-2094: Ctrl/Cmd+1 — switch to Story tab; Ctrl/Cmd+2 — switch to Notes tab.
      if (mod && !e.shiftKey && !e.altKey && e.key === '1') {
        e.preventDefault();
        handleTabChange('story');
        return;
      }
      if (mod && !e.shiftKey && !e.altKey && e.key === '2') {
        e.preventDefault();
        handleTabChange('notes');
        return;
      }
      // SKY-3207 (B4): Ctrl/Cmd+Shift+H — toggle top bar hidden
      if (mod && e.shiftKey && !e.altKey && (e.key === 'H' || e.key === 'h')) {
        e.preventDefault();
        toggleTopBar();
        return;
      }
      // SKY-3623: Ctrl/Cmd+3 — switch to Brainstorm tab.
      if (mod && !e.shiftKey && !e.altKey && e.key === '3') {
        e.preventDefault();
        handleTabChange('brainstorm');
        return;
      }
      // SKY-1700: Ctrl+Shift+L — open layout picker (AC-W-09)
      if (mod && e.shiftKey && !e.altKey && (e.key === 'L' || e.key === 'l')) {
        e.preventDefault();
        setLayoutPickerForceOpen(true);
        return;
      }
      if (mod && e.shiftKey && !e.altKey && (e.key === 'R' || e.key === 'r')) {
        e.preventDefault();
        const el = document.querySelector<HTMLElement>('[data-testid="global-right-sidebar"] [role="button"], [data-testid="global-right-sidebar"] button');
        el?.focus();
        return;
      }
      // SKY-2011: Ctrl/Cmd+Shift+K — open Continuity Peek panel
      if (mod && e.shiftKey && !e.altKey && (e.key === 'K' || e.key === 'k')) {
        e.preventDefault();
        setContinuityPeekOverlayOpen(true);
        focusContinuitySearch();
        return;
      }
      if (!mod || !e.shiftKey) return;
      // SKY-1699: Ctrl+Shift+2 — toggle split window
      if (e.key === '2') {
        e.preventDefault();
        handleToggleSplitWindow();
        return;
      }
      // SKY-1699: Ctrl+Shift+→ / Ctrl+Shift+← — move focus between split panes
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (splitWindowEnabled) setFocusedPane(2);
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (splitWindowEnabled) setFocusedPane(1);
        return;
      }
      if (e.key === 'F' || e.key === 'f') {
        if (tabShellRef.current.activeTab === 'story') {
          e.preventDefault();
          setWritingMode('focus');
        }
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
  }, [setWritingMode, setShortcutsOpen, setSettingsOpen, handleManualSnapshot, persistLeftSidebarLayout, handleToggleSplitWindow, splitWindowEnabled, setLayoutPickerForceOpen, handleTabChange, handleSetView, handleNotesSubViewChange, layout, persistLayout, focusContinuitySearch, toggleTopBar, handleGrsVisibilityChange, grsVisible]);

  useEffect(() => {
    if (!continuityPeekOverlayOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContinuityPeekOverlayOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [continuityPeekOverlayOpen]);

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

  // SKY-1699: Split window drag — mousedown on the divider starts a drag tracking the ratio.
  const startSplitDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const container = splitContainerRef.current;
    if (!container) return;
    splitDragRef.current = {
      startX: e.clientX,
      startRatio: splitRatio,
      containerWidth: container.getBoundingClientRect().width,
    };
  }, [splitRatio]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!splitDragRef.current) return;
      const { startX, startRatio, containerWidth } = splitDragRef.current;
      if (containerWidth === 0) return;
      const delta = e.clientX - startX;
      const deltaPct = (delta / containerWidth) * 100;
      const minPanePct = (320 / containerWidth) * 100;
      const newRatio = Math.max(minPanePct, Math.min(100 - minPanePct, startRatio + deltaPct));
      setSplitRatio(newRatio);
    };
    const onMouseUp = () => {
      if (!splitDragRef.current) return;
      splitDragRef.current = null;
      setSplitRatio((r) => {
        persistSplitRatio(r);
        return r;
      });
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [persistSplitRatio]);

  // SKY-1699: Pane 2 scene selection.
  const handlePane2SelectScene = useCallback((scene: Scene, chapter: Chapter, story: Story) => {
    setPane2Scene(scene);
    setPane2Chapter(chapter);
    setPane2Story(story);
    setFocusedPane(2);
  }, []);

  // SKY-1699: Keyboard handler for split divider (accessibility).
  const handleSplitDividerKey = useCallback((e: React.KeyboardEvent) => {
    const container = splitContainerRef.current;
    if (!container) return;
    const containerWidth = container.getBoundingClientRect().width;
    const minPanePct = containerWidth > 0 ? (320 / containerWidth) * 100 : 0;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setSplitRatio((r) => {
        const next = Math.max(minPanePct, r - 2);
        persistSplitRatio(next);
        return next;
      });
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      setSplitRatio((r) => {
        const next = Math.min(100 - minPanePct, r + 2);
        persistSplitRatio(next);
        return next;
      });
    }
  }, [persistSplitRatio]);

  // ─── Story/scene management ───

  const persistSceneMarkdown = useCallback(async (scene: Scene) => {
    try {
      await window.api.writeVault(scene.path, blocksToMarkdown(scene));
    } catch (e) {
      console.error('Failed to write scene markdown:', e);
    }
  }, []);

  // SKY-1699: Pane 2 blocks change handler — mirrors handleBlocksChange for pane 2's scene.
  const handlePane2BlocksChange = useCallback((blocks: Block[]) => {
    if (!pane2Scene || !pane2Chapter || !pane2Story) return;
    const updatedScene: Scene = { ...pane2Scene, blocks, updatedAt: now() };
    setPane2Scene(updatedScene);
    const updatedStories = stories.map((story) =>
      story.id !== pane2Story.id ? story : {
        ...story,
        chapters: story.chapters.map((ch) =>
          ch.id !== pane2Chapter.id ? ch : {
            ...ch,
            scenes: ch.scenes.map((sc) => sc.id !== updatedScene.id ? sc : updatedScene),
          }
        ),
      }
    );
    updateManifest(updatedStories);
    persistSceneMarkdown(updatedScene);
  }, [pane2Scene, pane2Chapter, pane2Story, stories, updateManifest, persistSceneMarkdown]);

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

  const handleContinueOnboarding = useCallback(() => {
    const updated = { ...(appSettings ?? {}), onboardingComplete: false } as AppSettings;
    setAppSettings(updated);
    window.api.settingsSet(updated).finally(() => window.location.reload()).catch(() => window.location.reload());
  }, [appSettings]);

  const handleConnectNotesVault = useCallback(async (seedMode: 'default' | 'blank') => {
    const picked = await window.api.pickFolder();
    if (picked.cancelled || !picked.vaultRoot) return;
    const storyPath = vaultBinding.storyPath || activeVaultRoot;
    await window.api.vaultSetPaths(storyPath, picked.vaultRoot, {
      seedMode,
      notesVaultToken: picked.registrationToken ?? undefined,
    });
    await loadVault();
  }, [activeVaultRoot, loadVault, vaultBinding.storyPath]);

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

  // SKY-2966: Handle scene selection requested from a floating navigator panel.
  useEffect(() => {
    if (!window.api.onNavigatorSceneChanged) return;
    const unsub = window.api.onNavigatorSceneChanged(({ sceneId }) => {
      for (const story of storiesRef.current) {
        for (const chapter of story.chapters) {
          const scene = chapter.scenes.find((sc) => sc.id === sceneId);
          if (scene) {
            handleSelectScene(scene, chapter, story);
            setViewDepth('scene');
            return;
          }
        }
      }
    });
    return () => unsub?.();
  }, [handleSelectScene, setViewDepth]);

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

  const applyCrossTabLinkMatch = useCallback((match: CrossTabLinkMatch) => {
    setAmbiguousLink(null);
    if (match.kind === 'scene') {
      setOpenedNotePath(null);
      handleSelectScene(match.scene, match.chapter, match.story);
      setView('editor');
      setViewDepth('scene');
      handleTabChange('story');
      setSceneFlashId(match.sceneId);
      window.setTimeout(() => setSceneFlashId((current) => current === match.sceneId ? null : current), 1200);
      return;
    }

    setSelectedScene(null);
    setSelectedChapter(null);
    setSelectedStory(null);
    setSelectedEntity(null);
    setOpenedNotePath(match.entityPath);
    handleNotesSubViewChange('editor');
    handleTabChange('notes');
  }, [handleSelectScene, handleTabChange, handleNotesSubViewChange]);

  const handleWikiLinkClick = useCallback((target: string) => {
    const resolution = resolveCrossTabLink(target, { stories, entities: allEntities, notePaths: allNotePaths });
    if (resolution.status === 'single') {
      applyCrossTabLinkMatch(resolution.matches[0]);
    } else if (resolution.status === 'ambiguous') {
      setAmbiguousLink({ rawTarget: resolution.rawTarget, matches: resolution.matches });
    }
  }, [allEntities, allNotePaths, applyCrossTabLinkMatch, stories]);

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

  // SKY-1699: The editor context that right-sidebar agents (Writing Assistant, Archive)
  // should respond to. In split mode this tracks the focused pane; otherwise it is the selected scene.
  const usePane2SidebarContext = splitWindowEnabled && focusedPane === 2;
  const activeSceneForSidebar = usePane2SidebarContext ? pane2Scene : selectedScene;

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
            onSelectStory={(st) => setSelectedStory(st)}
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
      case 'vault-graph':
        return <VaultGraphView onOpenNote={handleOpenSceneByPath} />;
      case 'review':
        return <SuggestionReview onOpenVaultPath={handleOpenSceneByPath} />;
      case 'progress':
        return <ProgressDashboard stories={stories} />;
      case 'timeline':
        return <StoryTimeline story={selectedStory} />;
      case 'writing-assistant':
        return (
          <WritingAssistantPanel
            scene={activeSceneForSidebar}
            enabled={appSettings?.waEnabled ?? appSettings?.agents?.writingAssistant?.enabled ?? true}
            scanIntervalSeconds={appSettings?.agents?.writingAssistant?.scanIntervalSeconds ?? 30}
            waScanInterval={appSettings?.waScanInterval}
            cadenceTrigger={appSettings?.waCadenceTrigger ?? appSettings?.agents?.writingAssistant?.cadenceTrigger}
            idleHeartbeatConstantInterval={appSettings?.agents?.writingAssistant?.idleHeartbeatConstantInterval}
            idleDebounceSeconds={appSettings?.agents?.writingAssistant?.idleDebounceSeconds}
            isActive={view === 'editor'}
            isPageFocused={view === 'editor'}
            onJumpToText={handleJumpToText}
            ttsSettings={appSettings?.tts}
            autoApply={appSettings?.agents?.writingAssistant?.autoApply ?? false}
            autoApplyCategories={appSettings?.agents?.writingAssistant?.autoApplyCategories}
            onAutoApplyCategoriesChange={handleWaAutoApplyCategoriesChange}
          />
        );
      case 'archive-continuity':
        return (
          <ContinuityPanel
            scene={activeSceneForSidebar}
            enabled={(appSettings?.agents?.archive?.enabled ?? true) && (appSettings?.archiveContinuityEnabled ?? true)}
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
      case 'scene-notes':
        return <SceneNotesPanel scene={activeSceneForSidebar} />;
      case 'scene-properties':
        return (
          <ScenePropertiesPanel
            scene={activeSceneForSidebar}
            chapter={usePane2SidebarContext ? pane2Chapter : selectedChapter}
            story={usePane2SidebarContext ? pane2Story : selectedStory}
            currentContent={activeSceneForSidebar?.blocks.map(b => b.content).join('\n\n') ?? ''}
            onDraftRestore={handleDraftRestore}
          />
        );
      case 'scene-outline':
        return (
          <OutlinePlanningPanel
            story={selectedStory}
            onSelectScene={(sc, ch) => {
              if (selectedStory) { handleSelectScene(sc, ch, selectedStory); setViewDepth('scene'); }
            }}
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
    activeSceneForSidebar, handleWaAutoApplyCategoriesChange,
    pane2Chapter, pane2Story, usePane2SidebarContext, handleDraftRestore,
  ]);

  // ─── Unified step handler (AC-C-4: one stepScene handler) ────────────────

  // §6: empty state — depth=scene but selected chapter has no scenes
  const depthIsEmpty = useMemo(
    () => viewDepth === 'scene' && selectedChapter !== null && selectedChapter.scenes.length === 0,
    [viewDepth, selectedChapter],
  );

  const { canPrev: depthCanPrev, canNext: depthCanNext, contextLabel: depthContextLabel } = useMemo(
    () => computeStepState(viewDepth, selectedScene, selectedChapter, selectedStory, stories),
    [viewDepth, selectedScene, selectedChapter, selectedStory, stories],
  );

  /**
   * Single handler for all prev/next navigation (DepthSlider arrows, on-canvas
   * edge arrows, BottomBar arrows, and Ctrl/Cmd+Alt+←→ keyboard shortcut).
   * Delegates pure logic to stepScene(); applies the resulting target to state.
   */
  const handleStep = useCallback((direction: 'prev' | 'next') => {
    const target = stepScene({ direction, depth: viewDepth, selectedScene, selectedChapter, selectedStory, stories });
    if (!target) return;
    if (target.scene && target.chapter) {
      handleSelectScene(target.scene, target.chapter, target.story);
    } else if (target.chapter) {
      setSelectedScene(null);
      setSelectedChapter(target.chapter);
      setSelectedStory(target.story);
      setSelectedEntity(null);
    } else {
      setSelectedScene(null);
      setSelectedChapter(null);
      setSelectedStory(target.story);
      setSelectedEntity(null);
    }
  }, [viewDepth, selectedScene, selectedChapter, selectedStory, stories, handleSelectScene]);

  const handleViewDepthChange = useCallback((newDepth: ViewDepth) => {
    setViewDepth(newDepth);
    if (newDepth === 'scene' && !selectedScene && selectedChapter && selectedStory) {
      const first = [...selectedChapter.scenes].sort((a, b) => a.order - b.order)[0];
      if (first) handleSelectScene(first, selectedChapter, selectedStory);
    }
  }, [selectedScene, selectedChapter, selectedStory, handleSelectScene]);

  // SKY-1699: word counts for both panes in split mode — must be before early returns (rules-of-hooks).
  const splitWordCounts = useMemo(() => {
    if (!splitWindowEnabled) return null;
    const countBlocks = (scene: Scene | null) =>
      scene
        ? scene.blocks.map((b) => b.content.trim().split(/\s+/).filter(Boolean).length).reduce((a, c) => a + c, 0)
        : 0;
    return { pane1: countBlocks(selectedScene), pane2: countBlocks(pane2Scene) };
  }, [splitWindowEnabled, selectedScene, pane2Scene]);

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
    writingAssistant: appSettings?.waEnabled ?? appSettings?.agents?.writingAssistant?.enabled ?? true,
    brainstorm: appSettings?.agents?.brainstorm?.enabled ?? true,
    // AC-S-02: archiveContinuityEnabled (master toggle) must also be true for archive panels to show
    archive: (appSettings?.agents?.archive?.enabled ?? true) && (appSettings?.archiveContinuityEnabled ?? true),
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
  const showRightSidebarGRS = !inFocusOrDF || (focusPrefs.showRightSidebar ?? false);
  const showBottomBar = !distractionFree && (writingMode !== 'focus' || focusPrefs.showBottomBar);
  const showTitleBar = !distractionFree && (writingMode !== 'focus' || focusPrefs.showTitleBar);
  const showTabBar = !distractionFree && (writingMode !== 'focus' || focusPrefs.showTabBar);
  const showStatusOverlay = distractionFree && focusPrefs.showStatusBar;

  const focusWordCount = selectedScene
    ? selectedScene.blocks.map(b => b.content.trim().split(/\s+/).filter(Boolean).length).reduce((a, c) => a + c, 0)
    : 0;
  const focusReadingMinutes = Math.max(1, Math.round(focusWordCount / 238));

  // SKY-3207 (B4): top bar visibility — chrome shows when title bar is on AND user hasn't hidden it (or is peeking)
  const showChrome = showTitleBar && (!topBarHidden || topBarPeekVisible);
  const showPeekStrip = showTitleBar && topBarHidden && !topBarPeekVisible;

  const shellClasses = [
    'desktop-shell',
    `writing-mode-${writingMode}`,
    distractionFree && 'distraction-free',
    topBarHidden && !distractionFree && 'desktop-shell--topbar-hidden',
    inFocusOrDF && !focusPrefs.showSidebarButtons && 'focus-hide-sidebar-btns',
    inFocusOrDF && !focusPrefs.showScrollbars && 'focus-hide-scrollbars',
    inFocusOrDF && !focusPrefs.showFileTreeArrows && 'focus-hide-tree-arrows',
  ].filter(Boolean).join(' ');

  const activeVaultBadge = tabShell.activeTab === 'notes'
    ? (vaultBinding.notesValid ? labelFromPath(vaultBinding.notesPath) : 'No Notes vault')
    : (vaultBinding.storyValid ? labelFromPath(vaultBinding.storyPath || activeVaultRoot) : 'No Story vault');
  const activeVaultBadgeTitle = tabShell.activeTab === 'notes'
    ? vaultBinding.notesPath
    : vaultBinding.storyPath || activeVaultRoot;
  const activeVaultBadgeMissing = tabShell.activeTab === 'notes' ? !vaultBinding.notesValid : !vaultBinding.storyValid;
  const activeVaultBadgeLabel = `${tabShell.activeTab === 'notes' ? 'Notes' : 'Story'} vault: ${activeVaultBadge}`;

  return (
    <PanelDragProvider onDrop={handlePanelDrop} onFloatDrop={handleFloatPanel} onTabBarDrop={handleTabBarDrop} onTabGroupDrop={handleTabGroupDrop}>
    <div className={shellClasses}>
      <UpdateBanner />
      {/* SKY-3207 (B4): peek strip — 8px hover target shown when top bar is hidden */}
      {showPeekStrip && (
        <div
          className="topbar-peek-strip"
          onMouseEnter={() => setTopBarPeekVisible(true)}
          aria-hidden="true"
          data-testid="topbar-peek-strip"
        />
      )}
      {/* SKY-3207 (B4): chrome wrapper — transparent in normal state, overlaid when peeking */}
      {showChrome && (
        <div
          className={`top-bar-chrome${topBarPeekVisible ? ' top-bar-chrome--peeking' : ''}`}
          onMouseLeave={topBarPeekVisible ? () => setTopBarPeekVisible(false) : undefined}
          data-testid="top-bar-chrome"
        >
          <WindowChrome />
          <AppMenuBar
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenHistory={() => setHistoryOpen(true)}
            onSearchNavigate={handleSearchNavigate}
            selectedStoryId={selectedStory?.id ?? null}
            activeVaultRoot={activeVaultRoot}
            onProjectSwitched={handleProjectSwitched}
            onOpenKeyboardShortcuts={() => setShortcutsOpen(true)}
            onToggleDistractionFree={toggleDistractionFree}
            onToggleTopBar={toggleTopBar}
            topBarHidden={topBarHidden}
            onOpenTour={() => setTourOpen(true)}
            onOpenExport={(scope: ExportScope) => setExportScope(scope)}
            requestText={requestText}
            dockedTabs={dockedTabs}
            activeDockedTabId={activeDockedTabId}
            onDockedTabSelect={setActiveDockedTabId}
            onDockedTabClose={handleTabClose}
            onDockedTabReorder={handleTabReorder}
            dockedPanelIds={dockedPanelIds}
            onAddPanelAsNewTab={handleAddPanelAsNewTab}
          />
          {/* SKY-2094 (Phase 2 #1): two-tab switcher — Story / Notes */}
          {showTabBar && (
            <TabBar
              activeTab={tabShell.activeTab}
              onTabChange={handleTabChange}
            />
          )}
          {/* SKY-2098: per-tab vault badge */}
          {activeVaultBadge && (
            <div
              className={`tab-bar-vault-badge${activeVaultBadgeMissing ? ' tab-bar-vault-badge--missing' : ''}`}
              aria-label={activeVaultBadgeLabel}
              aria-live="polite"
              data-testid="app-vault-badge"
            >
              <span className="tab-bar-vault-badge__name" title={activeVaultBadgeTitle}>
                {activeVaultBadge}
              </span>
            </div>
          )}
        </div>
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
            applyPageBackgroundTokens(s.pageBackground);
            // SKY-2963: must load the background data URL before applying tokens,
            // otherwise applyLiquidNeonTokens receives no bgDataUrl and resets the
            // background to the default gradient (same pattern as initial load above).
            const lg = s.liquidNeon;
            if (lg?.background && lg.background !== 'default') {
              window.api.loadBgImage?.(lg.background)
                .then((res: { dataUrl: string | null }) => applyLiquidNeonTokens(lg, res?.dataUrl))
                .catch(() => applyLiquidNeonTokens(lg));
            } else {
              applyLiquidNeonTokens(lg);
            }
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
      {/* SKY-2094: Story tabpanel — wraps all story content; hidden when Notes tab active */}
      {tabShell.activeTab === 'story' && (
      <div id="app-tabpanel-story" role="tabpanel" aria-labelledby="app-tab-story" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
      {/* SKY-2095 (Phase 2 #2): Story sub-view bar — vault badge + sub-view toggles. SKY-3626: writing mode removed, lives in editor toolbar. */}
      <StorySubViewBar
        activeSubView={view}
        onSubViewChange={handleSetView}
        vaultName={labelFromPath(vaultBinding.storyPath || activeVaultRoot)}
      />
      {/* SKY-1686: shell-main-row wraps all view-specific content + global right sidebar */}
      <div className="shell-main-row">
      {/* SKY-1698: active docked tab shows its panels in the main area */}
      {activeDockedTabId !== null && (() => {
        const activeTab = dockedTabs.find((t) => t.id === activeDockedTabId);
        if (!activeTab) return null;
        return (
          <div className="shell-panel-tab-view">
            {activeTab.panels.map((panelId) => (
              <div key={panelId} className="shell-panel-tab-panel">
                {renderSidebarPanel(panelId)}
              </div>
            ))}
          </div>
        );
      })()}
      {activeDockedTabId === null && view === 'kanban' && (
        <div className="shell-kanban">
          {selectedStory ? (
            <SceneCrafterPage
              key={selectedStory.id}
              story={selectedStory}
              onOpenNote={handleOpenSceneByPath}
              onOpenScene={handleOpenSceneById}
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
      {activeDockedTabId === null && view === 'timeline' && (
        <div className="shell-timeline">
          <div className="shell-timeline-mode-bar" role="group" aria-label="Timeline view mode">
            <button
              className={`shell-timeline-mode-btn${timelineMode === 'spreadsheet' ? ' shell-timeline-mode-btn--active' : ''}`}
              onClick={() => setTimelineMode('spreadsheet')}
              aria-pressed={timelineMode === 'spreadsheet'}
            >
              Spreadsheet
            </button>
            <button
              className={`shell-timeline-mode-btn${timelineMode === 'aeon' ? ' shell-timeline-mode-btn--active' : ''}`}
              onClick={() => setTimelineMode('aeon')}
              aria-pressed={timelineMode === 'aeon'}
            >
              AEON
            </button>
          </div>
          {timelineMode === 'spreadsheet' ? (
            <TimelineSpreadsheet story={selectedStory} onOpenScene={handleOpenSceneById} />
          ) : (
            <AeonLaneView story={selectedStory} onOpenScene={handleOpenSceneById} />
          )}
        </div>
      )}
      {activeDockedTabId === null && view === 'structure' && (
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
      {activeDockedTabId === null && view === 'editor' && <div className="shell-panels">
      {/* Left rail */}
      {showLeftSidebar && (
        <div className="shell-left" style={{ width: layout.leftWidth }}>
          <LeftRail
            leftSidebarLayout={leftSidebarLayout}
            onLeftSidebarLayoutChange={persistLeftSidebarLayout}
            renderPanelContent={renderSidebarPanel}
            rightPanelCount={grsPanels.length}
            onFloatPanel={(id) => handleFloatPanel(id, 'left')}
            onDockAsTab={(id) => handleDockPanelAsTab(id, 'left')}
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
          {/* SKY-1699/SKY-1700: Writing toolbar — DepthSlider + split toggle + layout picker. SKY-3626: NFE writing mode added here. */}
          <div className="shell-editor-toolbar">
            {selectedStory && showTabBar && !splitWindowEnabled && (
              <DepthSlider
                depth={viewDepth}
                onDepthChange={handleViewDepthChange}
                canPrev={depthCanPrev}
                canNext={depthCanNext}
                onPrev={() => handleStep('prev')}
                onNext={() => handleStep('next')}
                contextLabel={depthContextLabel}
                writingMode={writingMode}
                isEmpty={depthIsEmpty}
              />
            )}
            {/* SKY-3626: N/F/E writing-mode controls — Story editor only (center, above page) */}
            <div className="nfe-mode-group" aria-label="Writing mode" data-testid="nfe-mode-group">
              <button
                className={`nfe-mode-btn${writingMode === 'normal' ? ' active' : ''}`}
                onClick={() => setWritingMode('normal')}
                aria-pressed={writingMode === 'normal'}
                title="Normal mode — full editor + sidebars (Ctrl+Shift+N)"
                data-testid="writing-mode-normal"
              >N</button>
              <button
                className={`nfe-mode-btn${writingMode === 'focus' ? ' active' : ''}`}
                onClick={() => setWritingMode('focus')}
                aria-pressed={writingMode === 'focus'}
                title="Focus mode — distraction-free"
                data-testid="writing-mode-focus"
              >F</button>
              {writingMode === 'focus' && (
                <button
                  className="nfe-mode-prefs"
                  onClick={() => setFocusModePrefsOpen(true)}
                  title="Configure Focus mode panels"
                  aria-label="Focus mode preferences"
                >⚙</button>
              )}
              <button
                className={`nfe-mode-btn${writingMode === 'edit' ? ' active' : ''}`}
                onClick={() => setWritingMode('edit')}
                aria-pressed={writingMode === 'edit'}
                title="Edit mode — review with Writing Assistant + comments (Ctrl+Shift+E)"
                data-testid="writing-mode-edit"
              >E</button>
            </div>
            <button
              className="split-toggle-btn"
              onClick={handleToggleSplitWindow}
              aria-pressed={splitWindowEnabled}
              aria-label={splitWindowEnabled ? 'Close split view' : 'Split editor (2 panes)'}
              title="Split window (Ctrl+Shift+2)"
              data-testid="split-toggle-btn"
            >
              ⬜⬜
            </button>
            {/* SKY-1700: Layout picker (AC-W-02, AC-W-09) */}
            <LayoutPicker
              layouts={mergeWithBuiltins(workspaceLayouts)}
              activeLayoutId={activeLayoutId}
              hasUnsavedChanges={layoutHasUnsavedChanges}
              forceOpen={layoutPickerForceOpen}
              onForceOpenConsumed={() => setLayoutPickerForceOpen(false)}
              onSelectLayout={handleSelectLayout}
              onSaveCurrentAs={() => setLayoutManagerOpen(true)}
              onManage={() => setLayoutManagerOpen(true)}
            />
          </div>

          {splitWindowEnabled ? (
            /* SKY-1699: 2-pane split view */
            <>
              {selectedScene && pane2Scene && selectedScene.id === pane2Scene.id && (
                <div className="split-same-scene-banner" role="status" data-testid="split-same-scene-banner">
                  <span className="split-same-scene-icon" aria-hidden="true">⚠</span>
                  Both panes are editing the same scene.
                </div>
              )}
              <div
                className="split-window-container"
                ref={splitContainerRef}
              >
                <SplitEditorPane
                  paneNumber={1}
                  isFocused={focusedPane === 1}
                  scene={selectedScene}
                  chapter={selectedChapter}
                  story={selectedStory}
                  stories={stories}
                  onFocus={() => setFocusedPane(1)}
                  onSelectScene={(sc, ch, st) => { handleSelectScene(sc, ch, st); setViewDepth('scene'); }}
                  onBlocksChange={handleBlocksChange}
                  onEditorReady={handleEditorReady}
                  wikiLinkSuggestions={wikiLinkSuggestions}
                  onAcceptWikiLink={handleEditorAcceptWikiLink}
                  onRejectWikiLink={handleEditorRejectWikiLink}
                  autoLinkerEntities={allEntities}
                  autoLinkerMode={appSettings?.autoLinker?.mode ?? 'suggest'}
                  onEntityClick={handleEntityMentionClick}
                  style={{ flex: splitRatio }}
                />
                <div
                  className="split-window-divider"
                  role="separator"
                  aria-label="Resize split panes"
                  aria-orientation="vertical"
                  tabIndex={0}
                  onMouseDown={startSplitDrag}
                  onKeyDown={handleSplitDividerKey}
                  data-testid="split-divider"
                />
                <SplitEditorPane
                  paneNumber={2}
                  isFocused={focusedPane === 2}
                  scene={pane2Scene}
                  chapter={pane2Chapter}
                  story={pane2Story}
                  stories={stories}
                  onFocus={() => setFocusedPane(2)}
                  onSelectScene={handlePane2SelectScene}
                  onBlocksChange={handlePane2BlocksChange}
                  onEditorReady={(api) => { pane2EditorApiRef.current = api; }}
                  autoLinkerEntities={allEntities}
                  autoLinkerMode={appSettings?.autoLinker?.mode ?? 'suggest'}
                  onEntityClick={handleEntityMentionClick}
                  style={{ flex: 100 - splitRatio }}
                />
              </div>
            </>
          ) : (
            /* Single-pane view (existing behavior) */
            !vaultBinding.storyValid ? (
              <div className="shell-editor-empty shell-editor-empty--vault-missing">
                <div className="shell-editor-empty-icon">✍️</div>
                <h2>No Story vault</h2>
                <p>Start your first story to begin writing.</p>
                <div className="shell-editor-empty-actions">
                  <button
                    className="shell-editor-empty-cta"
                    onClick={handleContinueOnboarding}
                  >
                    Create a new story
                  </button>
                  <button
                    className="shell-editor-empty-secondary"
                    onClick={handleContinueOnboarding}
                  >
                    Continue onboarding
                  </button>
                </div>
              </div>
            ) : viewDepth === 'book' && selectedStory ? (
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
              <div className={`shell-editor-scene-wrap story-page-canvas${sceneFlashId === selectedScene.id ? ' shell-editor-scene-wrap--flash' : ''}`}>
                {/* AC-C-4: on-canvas edge arrows — route through unified handleStep */}
                <button
                  className="edge-arrow edge-arrow--prev"
                  onClick={() => handleStep('prev')}
                  disabled={!depthCanPrev}
                  aria-label="Previous scene (Ctrl+Alt+←)"
                  title="Previous (Ctrl+Alt+←)"
                  data-testid="edge-arrow-prev"
                  aria-hidden={!depthCanPrev}
                >
                  ‹
                </button>
                <button
                  className="edge-arrow edge-arrow--next"
                  onClick={() => handleStep('next')}
                  disabled={!depthCanNext}
                  aria-label="Next scene (Ctrl+Alt+→)"
                  title="Next (Ctrl+Alt+→)"
                  data-testid="edge-arrow-next"
                  aria-hidden={!depthCanNext}
                >
                  ›
                </button>
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
                <div className={`shell-editor-beta-wrap shell-editor-beta-wrap--page-mode${isGettingStartedVisible(gettingStartedProgress) && !seenEmptySceneHints.has(selectedScene.id) ? ' shell-editor-beta-wrap--hint' : ''}`}>
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
                    onWikiLinkClick={handleWikiLinkClick}
                    onSelectionChange={setEditorSelectionText}
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
                    currentContent={editorApiRef.current?.getMarkdown() ?? selectedScene.blocks.map(b => b.content).join('\n\n')}
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
                previewMode={notePreviewMode}
                onPreviewModeChange={setNotePreviewMode}
                onWikiLinkClick={handleWikiLinkClick}
                onWordCountChange={setOpenedNoteWordCount}
                onClose={() => setOpenedNotePath(null)}
              />
            ) : (
              <div className="shell-editor-empty">
                <div className="shell-editor-empty-icon">✍️</div>
                <h2>Welcome to Mythos Writer</h2>
                {stories.length === 0 ? (
                  <>
                    <p>Start your first story to begin writing.</p>
                    <button
                      className="shell-editor-empty-cta"
                      onClick={createStory}
                      data-testid="shell-empty-new-story"
                    >
                      Create a new story
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
            )
          )}
        </div>
        {showBottomBar && (
          <BottomBar
            selectedScene={selectedScene}
            selectedChapter={selectedChapter}
            selectedStory={selectedStory}
            onNavigateScene={handleStep}
            activeNotePath={openedNotePath}
            activeNoteWordCount={openedNoteWordCount}
            isVoiceActive={voiceActive}
            splitWordCounts={splitWordCounts}
          />
        )}
      </div>

      </div>}{/* end shell-panels */}

      {/* SKY-1686: Global right sidebar — only rendered once rightSidebarVisible is known from settings.
           undefined = settings not yet loaded or not seeded → omit entirely so layout is unchanged.
           This prevents the collapsed-edge strip from narrowing sibling views (e.g. timeline) before
           settings arrive, which caused TC-TL-06 detail-card pointer-event regression. */}
      {grsVisible !== undefined && showRightSidebarGRS && <GlobalRightSidebar
        visible={grsVisible as boolean}
        width={grsWidth}
        panels={grsPanels}
        onVisibilityChange={handleGrsVisibilityChange}
        onWidthChange={handleGrsWidthChange}
        onPanelsChange={handleGrsPanelsChange}
        renderPanelContent={renderSidebarPanel}
        continuityIssueCount={continuityCount}
        leftPanelCount={leftSidebarLayout.panels.length}
        onFloatPanel={(id) => handleFloatPanel(id, 'right')}
        onDockAsTab={(id) => handleDockPanelAsTab(id, 'right')}
        gettingStartedProgress={gettingStartedProgress}
        onGettingStartedAction={handleGettingStartedAction}
        onDismissGettingStarted={handleDismissGettingStarted}
        onToggleGsCollapsed={handleToggleGsCollapsed}
      />}

      {continuityPeekOverlayOpen && (
        <div
          className="continuity-focus-overlay-backdrop"
          onMouseDown={() => setContinuityPeekOverlayOpen(false)}
        >
          <div
            className="continuity-focus-overlay"
            role="dialog"
            aria-modal="true"
            aria-label="Continuity Peek"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="continuity-focus-overlay-header">
              <h2 className="continuity-focus-overlay-title">Continuity Peek</h2>
              <button
                type="button"
                className="continuity-focus-overlay-close"
                aria-label="Close Continuity Peek"
                onClick={() => setContinuityPeekOverlayOpen(false)}
              >
                ×
              </button>
            </div>
            <ContinuityPeekPanel
              selectionText={editorSelectionText}
              autoFocusSearch
              onOpenEntityNote={handleOpenContinuityEntityNote}
            />
          </div>
        </div>
      )}

      </div>{/* end shell-main-row */}
      </div>)}{/* end app-tabpanel-story */}
      {/* SKY-2096: Notes tabpanel — full layout (vault tree + editor + Brainstorm sidebar) */}
      {tabShell.activeTab === 'notes' && !vaultBinding.notesValid && (
        <div
          id="app-tabpanel-notes"
          role="tabpanel"
          aria-labelledby="app-tab-notes"
          style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <div className="shell-editor-empty shell-editor-empty--vault-missing">
            <div className="shell-editor-empty-icon">📁</div>
            <h2>No Notes vault</h2>
            <p>Connect or create a Notes vault to use worldbuilding notes in this tab.</p>
            <div className="shell-editor-empty-actions">
              <button
                className="shell-editor-empty-cta"
                onClick={() => { void handleConnectNotesVault('default'); }}
              >
                Create a Notes vault
              </button>
              <button
                className="shell-editor-empty-secondary"
                onClick={() => { void handleConnectNotesVault('blank'); }}
              >
                Connect existing folder
              </button>
            </div>
          </div>
        </div>
      )}
      {tabShell.activeTab === 'notes' && vaultBinding.notesValid && (
        <NotesTabPanel
          notesSubView={tabShell.notesSubView}
          onNotesSubViewChange={handleNotesSubViewChange}
          notesSidebarWidth={tabShell.notesSidebarWidth}
          notesSidebarCollapsed={tabShell.notesSidebarCollapsed}
          onNotesSidebarWidthChange={handleNotesSidebarWidthChange}
          onNotesSidebarCollapsedChange={handleNotesSidebarCollapsedChange}
          activeNotePath={openedNotePath}
          activeNotePreview={notePreviewMode}
          onActiveNotePreviewChange={setNotePreviewMode}
          onActiveNoteWordCountChange={setOpenedNoteWordCount}
          onCloseActiveNote={() => setOpenedNotePath(null)}
          onWikiLinkClick={handleWikiLinkClick}
          brainstormCollapsed={notesBrainstormCollapsed}
          onBrainstormCollapsedChange={setNotesBrainstormCollapsed}
          stories={stories}
          selectedSceneId={selectedScene?.id ?? null}
          onSelectScene={(sc, ch, st) => { handleSelectScene(sc, ch, st); setViewDepth('scene'); }}
          onCreateStory={createStory}
          onCreateChapter={createChapter}
          onCreateScene={createScene}
          onOpenFile={(path) => {
            setOpenedNotePath(path);
            handleNotesSubViewChange('editor');
          }}
          onExport={(scope: ExportScope) => setExportScope(scope)}
          journalModeEnabled={appSettings?.journalMode?.enabled ?? false}
          brainstormEnabled={agentFlags.brainstorm}
          voiceEnabled={appSettings?.agents?.brainstorm?.voiceEnabled ?? false}
          archiveContinuityEnabled={appSettings?.archiveContinuityEnabled ?? true}
          activeScene={selectedScene}
          onFirstSubmit={() => checkGettingStartedItem('brainstorm')}
          onNavigateToEntity={(entityId) => {
            window.api.entityRead(entityId).then((entity) => {
              if (entity) {
                setSelectedEntity(entity);
                setView('editor');
                handleTabChange('story');
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
                  handleTabChange('story');
                  return true;
                }
              }
            }
            return false;
          }}
          onSelectEntity={handleSelectEntity}
          selectedEntityId={selectedEntity?.id ?? null}
          activeStorySlug={selectedStory ? selectedStory.path.split(/[\\/]/).filter(Boolean).pop() ?? null : null}
          writingMode={writingMode}
          onSetWritingMode={setWritingMode}
          onOpenFocusPrefs={() => setFocusModePrefsOpen(true)}
        />
      )}
      {/* SKY-3623: Brainstorm top-level tab panel */}
      {tabShell.activeTab === 'brainstorm' && (
        <div
          id="app-tabpanel-brainstorm"
          role="tabpanel"
          aria-labelledby="app-tab-brainstorm"
          style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
        >
          <BrainstormPage
            onClose={() => {}}
            enabled={agentFlags.brainstorm}
            voiceEnabled={appSettings?.agents?.brainstorm?.voiceEnabled ?? false}
            archiveContinuityEnabled={appSettings?.archiveContinuityEnabled ?? true}
            activeScene={selectedScene}
            activeStorySlug={selectedStory ? selectedStory.path.split(/[\\/]/).filter(Boolean).pop() ?? null : null}
            onFirstSubmit={() => checkGettingStartedItem('brainstorm')}
            onNavigateToEntity={(entityId) => {
              window.api.entityRead(entityId).then((entity) => {
                if (entity) {
                  setSelectedEntity(entity);
                  setView('editor');
                  handleTabChange('story');
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
                    handleTabChange('story');
                    return true;
                  }
                }
              }
              return false;
            }}
          />
        </div>
      )}
      {ambiguousLink && (
        <div className="cross-tab-link-modal" role="dialog" aria-modal="true" aria-label="Choose link target">
          <div className="cross-tab-link-modal__card">
            <h2>Choose link target</h2>
            <p>Multiple matches found for [[{ambiguousLink.rawTarget}]].</p>
            <div className="cross-tab-link-modal__list">
              {ambiguousLink.matches.map((match) => (
                <button
                  key={match.kind === 'scene' ? `scene-${match.sceneId}` : `entity-${match.entityId}`}
                  type="button"
                  onClick={() => applyCrossTabLinkMatch(match)}
                >
                  {match.label}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => setAmbiguousLink(null)}>Cancel</button>
          </div>
        </div>
      )}
      <Toast message={budgetToastState?.message ?? null} level={budgetToastState?.level} />
      <Toast message={voiceToastState?.message ?? null} level={voiceToastState?.level} className="app-toast--stacked" />
      <Toast message={upgradeToastState?.message ?? null} level={upgradeToastState?.level} className="app-toast--stacked" />
      {voiceListening && (
        <div className="voice-listening-badge" role="status" aria-live="polite" aria-label="Voice input active">
          Listening…
        </div>
      )}
      <GlobalSearchPanel
        open={globalSearchOpen}
        defaultScope={tabShell.activeTab === 'story' ? 'story' : 'notes'}
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
      {/* SKY-1700: Layout Manager dialog (AC-W-03..AC-W-06) */}
      {layoutManagerOpen && (
        <LayoutManagerDialog
          layouts={mergeWithBuiltins(workspaceLayouts)}
          activeLayoutId={activeLayoutId}
          onClose={() => setLayoutManagerOpen(false)}
          onSelectLayout={(id) => { handleSelectLayout(id); setLayoutManagerOpen(false); }}
          onSaveCurrentAs={handleSaveCurrentAs}
          onRename={handleLayoutRename}
          onDelete={handleLayoutDelete}
          onSetDefault={handleLayoutSetDefault}
          onDuplicate={handleLayoutDuplicate}
        />
      )}
    </div>
    </PanelDragProvider>
  );
}
