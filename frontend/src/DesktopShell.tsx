import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { Story, Chapter, Scene, Block, Manifest, DraftState, LayoutPrefs, EntityEntry, WritingMode, FocusPrefs } from './types';
import FocusModePrefsDialog from './FocusModePrefsDialog';
import KeyboardShortcutsDialog from './KeyboardShortcutsDialog';
import { applyTheme, applyLiquidNeonTokens } from './theme';
import LeftRail from './LeftRail';
import RightSidebar from './RightSidebar';
import BottomBar from './BottomBar';
import BlockEditor, { type BlockEditorApi } from './BlockEditor';
import type { WLSuggestion } from './WikiLinkHintExtension';
import EntityDetail from './EntityDetail';
import BrainstormPage from './BrainstormPage';
import KanbanBoard from './KanbanBoard';
import VaultGraphView from './VaultGraphView';
import { useTextPrompt } from './useTextPrompt';
import SettingsPanel from './components/SettingsPanel';
import PromptHistoryPanel from './PromptHistoryPanel';
import SceneHistory from './SceneHistory';
import UpdateBanner from './UpdateBanner';
import SearchBar from './SearchBar';
import GlobalSearchPanel from './GlobalSearchPanel';
import BetaReadMargin from './BetaReadMargin';
import ProjectSwitcher from './ProjectSwitcher';
import DepthSlider, { type ViewDepth } from './components/EditorHeader/DepthSlider';
import { useFocusMode } from './useFocusMode';
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

type AppView = 'editor' | 'brainstorm' | 'kanban' | 'graph';

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
}

function AppMenuBar({ view, onSetView, onOpenSettings, onOpenHistory, onSearchNavigate, selectedStoryId, activeVaultRoot, onProjectSwitched, writingMode, onSetWritingMode, onOpenFocusPrefs, onOpenKeyboardShortcuts, onToggleDistractionFree }: AppMenuBarProps) {
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const [helpMenuOpen, setHelpMenuOpen] = useState(false);
  const helpMenuRef = useRef<HTMLDivElement>(null);
  const fileMenuRef = useRef<HTMLDivElement>(null);

  const handleExportEpub = () => {
    if (!selectedStoryId) {
      alert('Select a story first to export it as EPUB.');
      return;
    }
    (window as any).api?.exportEpub?.(selectedStoryId)
      .then((res: { path: string | null; cancelled: boolean }) => {
        if (!res.cancelled && res.path) {
          alert(`EPUB saved to:\n${res.path}`);
        }
      })
      .catch((err: Error) => alert(`Export failed: ${err.message}`));
  };

  const handleExportDocx = () => {
    if (!selectedStoryId) {
      alert('Select a story first to export it as DOCX.');
      return;
    }
    (window as any).api?.exportDocx?.(selectedStoryId)
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
      <ProjectSwitcher activeVaultRoot={activeVaultRoot} onSwitched={onProjectSwitched} />
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
              <button className="app-menu-dropdown-item" role="menuitem" onClick={() => { setFileMenuOpen(false); (window as any).api?.newStory?.(); }}>New Story</button>
              <button className="app-menu-dropdown-item" role="menuitem" onClick={() => { setFileMenuOpen(false); (window as any).api?.openVault?.(); }}>Open Vault…</button>
              <div className="app-menu-separator" role="separator" />
              <button className="app-menu-dropdown-item" role="menuitem" onClick={() => { setFileMenuOpen(false); handleExportEpub(); }}>Export EPUB…</button>
              <button className="app-menu-dropdown-item" role="menuitem" onClick={() => { setFileMenuOpen(false); handleExportDocx(); }}>Export DOCX…</button>
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
                          className={`book-outline-scene${isActiveScene ? ' active-scene' : ''}`}
                          role="button"
                          tabIndex={0}
                          onClick={() => onSelectScene(scene, chapter)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); onSelectScene(scene, chapter); }
                          }}
                          aria-pressed={isActiveScene}
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
  const [budgetToast, setBudgetToast] = useState<string | null>(null);
  const budgetToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [betaReadComments, setBetaReadComments] = useState<BetaReadComment[]>([]);
  const [betaReadLoading, setBetaReadLoading] = useState(false);
  const [focusModePrefsOpen, setFocusModePrefsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [viewDepth, setViewDepth] = useState<ViewDepth>('scene');
  const [showSceneHistory, setShowSceneHistory] = useState(false);
  const [snapshotSavedAt, setSnapshotSavedAt] = useState<string | null>(null);
  const [restoreKey, setRestoreKey] = useState(0);

  const VALID_DEPTHS: ViewDepth[] = ['book', 'chapter', 'scene'];
  const { distractionFree, toggle: toggleDistractionFree } = useFocusMode();
  const [saveState, setSaveState] = useState<'idle' | 'saved'>('idle');
  const saveIndicatorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorApiRef = useRef<BlockEditorApi | null>(null);
  const [wikiLinkSuggestions, setWikiLinkSuggestions] = useState<WLSuggestion[]>([]);

  // SKY-130: cross-restart scene/cursor restore refs
  const pendingCursorPosRef = useRef<number | null>(null);
  const sceneRestoreAttemptedRef = useRef(false);
  const restoreInProgressRef = useRef(false);
  const saveCursorDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleEditorReady = useCallback((api: BlockEditorApi) => {
    editorApiRef.current = api;
  }, []);

  // Restore per-document depth from localStorage when the selected scene changes
  useEffect(() => {
    if (!selectedScene) return;
    const stored = localStorage.getItem(`mythos:depth:${selectedScene.id}`) as ViewDepth | null;
    if (stored && VALID_DEPTHS.includes(stored)) {
      setViewDepth(stored);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedScene?.id]);

  const handleManualSnapshot = useCallback(async () => {
    if (!selectedScene) return;
    const content = selectedScene.blocks.map(b => b.content).join('\n\n');
    try {
      await (window as any).api.snapshotSave?.(selectedScene.id, content);
      setSnapshotSavedAt(new Date().toLocaleTimeString());
    } catch {
      // non-fatal
    }
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
      const res = await (window as any).api.betaReadList(sceneId);
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
  }, [selectedScene?.id, loadBetaReadComments]);

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
      const res = await (window as any).api.agentWritingAssistant(selectedText, context);
      const commentText: string = res?.text ?? 'No feedback generated.';
      await (window as any).api.betaReadCreate(selectedScene.id, selectedText, commentText);
      await loadBetaReadComments(selectedScene.id);
    } catch {
      // non-fatal
    } finally {
      setBetaReadLoading(false);
    }
  }, [selectedScene, betaReadLoading, loadBetaReadComments]);

  const handleBetaReadDismiss = useCallback(async (id: string) => {
    try {
      await (window as any).api.betaReadDismiss(id);
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

  const loadVault = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [m, s, rootResult] = await Promise.all([
        (window as any).api.readManifest() as Promise<Manifest>,
        (window.api.settingsGet?.() ?? Promise.resolve(null)).catch(() => null),
        ((window as any).api.getVaultRoot?.() ?? Promise.resolve(null)).catch(() => null),
      ]);
      setManifest(m);
      setStories(m.stories ?? []);
      if (m.layout) {
        setLayout({ ...DEFAULT_LAYOUT, ...m.layout });
      }
      if (s) {
        setAppSettings(s);
        applyTheme(s.theme);
        // Load background image data URL if a custom path is stored
        const lg = s.liquidNeon;
        if (lg?.background && lg.background !== 'default') {
          (window.api as any).loadBgImage?.(lg.background)
            .then((res: { dataUrl: string | null }) => applyLiquidNeonTokens(lg, res?.dataUrl))
            .catch(() => applyLiquidNeonTokens(lg));
        } else {
          applyLiquidNeonTokens(lg);
        }
      }
      if (rootResult?.vaultRoot) setActiveVaultRoot(rootResult.vaultRoot);
    } catch (e) {
      setError('Failed to load vault: ' + String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadVault();
  }, [loadVault]);

  // Handle project switches pushed from main process
  useEffect(() => {
    if (!(window as any).api?.onProjectSwitched) return;
    const unsub = (window as any).api.onProjectSwitched((data: { vaultRoot: string }) => {
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
      await (window as any).api.writeManifest(m);
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

  const setWritingMode = useCallback((mode: WritingMode) => {
    let newLayout: LayoutPrefs = { ...layout, writingMode: mode };
    if (mode === 'edit') {
      newLayout = { ...newLayout, leftTab: 'review', rightTab: 'ai' };
    }
    persistLayout(newLayout);
  }, [layout, persistLayout]);

  // ─── Writing mode keyboard shortcuts ───
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // ? key (with or without Shift) opens the keyboard shortcuts help dialog,
      // but not when focus is inside a text input or contenteditable.
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
  }, [setWritingMode, setShortcutsOpen, setGlobalSearchOpen]);

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
      await (window as any).api.writeVault(scene.path, blocksToMarkdown(scene));
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
    (window as any).api.snapshotSave?.(selectedScene.id, content).catch(() => {});
    // Flash "Saved" in the distraction-free status bar ~1200ms after the last edit
    if (saveIndicatorTimer.current) clearTimeout(saveIndicatorTimer.current);
    saveIndicatorTimer.current = setTimeout(() => {
      setSaveState('saved');
      saveIndicatorTimer.current = setTimeout(() => setSaveState('idle'), 1500);
    }, 1200);
  }, [selectedScene, selectedChapter, selectedStory, stories, updateManifest, persistSceneMarkdown]);

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
    (window as any).api?.writeVault?.(scene.path, blocksToMarkdown(scene)).catch(() => {});
  }, [stories, updateManifest, requestText]);

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

  const handleSelectScene = useCallback((scene: Scene, chapter: Chapter, story: Story) => {
    setSelectedScene(scene);
    setSelectedChapter(chapter);
    setSelectedStory(story);
    setSelectedEntity(null);
    setVaultContext('file');
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

  // SKY-127: Update window chrome neon border context based on selected vault item
  useEffect(() => {
    if (vaultContext) {
      document.documentElement.setAttribute('data-context', vaultContext);
    } else {
      document.documentElement.removeAttribute('data-context');
    }
  }, [vaultContext]);

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

  // Navigate to a scene from a backlink click by looking it up by path in the loaded stories
  const handleOpenSceneByPath = useCallback((scenePath: string) => {
    for (const story of stories) {
      for (const chapter of story.chapters) {
        const scene = chapter.scenes.find((sc) => sc.path === scenePath);
        if (scene) {
          handleSelectScene(scene, chapter, story);
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
  }, []);

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
      (window as any).api?.entityRead(result.docId)
        .then((entry: EntityEntry | null) => {
          if (entry) {
            handleSelectEntity(entry);
            setView('editor');
          }
        })
        .catch(() => {});
    }
  }, [stories, handleSelectScene, handleSelectEntity]);

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
    if (selectedScene) {
      localStorage.setItem(`mythos:depth:${selectedScene.id}`, newDepth);
    }
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
  const focusPrefs: FocusPrefs = layout.focusPrefs ?? { showLeftSidebar: false, showRightSidebar: false, showBottomBar: false };
  const showLeftSidebar = !distractionFree && (writingMode !== 'focus' || focusPrefs.showLeftSidebar);
  const showRightSidebar = !distractionFree && (writingMode !== 'focus' || focusPrefs.showRightSidebar);
  const showBottomBar = !distractionFree && (writingMode !== 'focus' || focusPrefs.showBottomBar);

  const focusWordCount = selectedScene
    ? selectedScene.blocks.map(b => b.content.trim().split(/\s+/).filter(Boolean).length).reduce((a, c) => a + c, 0)
    : 0;
  const focusReadingMinutes = Math.max(1, Math.round(focusWordCount / 238));

  return (
    <div className={`desktop-shell writing-mode-${writingMode}${distractionFree ? ' distraction-free' : ''}`}>
      <UpdateBanner />
      {!distractionFree && (
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
        />
      )}
      {distractionFree && (
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
      {view === 'brainstorm' && (
        <BrainstormPage onClose={() => setView('editor')} enabled={agentFlags.brainstorm} />
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
      {view === 'editor' && <div className="shell-panels">
      {/* Left rail */}
      {showLeftSidebar && (
        <div className="shell-left" style={{ width: layout.leftWidth }}>
          <LeftRail
            activeTab={layout.leftTab}
            onTabChange={(tab) => persistLayout({ ...layout, leftTab: tab })}
            stories={stories}
            selectedSceneId={selectedScene?.id ?? null}
            selectedEntityId={selectedEntity?.id ?? null}
            onSelectScene={handleSelectScene}
            onSelectEntity={handleSelectEntity}
            onCreateStory={createStory}
            onCreateChapter={createChapter}
            onCreateScene={createScene}
            onReorderScenes={handleReorderScenes}
            onOpenVaultPath={handleOpenSceneByPath}
            onContextChange={setVaultContext}
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
          {selectedStory && !distractionFree && (
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
              <div className="shell-editor-beta-wrap">
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
                  initialCursorPos={pendingCursorPosRef.current ?? undefined}
                  onCursorPosChange={handleCursorPosChange}
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
          ) : (
            <div className="shell-editor-empty">
              <div className="shell-editor-empty-icon">✍️</div>
              <h2>Welcome to Mythos Writer</h2>
              <p>Select a scene from the left panel to start writing.</p>
              <p className="shell-editor-empty-sub">
                No stories yet? Click the <strong>+</strong> button in the Stories panel to create your first story.
              </p>
            </div>
          )}
        </div>
        {showBottomBar && (
          <BottomBar
            selectedScene={selectedScene}
            selectedChapter={selectedChapter}
            selectedStory={selectedStory}
            onNavigateScene={handleNavigateScene}
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
            isPageFocused={view === 'editor'}
            onJumpToText={handleJumpToText}
            onInsertWikiLink={handleInsertWikiLink}
            onWikiLinkSuggestionsChange={setWikiLinkSuggestions}
          />
        </div>
      )}
      </div>}{/* end shell-panels */}
      {budgetToast && (
        <div className="budget-toast" role="alert" aria-live="assertive">
          {budgetToast}
        </div>
      )}
      {globalSearchOpen && (
        <GlobalSearchPanel
          onNavigate={(result) => {
            handleSearchNavigate(result);
            setGlobalSearchOpen(false);
          }}
          onClose={() => setGlobalSearchOpen(false)}
        />
      )}
      {promptModal}
    </div>
  );
}
