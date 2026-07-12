import { useState, useEffect, useCallback, useRef, useMemo, useReducer, type ReactNode } from 'react';
import { useToast } from './hooks/useToast';
import { Toast } from './components/Toast/Toast';
import type { Story, Chapter, Scene, Block, Manifest, DraftState, LayoutPrefs, EntityEntry, WritingMode, FocusPrefs } from './types';
import FocusModePrefsDialog from './FocusModePrefsDialog';
import ExportDialog, { type ExportScope } from './ExportDialog';
import KeyboardShortcutsDialog from './KeyboardShortcutsDialog';
import { applyTheme, applyLiquidNeonTokens, applyPageBackgroundTokens, applyStoryPageTokens, STORY_PAGE_DEFAULTS, STORY_PAGE_PRESET_WIDTHS, type StoryPagePrefs } from './theme';
import { applyLiquidNeonV2Tokens, vaultDefaultThemePatch, type LiquidNeonV2Settings } from './theme/liquidNeonEngine';
import { deriveVaultDisplayName } from './ProjectSwitcher';
import BackgroundStack from './theme/BackgroundStack';
import BorderOverlay from './theme/BorderOverlay';
import { showLnToast } from './theme/lnToast';
import NotificationCenter from './NotificationCenter';
import { pushNotification } from './notificationStore';
import ManuscriptView from './story/ManuscriptView';
import { cycleStatus, moveParagraph, sceneStatus, type ManuscriptCursor, type ParagraphRef, type ZoomLevel } from './story/manuscriptModel';
import type { WindowChromeMenu } from './components/ui/WindowChrome';
import cosmicBgUrl from './assets/cosmic-bg.webp';
import PageChromeToolbar from './PageChromeToolbar';
import PageRuler from './PageRuler';
import DocHeader from './DocHeader';
import MarginRuler from './MarginRuler';
import PageSetupPopover, { type PageStyle } from './PageSetupPopover';
import LeftRail, { DEFAULT_LEFT_SIDEBAR_LAYOUT } from './LeftRail';
import AppNavRail from './AppNavRail';
import WorkspaceTabBar from './WorkspaceTabBar';
import WorkspaceSplitPane from './WorkspaceSplitPane';
import WorkspaceSplitDropZones, { type SplitDropZone } from './WorkspaceSplitDropZones';
// Beta 4 M4: tabs are documents (scenes/notes), not module mirrors (§4).
import {
  makeSceneTab,
  upsertSceneTab,
  upsertNoteTab,
  reconcileSceneTabs,
  workspaceStripModeFor,
  provisionalSceneIsAway,
  PROVISIONAL_CREATED_TOAST,
  PROVISIONAL_DISCARDED_TOAST,
} from './workspaceDocTabs';
import { NAV_RAIL_DEFAULTS, mergeNavConfigItems, resolveNavRailItems } from './components/SettingsPanel/settingsPanelTypes';
import AccountModal from './AccountModal';
import NewStoryWizard from './NewStoryWizard';
import { buildNewStoryPlanNote, dedupePlanRelPath, makeStoryFromDraft } from './newStoryFlow';
import type { NewStoryDraft } from './newStoryFlow';
import BottomBar from './BottomBar';
import BlockEditor, { type BlockEditorApi } from './BlockEditor';
import NoteViewer from './NoteViewer';
import type { WLSuggestion } from './WikiLinkHintExtension';
import EntityDetail from './EntityDetail';
import SceneCrafterPage from './pages/SceneCrafter/SceneCrafterPage';
import VaultGraphView from './VaultGraphView';
import ManuscriptStructureView from './ManuscriptStructureView';
import TimelineRoot from './TimelineRoot';
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
import { useAgentsActive, useAgentActivity } from './agents/agentActivity';
import { useVaultAgentActions } from './agents/useVaultAgentActions';
import { useContinuityCommentsBridge } from './archive/useContinuityCommentsBridge';
import { resolveAgentDisplayName } from './agents/agentIdentity';
import ProjectSwitcher from './ProjectSwitcher';
import DepthSlider, { type ViewDepth } from './DepthSlider';
import DepthEdgeArrows from './DepthEdgeArrows';
import { scrollBehavior } from './lib/reducedMotion';
import ChapterInterlude from './ChapterInterlude';
import { stepScene, computeStepState, type StepSceneTarget } from './stepScene';
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
import GettingStartedPanel from './components/GettingStartedPanel/GettingStartedPanel';
import { PanelDragProvider } from './PanelDragContext';
import type { DragSidebar } from './PanelDragContext';
import SplitEditorPane from './SplitEditorPane';
import StorySubViewBar from './StorySubViewBar';
import NotesTabPanel from './NotesTabPanel';
import BrainstormPage from './BrainstormPage';
import { resolveCrossTabLink, buildWikiLinkTitleIndex, buildWikiLinkCandidates, buildSceneWikiLinkTitleIndex, notePathForUnresolvedLink, buildUnresolvedLinkNote, wikiLinkTargetStem, type CrossTabLinkMatch } from './crossTabLinkResolver';
import type { WikiLinkPreviewData } from './WikiLinkHoverPreview';
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
import SceneNotesPanel from './SceneNotesPanel';
import ScenePropertiesPanel from './ScenePropertiesPanel';
import OutlinePlanningPanel from './OutlinePlanningPanel';
import StoryTimeline from './StoryTimeline';
import WindowChrome from './components/ui/WindowChrome';
import './DesktopShell.css';

const DEFAULT_LAYOUT: LayoutPrefs = {
  leftWidth: 240,
  rightWidth: 400,
  bottomHeight: 32,
  rightTab: 'notes',
  leftTab: 'stories',
};

// Beta 4 W0.5 (B4-2): the window is always opaque — `No background` renders a
// plain dark backdrop from the token engine; no transparency plumbing remains.
async function applyLiquidNeonV2Theme(settings?: Partial<LiquidNeonV2Settings> | null): Promise<void> {
  // M4: a custom wallpaper is stored as a file path (pickBgImage) — resolve it
  // to a data URL for the CSS url() the same way the v1 background does.
  let resolved = settings;
  if (settings?.wp === 'custom' && settings.customWp && !/^(data|blob):/.test(settings.customWp)) {
    try {
      const res = await window.api?.loadBgImage?.(settings.customWp);
      if (res?.dataUrl) resolved = { ...settings, customWp: res.dataUrl };
    } catch { /* fall back to the raw path */ }
  }
  applyLiquidNeonV2Tokens(resolved, cosmicBgUrl);
}

// SKY-3618: Responsive layout constants
/** Minimum pixels reserved for the center editor column at all times. */
export const CENTER_MIN_WIDTH = 280;
/** Minimum sidebar panel width — matches CSS min-width on .shell-left / .shell-right. */
const PANEL_MIN_WIDTH = 160;
/** Width of each resize divider strip. */
const DIVIDER_WIDTH = 4;
/** Approximate width of the GlobalRightSidebar collapsed-edge strip. */
const GRS_COLLAPSED_STRIP_WIDTH = 36;

/**
 * Compute display widths for left and right panels so the center column
 * always retains at least CENTER_MIN_WIDTH pixels.
 *
 * Stored layout values are unchanged; callers use returned values for rendering only.
 */
export function computeClampedSidebarWidths(
  leftWidth: number,
  rightWidth: number,
  showLeft: boolean,
  showRight: boolean,
  panelsAvailableWidth: number,
): { left: number; right: number } {
  const dividers = (showLeft ? DIVIDER_WIDTH : 0) + (showRight ? DIVIDER_WIDTH : 0);
  const maxForSidebars = panelsAvailableWidth - CENTER_MIN_WIDTH - dividers;

  const activeLeft = showLeft ? leftWidth : 0;
  const activeRight = showRight ? rightWidth : 0;
  const total = activeLeft + activeRight;

  if (total <= maxForSidebars || maxForSidebars <= 0) {
    return { left: leftWidth, right: rightWidth };
  }

  const ratio = Math.max(0, maxForSidebars) / total;
  return {
    left: showLeft ? Math.max(PANEL_MIN_WIDTH, Math.floor(leftWidth * ratio)) : leftWidth,
    right: showRight ? Math.max(PANEL_MIN_WIDTH, Math.floor(rightWidth * ratio)) : rightWidth,
  };
}

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
}

// SKY-2964: writing-mode selector removed from AppMenuBar — canonical controls live in StorySubViewBar (above the page)
export function AppMenuBar({ onOpenSettings, onOpenHistory, onSearchNavigate, selectedStoryId, activeVaultRoot, onProjectSwitched, onOpenKeyboardShortcuts, onToggleDistractionFree, onToggleTopBar, topBarHidden, onOpenTour, onOpenExport, requestText }: AppMenuBarProps) {
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
        aria-label="Settings"
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

// ─── Chapter continuous view (SKY-3211 C2) — per-scene editable bands ───

interface SceneEditorBandProps {
  scene: Scene;
  index: number;
  isActive: boolean;
  onBlocksChange: (sceneId: string, blocks: Block[]) => void;
  onDraftStateChange: (sceneId: string, state: DraftState) => void;
  onFocus: (scene: Scene) => void;
}

function SceneEditorBand({ scene, index, isActive, onBlocksChange, onDraftStateChange, onFocus }: SceneEditorBandProps) {
  const handleBlocksChange = useCallback(
    (blocks: Block[]) => onBlocksChange(scene.id, blocks),
    [scene.id, onBlocksChange],
  );
  const handleDraftStateChange = useCallback(
    (state: DraftState) => onDraftStateChange(scene.id, state),
    [scene.id, onDraftStateChange],
  );
  const handleFocus = useCallback(() => onFocus(scene), [scene, onFocus]);

  return (
    <section
      className={`chapter-continuous-scene${isActive ? ' active' : ''}`}
      aria-label={`Scene ${index + 1}: ${scene.title}`}
      data-scene-id={scene.id}
    >
      <header className="chapter-continuous-scene-header">
        <h3 className="chapter-continuous-scene-title">{scene.title}</h3>
        <span className="chapter-continuous-scene-index" aria-hidden="true">Scene {index + 1}</span>
      </header>
      <div
        className="chapter-continuous-scene-editor"
        role="region"
        aria-label={`Editor: ${scene.title}`}
        onFocusCapture={handleFocus}
      >
        <BlockEditor
          key={scene.id}
          scene={scene}
          onBlocksChange={handleBlocksChange}
          onDraftStateChange={handleDraftStateChange}
          autoFocus={false}
        />
      </div>
    </section>
  );
}

interface ChapterContinuousViewProps {
  chapter: Chapter;
  storyId?: string;
  selectedSceneId: string | null;
  onBlocksChange: (sceneId: string, blocks: Block[]) => void;
  onDraftStateChange: (sceneId: string, state: DraftState) => void;
  onSceneFocus: (scene: Scene) => void;
}

export function ChapterContinuousView({ chapter, storyId, selectedSceneId, onBlocksChange, onDraftStateChange, onSceneFocus }: ChapterContinuousViewProps) {
  const sortedScenes = useMemo(
    () => [...chapter.scenes].sort((a, b) => a.order - b.order),
    [chapter.scenes],
  );
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!selectedSceneId || !containerRef.current) return;
    const el = containerRef.current.querySelector<HTMLElement>(`[data-scene-id="${selectedSceneId}"]`);
    el?.scrollIntoView({ block: 'nearest', behavior: scrollBehavior() });
  }, [selectedSceneId]);

  return (
    <div className="chapter-continuous-view" aria-label={`Chapter: ${chapter.title}`}>
      <header className="chapter-continuous-header">
        <h2 className="chapter-continuous-title">{chapter.title}</h2>
      </header>
      {/* GH #631: chapter-owned interlude prose (chapter.md), not part of any scene. */}
      <ChapterInterlude key={chapter.path} chapter={chapter} storyId={storyId} />
      <div className="chapter-continuous-scenes" ref={containerRef}>
        {sortedScenes.length === 0 ? (
          <p className="chapter-continuous-empty" role="status">No scenes in this chapter yet.</p>
        ) : (
          sortedScenes.map((scene, index) => {
            const isActive = scene.id === selectedSceneId;
            return (
              <SceneEditorBand
                key={scene.id}
                scene={scene}
                index={index}
                isActive={isActive}
                onBlocksChange={onBlocksChange}
                onDraftStateChange={onDraftStateChange}
                onFocus={onSceneFocus}
              />
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

export function BookOutlineView({ story, selectedChapterId, selectedSceneId, onSelectScene }: BookOutlineViewProps) {
  const sortedChapters = useMemo(
    () => [...story.chapters].sort((a, b) => a.order - b.order),
    [story.chapters],
  );
  const activeSceneRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    activeSceneRef.current?.scrollIntoView({ block: 'nearest', behavior: scrollBehavior() });
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

// ─── Full Book preview (SKY-3213 C4) — preview-only continuous prose ───
// Preview-only because C5 (virtualization) has not yet landed.

interface FullBookPreviewViewProps {
  story: Story | null;
}

function FullBookPreviewView({ story }: FullBookPreviewViewProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    headerRef.current?.focus({ preventScroll: true });
  }, [story?.id]);

  const chapters = useMemo(
    () => (story ? [...story.chapters].sort((a, b) => a.order - b.order) : []),
    [story],
  );

  const chapterSections = useMemo(
    () =>
      chapters.map((ch) => ({
        chapter: ch,
        scenes: [...ch.scenes]
          .sort((a, b) => a.order - b.order)
          .filter((sc) => sc.blocks.some((b) => b.content.trim())),
      })),
    [chapters],
  );

  const totalChapters = chapterSections.length;

  const scrollToChapter = useCallback(
    (idx: number) => {
      if (!scrollRef.current || totalChapters === 0) return;
      const wrapped = ((idx % totalChapters) + totalChapters) % totalChapters;
      const el = scrollRef.current.querySelector<HTMLElement>(
        `[data-chapter-idx="${wrapped}"]`,
      );
      el?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
      el?.focus({ preventScroll: true });
    },
    [totalChapters],
  );

  if (!story) {
    return (
      <div className="full-book-preview-empty" role="status" aria-live="polite">
        <span className="full-book-preview-empty__icon" aria-hidden="true">📖</span>
        <p className="full-book-preview-empty__title">No story selected</p>
        <p className="full-book-preview-empty__hint">Select a story from the Editor view to read the full book.</p>
      </div>
    );
  }

  if (chapters.length === 0) {
    return (
      <div className="full-book-preview-empty" role="status">
        <span className="full-book-preview-empty__icon" aria-hidden="true">📖</span>
        <p className="full-book-preview-empty__title">{story.title}</p>
        <p className="full-book-preview-empty__hint">No chapters yet. Add chapters and scenes in the Editor view.</p>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="full-book-preview-wrap"
      role="document"
      aria-label={`Full book preview: ${story.title}`}
    >
      <div className="full-book-preview">
        <header className="full-book-preview__book-header">
          <h1
            ref={headerRef}
            className="full-book-preview__story-title"
            tabIndex={-1}
          >
            {story.title}
          </h1>
          <span className="full-book-preview__readonly-badge" role="note">
            Preview — read only
          </span>
          {story.synopsis && (
            <p className="full-book-preview__synopsis">{story.synopsis}</p>
          )}
        </header>

        {chapterSections.map(({ chapter, scenes }, idx) => (
          <section
            key={chapter.id}
            className="full-book-preview__chapter"
            aria-labelledby={`fbp-ch-${chapter.id}`}
            tabIndex={-1}
            data-chapter-idx={idx}
          >
            <h2
              className="full-book-preview__chapter-title"
              id={`fbp-ch-${chapter.id}`}
            >
              {chapter.title}
            </h2>
            {scenes.length === 0 ? (
              <p className="full-book-preview__no-content">
                — no written scenes in this chapter —
              </p>
            ) : (
              scenes.map((scene, si) => {
                const sortedBlocks = [...scene.blocks]
                  .sort((a, b) => a.order - b.order)
                  .filter((b) => b.content.trim());
                return (
                  <article
                    key={scene.id}
                    className="full-book-preview__scene"
                    aria-labelledby={`fbp-sc-${scene.id}`}
                  >
                    <h3
                      className="full-book-preview__scene-title"
                      id={`fbp-sc-${scene.id}`}
                    >
                      {scene.title}
                    </h3>
                    <div className="full-book-preview__scene-body">
                      {sortedBlocks.map((block) => (
                        <p
                          key={block.id}
                          className={`full-book-preview__block full-book-preview__block--${block.type}`}
                        >
                          {block.content}
                        </p>
                      ))}
                    </div>
                    {si < scenes.length - 1 && (
                      <div
                        className="full-book-preview__scene-sep"
                        aria-hidden="true"
                      >
                        ✦ ✦ ✦
                      </div>
                    )}
                  </article>
                );
              })
            )}
            <nav
              className="full-book-preview__chapter-nav"
              aria-label={`Navigate chapters (${idx + 1} of ${totalChapters})`}
            >
              <button
                className="full-book-preview__nav-btn"
                onClick={() => scrollToChapter(idx - 1)}
                aria-label="Previous chapter (wraps to last)"
              >
                ← Prev
              </button>
              <span className="full-book-preview__nav-pos" aria-hidden="true">
                {idx + 1} / {totalChapters}
              </span>
              <button
                className="full-book-preview__nav-btn"
                onClick={() => scrollToChapter(idx + 1)}
                aria-label="Next chapter (wraps to first)"
              >
                Next →
              </button>
            </nav>
          </section>
        ))}

        <footer className="full-book-preview__footer">
          <button
            className="full-book-preview__back-top"
            onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: scrollBehavior() })}
            aria-label="Back to top of book"
          >
            ↑ Back to top
          </button>
        </footer>
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

export default function DesktopShell({ initialSettings }: { initialSettings?: AppSettings } = {}) {
  // SKY-4259: ref so loadVault can read the post-onboarding settings that the wizard
  // computed without needing it in the useCallback dep array.
  const initialSettingsRef = useRef<AppSettings | undefined>(initialSettings);
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeVaultRoot, setActiveVaultRoot] = useState<string>('');
  // Beta 4 M1: set by the two project-switch paths right before loadVault so
  // the reload can apply that vault's default theme (per-vault theme, §14.9 #9).
  const pendingVaultThemeRootRef = useRef<string | null>(null);
  const [editorSelectionText, setEditorSelectionText] = useState<string>('');
  const [continuityPeekOverlayOpen, setContinuityPeekOverlayOpen] = useState(false);
  const [layout, setLayout] = useState<LayoutPrefs>(DEFAULT_LAYOUT);
  const [view, setView] = useState<StorySubView>('editor');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [gettingStartedProgress, setGettingStartedProgress] = useState<GettingStartedProgress | null>(null);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [seenEmptySceneHints, setSeenEmptySceneHints] = useState<Set<string>>(() => new Set());
  const [vaultBinding, setVaultBinding] = useState<VaultBindingState>({ storyPath: '', notesPath: '', storyValid: true, notesValid: true });
  const { toast: budgetToastState, showToast: showBudgetToast } = useToast(5000);
  const { toast: voiceToastState, showToast: showVoiceToast } = useToast(4000);
  // GH #643: split-pane feedback (e.g. non-splittable tab kinds).
  const { toast: upgradeToastState, showToast: showUpgradeToast } = useToast(5000);
  const { toast: wikiLinkToastState, showToast: showWikiLinkToast } = useToast(3000);

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
  // Beta 4 M2: query handed off from the title-bar "Search vault…" field.
  const [globalSearchSeed, setGlobalSearchSeed] = useState('');
  // Beta 4 M2: View → Toggle left panel (§4) — a real user toggle, ANDed into
  // showLeftSidebar below (focus/distraction-free rules unchanged).
  const [leftPanelHidden, setLeftPanelHidden] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [viewDepth, setViewDepthRaw] = useState<ViewDepth>('scene');
  // SKY-6010: 'part' has no ViewDepth of its own (Parts don't exist in the
  // data model yet — book zoom stands in for it), so it's tracked as a flag
  // alongside viewDepth==='book' rather than folded into ViewDepth's union.
  // Any navigation through setViewDepth that isn't the manuscript zoom bar
  // itself must clear it, or the flag would go stale and misreport zoom.
  const [manuscriptPartZoom, setManuscriptPartZoom] = useState(false);
  const setViewDepth = useCallback((depth: ViewDepth) => {
    setManuscriptPartZoom(false);
    setViewDepthRaw(depth);
  }, []);
  const [showSceneHistory, setShowSceneHistory] = useState(false);
  const [snapshotSavedAt, setSnapshotSavedAt] = useState<string | null>(null);
  const [restoreKey, setRestoreKey] = useState(0);
  /** SKY-204: currently open vault note path (relative to notes vault root). */
  const [openedNotePath, setOpenedNotePath] = useState<string | null>(null);
  /** SKY-204: word count of the currently open vault note, updated live. */
  const [openedNoteWordCount, setOpenedNoteWordCount] = useState(0);
  const [notePreviewMode, setNotePreviewMode] = useState(false);
  const [notesBrainstormCollapsed, setNotesBrainstormCollapsed] = useState(false);
  /** SKY-3201: seed prompt pre-filled in the standalone Brainstorm tab (Notes/Story Assist context).
   *  Cleared after BrainstormPage mounts so navigating back doesn't re-seed with stale text. */
  const [brainstormSeedPrompt, setBrainstormSeedPrompt] = useState<string | null>(null);
  const [ambiguousLink, setAmbiguousLink] = useState<{ rawTarget: string; matches: CrossTabLinkMatch[] } | null>(null);
  const [sceneFlashId, setSceneFlashId] = useState<string | null>(null);

  // SKY-1694 (Wave 2a): left sidebar panel zone layout + right sidebar user-collapse toggle
  const [leftSidebarLayout, setLeftSidebarLayout] = useState<LeftSidebarLayout>(DEFAULT_LEFT_SIDEBAR_LAYOUT);
  // SKY-3177: AppNavRail collapse state + account modal
  const [navRailCollapsed, setNavRailCollapsed] = useState(false);
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  // Beta 4 M3: New Story wizard (rail stories switcher → "New Story…").
  const [newStoryOpen, setNewStoryOpen] = useState(false);
  const leftSidebarLayoutRef = useRef<LeftSidebarLayout>(DEFAULT_LEFT_SIDEBAR_LAYOUT);
  // SKY-3207 (B4): top bar hidden state
  const [topBarHidden, setTopBarHidden] = useState(false);
  const toggleTopBar = useCallback(() => setTopBarHidden((prev) => !prev), []);

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
  const [proposedCount, setProposedCount] = useState(0);

  // Poll proposed suggestion count every 30 s for nav badge
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = (window as any).api;
    if (typeof api?.suggestionsUnifiedList !== 'function') return;
    let cancelled = false;
    const poll = () => {
      (api.suggestionsUnifiedList({ status: 'proposed' }) as Promise<{ totalCount: number }>)
        .then((r) => { if (!cancelled) setProposedCount(r.totalCount ?? 0); })
        .catch(() => {});
    };
    poll();
    const id = window.setInterval(poll, 30_000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, []);

  // SKY-1698 (Wave 2d): custom panel tabs in the main tab bar
  const [dockedTabs, setDockedTabs] = useState<DockedTab[]>([]);
  const [activeDockedTabId, setActiveDockedTabId] = useState<string | null>(null);

  // SKY-3098 (v0.3) → Beta 4 M4: workspace tabs are documents. Each section
  // keeps its own strip (prototype etabs/ntabs): scenes on Story, notes on
  // Notes. Strips start empty and fill as documents open.
  const [storyDocTabs, setStoryDocTabs] = useState<WorkspaceTab[]>([]);
  const [activeStoryDocTabId, setActiveStoryDocTabId] = useState<string | null>(null);
  const [notesDocTabs, setNotesDocTabs] = useState<WorkspaceTab[]>([]);
  const [activeNotesDocTabId, setActiveNotesDocTabId] = useState<string | null>(null);
  // Beta 4 M4 (§1.5): the provisional scene created by "+" — its Scene lives
  // only in selectedScene until the first keystroke commits it.
  const [provisionalScene, setProvisionalScene] = useState<
    { tabId: string; sceneId: string; storyId: string; chapterId: string } | null
  >(null);
  // GH #643 split panes v1: right-hand workspace pane (module surfaces —
  // restored from persisted settings only since M4).
  const [workspaceSplitKind, setWorkspaceSplitKind] = useState<WorkspaceTabKind | null>(null);
  // Beta 4 M4: tab drag in flight (captured at dragstart) → split drop zones.
  const [tabDragPayload, setTabDragPayload] = useState<WorkspaceTab | null>(null);
  // Beta 4 M4: drop DOWN stacks the 2-pane editor, drop RIGHT sides it.
  const [splitDirection, setSplitDirection] = useState<SplitDropZone>('right');
  // Beta 4 M4: shell-driven note split request (note tab dropped on a zone).
  const [noteSplitRequest, setNoteSplitRequest] = useState<{ path: string; token: number } | null>(null);

  // SKY-1699 (Wave 2e): split window — 2-pane manuscript editing
  const [splitWindowEnabled, setSplitWindowEnabled] = useState(false);
  const [splitRatio, setSplitRatio] = useState(50);
  const [focusedPane, setFocusedPane] = useState<1 | 2>(1);
  const [pane2Scene, setPane2Scene] = useState<Scene | null>(null);
  const [pane2Chapter, setPane2Chapter] = useState<Chapter | null>(null);
  const [pane2Story, setPane2Story] = useState<Story | null>(null);
  const pane2EditorApiRef = useRef<BlockEditorApi | null>(null);
  const splitContainerRef = useRef<HTMLDivElement | null>(null);
  const splitDragRef = useRef<{ startX: number; startRatio: number; containerWidth: number; axis: 'x' | 'y' } | null>(null);

  // SKY-2094 (Phase 2 #1): two-tab app shell state (Story / Notes).
  const [tabShell, dispatchTabShell] = useReducer(tabbedShellReducer, DEFAULT_TABBED_SHELL_STATE);
  // Keep a ref to avoid stale closures when persisting.
  const tabShellRef = useRef<TabbedShellState>(DEFAULT_TABBED_SHELL_STATE);
  useEffect(() => { tabShellRef.current = tabShell; }, [tabShell]);
  // SKY-2102: Sync active tab to :root dataset so page-bg CSS can differentiate Story vs Notes.
  useEffect(() => {
    document.documentElement.dataset.activeTab = tabShell.activeTab;
  }, [tabShell.activeTab]);

  // SKY-3206: story page chrome
  const [pagePrefs, setPagePrefs] = useState<StoryPagePrefs>(STORY_PAGE_DEFAULTS);
  const [pageStyle, setPageStyle] = useState<PageStyle>('neon');
  const [pageSetupOpen, setPageSetupOpen] = useState(false);
  const [docZoom, setDocZoom] = useState(1.0);
  const pageWrapRef = useRef<HTMLDivElement | null>(null);
  const pageDragRef = useRef<{ startX: number; startWidth: number } | null>(null);


  // SKY-3206: Sync page prefs from settings when vault/settings change
  useEffect(() => {
    if (!appSettings || !activeVaultRoot) return;
    const map = (appSettings as AppSettings & { storyPagePrefsMap?: Record<string, StoryPagePrefs> }).storyPagePrefsMap;
    const prefs = map?.[activeVaultRoot] ?? STORY_PAGE_DEFAULTS;
    setPagePrefs(prefs);
  }, [appSettings, activeVaultRoot]);

  useEffect(() => {
    applyStoryPageTokens(pagePrefs);
  }, [pagePrefs]);


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

  const handleDismissGettingStarted = useCallback(() => {
    if (!gettingStartedProgress) return;
    persistGettingStartedProgress(gettingStartedReducer(gettingStartedProgress, { type: 'DISMISS' }));
  }, [gettingStartedProgress, persistGettingStartedProgress]);

  const handleToggleGsCollapsed = useCallback(() => {
    if (!gettingStartedProgress) return;
    persistGettingStartedProgress(gettingStartedReducer(gettingStartedProgress, { type: 'TOGGLE_COLLAPSE' }));
  }, [gettingStartedProgress, persistGettingStartedProgress]);

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

  const handleDismissSampleProjectBanner = useCallback(() => {
    setAppSettings((prev) => {
      if (!prev) return prev;
      const updated = { ...prev, sampleProjectBannerDismissed: true } as AppSettings;
      window.api.settingsSet(updated).catch(() => {});
      return updated;
    });
  }, []);

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

  const handlePagePrefsChange = useCallback((newPrefs: StoryPagePrefs) => {
    setPagePrefs(newPrefs);
    applyStoryPageTokens(newPrefs);
    if (!appSettings || !activeVaultRoot) return;
    const updated = {
      ...appSettings,
      storyPagePrefsMap: {
        ...(appSettings as AppSettings & { storyPagePrefsMap?: Record<string, StoryPagePrefs> }).storyPagePrefsMap,
        [activeVaultRoot]: newPrefs,
      },
    };
    window.api.settingsSet(updated as AppSettings).catch(() => {});
  }, [appSettings, activeVaultRoot]);

  const handlePageDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const el = pageWrapRef.current;
    if (!el) return;
    pageDragRef.current = { startX: e.clientX, startWidth: el.getBoundingClientRect().width };
    const onMove = (ev: MouseEvent) => {
      if (!pageDragRef.current) return;
      const delta = ev.clientX - pageDragRef.current.startX;
      const newW = Math.max(320, Math.min(1400, pageDragRef.current.startWidth + delta * 2));
      document.documentElement.style.setProperty('--page-width-story', `${newW}px`);
    };
    const onUp = (ev: MouseEvent) => {
      if (!pageDragRef.current) return;
      const delta = ev.clientX - pageDragRef.current.startX;
      const newW = Math.max(320, Math.min(1400, pageDragRef.current.startWidth + delta * 2));
      pageDragRef.current = null;
      const next: StoryPagePrefs = { ...pagePrefs, sizePreset: 'custom', customWidthPx: newW };
      setPagePrefs(next);
      handlePagePrefsChange(next);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handlePagePrefsChange, pagePrefs]);

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
  // SKY-3618: window width for responsive sidebar clamping
  const [windowInnerWidth, setWindowInnerWidth] = useState(() => window.innerWidth);
  // Holds current effective drag maxima — updated each render, read stale-free in event handlers
  const dragConstraintRef = useRef({ maxLeft: 500, maxRight: 500 });

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

  // ─── Beta 3 M22: agents-active chip + vault-tree agent actions ───
  // useAgentsActive feeds WorkspaceTabBar's status chip (left idle by M6);
  // useVaultAgentActions arms the notes-tree "Beta read" / "Continuity check"
  // context-menu items (left disabled by M15). Hooks live above the loading
  // early return per DesktopShell rules-of-hooks discipline.
  const agentsActive = useAgentsActive();
  useAgentActivity(betaReadLoading);
  // Beta 4 M2 (§4): bell rows deep-link to their source. The handlers below
  // are consts declared later in the component — safe because these closures
  // only run on notification click, long after render; the hook re-captures
  // them every render via refs.
  const { betaReadNote, continuityCheckNote } = useVaultAgentActions({
    agentNames: appSettings?.agentNames,
    onOpenNote: (path) => handleOpenContinuityEntityNote(path),
    onOpenContinuity: () => handleGrsVisibilityChange(true),
  });
  // Beta 3 M23: continuity flags surface as archive comments in the
  // manuscript gutter (live agent actions via suggestionId → archiveConfirm).
  useContinuityCommentsBridge(selectedStory, appSettings?.agentNames);

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
      // Mirror stopVoice: detach handlers and drop BOTH refs so a dead
      // recognition object can't keep firing onresult or leak via
      // voiceRecognitionRef (SKY audit P4).
      recog.onresult = null;
      recog.onerror = null;
      speechRecogRef.current = null;
      voiceRecognitionRef.current = null;
      voiceSessionRef.current = null;
      pttDownRef.current = false;
      setVoiceActive(false);
      setVoiceListening(false);
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
    // Beta 4 M1: consume the pending vault-switch marker synchronously so a
    // second concurrent loadVault (main push + local handler) can't re-apply.
    const switchedVaultRoot = pendingVaultThemeRootRef.current;
    pendingVaultThemeRootRef.current = null;
    let cachedSettings: AppSettings | null = null;
    try {
      const [sFromIpc, rootResult, vaultPaths] = await Promise.all([
        (window.api.settingsGet?.() ?? Promise.resolve(null)).catch(() => null),
        (window.api.getVaultRoot?.() ?? Promise.resolve(null)).catch(() => null),
        (window.api.vaultGetPaths?.() ?? Promise.resolve(null)).catch(() => null),
      ]);
      // SKY-4259: merge post-onboarding fields that the wizard computed but may not be
      // on disk yet (E2E mocks replace onboarding:complete without writing settings).
      // Disk values take precedence; initS fills absent fields or serves as full fallback
      // when the disk has no settings yet (fresh install, sFromIpc = null).
      const initS = initialSettingsRef.current;
      const s = sFromIpc ? {
        ...sFromIpc,
        ...(typeof initS?.rightSidebarVisible === 'boolean' && typeof sFromIpc.rightSidebarVisible !== 'boolean'
          ? { rightSidebarVisible: initS.rightSidebarVisible } : {}),
        ...(initS?.gettingStartedProgress != null && sFromIpc.gettingStartedProgress == null
          ? { gettingStartedProgress: initS.gettingStartedProgress } : {}),
        ...(initS?.onboardingStartMode != null && sFromIpc.onboardingStartMode == null
          ? { onboardingStartMode: initS.onboardingStartMode } : {}),
        ...(initS?.lastSampleGenre != null && sFromIpc.lastSampleGenre == null
          ? { lastSampleGenre: initS.lastSampleGenre } : {}),
      } : (initS ?? sFromIpc);
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
        // Restore global right sidebar state from persisted settings (SKY-1686)
        if (typeof s.rightSidebarVisible === 'boolean') setGrsVisible(s.rightSidebarVisible);
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
        // SKY-3098: restore nav rail + workspace tabs.
        if (typeof s.activeLayout?.navRailCollapsed === 'boolean') {
          setNavRailCollapsed(s.activeLayout.navRailCollapsed);
        } else if (s.navConfig?.collapsedDefault === true) {
          // SKY-3218: no explicit session state yet — honor the configured
          // "start collapsed" preference.
          setNavRailCollapsed(true);
        }
        // Beta 4 M4: restore document tabs. ≤Beta 3 module-mirror tabs
        // (activeLayout.workspaceTabs) are deliberately ignored — tabs are
        // documents now; provisional tabs never persist (§1.5).
        if (Array.isArray(s.activeLayout?.storyDocTabs)) {
          const restored = s.activeLayout.storyDocTabs.filter((t) => t.kind === 'scene' && !t.provisional);
          setStoryDocTabs(restored);
          const act = s.activeLayout.activeStoryDocTabId ?? null;
          setActiveStoryDocTabId(act !== null && restored.some((t) => t.id === act) ? act : null);
        }
        if (Array.isArray(s.activeLayout?.notesDocTabs)) {
          const restored = s.activeLayout.notesDocTabs.filter((t) => t.kind === 'note');
          setNotesDocTabs(restored);
          const act = s.activeLayout.activeNotesDocTabId ?? null;
          setActiveNotesDocTabId(act !== null && restored.some((t) => t.id === act) ? act : null);
        }
        // GH #643: restore the right-hand workspace split pane.
        if (s.activeLayout?.workspaceSplitPane?.kind) {
          setWorkspaceSplitKind(s.activeLayout.workspaceSplitPane.kind);
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
        // Beta 4 M1: per-vault default theme — when this reload came from a
        // vault switch and the target vault stores a default, apply it
        // (setKey + slots + wp per prototype 7111), persist, and toast.
        const vaultPatch = switchedVaultRoot
          ? vaultDefaultThemePatch(s.vaultThemes, s.liquidNeonV2, switchedVaultRoot)
          : null;
        if (vaultPatch && switchedVaultRoot) {
          const themed = { ...s, liquidNeonV2: vaultPatch.liquidNeonV2 } as AppSettings;
          cachedSettings = themed;
          setAppSettings(themed);
          window.api.settingsSet(themed).catch(() => {});
          void applyLiquidNeonV2Theme(vaultPatch.liquidNeonV2);
          showLnToast(
            'Switched Mythos vault — '
            + deriveVaultDisplayName({ vaultRoot: switchedVaultRoot, notesVaultRoot: notesPath || undefined })
            + ' · ' + vaultPatch.presetName + ' theme',
          );
        } else {
          // Beta 3 Liquid Neon (M1): v2 slot-engine tokens layer on after the
          // v1 axis tokens so v2 values win where both define a property.
          void applyLiquidNeonV2Theme(s.liquidNeonV2);
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

  // Debounced 500 ms trailing (audit P4): autosaves push vault:file-changed
  // about once per second while typing, and each reload runs two IPC calls
  // plus two setStates that re-render the whole shell. Only the last event in
  // a burst triggers the reload; the initial load on mount (above) stays
  // immediate.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = window.api.onVaultFileChanged(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        loadEntities();
      }, 500);
    });
    return () => {
      if (timer) clearTimeout(timer);
      off();
    };
  }, [loadEntities]);

  // Handle project switches pushed from main process
  useEffect(() => {
    if (!window.api?.onProjectSwitched) return;
    const unsub = window.api.onProjectSwitched((data: { vaultRoot: string }) => {
      pendingVaultThemeRootRef.current = data.vaultRoot; // Beta 4 M1: per-vault theme
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
    pendingVaultThemeRootRef.current = vaultRoot; // Beta 4 M1: per-vault theme
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

  // SKY-3098 (v0.3): Persist nav rail collapsed state.
  const persistNavRailCollapsed = useCallback((collapsed: boolean) => {
    setNavRailCollapsed(collapsed);
    setAppSettings((prev) => {
      if (!prev) return prev;
      const updated: AppSettings = {
        ...prev,
        activeLayout: { ...prev.activeLayout, leftSidebar: leftSidebarLayoutRef.current, navRailCollapsed: collapsed },
      };
      window.api.settingsSet(updated).catch(() => {});
      return updated;
    });
  }, []);

  // Beta 4 M4: Persist per-section document tabs + active ids. Provisional
  // tabs never persist — nothing about a provisional scene is saved (§1.5).
  const persistDocTabs = useCallback((patch: {
    story?: { tabs: WorkspaceTab[]; activeId: string | null };
    notes?: { tabs: WorkspaceTab[]; activeId: string | null };
  }) => {
    setAppSettings((prev) => {
      if (!prev) return prev;
      const updated: AppSettings = {
        ...prev,
        activeLayout: {
          ...prev.activeLayout,
          leftSidebar: leftSidebarLayoutRef.current,
          ...(patch.story
            ? {
                storyDocTabs: patch.story.tabs.filter((t) => !t.provisional),
                activeStoryDocTabId: patch.story.activeId,
              }
            : {}),
          ...(patch.notes
            ? { notesDocTabs: patch.notes.tabs, activeNotesDocTabId: patch.notes.activeId }
            : {}),
        },
      };
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
    if (tab !== 'brainstorm') {
      setBrainstormSeedPrompt(null);
    }
    if (tab === 'story') {
      // Restore the story sub-view the user was in before switching to Notes.
      setView(tabShellRef.current.storySubView);
    }
    dispatchTabShell({ type: 'SET_TAB', tab });
    tabShellRef.current = { ...tabShellRef.current, activeTab: tab };
    persistTabShell({ ...tabShellRef.current, activeTab: tab });
  }, [persistTabShell]);

  // Beta 4 M4: nav-rail section clicks only route — they no longer create
  // workspace tabs (tabs are documents, not module mirrors).
  const handleNavSectionChange = useCallback((tab: AppTab) => {
    handleTabChange(tab);
  }, [handleTabChange]);

  // ── GH #643 split panes v1 (module surfaces) ──
  // Since M4 the strip no longer offers module tabs, but a previously
  // persisted right-hand pane still restores; keep close/persist working.
  const persistWorkspaceSplit = useCallback((kind: WorkspaceTabKind | null) => {
    setAppSettings((prev) => {
      if (!prev) return prev;
      const updated: AppSettings = {
        ...prev,
        activeLayout: {
          ...prev.activeLayout,
          leftSidebar: leftSidebarLayoutRef.current,
          workspaceSplitPane: kind ? { kind } : null,
        },
      };
      window.api.settingsSet(updated).catch(() => {});
      return updated;
    });
  }, []);

  const closeSplitPane = useCallback(() => {
    setWorkspaceSplitKind(null);
    persistWorkspaceSplit(null);
  }, [persistWorkspaceSplit]);

  // Beta 4 M4: clear the drag payload when any drag ends, wherever it ends —
  // the drop zones unmount with it. (Set by WorkspaceTabBar's onTabDragStart.)
  useEffect(() => {
    const onDragEnd = () => setTabDragPayload(null);
    document.addEventListener('dragend', onDragEnd);
    document.addEventListener('drop', onDragEnd);
    return () => {
      document.removeEventListener('dragend', onDragEnd);
      document.removeEventListener('drop', onDragEnd);
    };
  }, []);

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

  const handleGettingStartedAction = useCallback((itemId: GettingStartedItemId) => {
    checkGettingStartedItem(itemId);
    if (itemId === 'brainstorm') {
      handleTabChange('notes');
      return;
    }
    if (itemId === 'notes-vault') {
      handleNotesSubViewChange('editor');
      handleTabChange('notes');
      return;
    }
    if (itemId === 'add-character') {
      handleTabChange('notes');
      return;
    }
    if (itemId === 'write-scene') {
      handleSetView('editor');
      handleTabChange('story');
      if (!selectedScene) editorApiRef.current?.focus();
    }
  }, [checkGettingStartedItem, handleTabChange, handleNotesSubViewChange, handleSetView, selectedScene]);

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
      newLayout = { ...newLayout, leftTab: 'review', rightTab: 'ai' };
    }
    persistLayout(newLayout);
  }, [layout, persistLayout]);


  // SKY-1699: Toggle split window on/off (declared early so keyboard useEffect can reference it).
  const handleToggleSplitWindow = useCallback(() => {
    // Beta 4 M4: the toolbar toggle always opens the side-by-side layout;
    // stacked splits come from dropping a tab on the DOWN zone.
    setSplitDirection('right');
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
      // Beta 4 M2 (§1 keyboard map / CF-14): Ctrl/Cmd+K = the command palette
      // fronting FTS5 search — the title-bar pill's "Ctrl K" hint must not lie
      // (§1.2). The old story-tab Scene Crafter binding moved to the Insert
      // menu ("Beat (Scene Crafter)") and the nav rail.
      if (mod && !e.shiftKey && !e.altKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setGlobalSearchSeed('');
        setGlobalSearchOpen(true);
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
      // SKY-2094: Ctrl/Cmd+1 — Story tab; Ctrl/Cmd+2 — Notes tab; SKY-3201: Ctrl/Cmd+3 — Brainstorm tab.
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
        const el = document.querySelector<HTMLElement>('[data-testid="global-right-sidebar"] [role="tab"][aria-selected="true"], [data-testid="global-right-sidebar"] [role="button"], [data-testid="global-right-sidebar"] button');
        el?.focus();
        return;
      }
      // SKY-2011: Ctrl/Cmd+Shift+K — open Continuity Peek or reveal GRS
      if (mod && e.shiftKey && !e.altKey && (e.key === 'K' || e.key === 'k')) {
        e.preventDefault();
        if ((layout.writingMode ?? 'normal') === 'focus') {
          setContinuityPeekOverlayOpen(true);
        } else {
          handleGrsVisibilityChange(true);
          persistLayout({ ...layout, rightTab: 'continuity' });
        }
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
  }, [setWritingMode, setShortcutsOpen, setSettingsOpen, handleManualSnapshot, persistLeftSidebarLayout, handleToggleSplitWindow, splitWindowEnabled, setLayoutPickerForceOpen, handleTabChange, handleNotesSubViewChange, layout, persistLayout, focusContinuitySearch, grsVisible, handleGrsVisibilityChange, toggleTopBar]);

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
      // SKY-3618: use dynamically-computed max so center column always keeps CENTER_MIN_WIDTH
      const dynamicMax = target === 'left' ? dragConstraintRef.current.maxLeft : dragConstraintRef.current.maxRight;
      const newWidth = Math.max(PANEL_MIN_WIDTH, Math.min(dynamicMax, startWidth + (target === 'left' ? delta : -delta)));
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
    const dynamicMax = target === 'left' ? dragConstraintRef.current.maxLeft : dragConstraintRef.current.maxRight;
    const newWidth = Math.max(PANEL_MIN_WIDTH, Math.min(dynamicMax, layout[key] + delta));
    persistLayout({ ...layout, [key]: newWidth });
  }, [layout, persistLayout]);

  // SKY-3618: Update windowInnerWidth on resize so clamped sidebar widths recompute.
  // Throttled to one requestAnimationFrame per burst (audit P4) — resize fires
  // many times per frame during an interactive window drag.
  useEffect(() => {
    let rafId: number | null = null;
    const onResize = () => {
      if (rafId !== null) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        setWindowInnerWidth(window.innerWidth);
      });
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      if (rafId !== null) window.cancelAnimationFrame(rafId);
    };
  }, []);

  // SKY-1699: Split window drag — mousedown on the divider starts a drag tracking the ratio.
  const startSplitDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const container = splitContainerRef.current;
    if (!container) return;
    // Beta 4 M4: the divider drags along the split axis — X for side-by-side,
    // Y for the stacked (drop DOWN) layout.
    const rect = container.getBoundingClientRect();
    splitDragRef.current = {
      startX: splitDirection === 'down' ? e.clientY : e.clientX,
      startRatio: splitRatio,
      containerWidth: splitDirection === 'down' ? rect.height : rect.width,
      axis: splitDirection === 'down' ? 'y' : 'x',
    };
  }, [splitRatio, splitDirection]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!splitDragRef.current) return;
      const { startX, startRatio, containerWidth, axis } = splitDragRef.current;
      if (containerWidth === 0) return;
      const delta = (axis === 'y' ? e.clientY : e.clientX) - startX;
      const deltaPct = (delta / containerWidth) * 100;
      const minPane = axis === 'y' ? 180 : 320;
      const minPanePct = (minPane / containerWidth) * 100;
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
    // Beta 4 M4: arrows follow the split axis (Left/Right sided, Up/Down stacked).
    const vertical = splitDirection === 'down';
    const rect = container.getBoundingClientRect();
    const containerSize = vertical ? rect.height : rect.width;
    const minPanePct = containerSize > 0 ? ((vertical ? 180 : 320) / containerSize) * 100 : 0;
    const shrinkKey = vertical ? 'ArrowUp' : 'ArrowLeft';
    const growKey = vertical ? 'ArrowDown' : 'ArrowRight';
    if (e.key === shrinkKey) {
      e.preventDefault();
      setSplitRatio((r) => {
        const next = Math.max(minPanePct, r - 2);
        persistSplitRatio(next);
        return next;
      });
    } else if (e.key === growKey) {
      e.preventDefault();
      setSplitRatio((r) => {
        const next = Math.min(100 - minPanePct, r + 2);
        persistSplitRatio(next);
        return next;
      });
    }
  }, [persistSplitRatio, splitDirection]);

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
    const content = blocks.map((b) => b.content).join('\n\n');
    // Beta 4 M4 (§1.5): a provisional scene lives only in editor state until
    // the first real keystroke; while it's still empty, nothing persists.
    const isProvisional = provisionalScene?.sceneId === updatedScene.id;
    if (isProvisional && !content.trim()) return;
    const updatedStories = stories.map((story) =>
      story.id !== selectedStory.id ? story : {
        ...story,
        chapters: story.chapters.map((ch) =>
          ch.id !== selectedChapter.id ? ch : {
            ...ch,
            // Committing a provisional scene appends it to its chapter;
            // ordinary edits replace the stored scene in place.
            scenes: isProvisional
              ? [...ch.scenes, updatedScene]
              : ch.scenes.map((sc) => sc.id !== updatedScene.id ? sc : updatedScene),
          }
        ),
      }
    );
    updateManifest(updatedStories);
    persistSceneMarkdown(updatedScene);
    if (isProvisional && provisionalScene) {
      // The scene is real now — its tab stops being provisional.
      const committedTabs = storyDocTabs.map((t) =>
        t.id === provisionalScene.tabId ? { ...t, provisional: undefined } : t,
      );
      setStoryDocTabs(committedTabs);
      persistDocTabs({ story: { tabs: committedTabs, activeId: provisionalScene.tabId } });
      setProvisionalScene(null);
    }
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
  }, [selectedScene, selectedChapter, selectedStory, stories, updateManifest, persistSceneMarkdown, checkGettingStartedItem, provisionalScene, storyDocTabs, persistDocTabs]);

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

  // SKY-6491: DocHeader's editable title was wired to a no-op that silently
  // discarded edits — commit the new title into the scene like every other
  // per-field scene mutation in this file (state + manifest + markdown).
  const handleSceneTitleChange = useCallback((title: string) => {
    if (!selectedScene || !selectedChapter || !selectedStory) return;
    const trimmed = title.trim();
    if (!trimmed || trimmed === selectedScene.title) return;
    const updatedScene: Scene = { ...selectedScene, title: trimmed, updatedAt: now() };
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
  }, [selectedScene, selectedChapter, selectedStory, stories, updateManifest, persistSceneMarkdown]);

  // SKY-3211 C2: Chapter continuous view — per-scene blocks change handler.


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

  // SKY-320/SKY-906 parity for the Liquid Neon title bar: the legacy
  // ProjectSwitcher's "+ Create new Mythos Vault" flow, driven through the
  // same useTextPrompt modal and vaultCreateDefaultMythos IPC. Main persists
  // settings + recents; we just switch the renderer to the new vault.
  const createMythosVault = useCallback(async () => {
    const name = await requestText('Name for the new Mythos Vault:');
    if (name === null) return;
    const trimmed = name.trim();
    if (trimmed && (trimmed.includes('/') || trimmed.includes('\\') || trimmed === '.' || trimmed === '..')) {
      alert('Vault name cannot contain slashes or path traversal.');
      return;
    }
    try {
      const result = await window.api?.vaultCreateDefaultMythos?.({
        vaultName: trimmed || undefined,
        seedMode: 'default',
      });
      if (!result || result.error) {
        alert(`Could not create vault: ${result?.error ?? 'unknown error'}`);
        return;
      }
      handleProjectSwitched(result.vaultRoot);
    } catch (err) {
      alert(`Create failed: ${(err as Error).message}`);
    }
  }, [requestText, handleProjectSwitched]);

  // Title-bar "Open vault…" — the legacy switcher's "Open Other Folder…".
  const openVaultViaPicker = useCallback(async () => {
    try {
      const result = await window.api?.openVaultFolder?.();
      if (!result?.cancelled && result?.vaultRoot) handleProjectSwitched(result.vaultRoot);
    } catch { /* non-fatal */ }
  }, [handleProjectSwitched]);

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
  }, [stories, updateManifest, requestText, handleSelectScene, setViewDepth]);

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

  // Beta 4 M1: the SKY-127 data-context window-ring effect is deleted with the
  // html frame ring (§3: no neon window frame ring around the app).

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

  const handleOpenGraphScene = useCallback((storyId: string, chapterId: string, sceneId: string) => {
    const story = stories.find((candidate) => candidate.id === storyId);
    const chapter = story?.chapters.find((candidate) => candidate.id === chapterId);
    const scene = chapter?.scenes.find((candidate) => candidate.id === sceneId);
    if (!story || !chapter || !scene) return;

    setOpenedNotePath(null);
    handleSelectScene(scene, chapter, story);
    setView('editor');
    setViewDepth('scene');
    handleTabChange('story');
  }, [stories, handleSelectScene, handleTabChange, setViewDepth]);

  // ═══ Beta 4 M4: workspace tabs = documents (§4, §1.5) ═══════════════════

  // §4: which strip the tab bar shows for the current route — Story/Notes get
  // document strips, Scene Crafter/Entities a static pseudo-tab, and
  // Brainstorm/Timeline/Graph hide it entirely.
  const workspaceStripMode = useMemo(
    () => workspaceStripModeFor(tabShell.activeTab, view, tabShell.notesSubView),
    [tabShell.activeTab, view, tabShell.notesSubView],
  );

  // Opening a scene anywhere (tree, graph, timeline, palette…) surfaces or
  // focuses its document tab — never duplicating it (prototype tree pick).
  useEffect(() => {
    if (!selectedScene) return;
    if (provisionalScene?.sceneId === selectedScene.id) return; // created explicitly with its tab
    const result = upsertSceneTab(storyDocTabs, selectedScene);
    const activeChanged = activeStoryDocTabId !== result.activeId;
    if (result.tabs !== storyDocTabs) setStoryDocTabs(result.tabs);
    if (activeChanged) setActiveStoryDocTabId(result.activeId);
    if (result.tabs !== storyDocTabs || activeChanged) {
      persistDocTabs({ story: { tabs: result.tabs, activeId: result.activeId } });
    }
  }, [selectedScene, provisionalScene, storyDocTabs, activeStoryDocTabId, persistDocTabs]);

  // Opening a note surfaces/focuses its tab in the Notes strip.
  useEffect(() => {
    if (!openedNotePath) return;
    const result = upsertNoteTab(notesDocTabs, openedNotePath);
    const activeChanged = activeNotesDocTabId !== result.activeId;
    if (result.tabs !== notesDocTabs) setNotesDocTabs(result.tabs);
    if (activeChanged) setActiveNotesDocTabId(result.activeId);
    if (result.tabs !== notesDocTabs || activeChanged) {
      persistDocTabs({ notes: { tabs: result.tabs, activeId: result.activeId } });
    }
  }, [openedNotePath, notesDocTabs, activeNotesDocTabId, persistDocTabs]);

  // Keep scene tabs honest against the manifest: refresh titles/status dots,
  // drop tabs whose scene was deleted (restored layouts included).
  useEffect(() => {
    if (loading) return;
    const result = reconcileSceneTabs(storyDocTabs, stories);
    if (!result.changed) return;
    const nextActive =
      activeStoryDocTabId !== null && result.tabs.some((t) => t.id === activeStoryDocTabId)
        ? activeStoryDocTabId
        : result.tabs[0]?.id ?? null;
    setStoryDocTabs(result.tabs);
    if (nextActive !== activeStoryDocTabId) setActiveStoryDocTabId(nextActive);
    persistDocTabs({ story: { tabs: result.tabs, activeId: nextActive } });
  }, [loading, stories, storyDocTabs, activeStoryDocTabId, persistDocTabs]);

  // §1.5: discard the untouched provisional scene the moment the user
  // navigates away from it — silently, with the spec toast.
  const discardProvisionalScene = useCallback((prov: { tabId: string; sceneId: string }) => {
    setStoryDocTabs((prev) => prev.filter((t) => t.id !== prov.tabId));
    setActiveStoryDocTabId((cur) => (cur === prov.tabId ? null : cur));
    setSelectedScene((cur) => (cur?.id === prov.sceneId ? null : cur));
    setProvisionalScene(null);
    showLnToast(PROVISIONAL_DISCARDED_TOAST);
  }, []);

  useEffect(() => {
    if (!provisionalScene) return;
    const away = provisionalSceneIsAway({
      activeTab: tabShell.activeTab,
      storySubView: view,
      viewDepth,
      selectedSceneId: selectedScene?.id ?? null,
      provisionalSceneId: provisionalScene.sceneId,
    });
    if (away) discardProvisionalScene(provisionalScene);
  }, [provisionalScene, tabShell.activeTab, view, viewDepth, selectedScene, discardProvisionalScene]);

  // §1.5: "+" opens a provisional scene immediately — nothing persists until
  // the user types (prototype addProvScene).
  const handleNewProvisionalScene = useCallback(() => {
    if (provisionalScene) {
      // One provisional at a time — refocus it (it is discarded on any
      // navigation, so it is already the open document).
      setActiveStoryDocTabId(provisionalScene.tabId);
      return;
    }
    const story = selectedStory ?? stories[0] ?? null;
    const chapter = story
      ? (selectedChapter && story.chapters.some((c) => c.id === selectedChapter.id)
          ? selectedChapter
          : story.chapters[story.chapters.length - 1] ?? null)
      : null;
    if (!story || !chapter) {
      showLnToast('Create a story with a chapter first — a new scene needs a home');
      return;
    }
    const id = generateId();
    const scene: Scene = {
      id,
      title: 'Untitled Scene',
      path: `stories/${story.id}/chapters/${chapter.id}/scenes/${id}.md`,
      order: chapter.scenes.length,
      chapterId: chapter.id,
      storyId: story.id,
      blocks: [],
      draftState: undefined,
      createdAt: now(),
      updatedAt: now(),
    };
    const tab = makeSceneTab(scene, undefined, true);
    setStoryDocTabs((prev) => [...prev, tab]);
    setActiveStoryDocTabId(tab.id);
    setProvisionalScene({ tabId: tab.id, sceneId: id, storyId: story.id, chapterId: chapter.id });
    handleTabChange('story');
    setView('editor');
    setViewDepth('scene');
    handleSelectScene(scene, chapter, story);
    showLnToast(PROVISIONAL_CREATED_TOAST);
  }, [provisionalScene, selectedStory, selectedChapter, stories, handleTabChange, setViewDepth, handleSelectScene]);

  const handleNewWorkspaceTab = useCallback(() => {
    if (workspaceStripMode.kind === 'docs' && workspaceStripMode.strip === 'notes') {
      // Prototype routes notes "+" to the note template picker, which lives
      // in the explorer toolbar here (§6) — explain instead of a dead click.
      showLnToast('New note lives in the notes explorer — use its New note button');
      return;
    }
    handleNewProvisionalScene();
  }, [workspaceStripMode, handleNewProvisionalScene]);

  // Selecting a tab opens its document.
  const handleWorkspaceTabSelect = useCallback((tabId: string) => {
    const storyTab = storyDocTabs.find((t) => t.id === tabId);
    if (storyTab) {
      setActiveStoryDocTabId(tabId);
      persistDocTabs({ story: { tabs: storyDocTabs, activeId: tabId } });
      if (!storyTab.provisional && storyTab.docId) {
        handleTabChange('story');
        setViewDepth('scene');
        handleOpenSceneById(storyTab.docId);
      }
      return;
    }
    const noteTab = notesDocTabs.find((t) => t.id === tabId);
    if (noteTab?.docPath) {
      setActiveNotesDocTabId(tabId);
      persistDocTabs({ notes: { tabs: notesDocTabs, activeId: tabId } });
      handleTabChange('notes');
      handleNotesSubViewChange('editor');
      setOpenedNotePath(noteTab.docPath);
    }
  }, [storyDocTabs, notesDocTabs, persistDocTabs, handleTabChange, handleOpenSceneById, handleNotesSubViewChange, setViewDepth]);

  const handleWorkspaceTabClose = useCallback((tabId: string) => {
    // Closing the provisional tab = discarding the untouched scene (§1.5).
    if (provisionalScene?.tabId === tabId) {
      discardProvisionalScene(provisionalScene);
      return;
    }
    if (storyDocTabs.some((t) => t.id === tabId)) {
      const next = storyDocTabs.filter((t) => t.id !== tabId);
      // Mirror the bar's neighbor pick (left, or right from the first slot) so
      // the persisted active id matches what the bar just selected.
      let nextActive = activeStoryDocTabId;
      if (activeStoryDocTabId === tabId) {
        const idx = storyDocTabs.findIndex((t) => t.id === tabId);
        nextActive = next.length > 0 ? (idx > 0 ? storyDocTabs[idx - 1].id : storyDocTabs[1].id) : null;
        if (next.length === 0) setSelectedScene(null);
      }
      setStoryDocTabs(next);
      setActiveStoryDocTabId(nextActive);
      persistDocTabs({ story: { tabs: next, activeId: nextActive } });
      return;
    }
    if (notesDocTabs.some((t) => t.id === tabId)) {
      const next = notesDocTabs.filter((t) => t.id !== tabId);
      let nextActive = activeNotesDocTabId;
      if (activeNotesDocTabId === tabId) {
        const idx = notesDocTabs.findIndex((t) => t.id === tabId);
        nextActive = next.length > 0 ? (idx > 0 ? notesDocTabs[idx - 1].id : notesDocTabs[1].id) : null;
        if (next.length === 0) setOpenedNotePath(null);
      }
      setNotesDocTabs(next);
      setActiveNotesDocTabId(nextActive);
      persistDocTabs({ notes: { tabs: next, activeId: nextActive } });
    }
  }, [provisionalScene, discardProvisionalScene, storyDocTabs, notesDocTabs, activeStoryDocTabId, activeNotesDocTabId, persistDocTabs]);

  const handleWorkspaceTabReorder = useCallback((fromIndex: number, toIndex: number) => {
    if (workspaceStripMode.kind !== 'docs') return;
    if (workspaceStripMode.strip === 'notes') {
      const arr = [...notesDocTabs];
      const [moved] = arr.splice(fromIndex, 1);
      arr.splice(toIndex, 0, moved);
      setNotesDocTabs(arr);
      persistDocTabs({ notes: { tabs: arr, activeId: activeNotesDocTabId } });
    } else {
      const arr = [...storyDocTabs];
      const [moved] = arr.splice(fromIndex, 1);
      arr.splice(toIndex, 0, moved);
      setStoryDocTabs(arr);
      persistDocTabs({ story: { tabs: arr, activeId: activeStoryDocTabId } });
    }
  }, [workspaceStripMode, storyDocTabs, notesDocTabs, activeStoryDocTabId, activeNotesDocTabId, persistDocTabs]);

  // §4: dropping a scene tab opens a second fully editable editor pane
  // (SKY-1699 split window) sided or stacked by drop zone; the doc's tab
  // moves into the split while other tabs remain (prototype tabDown up).
  const openSceneInSplitPane = useCallback((sceneId: string, tabId: string | null, zone: SplitDropZone) => {
    let found: { scene: Scene; chapter: Chapter; story: Story } | null = null;
    for (const story of stories) {
      for (const chapter of story.chapters) {
        const scene = chapter.scenes.find((sc) => sc.id === sceneId);
        if (scene) { found = { scene, chapter, story }; break; }
      }
      if (found) break;
    }
    if (!found) return;
    setPane2Scene(found.scene);
    setPane2Chapter(found.chapter);
    setPane2Story(found.story);
    setSplitDirection(zone);
    setSplitWindowEnabled(true);
    handleTabChange('story');
    setView('editor');
    setViewDepth('scene');
    if (tabId) {
      const rest = storyDocTabs.filter((t) => t.id !== tabId);
      if (rest.length > 0) {
        setStoryDocTabs(rest);
        let nextActive = activeStoryDocTabId;
        if (activeStoryDocTabId === tabId) {
          nextActive = rest[0].id;
          setActiveStoryDocTabId(nextActive);
          if (rest[0].docId) handleOpenSceneById(rest[0].docId);
        }
        persistDocTabs({ story: { tabs: rest, activeId: nextActive } });
      }
    }
    showLnToast(`“${found.scene.title}” moved ${zone === 'down' ? 'below' : 'to the side'}`);
  }, [stories, storyDocTabs, activeStoryDocTabId, persistDocTabs, handleTabChange, handleOpenSceneById, setViewDepth]);

  // §4/§6: dropping a notes tab splits notes (NotesTabPanel's M16 split).
  const openNoteInSplitPane = useCallback((notePath: string, title: string, zone: SplitDropZone) => {
    handleTabChange('notes');
    handleNotesSubViewChange('editor');
    if (!openedNotePath) setOpenedNotePath(notePath);
    setNoteSplitRequest({ path: notePath, token: Date.now() });
    showLnToast(`“${title}” moved ${zone === 'down' ? 'below' : 'to the side'}`);
  }, [handleTabChange, handleNotesSubViewChange, openedNotePath]);

  const handleSplitZoneDrop = useCallback((zone: SplitDropZone) => {
    const payload = tabDragPayload;
    setTabDragPayload(null);
    if (!payload) return;
    if (payload.kind === 'note' && payload.docPath) {
      openNoteInSplitPane(payload.docPath, payload.title, zone);
      return;
    }
    if (payload.kind === 'scene' && payload.docId) {
      if (provisionalScene?.tabId === payload.id) {
        showLnToast('Type in the new scene first — an empty provisional scene has nothing to split');
        return;
      }
      openSceneInSplitPane(payload.docId, payload.id, zone);
    }
  }, [tabDragPayload, provisionalScene, openNoteInSplitPane, openSceneInSplitPane]);

  // Context menu / Shift+click "Open to the side" (§4).
  const handleTabOpenInSplit = useCallback((tabId: string) => {
    const storyTab = storyDocTabs.find((t) => t.id === tabId);
    if (storyTab) {
      if (storyTab.provisional || !storyTab.docId) {
        showLnToast('Type in the new scene first — an empty provisional scene has nothing to split');
        return;
      }
      openSceneInSplitPane(storyTab.docId, tabId, 'right');
      return;
    }
    const noteTab = notesDocTabs.find((t) => t.id === tabId);
    if (noteTab?.docPath) openNoteInSplitPane(noteTab.docPath, noteTab.title, 'right');
  }, [storyDocTabs, notesDocTabs, openSceneInSplitPane, openNoteInSplitPane]);

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
  }, [handleSelectScene, handleTabChange, handleNotesSubViewChange, setViewDepth]);

  const handleWikiLinkClick = useCallback((target: string) => {
    const resolution = resolveCrossTabLink(target, {
      stories,
      entities: allEntities,
      notePaths: allNotePaths,
      onNotify: showWikiLinkToast,
    });
    if (resolution.status === 'single') {
      applyCrossTabLinkMatch(resolution.matches[0]);
    } else if (resolution.status === 'ambiguous') {
      setAmbiguousLink({ rawTarget: resolution.rawTarget, matches: resolution.matches });
    }
  }, [allEntities, allNotePaths, applyCrossTabLinkMatch, showWikiLinkToast, stories]);

  // SKY-5702: normalized cross-vault title index feeding the editors'
  // resolved/unresolved [[wiki link]] styling, plus the flat candidate list
  // for the `[[` autocomplete popup. Both rebuilt only when the underlying
  // vault state actually changes.
  const wikiLinkTitleIndex = useMemo(
    () => buildWikiLinkTitleIndex({ stories, entities: allEntities, notePaths: allNotePaths }),
    [stories, allEntities, allNotePaths],
  );
  const wikiLinkCandidates = useMemo(
    () => buildWikiLinkCandidates({ stories, entities: allEntities, notePaths: allNotePaths }),
    [stories, allEntities, allNotePaths],
  );
  // M16: stems that resolve to story scenes — those [[links]] render gold in
  // the notes editor (Liquid Neon mkLink parity).
  const sceneWikiLinkTitleIndex = useMemo(
    () => buildSceneWikiLinkTitleIndex(stories),
    [stories],
  );

  // M16: notes-editor wiki-link click — same resolution as the story editor,
  // but an unresolved link CREATES the note in the Notes Vault (Obsidian
  // parity, plan §M16 "unresolved click creates the note") instead of only
  // toasting. The story editor keeps its warn-toast behavior.
  const handleNotesWikiLinkClick = useCallback((target: string) => {
    const resolution = resolveCrossTabLink(target, {
      stories,
      entities: allEntities,
      notePaths: allNotePaths,
    });
    if (resolution.status === 'single') {
      applyCrossTabLinkMatch(resolution.matches[0]);
      return;
    }
    if (resolution.status === 'ambiguous') {
      setAmbiguousLink({ rawTarget: resolution.rawTarget, matches: resolution.matches });
      return;
    }
    const newNotePath = notePathForUnresolvedLink(target);
    if (!newNotePath) return;
    void (async () => {
      const stem = wikiLinkTargetStem(target);
      // Guard against a stale notePaths index: if the file already exists,
      // just open it rather than overwrite.
      const existing = await window.api.readNotesVault(newNotePath);
      if (!('error' in existing)) {
        setOpenedNotePath(newNotePath);
        handleNotesSubViewChange('editor');
        handleTabChange('notes');
        return;
      }
      const written = await window.api.writeNotesVault(newNotePath, buildUnresolvedLinkNote(target));
      if ('error' in written) {
        showWikiLinkToast(`Could not create "${stem}" in the Notes Vault`, 'error');
        return;
      }
      showWikiLinkToast(`Created "${stem}" in the Notes Vault`);
      void loadEntities(); // refresh note paths so the link resolves immediately
      setSelectedScene(null);
      setSelectedChapter(null);
      setSelectedStory(null);
      setSelectedEntity(null);
      setOpenedNotePath(newNotePath);
      handleNotesSubViewChange('editor');
      handleTabChange('notes');
    })();
  }, [stories, allEntities, allNotePaths, applyCrossTabLinkMatch, handleNotesSubViewChange, handleTabChange, loadEntities, showWikiLinkToast]);

  // M16: hover-preview resolver — notes read via the vault IPC, scenes from
  // the already-loaded in-memory blocks. Null means "unresolved" and the card
  // shows the click-would-create hint.
  const resolveNotesWikiLinkPreview = useCallback(async (target: string): Promise<WikiLinkPreviewData | null> => {
    const resolution = resolveCrossTabLink(target, {
      stories,
      entities: allEntities,
      notePaths: allNotePaths,
    });
    if (resolution.matches.length === 0) return null;
    const match = resolution.matches[0];
    if (match.kind === 'scene') {
      return {
        kind: 'scene',
        title: match.scene.title,
        subtitle: `${match.story.title} › ${match.chapter.title}`,
        markdown: match.scene.blocks.map((b) => b.content).join('\n\n'),
      };
    }
    const r = await window.api.readNotesVault(match.entityPath);
    if ('error' in r) return null; // fallback entity whose file does not exist yet
    return {
      kind: 'note',
      title: match.entity.name,
      subtitle: match.entityPath,
      markdown: r.content,
    };
  }, [stories, allEntities, allNotePaths]);

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
            onExport={(scope: ExportScope) => setExportScope(scope)}
            journalModeEnabled={appSettings?.journalMode?.enabled ?? false}
            onBetaRead={betaReadNote}
            onContinuityCheck={continuityCheckNote}
          />
        );
      case 'vault-graph':
        return <VaultGraphView onOpenNote={handleOpenSceneByPath} onOpenScene={handleOpenGraphScene} />;
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
            autoApply={appSettings?.agents?.writingAssistant?.autoApply ?? false}
            autoApplyCategories={appSettings?.agents?.writingAssistant?.autoApplyCategories}
            onAutoApplyCategoriesChange={handleWaAutoApplyCategoriesChange}
            ttsSettings={appSettings?.tts}
            voiceEnabled={appSettings?.voice?.enabled ?? false}
            voicePrefs={appSettings?.voice}
            displayName={resolveAgentDisplayName('writingAssistant', appSettings?.agentNames)}
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
            onDraftRestore={handleSceneRestore}
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
      case 'brainstorm':
        return (
          <BrainstormPage
            onClose={() => {}}
            enabled={appSettings?.agents?.brainstorm?.enabled ?? true}
            voiceEnabled={appSettings?.agents?.brainstorm?.voiceEnabled ?? false}
            archiveContinuityEnabled={(appSettings?.agents?.archive?.enabled ?? true) && (appSettings?.archiveContinuityEnabled ?? true)}
            activeScene={activeSceneForSidebar}
            activeStorySlug={selectedStory ? selectedStory.path.split(/[\\/]/).filter(Boolean).pop() ?? null : null}
            ttsSettings={appSettings?.tts}
            voicePrefs={appSettings?.voice}
            compact
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
    handleOpenSceneByPath, handleOpenGraphScene, setExportScope, appSettings,
    view, handleJumpToText,
    setContinuityCount, setSettingsOpen,
    activeSceneForSidebar, handleWaAutoApplyCategoriesChange,
    pane2Chapter, pane2Story, usePane2SidebarContext, handleSceneRestore,
    betaReadNote, continuityCheckNote,
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

  // ─── Header depth slider navigation (MYT-378 / SKY-5156) ───
  // Nav state + stepping are delegated to the pure stepScene selector so the
  // header arrows cross chapter/story boundaries within the active depth band
  // (bounded at the very first/last scene of the story). See stepScene.ts.

  const depthStepState = useMemo(
    () => computeStepState(viewDepth, selectedScene, selectedChapter, selectedStory, stories),
    [viewDepth, selectedScene, selectedChapter, selectedStory, stories],
  );
  const depthCanPrev = depthStepState.canPrev;
  const depthCanNext = depthStepState.canNext;
  const depthContextLabel = depthStepState.contextLabel;

  // §6: empty state — depth=scene but selected chapter has no scenes
  const depthIsEmpty = useMemo(
    () => viewDepth === 'scene' && selectedChapter !== null && selectedChapter.scenes.length === 0,
    [viewDepth, selectedChapter],
  );

  // Apply a stepScene target: open the scene when present, otherwise focus the
  // chapter/story (empty chapter or scene-less story edge cases).
  const applyStepTarget = useCallback((target: StepSceneTarget | null) => {
    if (!target) return;
    if (target.scene && target.chapter) {
      handleSelectScene(target.scene, target.chapter, target.story);
    } else {
      setSelectedScene(null);
      setSelectedChapter(target.chapter);
      setSelectedStory(target.story);
      setSelectedEntity(null);
    }
  }, [handleSelectScene]);

  const handleDepthPrev = useCallback(() => {
    applyStepTarget(
      stepScene({ direction: 'prev', depth: viewDepth, selectedScene, selectedChapter, selectedStory, stories }),
    );
  }, [viewDepth, selectedScene, selectedChapter, selectedStory, stories, applyStepTarget]);

  const handleDepthNext = useCallback(() => {
    applyStepTarget(
      stepScene({ direction: 'next', depth: viewDepth, selectedScene, selectedChapter, selectedStory, stories }),
    );
  }, [viewDepth, selectedScene, selectedChapter, selectedStory, stories, applyStepTarget]);

  const handleViewDepthChange = useCallback((newDepth: ViewDepth) => {
    setViewDepth(newDepth);
    if (newDepth === 'scene' && !selectedScene && selectedChapter && selectedStory) {
      const first = [...selectedChapter.scenes].sort((a, b) => a.order - b.order)[0];
      if (first) handleSelectScene(first, selectedChapter, selectedStory);
    }
  }, [selectedScene, selectedChapter, selectedStory, handleSelectScene, setViewDepth]);

  // SKY-1699: word counts for both panes in split mode — must be before early returns (rules-of-hooks).
  const splitWordCounts = useMemo(() => {
    if (!splitWindowEnabled) return null;
    const countBlocks = (scene: Scene | null) =>
      scene
        ? scene.blocks.map((b) => b.content.trim().split(/\s+/).filter(Boolean).length).reduce((a, c) => a + c, 0)
        : 0;
    return { pane1: countBlocks(selectedScene), pane2: countBlocks(pane2Scene) };
  }, [splitWindowEnabled, selectedScene, pane2Scene]);

  // SKY-3218 / GH #643: derive nav-rail items from the user's saved navConfig
  // (Settings → Appearance → Nav-bar). Newer default items missing from an
  // older saved config are appended so upgrades surface new sections; an
  // all-disabled config falls back to the defaults so the rail never strands
  // the user.
  const savedNavConfig = appSettings?.navConfig;
  // Beta 3 M9: heading-zoom manuscript replaces the book/chapter depth views.
  // Cursor indices follow the model's order-field sorting.
  const manuscriptCursor = useMemo<ManuscriptCursor>(() => {
    const zoom: ZoomLevel =
      viewDepth === 'book'
        ? (manuscriptPartZoom ? 'part' : 'book')
        : viewDepth === 'chapter' ? 'chapter' : 'scene';
    if (!selectedStory) return { zoom, part: 0, chapter: 0, scene: 0 };
    const chapters = [...selectedStory.chapters].sort((a, b) => a.order - b.order);
    const ci = Math.max(0, selectedChapter ? chapters.findIndex((c) => c.id === selectedChapter.id) : 0);
    const scenes = chapters[ci] ? [...chapters[ci].scenes].sort((a, b) => a.order - b.order) : [];
    const si = Math.max(0, selectedScene ? scenes.findIndex((sc) => sc.id === selectedScene.id) : 0);
    return { zoom, part: 0, chapter: ci, scene: si };
  }, [viewDepth, manuscriptPartZoom, selectedStory, selectedChapter, selectedScene]);

  const handleManuscriptCursorChange = useCallback((cursor: ManuscriptCursor) => {
    if (!selectedStory) return;
    const chapters = [...selectedStory.chapters].sort((a, b) => a.order - b.order);
    const ch = chapters[Math.min(cursor.chapter, Math.max(0, chapters.length - 1))];
    if (ch) {
      const scenes = [...ch.scenes].sort((a, b) => a.order - b.order);
      const sc = scenes[Math.min(cursor.scene, Math.max(0, scenes.length - 1))];
      if (sc) handleSelectScene(sc, ch, selectedStory);
    }
    // setViewDepth clears manuscriptPartZoom as a side effect, so the 'part'
    // flag must be (re-)applied after it, not before — see SKY-6010.
    setViewDepth(cursor.zoom === 'part' ? 'book' : cursor.zoom);
    setManuscriptPartZoom(cursor.zoom === 'part');
  }, [selectedStory, handleSelectScene, setViewDepth]);

  // Chapter-agnostic persistence (book zoom edits any chapter's scene — the
  // SKY-3211 handlers assume selectedChapter, so these find the owner).
  const handleManuscriptEditParagraph = useCallback((sceneId: string, blockId: string, newText: string) => {
    if (!selectedStory) return;
    const owner = selectedStory.chapters.find((ch) => ch.scenes.some((sc) => sc.id === sceneId));
    const scene = owner?.scenes.find((sc) => sc.id === sceneId);
    if (!owner || !scene) return;
    const blocks = scene.blocks.map((b) => (b.id === blockId ? { ...b, content: newText } : b));
    const updatedScene: Scene = { ...scene, blocks, updatedAt: now() };
    const updatedStories = stories.map((story) =>
      story.id !== selectedStory.id ? story : {
        ...story,
        chapters: story.chapters.map((ch) =>
          ch.id !== owner.id ? ch : { ...ch, scenes: ch.scenes.map((sc) => (sc.id !== sceneId ? sc : updatedScene)) }
        ),
      }
    );
    updateManifest(updatedStories);
    persistSceneMarkdown(updatedScene);
    window.api.snapshotSave?.(sceneId, blocks.map((b) => b.content).join('\n\n')).catch(() => {});
  }, [selectedStory, stories, updateManifest, persistSceneMarkdown]);

  const handleManuscriptCycleStatus = useCallback((sceneId: string) => {
    if (!selectedStory) return;
    const owner = selectedStory.chapters.find((ch) => ch.scenes.some((sc) => sc.id === sceneId));
    const scene = owner?.scenes.find((sc) => sc.id === sceneId);
    if (!owner || !scene) return;
    const next = cycleStatus(sceneStatus(scene));
    const draftState = next === 'draft' ? 'in-progress' as const : next === 'done' ? 'final' as const : undefined;
    const updatedScene: Scene = { ...scene, draftState, updatedAt: now() };
    const updatedStories = stories.map((story) =>
      story.id !== selectedStory.id ? story : {
        ...story,
        chapters: story.chapters.map((ch) =>
          ch.id !== owner.id ? ch : { ...ch, scenes: ch.scenes.map((sc) => (sc.id !== sceneId ? sc : updatedScene)) }
        ),
      }
    );
    updateManifest(updatedStories);
  }, [selectedStory, stories, updateManifest]);

  // Beta 3 M10: paragraph grip drag — pure move via the model, then persist
  // every changed scene through the same per-scene markdown + snapshot path
  // paragraph edits use (scene files stay the storage unit).
  const handleManuscriptMoveParagraph = useCallback((from: ParagraphRef, to: ParagraphRef) => {
    if (!selectedStory) return;
    const res = moveParagraph(selectedStory, from, to);
    if (!res) return;
    const stamp = now();
    const changed = new Set(res.changedSceneIds);
    const stampedStory: Story = {
      ...res.story,
      chapters: res.story.chapters.map((ch) =>
        ch.scenes.some((sc) => changed.has(sc.id))
          ? { ...ch, scenes: ch.scenes.map((sc) => (changed.has(sc.id) ? { ...sc, updatedAt: stamp } : sc)) }
          : ch
      ),
    };
    updateManifest(stories.map((st) => (st.id === selectedStory.id ? stampedStory : st)));
    for (const ch of stampedStory.chapters) {
      for (const sc of ch.scenes) {
        if (!changed.has(sc.id)) continue;
        persistSceneMarkdown(sc);
        const content = [...sc.blocks].sort((a, b) => a.order - b.order).map((b) => b.content).join('\n\n');
        window.api.snapshotSave?.(sc.id, content).catch(() => {});
      }
    }
    showLnToast('Block moved');
  }, [selectedStory, stories, updateManifest, persistSceneMarkdown]);

  // Beta 3 M10: manuscript sheet width (prototype pageW) persisted app-wide.
  const handleManuscriptPageWidthChange = useCallback((px: number) => {
    setAppSettings((prev) => {
      if (!prev || prev.manuscriptPageWidth === px) return prev;
      const updated: AppSettings = { ...prev, manuscriptPageWidth: px };
      window.api.settingsSet(updated).catch(() => {});
      return updated;
    });
  }, []);

  // Beta 3 M10 toolbar actions (prototype 766-777). Read is scripted until the
  // M13 TTS Reader lands; Dictate reuses the existing voice pipeline; Assist
  // surfaces the Writing Assistant panel in the left sidebar (GH #633 home).
  const handleToolbarRead = useCallback(() => {
    showLnToast('Read aloud arrives with the TTS Reader milestone (M13)');
  }, []);

  const handleToolbarDictate = useCallback(() => {
    if (!appSettings?.voice?.enabled) {
      showLnToast('Enable Voice in Settings to dictate');
      return;
    }
    if (voiceActive) stopVoice().catch(() => {});
    else startVoice().catch(() => {});
  }, [appSettings?.voice?.enabled, voiceActive, startVoice, stopVoice]);

  const handleToolbarAssist = useCallback(() => {
    const cur = leftSidebarLayoutRef.current;
    const panels = cur.panels.some((pnl) => pnl.id === 'writing-assistant')
      ? cur.panels.map((pnl) => (pnl.id === 'writing-assistant' ? { ...pnl, collapsed: false } : pnl))
      : [{ id: 'writing-assistant' as SidebarPanelId, collapsed: false }, ...cur.panels];
    persistLeftSidebarLayout({ ...cur, panels, sidebarCollapsed: false });
  }, [persistLeftSidebarLayout]);

  const manuscriptToolbarActions = useMemo(() => ({
    onRead: handleToolbarRead,
    onDictate: handleToolbarDictate,
    dictating: voiceActive,
    onAssist: handleToolbarAssist,
  }), [handleToolbarRead, handleToolbarDictate, voiceActive, handleToolbarAssist]);

  // Beta 3 M6 → Beta 4 M4: context-menu "Pop out into new window". Document
  // tabs have no dedicated window host yet, so they explain themselves (§1.2
  // "nothing is dead") until the doc pop-out window lands; module kinds with
  // a FloatingPanelApp renderer keep the SKY-1697 float flow.
  const handleTabPopOut = useCallback((tabId: string) => {
    const tab = storyDocTabs.find((t) => t.id === tabId) ?? notesDocTabs.find((t) => t.id === tabId);
    if (!tab) return;
    const floatable: Partial<Record<WorkspaceTabKind, SidebarPanelId>> = {
      timeline: 'timeline',
      entities: 'entities',
      'vault-graph': 'vault-graph',
    };
    const panelId = floatable[tab.kind];
    if (!panelId) {
      showLnToast('Documents can’t pop out into their own window yet — use Open to the side');
      return;
    }
    window.api.panelFloat?.(panelId, { sourceSidebar: 'right' }).catch(() => {});
    setAppSettings((prev) => {
      if (!prev) return prev;
      const existing = prev.activeLayout?.floatingPanels ?? [];
      if (existing.some((e) => e.panelId === panelId)) return prev;
      const entry: FloatingPanelEntry = { panelId, x: 0, y: 0, width: 360, height: 600, alwaysOnTop: false, lastDockSidebar: 'right' };
      const updated: AppSettings = { ...prev, activeLayout: { ...prev.activeLayout, leftSidebar: leftSidebarLayoutRef.current, floatingPanels: [...existing, entry] } };
      window.api.settingsSet(updated).catch(() => {});
      return updated;
    });
    handleWorkspaceTabClose(tabId);
  }, [storyDocTabs, notesDocTabs, handleWorkspaceTabClose]);

  // Beta 3 M7: Stories popover data for the nav rail (prototype 179-203).
  // Beta 4 M3: subtitle = the wizard's voice preset (genre · voice · POV),
  // falling back to a chapter count for pre-wizard stories.
  const navRailStories = useMemo(
    () => stories.map((st) => ({
      id: st.id,
      title: st.title,
      subtitle: [st.genre, st.voice, st.pov].filter(Boolean).join(' · ')
        || `${st.chapters.length} chapter${st.chapters.length === 1 ? '' : 's'}`,
      active: st.id === selectedStory?.id,
    })),
    [stories, selectedStory],
  );
  const handleRailStorySelect = useCallback((id: string) => {
    const st = stories.find((x) => x.id === id);
    if (!st) return;
    setSelectedStory(st);
    handleNavSectionChange('story');
  }, [stories, handleNavSectionChange]);

  // ── Beta 4 M3: six-module nav rail (FULL-SPEC §4; prototype navItems 5681) ──
  // story/notes/brainstorm stay top-level tabs; crafter/timeline are Story
  // sub-view surfaces and graph is the Notes graph surface. M4's document-tab
  // model owns the strip (static pseudo-tab / hidden per view), so rail clicks
  // switch section + sub-view directly instead of creating module tabs.
  const handleNavModuleChange = useCallback((moduleId: NavRailModuleId) => {
    switch (moduleId) {
      case 'crafter':
        handleNavSectionChange('story');
        handleSetView('kanban');
        break;
      case 'timeline':
        handleNavSectionChange('story');
        handleSetView('timeline');
        break;
      case 'graph':
        handleNavSectionChange('notes');
        handleNotesSubViewChange('graph');
        break;
      case 'story':
        handleNavSectionChange('story');
        // Scene Crafter and Timeline have their own rail items now, so a
        // Story Writer click always lands on the editor sub-view (the other
        // Story sub-tabs — structure/book — still restore normally).
        if (tabShellRef.current.storySubView === 'kanban' || tabShellRef.current.storySubView === 'timeline') {
          handleSetView('editor');
        }
        break;
      case 'notes':
        handleNavSectionChange('notes');
        // Vault Graph is its own rail item — a Notes Editor click shows notes.
        if (tabShellRef.current.notesSubView === 'graph') handleNotesSubViewChange('editor');
        break;
      default:
        handleNavSectionChange(moduleId);
    }
  }, [handleNotesSubViewChange, handleNavSectionChange, handleSetView]);

  // Which rail module is lit: derived from the actual displayed surface so
  // the slot-glow pill follows crafter/timeline/graph sub-views too.
  const activeNavModule: NavRailModuleId = tabShell.activeTab === 'story'
    ? (view === 'kanban' ? 'crafter' : view === 'timeline' ? 'timeline' : 'story')
    : tabShell.activeTab === 'notes'
      ? (tabShell.notesSubView === 'graph' ? 'graph' : 'notes')
      : 'brainstorm';

  // Beta 4 M3: rail edit popover rows — the full merged module config
  // (hidden items included) in user order; SKY-5903 merge semantics apply.
  const railEditItems = useMemo(
    () => mergeNavConfigItems(appSettings?.navConfig?.items, NAV_RAIL_DEFAULTS.items)
      .sort((a, b) => a.order - b.order),
    [appSettings?.navConfig?.items],
  );

  // Beta 4 M3: persist rail reorder/hide from the edit popover (survives
  // restarts via the same settings file the Settings → Nav-bar card writes).
  const persistNavRailConfigItems = useCallback((items: NavRailItemConfig[]) => {
    setAppSettings((prev) => {
      if (!prev) return prev;
      const base = prev.navConfig ?? NAV_RAIL_DEFAULTS;
      const updated: AppSettings = { ...prev, navConfig: { ...base, items } };
      window.api.settingsSet(updated).catch(() => {});
      return updated;
    });
  }, []);

  // Beta 4 M3: New Story wizard create — the story AND its Story Plan note
  // (import-flow convention: Notes Vault `Plans/Plan — <name>.md`, which
  // Scene Crafter and the timeline auto-build already read).
  const handleCreateStoryFromWizard = useCallback(async (draft: NewStoryDraft) => {
    const story = makeStoryFromDraft(draft, { id: generateId(), createdAt: now() });
    updateManifest([...stories, story]);
    setSelectedStory(story);
    setNewStoryOpen(false);
    handleNavSectionChange('story');
    let planWritten = false;
    try {
      const listing = await window.api.listNotesVault?.();
      const taken = listing && !('error' in listing) ? listing.items.map((i) => i.path) : [];
      const rel = dedupePlanRelPath(story.title, taken);
      const res = await window.api.writeNotesVault?.(rel, buildNewStoryPlanNote(story, draft));
      planWritten = !!res && !('error' in res);
    } catch {
      /* non-fatal — the toast reports it */
    }
    showLnToast(planWritten
      ? `“${story.title}” created — plan note added; Brainstorm will fill the outline`
      : `“${story.title}” created — the Story Plan note could not be written`);
  }, [stories, updateManifest, handleNavSectionChange]);

  // Beta 3 M5: command palette entries (prototype cmdIndex 3900-3913) — the
  // Ctrl-K panel lists these above the vault search hits.
  const paletteCommands = useMemo(() => [
    { t: 'Toggle focus mode', sub: 'Hide chrome · just the page', run: () => toggleDistractionFree() },
    { t: 'Open appearance settings', sub: 'Theme · glass · neon', run: () => setSettingsOpen(true) },
    { t: 'Export…', sub: 'DOCX · EPUB · Markdown', run: () => { if (selectedStory) setExportScope({ kind: 'story', storyId: selectedStory.id }); else showLnToast('Select a story first to export.'); } },
    { t: 'Welcome tour', sub: 'Replay the intro', run: () => setTourOpen(true) },
    { t: 'Keyboard shortcuts', sub: 'Every binding at a glance', run: () => setShortcutsOpen(true) },
    { t: 'Prompt history', sub: 'Past agent prompts', run: () => setHistoryOpen(true) },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [selectedStory, toggleDistractionFree]);

  // Beta 3 M5: feed the title-bar bell from real agent activity.
  const prevProposedRef = useRef(0);
  useEffect(() => {
    if (proposedCount > prevProposedRef.current) {
      pushNotification({
        kind: 'sugg',
        title: `New suggestion ready${proposedCount > 1 ? ` (${proposedCount} pending)` : ''}`,
        detail: 'Writing Assistant — open Suggestion Review',
        onOpen: () => handleGrsVisibilityChange(true),
      });
    }
    prevProposedRef.current = proposedCount;
  }, [proposedCount, handleGrsVisibilityChange]);

  const prevContinuityRef = useRef(0);
  useEffect(() => {
    if (continuityCount > prevContinuityRef.current) {
      pushNotification({
        kind: 'archive',
        title: `Archive Agent flagged ${continuityCount} continuity issue${continuityCount === 1 ? '' : 's'}`,
        detail: 'Click to review in the Continuity panel',
        onOpen: () => handleGrsVisibilityChange(true),
      });
    }
    prevContinuityRef.current = continuityCount;
  }, [continuityCount, handleGrsVisibilityChange]);

  // Beta 3 M5 / Beta 4 M2: prototype title-bar menus (menuDefs, prototype 6810–
  // 6816) mapped to the app's real handlers — every item acts or explains
  // itself (§1.2, no silent no-ops).
  const titleBarMenus: WindowChromeMenu[] = useMemo(() => [
    { label: 'File', items: [
      { label: 'New scene', run: () => {
        if (selectedStory && selectedChapter) void createScene(selectedStory.id, selectedChapter.id);
        else showLnToast('Open a chapter first — New scene appends to the current chapter');
      } },
      { label: 'New story', run: () => { void createStory(); } },
      { label: 'New note…', run: () => handleNavSectionChange('notes') },
      { label: 'Import vault / story…', run: () => setSettingsOpen(true) },
      { label: 'Export…', run: () => { if (selectedStory) setExportScope({ kind: 'story', storyId: selectedStory.id }); else showLnToast('Select a story first to export.'); } },
      { label: 'Prompt history…', run: () => setHistoryOpen(true) },
    ] },
    { label: 'Edit', items: [
      { label: 'Undo', run: () => { document.execCommand('undo'); } },
      { label: 'Redo', run: () => { document.execCommand('redo'); } },
      { label: 'Find everywhere…', run: () => { setGlobalSearchSeed(''); setGlobalSearchOpen(true); } },
    ] },
    { label: 'View', items: [
      { label: 'Toggle left panel', run: () => setLeftPanelHidden((h) => !h) },
      { label: 'Toggle right panel', run: () => handleGrsVisibilityChange(!(grsVisible ?? true)) },
      { label: 'Focus mode', run: () => toggleDistractionFree() },
      { label: 'Slim rail', run: () => persistNavRailCollapsed(!navRailCollapsed) },
      { label: topBarHidden ? 'Show top bar' : 'Hide top bar', run: () => toggleTopBar() },
      { label: 'Keyboard shortcuts…', run: () => setShortcutsOpen(true) },
    ] },
    { label: 'Insert', items: [
      { label: 'Beat (Scene Crafter)', run: () => { handleTabChange('story'); handleSetView('kanban'); } },
      { label: 'Comment', run: () => showLnToast('Select text in the manuscript, then hit Comment') },
      { label: 'Wiki link [[…]]', run: () => showLnToast('Type [[ in any note to link — Obsidian style') },
    ] },
    { label: 'Tools', items: [
      { label: 'Run continuity scan', run: () => { handleGrsVisibilityChange(true); showLnToast('Archive Agent scanning — check the Continuity panel'); } },
      // Prototype 6814: Beta Reader reads the open scene/chapter, reactions
      // land as margin comments (BetaReadMargin next to the manuscript).
      { label: 'Beta read this chapter', run: () => {
        if (!selectedScene) { showLnToast('Open a scene first — the Beta Reader reads the open chapter'); return; }
        const text = selectedScene.blocks.map((b) => b.content).join('\n\n');
        if (!text.trim()) { showLnToast('This scene is empty — nothing to beta read'); return; }
        void handleBetaReadRequest(text);
        showLnToast('Beta Reader queued — reactions land as margin comments');
      } },
      { label: 'Rebuild search index', run: () => {
        showLnToast('Rebuilding search index…');
        void window.api.reindexVault?.()
          .then((r) => showLnToast(`Index rebuilt — ${r.scanned} files scanned, ${r.updated} updated`))
          .catch(() => showLnToast('Index rebuild failed — the index still updates as you write'));
      } },
    ] },
    { label: 'Help', items: [
      { label: 'Welcome tour', run: () => setTourOpen(true) },
      { label: 'Keyboard shortcuts…', run: () => setShortcutsOpen(true) },
      { label: 'About Mythos Writer', run: () => setSettingsOpen(true) },
      { label: 'Check for updates', run: () => {
        showLnToast('Checking for updates…');
        void window.api.checkForUpdate?.()
          .then((r) => { if (!r?.queued) showLnToast(r?.reason ?? 'Updates are unavailable in this build'); })
          .catch(() => showLnToast('Update check failed — try again later'));
      } },
    ] },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [selectedStory, selectedChapter, selectedScene, grsVisible, navRailCollapsed, topBarHidden, handleNavSectionChange, handleGrsVisibilityChange, toggleDistractionFree, persistNavRailCollapsed, toggleTopBar, createStory, createScene, handleTabChange, handleSetView, handleBetaReadRequest]);

  const navItems = useMemo<NavRailItem[]>(
    () => resolveNavRailItems(savedNavConfig, NAV_RAIL_DEFAULTS),
    [savedNavConfig],
  );

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
  // Beta 4 M2: View → Toggle left panel is a real user toggle (§4).
  const showLeftSidebar = !distractionFree && !leftPanelHidden && (writingMode !== 'focus' || focusPrefs.showLeftSidebar);
  const showBottomBar = !distractionFree && (writingMode !== 'focus' || focusPrefs.showBottomBar);

  // SKY-3618: Compute clamped display widths so center column always gets >= CENTER_MIN_WIDTH pixels.
  // The stored layout.leftWidth / layout.rightWidth are preserved unchanged; only the rendered width is clamped.
  const grsEffectiveWidth =
    grsVisible === true
      ? Math.max(200, Math.min(600, grsWidth))
      : grsVisible === false
      ? GRS_COLLAPSED_STRIP_WIDTH
      : 0;
  const panelsAvailableWidth = windowInnerWidth - grsEffectiveWidth;
  const { left: clampedLeftWidth } = computeClampedSidebarWidths(
    layout.leftWidth,
    layout.rightWidth,
    showLeftSidebar,
    false, // legacy shell-right removed; GRS manages the right panel independently
    panelsAvailableWidth,
  );
  // Update drag maxima every render so onMouseMove sees fresh values (ref = no stale closure)
  dragConstraintRef.current = {
    maxLeft: Math.min(
      500,
      Math.max(PANEL_MIN_WIDTH, panelsAvailableWidth - CENTER_MIN_WIDTH - DIVIDER_WIDTH * 2),
    ),
    maxRight: Math.min(
      500,
      Math.max(PANEL_MIN_WIDTH, panelsAvailableWidth - CENTER_MIN_WIDTH - DIVIDER_WIDTH * 2 - (showLeftSidebar ? layout.leftWidth : 0)),
    ),
  };
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

  const activeVaultBadge = tabShell.activeTab === 'notes'
    ? (vaultBinding.notesValid ? labelFromPath(vaultBinding.notesPath) : 'No Notes vault')
    : tabShell.activeTab === 'brainstorm'
      ? (vaultBinding.storyValid ? labelFromPath(vaultBinding.storyPath || activeVaultRoot) : 'No Story vault')
      : (vaultBinding.storyValid ? labelFromPath(vaultBinding.storyPath || activeVaultRoot) : 'No Story vault');
  const activeVaultBadgeTitle = tabShell.activeTab === 'notes'
    ? vaultBinding.notesPath
    : vaultBinding.storyPath || activeVaultRoot;
  const activeVaultBadgeMissing = tabShell.activeTab === 'notes' ? !vaultBinding.notesValid : !vaultBinding.storyValid;
  const activeVaultBadgeLabel = `${tabShell.activeTab === 'notes' ? 'Notes' : tabShell.activeTab === 'brainstorm' ? 'Brainstorm' : 'Story'} vault: ${activeVaultBadge}`;
  const showSampleProjectBanner = appSettings?.onboardingStartMode === 'sample'
    && !appSettings.sampleProjectBannerDismissed;

  const navRailConfig = appSettings?.navConfig;

  return (
    <PanelDragProvider onDrop={handlePanelDrop} onFloatDrop={handleFloatPanel} onTabBarDrop={handleTabBarDrop} onTabGroupDrop={handleTabGroupDrop}>
    <div className={shellClasses}>
      {/* Beta 3 Liquid Neon (M2): wallpaper + ambience + scrim + vignette,
          behind every glass panel (prototype HTML 45–54). */}
      <BackgroundStack settings={appSettings?.liquidNeonV2} />
      {/* Beta 4 W0.5 (B4-1): the animated neon window frame ring is deleted —
          a full-viewport conic-gradient + hue-rotate paint storm (PERFORMANCE
          §3). Panel border overlays keep the neon look. */}
      <UpdateBanner />
      {/* Beta 3 M5: the prototype's single 44px title bar replaces the old
          WindowChrome + AppMenuBar rows (menus, Ctrl-K pill, bell, account). */}
      {showTitleBar && (
        <WindowChrome
          menus={titleBarMenus}
          onOpenPalette={(seed) => { setGlobalSearchSeed(seed ?? ''); setGlobalSearchOpen(true); }}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenAccount={() => setAccountModalOpen(true)}
          activeVaultRoot={activeVaultRoot}
          onProjectSwitched={handleProjectSwitched}
          onNewStory={() => { void createStory(); }}
          onOpenVault={() => { void openVaultViaPicker(); }}
          onCreateVault={() => { void createMythosVault(); }}
          onReplayOnboarding={() => {
            window.api?.onboardingReset?.().then(() => window.location.reload()).catch(() => {});
          }}
          notificationCenter={<NotificationCenter />}
        />
      )}
      {/* SKY-3098: AppNavRail + main content column */}
      <div className="desktop-shell__body">
        {showTitleBar && (
          <AppNavRail
            activeSection={activeNavModule}
            onSectionChange={handleNavModuleChange}
            onOpenAccount={() => setAccountModalOpen(true)}
            onOpenSettings={() => setSettingsOpen(true)}
            navItems={navItems}
            collapsed={navRailCollapsed}
            onToggleCollapsed={() => persistNavRailCollapsed(!navRailCollapsed)}
            showLabels={navRailConfig?.showLabels ?? true}
            showIcons={navRailConfig?.showIcons ?? true}
            neonOverlay={<BorderOverlay settings={appSettings?.liquidNeonV2} slot={6} delay={2.2} />}
            stories={navRailStories}
            onStorySelect={handleRailStorySelect}
            onNewStory={() => setNewStoryOpen(true)}
            editableItems={railEditItems}
            onEditableItemsChange={persistNavRailConfigItems}
          />
        )}
        <div className="desktop-shell__main-col">
        {/* Beta 4 M4 (§4): document tab strip — Story + Notes views only;
            static pseudo-tab on Scene Crafter/Entities; hidden on
            Brainstorm/Timeline/Graph (Settings/Beta are overlays). */}
        {showTitleBar && workspaceStripMode.kind !== 'hidden' && (
          <WorkspaceTabBar
            tabs={
              workspaceStripMode.kind === 'docs'
                ? (workspaceStripMode.strip === 'notes' ? notesDocTabs : storyDocTabs)
                : []
            }
            activeTabId={
              workspaceStripMode.kind === 'docs'
                ? (workspaceStripMode.strip === 'notes' ? activeNotesDocTabId : activeStoryDocTabId)
                : null
            }
            staticTabLabel={workspaceStripMode.kind === 'static' ? workspaceStripMode.label : undefined}
            onTabSelect={handleWorkspaceTabSelect}
            onTabClose={handleWorkspaceTabClose}
            onTabReorder={handleWorkspaceTabReorder}
            onNewTab={handleNewWorkspaceTab}
            onTabOpenInSplit={handleTabOpenInSplit}
            onTabPopOut={handleTabPopOut}
            onTabDragStart={setTabDragPayload}
            agentsActive={agentsActive}
            newTabTitle={
              workspaceStripMode.kind === 'docs' && workspaceStripMode.strip === 'notes'
                ? 'New note — via the notes explorer'
                : 'New blank scene — it only saves once you type'
            }
          />
        )}
        {/* SKY-2098: per-tab vault badge */}
        {showTitleBar && activeVaultBadge && (
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
            // Beta 3 Liquid Neon (M1): re-apply v2 slot-engine tokens on save.
            void applyLiquidNeonV2Theme(s.liquidNeonV2);
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
      {/* SKY-5592: outer flex row — GlobalRightSidebar persists across all top-level tabs (Story/Notes/Brainstorm) */}
      <div className="shell-main-row">
      {/* SKY-2094: Story tabpanel — wraps all story content; hidden when Notes tab active */}
      {tabShell.activeTab === 'story' && (
      <div id="app-tabpanel-story" role="tabpanel" aria-labelledby="app-tab-story" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
      {/* SKY-2095 (Phase 2 #2): Story sub-view bar — vault badge + sub-view toggles + writing mode. */}
      <StorySubViewBar
        activeSubView={view}
        onSubViewChange={handleSetView}
        vaultName={labelFromPath(vaultBinding.storyPath || activeVaultRoot)}
      />
      {showSampleProjectBanner && (
        <div
          className="sample-project-banner"
          data-testid="gs-sample-banner"
          role="status"
          aria-live="polite"
        >
          <div className="sample-project-banner__copy">
            <strong>Sample project</strong>
            <span>Explore the seeded scenes, characters, and notes, or replace them whenever you are ready.</span>
          </div>
          <button
            type="button"
            className="sample-project-banner__dismiss"
            data-testid="gs-sample-banner-dismiss"
            aria-label="Dismiss sample project banner"
            onClick={handleDismissSampleProjectBanner}
          >
            Dismiss
          </button>
        </div>
      )}
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
          {/* SKY-3185 — F5: TimelineRoot owns the mode switcher (Spreadsheet |
              AEON | AEON Track), grouping, and cross-view selection state. */}
          <TimelineRoot story={selectedStory} onOpenScene={handleOpenSceneById} />
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
      {activeDockedTabId === null && view === 'book' && (
        <div className="shell-book">
          <FullBookPreviewView story={selectedStory ?? null} />
        </div>
      )}
      {activeDockedTabId === null && view === 'editor' && <div className="shell-panels">
      {/* Left rail */}
      {showLeftSidebar && (
        <div className="shell-left" style={{ width: clampedLeftWidth }}>
          {/* Beta 3 M3: slot-A breathing border (prototype brL, delay 0) */}
          <BorderOverlay settings={appSettings?.liquidNeonV2} slot={1} delay={0} />
          <LeftRail
            leftSidebarLayout={leftSidebarLayout}
            onLeftSidebarLayoutChange={persistLeftSidebarLayout}
            renderPanelContent={renderSidebarPanel}
            rightPanelCount={grsPanels.length}
            onFloatPanel={(id) => handleFloatPanel(id, 'left')}
            onDockAsTab={(id) => handleDockPanelAsTab(id, 'left')}
            panelBadgeCounts={{ review: proposedCount }}
          />
        </div>
      )}

      {/* Left resize handle */}
      {showLeftSidebar && (
        <div
          role="separator"
          aria-label="Resize left panel"
          aria-orientation="vertical"
          aria-valuenow={clampedLeftWidth}
          aria-valuemin={PANEL_MIN_WIDTH}
          aria-valuemax={dragConstraintRef.current.maxLeft}
          tabIndex={0}
          className="shell-divider shell-divider-left"
          onMouseDown={(e) => startDrag('left', e)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') { e.preventDefault(); adjustPanelWidth('left', +8); }
            else if (e.key === 'ArrowLeft') { e.preventDefault(); adjustPanelWidth('left', -8); }
            else if (e.key === 'Home') { e.preventDefault(); persistLayout({ ...layout, leftWidth: PANEL_MIN_WIDTH }); }
            else if (e.key === 'End') { e.preventDefault(); persistLayout({ ...layout, leftWidth: dragConstraintRef.current.maxLeft }); }
          }}
        />
      )}

      {/* Center + bottom */}
      <div className="shell-center-column">
        {/* Beta 3 M3: slot-B breathing border (prototype brC, delay .8) */}
        <BorderOverlay settings={appSettings?.liquidNeonV2} slot={2} delay={0.8} />
        <div className="shell-editor">
          {/* SKY-1699/SKY-1700: Writing toolbar — DepthSlider + split toggle + layout picker */}
          <div className="shell-editor-toolbar">
            {/* W0.4 (GAP P0#4): at book/chapter depth the ManuscriptView's own
                doc header (zoom seg + breadcrumbs) is the single zoom bar —
                the DepthSlider only mounts at scene depth, where that header
                doesn't render. Exactly one zoom seg in the DOM at any time. */}
            {selectedStory && showTabBar && !splitWindowEnabled && viewDepth === 'scene' && (
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
            {/* SKY-3201: Story Assist — open Brainstorm tab seeded with active scene context */}
            {selectedScene && agentFlags.brainstorm && (
              <button
                className="story-assist-btn"
                type="button"
                aria-label="Open Brainstorm with current scene context (Story Assist)"
                data-testid="story-assist-btn"
                title="Story Assist — open Brainstorm with this scene's context (Ctrl+3)"
                onClick={() => {
                  const excerpt = selectedScene.blocks.map((b) => b.content).join(' ').slice(0, 300);
                  const seed = excerpt.trim()
                    ? `Story Assist: help me develop the scene "${selectedScene.title}". Here's what I have so far:\n\n${excerpt}…`
                    : `Story Assist: help me develop the scene "${selectedScene.title}".`;
                  setBrainstormSeedPrompt(seed);
                  handleTabChange('brainstorm');
                }}
              >
                ✦ Story Assist
              </button>
            )}
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
                className={`split-window-container${splitDirection === 'down' ? ' split-window-container--down' : ''}`}
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
                  onWikiLinkClick={handleWikiLinkClick}
                  resolvedWikiLinkTitles={wikiLinkTitleIndex}
                  wikiLinkCandidates={wikiLinkCandidates}
                  style={{ flex: splitRatio }}
                />
                <div
                  className="split-window-divider"
                  role="separator"
                  aria-label="Resize split panes"
                  aria-orientation={splitDirection === 'down' ? 'horizontal' : 'vertical'}
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
                  onWikiLinkClick={handleWikiLinkClick}
                  resolvedWikiLinkTitles={wikiLinkTitleIndex}
                  wikiLinkCandidates={wikiLinkCandidates}
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
              /* Beta 3 M9: the heading-zoom manuscript renders book zoom.
                 book-outline-view stays as an E2E selector-compat anchor. */
              <div className="shell-depth-view-wrap book-outline-view">
                <ManuscriptView
                  story={selectedStory}
                  cursor={manuscriptCursor}
                  onCursorChange={handleManuscriptCursorChange}
                  onEditParagraph={handleManuscriptEditParagraph}
                  onCycleStatus={handleManuscriptCycleStatus}
                  onMoveParagraph={handleManuscriptMoveParagraph}
                  pageWidth={appSettings?.manuscriptPageWidth ?? 1000}
                  onPageWidthChange={handleManuscriptPageWidthChange}
                  liquidNeon={appSettings?.liquidNeonV2}
                  onDictate={manuscriptToolbarActions.onDictate}
                  dictating={manuscriptToolbarActions.dictating}
                  onAssist={manuscriptToolbarActions.onAssist}
                  focusMode={writingMode === 'focus'}
                  autoLinkEntities={allEntities}
                  autoLinkMode={appSettings?.autoLinker?.mode ?? 'suggest'}
                  ttsSettings={appSettings?.tts}
                  voicePrefs={appSettings?.voice}
                />
                <DepthEdgeArrows
                  depth="book"
                  canPrev={depthCanPrev}
                  canNext={depthCanNext}
                  onPrev={handleDepthPrev}
                  onNext={handleDepthNext}
                />
              </div>
            ) : viewDepth === 'chapter' && selectedChapter ? (
              /* Beta 3 M9: chapter zoom of the same continuous manuscript.
                 chapter-continuous-view stays as an E2E compat anchor. */
              <div className="shell-depth-view-wrap chapter-continuous-view">
                <ManuscriptView
                  story={selectedStory!}
                  cursor={manuscriptCursor}
                  onCursorChange={handleManuscriptCursorChange}
                  onEditParagraph={handleManuscriptEditParagraph}
                  onCycleStatus={handleManuscriptCycleStatus}
                  onMoveParagraph={handleManuscriptMoveParagraph}
                  pageWidth={appSettings?.manuscriptPageWidth ?? 1000}
                  onPageWidthChange={handleManuscriptPageWidthChange}
                  liquidNeon={appSettings?.liquidNeonV2}
                  onDictate={manuscriptToolbarActions.onDictate}
                  dictating={manuscriptToolbarActions.dictating}
                  onAssist={manuscriptToolbarActions.onAssist}
                  focusMode={writingMode === 'focus'}
                  autoLinkEntities={allEntities}
                  autoLinkMode={appSettings?.autoLinker?.mode ?? 'suggest'}
                  ttsSettings={appSettings?.tts}
                  voicePrefs={appSettings?.voice}
                />
                <DepthEdgeArrows
                  depth="chapter"
                  canPrev={depthCanPrev}
                  canNext={depthCanNext}
                  onPrev={handleDepthPrev}
                  onNext={handleDepthNext}
                />
              </div>
            ) : selectedScene ? (
              <div className={`shell-editor-scene-wrap story-page-canvas${sceneFlashId === selectedScene.id ? ' shell-editor-scene-wrap--flash' : ''}`}>
                <DocHeader
                  title={selectedScene.title ?? ''}
                  onTitleChange={handleSceneTitleChange}
                  wordCount={focusWordCount}
                  breadcrumb={[selectedStory?.title ?? '', selectedChapter?.title ?? '', selectedScene.title ?? ''].filter(Boolean)}
                  zoom={docZoom}
                  onZoomChange={setDocZoom}
                  isFocusMode={writingMode === 'focus'}
                  onFocusToggle={() => setWritingMode(writingMode === 'focus' ? 'normal' : 'focus')}
                />
                <MarginRuler
                  widthPx={
                    pagePrefs.sizePreset === 'custom' && pagePrefs.customWidthPx != null
                      ? pagePrefs.customWidthPx
                      : (STORY_PAGE_PRESET_WIDTHS[pagePrefs.sizePreset] ?? 680)
                  }
                  onWidthChange={(px) => handlePagePrefsChange({ ...pagePrefs, sizePreset: 'custom', customWidthPx: px })}
                />
                <PageSetupPopover
                  isOpen={pageSetupOpen}
                  onClose={() => setPageSetupOpen(false)}
                  prefs={pagePrefs}
                  onPrefsChange={handlePagePrefsChange}
                  pageStyle={pageStyle}
                  onPageStyleChange={setPageStyle}
                />
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
                <PageChromeToolbar
                  prefs={pagePrefs}
                  onPrefsChange={handlePagePrefsChange}
                />
                {/* GH #842 (Beta 3 M10): Word-style draggable ruler — hidden in
                    Focus mode and when the top bar is hidden. */}
                {!inFocusOrDF && !topBarHidden && (
                  <PageRuler prefs={pagePrefs} onPrefsChange={handlePagePrefsChange} />
                )}
                <div
                  ref={pageWrapRef}
                  className={`shell-editor-beta-wrap shell-editor-beta-wrap--page-mode${isGettingStartedVisible(gettingStartedProgress) && !seenEmptySceneHints.has(selectedScene.id) ? ' shell-editor-beta-wrap--hint' : ''}`}
                  style={{ position: 'relative' }}
                >
                  {/* SKY-5904: anchored to the page-mode wrapper (max-width 720px,
                      centered) rather than the full-width canvas, so the arrows
                      hug the actual page edges instead of the outer pane edges. */}
                  <DepthEdgeArrows
                    depth="scene"
                    canPrev={depthCanPrev}
                    canNext={depthCanNext}
                    onPrev={handleDepthPrev}
                    onNext={handleDepthNext}
                  />
                  <BlockEditor
                    key={`${selectedScene.id}-${restoreKey}`}
                    scene={selectedScene}
                    enableHeadingFocus
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
                    resolvedWikiLinkTitles={wikiLinkTitleIndex}
                    wikiLinkCandidates={wikiLinkCandidates}
                    onSelectionChange={setEditorSelectionText}
                    toolbarActions={manuscriptToolbarActions}
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
                  <div
                    className="pct-drag-handle"
                    onMouseDown={handlePageDragStart}
                    role="separator"
                    aria-orientation="vertical"
                    aria-label="Drag to resize page width"
                    tabIndex={0}
                    onKeyDown={e => {
                      const cur = pagePrefs.customWidthPx ?? STORY_PAGE_PRESET_WIDTHS[pagePrefs.sizePreset] ?? 680;
                      if (e.key === 'ArrowRight') handlePagePrefsChange({ ...pagePrefs, sizePreset: 'custom', customWidthPx: Math.min(1400, cur + 10) });
                      else if (e.key === 'ArrowLeft') handlePagePrefsChange({ ...pagePrefs, sizePreset: 'custom', customWidthPx: Math.max(320, cur - 10) });
                    }}
                  />
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
                resolvedWikiLinkTitles={wikiLinkTitleIndex}
                wikiLinkCandidates={wikiLinkCandidates}
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
            onNavigateScene={handleNavigateScene}
            activeNotePath={openedNotePath}
            activeNoteWordCount={openedNoteWordCount}
            isVoiceActive={voiceActive}
            splitWordCounts={splitWordCounts}
            pageWidthPx={selectedScene
              ? (pagePrefs.customWidthPx ?? STORY_PAGE_PRESET_WIDTHS[pagePrefs.sizePreset] ?? 680)
              : null}
          />
        )}
      </div>

      </div>}{/* end shell-panels */}
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
          onWikiLinkClick={handleNotesWikiLinkClick}
          resolvedWikiLinkTitles={wikiLinkTitleIndex}
          wikiLinkCandidates={wikiLinkCandidates}
          sceneWikiLinkTitles={sceneWikiLinkTitleIndex}
          resolveWikiLinkPreview={resolveNotesWikiLinkPreview}
          notePaths={allNotePaths}
          noteSplitRequest={noteSplitRequest}
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
          onOpenScene={handleOpenGraphScene}
          onBetaRead={betaReadNote}
          onContinuityCheck={continuityCheckNote}
          onExport={(scope: ExportScope) => setExportScope(scope)}
          journalModeEnabled={appSettings?.journalMode?.enabled ?? false}
          brainstormEnabled={agentFlags.brainstorm}
          voiceEnabled={appSettings?.agents?.brainstorm?.voiceEnabled ?? false}
          ttsSettings={appSettings?.tts}
          voicePrefs={appSettings?.voice}
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
          onOpenBrainstorm={(seedText) => {
            setBrainstormSeedPrompt(seedText);
            handleTabChange('brainstorm');
          }}
        />
      )}
      {/* SKY-3623: Brainstorm top-level tab panel */}
      {tabShell.activeTab === 'brainstorm' && (
        <div
          id="app-tabpanel-brainstorm"
          role="tabpanel"
          aria-labelledby="app-tab-brainstorm"
          style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}
        >
          <BrainstormPage
            key={brainstormSeedPrompt ?? 'brainstorm'}
            onClose={() => handleTabChange('story')}
            enabled={agentFlags.brainstorm}
            voiceEnabled={appSettings?.agents?.brainstorm?.voiceEnabled ?? false}
            archiveContinuityEnabled={appSettings?.archiveContinuityEnabled ?? true}
            ttsSettings={appSettings?.tts}
            voicePrefs={appSettings?.voice}
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
            seedPrompt={brainstormSeedPrompt ?? undefined}
          />
        </div>
      )}
      {/* SKY-1686: Global right sidebar — only rendered once rightSidebarVisible is known from settings.
           undefined = settings not yet loaded or not seeded → omit entirely so layout is unchanged.
           This prevents the collapsed-edge strip from narrowing sibling views (e.g. timeline) before
           settings arrive, which caused TC-TL-06 detail-card pointer-event regression.
           SKY-5592: moved out of story-only conditional so it persists in Notes and Brainstorm modes.
           Forced into its collapsed-edge state (not unmounted) while NotesTabPanel's own embedded
           Brainstorm sidebar is expanded, so the two right-hand panels never both show full-width at
           once — avoids the double-sidebar duplication that a naive always-visible mount would cause. */}
      {grsVisible !== undefined && <GlobalRightSidebar
        visible={(grsVisible as boolean) && !distractionFree && (writingMode !== 'focus' || focusPrefs.showRightSidebar) && !(tabShell.activeTab === 'notes' && !notesBrainstormCollapsed)}
        width={grsWidth}
        panels={grsPanels}
        onVisibilityChange={handleGrsVisibilityChange}
        onWidthChange={handleGrsWidthChange}
        onPanelsChange={handleGrsPanelsChange}
        renderPanelContent={renderSidebarPanel}
        continuityIssueCount={continuityCount}
        reviewBadgeCount={proposedCount}
        leftPanelCount={leftSidebarLayout.panels.length}
        onFloatPanel={(id) => handleFloatPanel(id, 'right')}
        onDockAsTab={(id) => handleDockPanelAsTab(id, 'right')}
        neonOverlay={<BorderOverlay settings={appSettings?.liquidNeonV2} slot={3} delay={1.6} />}
        headerContent={isGettingStartedVisible(gettingStartedProgress) ? (
          <GettingStartedPanel
            progress={gettingStartedProgress!}
            onAction={handleGettingStartedAction}
            onDismiss={handleDismissGettingStarted}
            onToggleCollapse={handleToggleGsCollapsed}
          />
        ) : undefined}
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

      {/* Restore GettingStartedPanel when GlobalRightSidebar is not visible.
           migrateV1Layout seeds activeLayout.rightSidebar.visible=false for fresh installs/E2E seeds
           without layoutMigrationDone, so grsVisible becomes false (not undefined) after settings load.
           Condition: show whenever GRS is not open (grsVisible !== true).
           SKY-5592: also suppressed while NotesTabPanel's own embedded Brainstorm sidebar is expanded —
           otherwise this fallback stacks as a second full right-hand panel next to it in Notes mode. */}
      {grsVisible !== true && !(tabShell.activeTab === 'notes' && !notesBrainstormCollapsed) && isGettingStartedVisible(gettingStartedProgress) && gettingStartedProgress && (
        <aside className="gs-aside">
          <GettingStartedPanel
            progress={gettingStartedProgress}
            onAction={handleGettingStartedAction}
            onDismiss={handleDismissGettingStarted}
            onToggleCollapse={handleToggleGsCollapsed}
          />
        </aside>
      )}
      </div>{/* end shell-main-row (SKY-5592: outer row wrapping all tabs + GRS) */}
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
      <Toast message={wikiLinkToastState?.message ?? null} level={wikiLinkToastState?.level} className="app-toast--stacked" />
      {voiceListening && (
        <div className="voice-listening-badge" role="status" aria-live="polite" aria-label="Voice input active">
          Listening…
        </div>
      )}
      <GlobalSearchPanel
        open={globalSearchOpen}
        commands={paletteCommands}
        initialQuery={globalSearchSeed}
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
      {/* SKY-3098 (v0.3): AccountModal — wired to nav rail brand glyph */}
      {accountModalOpen && (
        <AccountModal open={accountModalOpen} onClose={() => setAccountModalOpen(false)} />
      )}
      {/* Beta 4 M3: New Story wizard — rail stories switcher → "New Story…" */}
      {newStoryOpen && (
        <NewStoryWizard
          open={newStoryOpen}
          onClose={() => setNewStoryOpen(false)}
          onCreate={(draft) => { void handleCreateStoryFromWizard(draft); }}
        />
      )}
        </div>{/* end desktop-shell__main-col */}
        {/* GH #643 split panes v1: right-hand workspace pane */}
        {workspaceSplitKind && (
          <WorkspaceSplitPane kind={workspaceSplitKind} onClose={closeSplitPane}>
            {workspaceSplitKind === 'kanban' ? (
              selectedStory ? (
                <SceneCrafterPage
                  key={`split-${selectedStory.id}`}
                  story={selectedStory}
                  onOpenNote={handleOpenSceneByPath}
                  onOpenScene={handleOpenSceneById}
                />
              ) : (
                <div className="shell-editor-empty"><p>Select a story to see its Scene Board.</p></div>
              )
            ) : workspaceSplitKind === 'timeline' ? (
              <TimelineRoot story={selectedStory} onOpenScene={handleOpenSceneById} />
            ) : workspaceSplitKind === 'vault-graph' ? (
              <VaultGraphView onOpenNote={handleOpenSceneByPath} onOpenScene={handleOpenGraphScene} />
            ) : workspaceSplitKind === 'entities' ? (
              <EntityBrowser
                onSelectEntity={handleSelectEntity}
                selectedEntityId={selectedEntity?.id ?? null}
              />
            ) : workspaceSplitKind === 'brainstorm' ? (
              <BrainstormPage
                onClose={closeSplitPane}
                enabled={agentFlags.brainstorm}
                voiceEnabled={appSettings?.agents?.brainstorm?.voiceEnabled ?? false}
                archiveContinuityEnabled={appSettings?.archiveContinuityEnabled ?? true}
                activeScene={selectedScene}
                activeStorySlug={selectedStory ? selectedStory.path.split(/[\\/]/).filter(Boolean).pop() ?? null : null}
                ttsSettings={appSettings?.tts}
                voicePrefs={appSettings?.voice}
                compact
              />
            ) : null}
          </WorkspaceSplitPane>
        )}
        {/* Beta 4 M4 (§4): DOWN (lower 45%) / RIGHT (right 44%) split drop
            zones — mounted only while a workspace tab drag is in flight. */}
        {tabDragPayload && (
          <WorkspaceSplitDropZones
            dragLabel={tabDragPayload.title}
            onDropZone={handleSplitZoneDrop}
          />
        )}
      </div>{/* end desktop-shell__body */}
    </div>
    </PanelDragProvider>
  );
}
